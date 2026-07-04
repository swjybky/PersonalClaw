import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ModelApiSchema, ModelProviderSchema, type ModelApi, type ModelProvider } from "@personal-claw/contracts";
import type { PiModelRef, SupportedPiProviderId } from "@personal-claw/pi-runtime-adapter";

interface StoredEntry {
  id: string;
  label: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl?: string;
  api?: ModelApi;
  reasoning?: boolean;
  apiKey: string;
}

interface StoredConfig {
  version: 1;
  entries: StoredEntry[];
  defaultModelId: string | null;
}

interface ResolvedModelConfig {
  modelRef: PiModelRef;
  provider: SupportedPiProviderId;
  apiKey: string;
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEntry(raw: unknown): StoredEntry | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const providerResult = ModelProviderSchema.safeParse(raw.provider);
  if (!providerResult.success) {
    return undefined;
  }

  const apiResult = raw.api === undefined ? { success: true, data: undefined } : ModelApiSchema.safeParse(raw.api);
  if (!apiResult.success) {
    return undefined;
  }

  const id = typeof raw.id === "string" ? raw.id : undefined;
  const label = typeof raw.label === "string" ? raw.label : undefined;
  const modelId = typeof raw.modelId === "string" ? raw.modelId : undefined;
  const apiKey = typeof raw.apiKey === "string" ? raw.apiKey : undefined;
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl : undefined;
  const reasoning = typeof raw.reasoning === "boolean" ? raw.reasoning : undefined;

  if (!id || !label || !modelId || apiKey === undefined) {
    return undefined;
  }

  const entry: StoredEntry = {
    id,
    label,
    provider: providerResult.data,
    modelId,
    apiKey
  };

  if (baseUrl) {
    entry.baseUrl = baseUrl;
  }
  if (apiResult.data) {
    entry.api = apiResult.data;
  }
  if (reasoning !== undefined) {
    entry.reasoning = reasoning;
  }

  return entry;
}

function parseConfig(raw: unknown): StoredConfig | undefined {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) {
    return undefined;
  }

  const entries: StoredEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw.entries) {
    const entry = parseEntry(item);

    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      entries.push(entry);
    }
  }

  const defaultModelId =
    typeof raw.defaultModelId === "string" && seen.has(raw.defaultModelId)
      ? raw.defaultModelId
      : null;

  return { version: 1, entries, defaultModelId };
}

export class ModelConfigFileReader {
  private readonly filePath: string;

  constructor(userDataDir: string | undefined) {
    this.filePath = userDataDir ? join(userDataDir, "model-config.json") : "";
  }

  isAvailable(): boolean {
    return Boolean(this.filePath) && existsSync(this.filePath);
  }

  resolveDefault(): ResolvedModelConfig | undefined {
    const config = this.readConfig();

    if (!config || !config.defaultModelId) {
      return undefined;
    }

    const resolved = this.resolveFromConfig(config, config.defaultModelId);

    if (!resolved || resolved.provider === "faux") {
      return undefined;
    }

    return resolved;
  }

  resolveById(id: string): ResolvedModelConfig | undefined {
    const config = this.readConfig();

    if (!config) {
      return undefined;
    }

    return this.resolveFromConfig(config, id);
  }

  private readConfig(): StoredConfig | undefined {
    if (!this.filePath) {
      return undefined;
    }

    let raw: unknown;

    try {
      raw = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      return undefined;
    }

    const config = parseConfig(raw);

    return config;
  }

  private resolveFromConfig(config: StoredConfig, id: string): ResolvedModelConfig | undefined {
    const entry = config.entries.find((item) => item.id === id);

    if (!entry) {
      return undefined;
    }

    return {
      modelRef: {
        provider: entry.provider,
        modelId: entry.modelId,
        ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
        ...(entry.api ? { api: entry.api } : {}),
        ...(entry.reasoning !== undefined ? { reasoning: entry.reasoning } : {})
      },
      provider: entry.provider,
      apiKey: entry.apiKey.trim(),
      label: entry.label
    };
  }
}
