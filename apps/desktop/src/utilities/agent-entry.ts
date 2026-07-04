import { createEnvelope, type CommandResult, type SystemEventEnvelope } from "@personal-claw/contracts";
import { createId, nowIso } from "@personal-claw/shared";
import { PiAgentRuntimeAdapter, createPiModelRefFromEnv, type AgentRuntimeEvent } from "@personal-claw/pi-runtime-adapter";
import { ModelConfigFileReader } from "./model-config-reader";
import { bootUtility } from "./runtime";

const envModelRef = createPiModelRefFromEnv(process.env);
const modelConfigReader = new ModelConfigFileReader(process.env.PERSONAL_CLAW_USER_DATA_DIR);

const runtime = new PiAgentRuntimeAdapter({
  ...(envModelRef ? { defaultModelRef: envModelRef } : {}),
  modelRefResolver: () => {
    const resolved = modelConfigReader.resolveDefault();
    return resolved?.modelRef;
  },
  apiKeyResolver: (provider) => {
    const resolved = modelConfigReader.resolveDefault();
    return resolved && resolved.provider === provider ? resolved.apiKey : undefined;
  }
});

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
  },
  correlationId: string,
  emitEvent: (event: SystemEventEnvelope) => void
): void {
  void (async () => {
    for await (const event of runtime.start(input)) {
      emitEvent(toEventEnvelope(event, correlationId));
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

bootUtility("agent", {
  commandHandler(command, emitEvent): CommandResult {
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
        prompt: command.payload.message
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
