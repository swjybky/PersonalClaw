import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  ModelConfigEntryInputSchema,
  ModelConfigSummaryListPayloadSchema,
  ModelConfigSummarySchema,
  createEnvelope
} from "@personal-claw/contracts";

describe("model config contracts", () => {
  it("accepts a modelConfig.upsert command with a write-only api key", () => {
    const envelope = createEnvelope(
      "modelConfig.upsert",
      {
        entry: {
          id: "deepseek-flash",
          label: "DeepSeek Flash",
          provider: "deepseek",
          modelId: "deepseek-v4-flash",
          apiKey: "sk-test-key"
        }
      },
      { id: "cmd_model_1" }
    );

    const parsed = CommandEnvelopeSchema.parse(envelope);

    expect(parsed.type).toBe("modelConfig.upsert");
    expect(ModelConfigEntryInputSchema.parse((parsed.payload as { entry: { apiKey: string } }).entry).apiKey)
      .toBe("sk-test-key");
  });

  it("rejects an unknown model provider", () => {
    const result = ModelConfigEntryInputSchema.safeParse({
      id: "bad",
      label: "Bad",
      provider: "not-a-provider",
      modelId: "model-x"
    });

    expect(result.success).toBe(false);
  });

  it("summary never exposes the raw api key and carries a secretRef", () => {
    const summary = {
      id: "deepseek-flash",
      label: "DeepSeek Flash",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      hasSecret: true,
      secretRef: "model-config:deepseek-flash"
    };

    const parsed = ModelConfigSummarySchema.parse(summary);

    expect(parsed.hasSecret).toBe(true);
    expect(parsed.secretRef).toBe("model-config:deepseek-flash");
    expect(Object.keys(parsed)).not.toContain("apiKey");
  });

  it("summary list payload reports the default model id or null", () => {
    const withDefault = ModelConfigSummaryListPayloadSchema.parse({
      summaries: [
        {
          id: "faux",
          label: "本地 Faux",
          provider: "faux",
          modelId: "personal-task-manager",
          hasSecret: false,
          secretRef: "model-config:faux"
        }
      ],
      defaultModelId: "faux",
      version: 1
    });

    expect(withDefault.defaultModelId).toBe("faux");

    const empty = ModelConfigSummaryListPayloadSchema.parse({
      summaries: [],
      defaultModelId: null,
      version: 1
    });

    expect(empty.defaultModelId).toBeNull();
  });

  it("routes modelConfig.delete and modelConfig.setDefault through the command union", () => {
    const del = createEnvelope("modelConfig.delete", { id: "deepseek-flash" }, { id: "cmd_del" });
    const setDefault = createEnvelope(
      "modelConfig.setDefault",
      { id: "deepseek-flash" },
      { id: "cmd_default" }
    );

    expect(CommandEnvelopeSchema.parse(del).type).toBe("modelConfig.delete");
    expect(CommandEnvelopeSchema.parse(setDefault).type).toBe("modelConfig.setDefault");
  });
});
