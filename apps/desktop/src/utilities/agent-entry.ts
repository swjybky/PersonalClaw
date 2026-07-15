import {
  CommandEnvelopeSchema,
  CommandResultSchema,
  TaskDraftCreatedEventEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type ModelConfigTestResultPayload,
  type PiRuntimeRef,
  type SystemEventEnvelope
} from "@personal-claw/contracts";
import { createId, nowIso } from "@personal-claw/shared";
import {
  PiAgentRuntimeAdapter,
  createPiModelRefFromEnv,
  type AgentRuntimeEvent,
  type TaskToolExecutor,
  type TaskToolExecutionInput
} from "@personal-claw/pi-runtime-adapter";
import { ModelConfigFileReader } from "./model-config-reader";
import { bootUtility } from "./runtime";
import { buildTaskDraftPreview, buildTaskDraftPrompt } from "./task-draft-planning";

const envModelRef = createPiModelRefFromEnv(process.env);
const modelConfigReader = new ModelConfigFileReader(process.env.PERSONAL_CLAW_USER_DATA_DIR);
const requestTimeoutMs = readPositiveInteger(process.env.PERSONAL_CLAW_AGENT_PROMPT_TIMEOUT_MS);
const forceFauxProvider = process.env.PERSONAL_CLAW_PI_FORCE_FAUX === "1";
const coreToolCommandTimeoutMs = readPositiveInteger(process.env.PERSONAL_CLAW_CORE_TOOL_TIMEOUT_MS) ?? 60_000;

interface PendingCoreCommand {
  resolve(value: CommandResult): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  abortListener?: () => void;
  signal?: AbortSignal;
}

const pendingCoreCommands = new Map<string, PendingCoreCommand>();

const runtime = new PiAgentRuntimeAdapter({
  ...(forceFauxProvider
    ? { defaultModelRef: { provider: "faux" as const } }
    : envModelRef
      ? { defaultModelRef: envModelRef }
      : {}),
  ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
  modelRefResolver: () => {
    if (forceFauxProvider) {
      return undefined;
    }

    const resolved = modelConfigReader.resolveDefault();
    return resolved?.modelRef;
  },
  apiKeyResolver: (provider) => {
    const resolved = modelConfigReader.resolveDefault();
    return resolved && resolved.provider === provider ? resolved.apiKey : undefined;
  },
  taskToolExecutor: executeCoreTaskTool
});

if (process.parentPort) {
  process.parentPort.on("message", handleCoreCommandResultMessage);
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapMessage(message: unknown): unknown {
  if (isRecord(message) && "data" in message) {
    return message.data;
  }

  return message;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function cleanupPendingCoreCommand(requestId: string): PendingCoreCommand | undefined {
  const pending = pendingCoreCommands.get(requestId);

  if (!pending) {
    return undefined;
  }

  clearTimeout(pending.timer);
  if (pending.abortListener) {
    pending.signal?.removeEventListener("abort", pending.abortListener);
  }
  pendingCoreCommands.delete(requestId);
  return pending;
}

function handleCoreCommandResultMessage(message: unknown): void {
  const raw = unwrapMessage(message);

  if (!isRecord(raw) || raw.kind !== "utility.core_command.result" || raw.worker !== "agent") {
    return;
  }

  const requestId = readString(raw, "requestId");
  const pending = requestId ? cleanupPendingCoreCommand(requestId) : undefined;

  if (!requestId || !pending) {
    return;
  }

  const parsed = CommandResultSchema.safeParse(raw.result);

  if (parsed.success) {
    pending.resolve(parsed.data);
    return;
  }

  pending.reject(new Error("Core command bridge returned an invalid CommandResult."));
}

function normalizeTaskToolPayload(input: TaskToolExecutionInput): Record<string, unknown> {
  const payload = isRecord(input.args) ? { ...input.args } : {};

  if (
    (input.commandType === "task.create" || input.commandType === "task.list") &&
    !isNonEmptyString(payload.projectId) &&
    input.projectId
  ) {
    payload.projectId = input.projectId;
  }

  if (
    (input.commandType === "task.get" ||
      input.commandType === "task.update" ||
      input.commandType === "task.updateProgress") &&
    !isNonEmptyString(payload.id) &&
    input.taskId
  ) {
    payload.id = input.taskId;
  }

  if (input.commandType === "task.create" && !isRecord(payload.source)) {
    payload.source = {
      kind: "conversation",
      label: "AI conversation",
      ...(input.sessionId ? { referenceId: input.sessionId } : {})
    };
  }

  return payload;
}

function createCoreCommandForTaskTool(input: TaskToolExecutionInput): CommandEnvelope {
  const payload = normalizeTaskToolPayload(input);

  return CommandEnvelopeSchema.parse(
    createEnvelope(input.commandType, payload, {
      id: createId("cmd_tool"),
      context: {
        correlationId: input.toolCallId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {})
      }
    })
  );
}

function requestCoreCommand(command: CommandEnvelope, signal?: AbortSignal): Promise<CommandResult> {
  const port = process.parentPort;

  if (!port) {
    return Promise.resolve({
      status: "rejected",
      requestId: command.id,
      error: {
        code: "agent.core_bridge_unavailable",
        message: "Agent utility cannot reach the Core command bridge."
      }
    });
  }

  if (signal?.aborted) {
    return Promise.reject(new Error(`Core command aborted before dispatch: ${command.type}`));
  }

  return new Promise<CommandResult>((resolve, reject) => {
    const requestId = command.id;
    const timer = setTimeout(() => {
      cleanupPendingCoreCommand(requestId);
      reject(new Error(`Core command timed out: ${command.type}`));
    }, coreToolCommandTimeoutMs);
    const abortListener = signal
      ? () => {
          cleanupPendingCoreCommand(requestId);
          reject(new Error(`Core command aborted: ${command.type}`));
        }
      : undefined;

    timer.unref();
    if (signal && abortListener) {
      signal.addEventListener("abort", abortListener, { once: true });
    }

    pendingCoreCommands.set(requestId, {
      resolve,
      reject,
      timer,
      ...(abortListener ? { abortListener } : {}),
      ...(signal ? { signal } : {})
    });

    port.postMessage({
      kind: "utility.core_command.request",
      worker: "agent",
      requestId,
      command
    });
  });
}

function stringifyToolPayload(value: unknown): string {
  const text = JSON.stringify(value, null, 2);

  if (text.length <= 4000) {
    return text;
  }

  return `${text.slice(0, 4000)}\n...`;
}

async function executeCoreTaskTool(
  input: TaskToolExecutionInput
): Promise<Awaited<ReturnType<TaskToolExecutor>>> {
  const command = createCoreCommandForTaskTool(input);
  const result = await requestCoreCommand(command, input.signal);

  if (result.status === "accepted") {
    return {
      content: [
        {
          type: "text" as const,
          text: `Core accepted ${input.toolName} (${input.commandType}).\n\n${stringifyToolPayload(result.payload)}`
        }
      ],
      details: {
        toolName: input.toolName,
        commandType: input.commandType,
        routedThrough: "core",
        status: "accepted",
        requestId: result.requestId,
        payload: result.payload
      }
    };
  }

  throw new Error(`Core rejected ${input.toolName} (${input.commandType}): ${result.error.message}`);
}

function toEventEnvelope(event: AgentRuntimeEvent, correlationId: string): SystemEventEnvelope {
  const context = {
    correlationId,
    runId: event.runId,
    ...(event.sessionId ? { sessionId: event.sessionId } : {})
  };

  if (event.type === "agent.delta") {
    return createEnvelope(
      "agent.message_delta",
      {
        sessionId: event.sessionId ?? "default",
        runId: event.runId,
        messageId: event.payload.messageId,
        delta: event.payload.delta,
        runtime: event.payload.runtime
      },
      {
        id: createId("evt"),
        context
      }
    );
  }

  if (event.type === "agent.thinking_delta") {
    return createEnvelope(
      "agent.thinking_delta",
      {
        sessionId: event.sessionId ?? "default",
        runId: event.runId,
        messageId: event.payload.messageId,
        delta: event.payload.delta,
        runtime: event.payload.runtime
      },
      {
        id: createId("evt"),
        context
      }
    );
  }

  if (event.type === "agent.completed") {
    return createEnvelope(
      "agent.message_completed",
      {
        sessionId: event.sessionId ?? "default",
        runId: event.runId,
        messageId: event.payload.messageId,
        role: "assistant" as const,
        content: event.payload.content,
        runtime: event.payload.runtime,
        ...(event.payload.thinking ? { thinking: event.payload.thinking } : {}),
        ...(event.payload.stopReason ? { stopReason: event.payload.stopReason } : {}),
        ...(event.payload.usage ? { usage: event.payload.usage } : {})
      },
      {
        id: createId("evt"),
        context
      }
    );
  }

  if (event.type === "agent.tool_requested") {
    return createEnvelope(
      "tool.call_requested",
      {
        sessionId: event.sessionId ?? "default",
        runId: event.runId,
        toolCallId: event.payload.toolCallId,
        toolName: event.payload.toolName,
        args: event.payload.args,
        runtime: event.payload.runtime
      },
      {
        id: createId("evt"),
        context
      }
    );
  }

  return createEnvelope(
    "agent.error",
    {
      sessionId: event.sessionId ?? "default",
      runId: event.runId,
      code: event.payload.code,
      message: event.payload.message,
      ...(event.payload.details ? { details: event.payload.details } : {}),
      ...(event.payload.runtime ? { runtime: event.payload.runtime } : {})
    },
    {
      id: createId("evt"),
      context
    }
  );
}

function streamPrompt(
  input: {
    runId: string;
    sessionId: string;
    projectId?: string;
    taskId?: string;
    prompt: string;
    toolMode?: "task_management" | "none";
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
  },
  correlationId: string,
  emitEvent: (event: SystemEventEnvelope) => void,
  options: {
    onCompleted?: (event: Extract<AgentRuntimeEvent, { type: "agent.completed" }>) => void;
  } = {}
): void {
  void (async () => {
    for await (const event of runtime.start(input)) {
      emitEvent(toEventEnvelope(event, correlationId));

      if (event.type === "agent.completed") {
        options.onCompleted?.(event);
      }
    }
  })().catch((error: unknown) => {
    emitEvent(
      createEnvelope(
        "agent.error",
        {
          sessionId: input.sessionId,
          runId: input.runId,
          code: "agent.stream_failed",
          message: error instanceof Error ? error.message : "Agent stream failed.",
          ...(error ? { details: error } : {})
        },
        {
          id: createId("evt"),
          context: {
            correlationId,
            sessionId: input.sessionId,
            runId: input.runId
          }
        }
      )
    );
  });
}

function emitTaskDraftCreated(input: {
  draftId: string;
  sessionId: string;
  runId: string;
  description: string;
  assistantText: string;
  runtime: PiRuntimeRef;
  correlationId: string;
  maxIterations: number;
  emitEvent: (event: SystemEventEnvelope) => void;
}): void {
  const draft = buildTaskDraftPreview({
    draftId: input.draftId,
    description: input.description,
    assistantText: input.assistantText,
    createdAt: nowIso(),
    maxIterations: input.maxIterations
  });

  input.emitEvent(
    TaskDraftCreatedEventEnvelopeSchema.parse(
      createEnvelope(
        "task.draft_created",
        {
          sessionId: input.sessionId,
          runId: input.runId,
          draft,
          runtime: input.runtime
        },
        {
          id: createId("evt"),
          context: {
            correlationId: input.correlationId,
            sessionId: input.sessionId,
            runId: input.runId
          }
        }
      )
    )
  );
}

async function testModelConfig(id: string): Promise<ModelConfigTestResultPayload> {
  const startedAt = Date.now();
  const resolved = modelConfigReader.resolveById(id);

  if (!resolved) {
    return {
      id,
      status: "failed",
      checkedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      message: "未找到对应的模型配置。"
    };
  }

  if (resolved.provider !== "faux" && !resolved.apiKey) {
    return {
      id,
      status: "failed",
      checkedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      runtime: {
        provider: resolved.provider,
        model: resolved.modelRef.modelId ?? resolved.label,
        mode: "provider"
      },
      message: "API Key 未配置，无法测试真实 provider。"
    };
  }

  const testRuntime = new PiAgentRuntimeAdapter({
    defaultModelRef: resolved.modelRef,
    requestTimeoutMs: requestTimeoutMs ?? 20_000,
    apiKeyResolver: (provider) => (provider === resolved.provider ? resolved.apiKey : undefined)
  });

  let runtimeRef: ModelConfigTestResultPayload["runtime"];

  try {
    runtimeRef = testRuntime.describe({ modelRef: resolved.modelRef });

    for await (const event of testRuntime.start({
      runId: createId("model_test_run"),
      sessionId: `model-test-${id}`,
      prompt: "请只回复 OK，用于 PersonalClaw 模型配置连通性测试。",
      toolMode: "none",
      thinkingLevel: "off",
      modelRef: resolved.modelRef
    })) {
      if (event.type === "agent.completed") {
        runtimeRef = event.payload.runtime;
        return {
          id,
          status: "ok",
          checkedAt: nowIso(),
          latencyMs: Date.now() - startedAt,
          runtime: runtimeRef,
          message: "模型连通性测试通过。"
        };
      }

      if (event.type === "agent.error") {
        if (event.payload.runtime) {
          runtimeRef = event.payload.runtime;
        }

        return {
          id,
          status: "failed",
          checkedAt: nowIso(),
          latencyMs: Date.now() - startedAt,
          runtime: runtimeRef,
          message: event.payload.message
        };
      }
    }

    return {
      id,
      status: "failed",
      checkedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      runtime: runtimeRef,
      message: "模型测试未返回完成事件。"
    };
  } catch (error: unknown) {
    return {
      id,
      status: "failed",
      checkedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      runtime: runtimeRef,
      message: error instanceof Error ? error.message : "模型测试失败。"
    };
  }
}

bootUtility("agent", {
  async commandHandler(command, emitEvent): Promise<CommandResult> {
    if (command.type === "modelConfig.test") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: await testModelConfig(command.payload.id)
      };
    }

    if (command.type === "task.draftFromDescription") {
      const runId = createId("run");
      const draftId = createId("draft");
      const sessionId = command.payload.sessionId ?? createId("session");
      const correlationId = command.context?.correlationId ?? command.id;
      const runtimeRef = runtime.describe();
      const maxIterations = command.payload.loop?.maxIterations ?? 4;
      const prompt = buildTaskDraftPrompt(command.payload.description, maxIterations);

      streamPrompt(
        {
          runId,
          sessionId,
          prompt,
          toolMode: "none",
          ...(command.payload.thinkingLevel ? { thinkingLevel: command.payload.thinkingLevel } : {})
        },
        correlationId,
        emitEvent,
        {
          onCompleted(event) {
            emitTaskDraftCreated({
              draftId,
              sessionId,
              runId,
              description: command.payload.description,
              assistantText: event.payload.content,
              runtime: event.payload.runtime,
              correlationId,
              maxIterations,
              emitEvent
            });
          }
        }
      );

      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          draftId,
          sessionId,
          runId,
          acceptedAt: nowIso(),
          runtime: runtimeRef
        }
      };
    }

    if (command.type !== "session.prompt") {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent.unsupported_command",
          message: `Agent utility does not support ${command.type}.`
        }
      };
    }

    const runId = createId("run");
    const correlationId = command.context?.correlationId ?? command.id;
    const runtimeRef = runtime.describe();

    streamPrompt(
      {
        runId,
        sessionId: command.payload.sessionId,
        ...(command.payload.projectId ? { projectId: command.payload.projectId } : {}),
        ...(command.payload.taskId ? { taskId: command.payload.taskId } : {}),
        prompt: command.payload.message,
        ...(command.payload.thinkingLevel ? { thinkingLevel: command.payload.thinkingLevel } : {})
      },
      correlationId,
      emitEvent
    );

    return {
      status: "accepted",
      requestId: command.id,
      payload: {
        sessionId: command.payload.sessionId,
        runId,
        acceptedAt: nowIso(),
        runtime: runtimeRef
      }
    };
  }
});
