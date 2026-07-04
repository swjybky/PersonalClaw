import type { ModelConfigSummary, ThinkingLevel } from "@personal-claw/contracts";

type CapabilitySummary = Pick<ModelConfigSummary, "provider" | "modelId" | "reasoning">;

const deepSeekThinkingModelPatterns: readonly RegExp[] = [
  /^deepseek[-_ ]?v4[-_ ]?(flash|pro)$/i,
  /^deepseek[-_ ]?reasoner$/i,
  /^deepseek[-_ ]?r1/i
];

export function supportsThinkingLevel(summary: CapabilitySummary | undefined): boolean {
  if (!summary) {
    return false;
  }

  if (summary.reasoning === true) {
    return true;
  }

  const modelId = summary.modelId.trim();

  if (summary.provider === "deepseek") {
    return deepSeekThinkingModelPatterns.some((pattern) => pattern.test(modelId));
  }

  return false;
}

export function defaultThinkingLevelForModel(summary: CapabilitySummary | undefined): ThinkingLevel {
  return supportsThinkingLevel(summary) ? "medium" : "off";
}

export function resolveThinkingLevelForModel(
  summary: CapabilitySummary | undefined,
  requestedLevel: ThinkingLevel
): ThinkingLevel {
  return supportsThinkingLevel(summary) ? requestedLevel : "off";
}
