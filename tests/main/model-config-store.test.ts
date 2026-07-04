import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelConfigStore, resolveModelConfigPath } from "../../apps/desktop/src/main/model-config-store";

describe("main model config store", () => {
  let tempDir: string;
  let store: ModelConfigStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pc-model-config-"));
    store = new ModelConfigStore(resolveModelConfigPath(tempDir));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts empty with no default model", () => {
    const list = store.list();

    expect(list.summaries).toEqual([]);
    expect(list.defaultModelId).toBeNull();
  });

  it("persists an entry and marks the first entry as default", () => {
    const result = store.upsert({
      id: "deepseek-flash",
      label: "DeepSeek Flash",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKey: "sk-test"
    });

    expect(result.defaultModelId).toBe("deepseek-flash");
    expect(result.summaries[0]?.hasSecret).toBe(true);
    expect(result.summaries[0]?.secretRef).toBe("model-config:deepseek-flash");
  });

  it("never returns the raw api key in summaries", () => {
    const result = store.upsert({
      id: "openai-mini",
      label: "OpenAI Mini",
      provider: "openai",
      modelId: "gpt-4o-mini",
      apiKey: "sk-secret"
    });

    const summary = result.summaries[0];

    expect(summary).toBeDefined();
    expect(JSON.stringify(summary)).not.toContain("sk-secret");
    expect(Object.keys(summary ?? {})).not.toContain("apiKey");
  });

  it("updates an existing entry by id and preserves the default flag", () => {
    store.upsert({
      id: "kimi",
      label: "Kimi",
      provider: "kimi-coding",
      modelId: "kimi-k2",
      apiKey: "sk-kimi"
    });

    const updated = store.upsert({
      id: "kimi",
      label: "Kimi Coding",
      provider: "kimi-coding",
      modelId: "kimi-k2",
      apiKey: "sk-kimi-2"
    });

    expect(updated.summaries).toHaveLength(1);
    expect(updated.summaries[0]?.label).toBe("Kimi Coding");
    expect(updated.defaultModelId).toBe("kimi");
  });

  it("preserves an existing api key when editing without a replacement key", () => {
    store.upsert({
      id: "deepseek-pro",
      label: "DeepSeek Pro",
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      apiKey: "sk-existing"
    });

    const updated = store.upsert({
      id: "deepseek-pro",
      label: "DeepSeek Pro Reasoning",
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      reasoning: true
    });

    expect(updated.summaries[0]?.hasSecret).toBe(true);
    expect(updated.summaries[0]?.label).toBe("DeepSeek Pro Reasoning");
  });

  it("switches the default back to the first entry when the default is deleted", () => {
    store.upsert({
      id: "openai-mini",
      label: "OpenAI Mini",
      provider: "openai",
      modelId: "gpt-4o-mini",
      apiKey: "sk-openai"
    });
    store.upsert({
      id: "deepseek-flash",
      label: "DeepSeek Flash",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      apiKey: "sk-deepseek"
    });
    store.setDefault("deepseek-flash");

    const afterDelete = store.delete("deepseek-flash");

    expect(afterDelete.summaries.map((summary) => summary.id)).toEqual(["openai-mini"]);
    expect(afterDelete.defaultModelId).toBe("openai-mini");
  });

  it("marks a provider without an api key as missing secret", () => {
    const result = store.upsert({
      id: "no-key",
      label: "No Key",
      provider: "anthropic",
      modelId: "claude-3-5-sonnet",
      apiKey: ""
    });

    expect(result.summaries[0]?.hasSecret).toBe(false);
  });

  it("survives a malformed config file by resetting to an empty store", () => {
    const path = resolveModelConfigPath(tempDir);
    writeFileSync(path, "{ not valid json", "utf8");
    const malformed = new ModelConfigStore(path);

    expect(malformed.list().summaries).toEqual([]);
  });
});
