import { describe, expect, it } from "vitest";
import {
  PiAgentRuntimeAdapter,
  createPiModelRefFromEnv,
  providerApiKeyEnvVar,
  type AgentRuntimeEvent
} from "@personal-claw/pi-runtime-adapter";

describe("pi runtime adapter", () => {
  it("streams a local PersonalClaw task response through pi-agent-core", async () => {
    const runtime = new PiAgentRuntimeAdapter();
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_test_1",
      sessionId: "session_test_1",
      prompt: "帮我整理今天要完成的三件事"
    })) {
      events.push(event);
    }

    const completed = events.find((event) => event.type === "agent.completed");

    expect(completed?.payload.content).toContain("pi-agent-core");
    expect(completed?.payload.content).toContain("**pi-agent-core**");
    expect(completed?.payload.content).toContain("| 项目 | 当前判断 |");
    expect(completed?.payload.runtime.mode).toBe("local-faux");
  });

  it("rejects unsupported provider names from environment config", () => {
    expect(() => createPiModelRefFromEnv({ PERSONAL_CLAW_PI_PROVIDER: "unknown-provider" })).toThrow(
      "Unsupported PERSONAL_CLAW_PI_PROVIDER"
    );
  });

  it("maps each real provider to its pi-ai api key env var and skips faux", () => {
    expect(providerApiKeyEnvVar("openai")).toBe("OPENAI_API_KEY");
    expect(providerApiKeyEnvVar("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(providerApiKeyEnvVar("deepseek")).toBe("DEEPSEEK_API_KEY");
    expect(providerApiKeyEnvVar("kimi-coding")).toBe("KIMI_API_KEY");
    expect(providerApiKeyEnvVar("faux")).toBeUndefined();
  });

  it("prefers an explicit model ref, then the resolver, then the default", () => {
    const resolverRuntime = new PiAgentRuntimeAdapter({
      modelRefResolver: () => ({ provider: "faux", modelId: "from-resolver" })
    });

    expect(resolverRuntime.describe().model).toBe("from-resolver");

    const explicitRuntime = new PiAgentRuntimeAdapter({
      defaultModelRef: { provider: "faux", modelId: "from-default" },
      modelRefResolver: () => ({ provider: "faux", modelId: "from-resolver" })
    });

    expect(explicitRuntime.describe({ modelRef: { provider: "faux", modelId: "explicit" } }).model).toBe(
      "explicit"
    );
  });

  it("fails fast when a real provider has no api key configured", () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    try {
      const runtime = new PiAgentRuntimeAdapter({
        defaultModelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        apiKeyResolver: () => ""
      });

      expect(() => runtime.describe()).toThrow("Missing API key for provider deepseek");
    } finally {
      if (previous === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previous;
      }
    }
  });

  it("falls back to the default model ref when the resolver throws or returns undefined", () => {
    const throwing = new PiAgentRuntimeAdapter({
      defaultModelRef: { provider: "faux", modelId: "from-default" },
      modelRefResolver: () => {
        throw new Error("config unavailable");
      }
    });

    expect(throwing.describe().model).toBe("from-default");

    const empty = new PiAgentRuntimeAdapter({
      defaultModelRef: { provider: "faux", modelId: "from-default" },
      modelRefResolver: () => undefined
    });

    expect(empty.describe().model).toBe("from-default");
  });

  it("describes a configured OpenAI-compatible custom endpoint", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const runtime = new PiAgentRuntimeAdapter({
        defaultModelRef: {
          provider: "openai",
          modelId: "local-model",
          baseUrl: "http://localhost:11434/v1",
          api: "openai-completions"
        },
        apiKeyResolver: () => "sk-local"
      });

      expect(runtime.describe()).toEqual({
        provider: "openai",
        model: "local-model",
        mode: "provider"
      });
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});

