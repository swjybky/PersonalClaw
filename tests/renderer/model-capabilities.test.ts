import { describe, expect, it } from "vitest";
import {
  defaultThinkingLevelForModel,
  resolveThinkingLevelForModel,
  supportsThinkingLevel
} from "../../apps/desktop/src/renderer/src/modelCapabilities";

describe("renderer model capabilities", () => {
  it("infers thinking support for known DeepSeek thinking models", () => {
    expect(
      supportsThinkingLevel({
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        reasoning: false
      })
    ).toBe(true);

    expect(
      supportsThinkingLevel({
        provider: "deepseek",
        modelId: "deepseek-v4-flash",
        reasoning: undefined
      })
    ).toBe(true);
  });

  it("uses explicit reasoning support before provider inference", () => {
    expect(
      supportsThinkingLevel({
        provider: "openai",
        modelId: "custom-reasoning-model",
        reasoning: true
      })
    ).toBe(true);
  });

  it("forces thinking off for models without thinking support", () => {
    const summary = {
      provider: "openai" as const,
      modelId: "gpt-4.1-mini",
      reasoning: false
    };

    expect(defaultThinkingLevelForModel(summary)).toBe("off");
    expect(resolveThinkingLevelForModel(summary, "high")).toBe("off");
  });
});
