import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
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
});
