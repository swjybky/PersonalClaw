import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelConfigFileReader } from "../../apps/desktop/src/utilities/model-config-reader";

describe("agent model config file reader", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pc-agent-config-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("is unavailable when the user data dir is missing or the file does not exist", () => {
    expect(new ModelConfigFileReader(undefined).isAvailable()).toBe(false);
    expect(new ModelConfigFileReader(tempDir).isAvailable()).toBe(false);
  });

  it("resolves the default real provider entry with its api key", () => {
    writeFileSync(
      join(tempDir, "model-config.json"),
      JSON.stringify({
        version: 1,
        defaultModelId: "deepseek-flash",
        entries: [
          {
            id: "deepseek-flash",
            label: "DeepSeek Flash",
            provider: "deepseek",
            modelId: "deepseek-v4-flash",
            apiKey: "sk-deepseek"
          }
        ]
      }),
      "utf8"
    );

    const resolved = new ModelConfigFileReader(tempDir).resolveDefault();

    expect(resolved?.provider).toBe("deepseek");
    expect(resolved?.modelRef).toEqual({ provider: "deepseek", modelId: "deepseek-v4-flash" });
    expect(resolved?.apiKey).toBe("sk-deepseek");
  });

  it("returns undefined when the default model is the faux provider", () => {
    writeFileSync(
      join(tempDir, "model-config.json"),
      JSON.stringify({
        version: 1,
        defaultModelId: "faux",
        entries: [
          {
            id: "faux",
            label: "Local Faux",
            provider: "faux",
            modelId: "personal-task-manager",
            apiKey: ""
          }
        ]
      }),
      "utf8"
    );

    expect(new ModelConfigFileReader(tempDir).resolveDefault()).toBeUndefined();
  });

  it("resolves a selected faux provider entry for connectivity testing", () => {
    writeFileSync(
      join(tempDir, "model-config.json"),
      JSON.stringify({
        version: 1,
        defaultModelId: "faux",
        entries: [
          {
            id: "faux",
            label: "Local Faux",
            provider: "faux",
            modelId: "personal-task-manager",
            apiKey: ""
          }
        ]
      }),
      "utf8"
    );

    const resolved = new ModelConfigFileReader(tempDir).resolveById("faux");

    expect(resolved?.label).toBe("Local Faux");
    expect(resolved?.provider).toBe("faux");
    expect(resolved?.modelRef).toEqual({ provider: "faux", modelId: "personal-task-manager" });
  });

  it("resolves custom endpoint fields for runtime adapter testing", () => {
    writeFileSync(
      join(tempDir, "model-config.json"),
      JSON.stringify({
        version: 1,
        defaultModelId: "openai-custom",
        entries: [
          {
            id: "openai-custom",
            label: "OpenAI Compatible",
            provider: "openai",
            modelId: "local-model",
            baseUrl: "http://localhost:11434/v1",
            api: "openai-completions",
            reasoning: true,
            apiKey: "sk-local"
          }
        ]
      }),
      "utf8"
    );

    const resolved = new ModelConfigFileReader(tempDir).resolveById("openai-custom");

    expect(resolved?.modelRef).toEqual({
      provider: "openai",
      modelId: "local-model",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      reasoning: true
    });
  });

  it("returns undefined when resolving a missing selected model", () => {
    writeFileSync(
      join(tempDir, "model-config.json"),
      JSON.stringify({
        version: 1,
        defaultModelId: null,
        entries: []
      }),
      "utf8"
    );

    expect(new ModelConfigFileReader(tempDir).resolveById("missing")).toBeUndefined();
  });

  it("returns undefined when no default model is set", () => {
    writeFileSync(
      join(tempDir, "model-config.json"),
      JSON.stringify({
        version: 1,
        defaultModelId: null,
        entries: [
          {
            id: "openai-mini",
            label: "OpenAI Mini",
            provider: "openai",
            modelId: "gpt-4o-mini",
            apiKey: "sk-openai"
          }
        ]
      }),
      "utf8"
    );

    expect(new ModelConfigFileReader(tempDir).resolveDefault()).toBeUndefined();
  });

  it("returns undefined on a corrupted config file", () => {
    writeFileSync(join(tempDir, "model-config.json"), "{ broken", "utf8");

    expect(new ModelConfigFileReader(tempDir).resolveDefault()).toBeUndefined();
  });
});
