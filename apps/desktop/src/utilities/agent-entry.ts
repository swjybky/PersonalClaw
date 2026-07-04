import {
  createEnvelope,
  type CommandResult,
  type ModelConfigTestResultPayload,
  type PiRuntimeRef,
  type SystemEventEnvelope,
  type TaskDraftPreview,
  type TaskDraftStep
} from "@personal-claw/contracts";
import { createId, nowIso } from "@personal-claw/shared";
import { PiAgentRuntimeAdapter, createPiModelRefFromEnv, type AgentRuntimeEvent } from "@personal-claw/pi-runtime-adapter";
import { ModelConfigFileReader } from "./model-config-reader";
import { bootUtility } from "./runtime";

const envModelRef = createPiModelRefFromEnv(process.env);
const modelConfigReader = new ModelConfigFileReader(process.env.PERSONAL_CLAW_USER_DATA_DIR);
const requestTimeoutMs = readPositiveInteger(process.env.PERSONAL_CLAW_AGENT_PROMPT_TIMEOUT_MS);
const forceFauxProvider = process.env.PERSONAL_CLAW_PI_FORCE_FAUX === "1";

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
  }
});

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
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
    taskId?: string;
    prompt: string;
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

function buildTaskDraftPrompt(description: string, maxIterations: number): string {
  return [
    "You are the PersonalClaw loop agent for task intake.",
    "Turn the user's natural-language description into an executable task draft.",
    "Stay inside draft mode: do not execute tools, do not claim persistent state was created, and do not skip approval.",
    `Run at most ${maxIterations} loop passes: intake, analysis, plan design, approval gate.`,
    "",
    "Return a concise draft with these sections:",
    "1. Objective",
    "2. Missing information",
    "3. Suggested automation level",
    "4. Draft steps",
    "5. Approval notes",
    "",
    "User description:",
    description
  ].join("\n");
}

function buildTaskDraftPreview(input: {
  draftId: string;
  description: string;
  assistantText: string;
  createdAt: string;
  maxIterations: number;
}): TaskDraftPreview {
  const normalizedDescription = input.description.trim().replace(/\s+/g, " ");
  const objective = normalizedDescription || "Clarify the personal task objective.";
  const title = makeDraftTitle(objective);
  const stepSeed = createId("draft_step");
  const steps: TaskDraftStep[] = [
    {
      id: `${stepSeed}_1`,
      sequence: 1,
      type: "human_input",
      title: "Confirm task boundary",
      goal: "Confirm the project, expected result, deadline, and what the assistant may inspect.",
      dependsOn: [],
      requiredPermissions: [],
      expectedSideEffects: [],
      successCriteria: ["User confirms scope and completion criteria."],
      retryStrategy: "Ask one focused clarification round if scope is still ambiguous.",
      rollbackNotes: "No external state changes are made during clarification."
    },
    {
      id: `${stepSeed}_2`,
      sequence: 2,
      type: "agent",
      title: "Refine analysis",
      goal: "Convert the confirmed objective into constraints, assumptions, risks, and deliverables.",
      dependsOn: [`${stepSeed}_1`],
      requiredPermissions: [],
      expectedSideEffects: [],
      successCriteria: ["Task analysis is editable and reviewable by the user."],
      retryStrategy: "Regenerate the analysis from the latest confirmed description.",
      rollbackNotes: "Discard the draft version and keep the previous reviewed draft."
    },
    {
      id: `${stepSeed}_3`,
      sequence: 3,
      type: "agent",
      title: "Draft execution plan",
      goal: "Create ordered steps with dependencies, verification checks, and approval gates.",
      dependsOn: [`${stepSeed}_2`],
      requiredPermissions: [],
      expectedSideEffects: [],
      successCriteria: ["Every step has a clear goal, dependency, and success criterion."],
      retryStrategy: "Split any vague step into smaller reviewable steps.",
      rollbackNotes: "Keep the prior plan version until the new draft is approved."
    },
    {
      id: `${stepSeed}_4`,
      sequence: 4,
      type: "approval",
      title: "Request plan approval",
      goal: "Wait for the user to approve or edit the draft before any execution phase.",
      dependsOn: [`${stepSeed}_3`],
      requiredPermissions: ["user.plan_approval"],
      expectedSideEffects: [],
      successCriteria: ["The user explicitly approves the plan version."],
      retryStrategy: "Return to plan editing if the user rejects or changes the draft.",
      rollbackNotes: "Unapproved plans never execute tools."
    }
  ];

  return {
    draftId: input.draftId,
    status: "draft",
    title,
    objective,
    source: {
      kind: "manual_description",
      description: input.description
    },
    suggestedAutomationLevel: "L0",
    assumptions: [
      "The draft is a review artifact, not a persisted Task/Plan/Run state.",
      "No tools are executed until a later Policy Engine and approval path allow them."
    ],
    constraints: [
      "Renderer has no Node, filesystem, SQLite, key, or pi SDK access.",
      "Tool calls remain blocked before Policy Engine approval.",
      "Task/Plan/Run persistence must be owned by Core in a later phase."
    ],
    missingInformation: [
      "Target project or workspace",
      "Definition of done",
      "Deadline or priority",
      "Allowed context and data sources"
    ],
    expectedArtifacts: ["Editable task analysis", "Draft plan steps", "Approval-ready task summary"],
    loopIterations: [
      {
        index: 1,
        phase: "intake",
        status: "done",
        summary: "Captured the user description as manual task input."
      },
      {
        index: 2,
        phase: "analysis",
        status: "done",
        summary: "Separated objective, assumptions, constraints, and missing information."
      },
      {
        index: 3,
        phase: "plan_design",
        status: "done",
        summary: "Prepared a non-executing plan preview with dependencies and verification."
      },
      {
        index: 4,
        phase: "approval_gate",
        status: "active",
        summary: "Waiting for user review before any future execution path."
      }
    ],
    steps,
    approvalRequired: true,
    generatedSummary: input.assistantText.trim() || "The loop agent produced an empty draft summary.",
    createdAt: input.createdAt
  };
}

function makeDraftTitle(objective: string): string {
  const compact = objective.replace(/[.!?。！？]+$/u, "").trim();
  const title = compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;

  return title || "Untitled task draft";
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
