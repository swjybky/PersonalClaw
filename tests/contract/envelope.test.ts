import { describe, expect, it } from "vitest";
import {
  AgentMessageCompletedEventEnvelopeSchema,
  AgentThinkingDeltaEventEnvelopeSchema,
  CommandEnvelopeSchema,
  SessionPromptAcceptedPayloadSchema,
  SystemHealthPayloadSchema,
  createEnvelope
} from "@personal-claw/contracts";

describe("IPC envelope contracts", () => {
  it("accepts a versioned system.health command", () => {
    const envelope = createEnvelope("system.health", {}, { id: "cmd_1" });

    expect(CommandEnvelopeSchema.parse(envelope).protocolVersion).toBe(1);
  });

  it("rejects an unsupported protocol version", () => {
    const envelope = {
      protocolVersion: 2,
      id: "cmd_1",
      type: "system.health",
      timestamp: new Date().toISOString(),
      payload: {}
    };

    expect(CommandEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });

  it("validates system health payload shape", () => {
    const payload = {
      status: "ok",
      checkedAt: new Date().toISOString(),
      workers: [
        {
          name: "core",
          status: "ok",
          pid: 123,
          startedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString()
        }
      ]
    };

    expect(SystemHealthPayloadSchema.parse(payload).workers[0]?.name).toBe("core");
  });

  it("accepts a versioned session.prompt command", () => {
    const envelope = createEnvelope(
      "session.prompt",
      {
        sessionId: "session_1",
        message: "整理今天的个人任务",
        thinkingLevel: "medium"
      },
      {
        id: "cmd_session_1",
        context: {
          correlationId: "cmd_session_1"
        }
      }
    );

    expect(CommandEnvelopeSchema.parse(envelope).type).toBe("session.prompt");
  });

  it("accepts agent thinking delta events", () => {
    const envelope = createEnvelope(
      "agent.thinking_delta",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        delta: "正在分析用户意图。",
        runtime: {
          provider: "deepseek",
          model: "deepseek-v4-pro",
          mode: "provider"
        }
      },
      {
        id: "evt_thinking_1"
      }
    );

    expect(AgentThinkingDeltaEventEnvelopeSchema.parse(envelope).payload.delta).toContain("分析");
  });

  it("validates pi runtime prompt acceptance payloads", () => {
    const payload = {
      sessionId: "session_1",
      runId: "run_1",
      acceptedAt: new Date().toISOString(),
      runtime: {
        provider: "personal-claw",
        model: "personal-task-manager",
        mode: "local-faux"
      }
    };

    expect(SessionPromptAcceptedPayloadSchema.parse(payload).runtime.mode).toBe("local-faux");
  });

  it("accepts agent message completed events", () => {
    const envelope = createEnvelope(
      "agent.message_completed",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        role: "assistant",
        content: "任务草稿已生成。",
        runtime: {
          provider: "personal-claw",
          model: "personal-task-manager",
          mode: "local-faux"
        }
      },
      {
        id: "evt_1",
        context: {
          correlationId: "cmd_session_1",
          sessionId: "session_1",
          runId: "run_1"
        }
      }
    );

    expect(AgentMessageCompletedEventEnvelopeSchema.parse(envelope).payload.role).toBe("assistant");
  });
});
