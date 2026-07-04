import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ModelProviderSchema, type ModelProvider } from "@personal-claw/contracts";
import type { PiModelRef, SupportedPiProviderId } from "@personal-claw/pi-runtime-adapter";

interface StoredEntry {
  id: string;
  label: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl?: string;
  api?: string;
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

  const id = typeof raw.id === "string" ? raw.id : undefined;
  const label = typeof raw.label === "string" ? raw.label : undefined;
  const modelId = typeof raw.modelId === "string" ? raw.modelId : undefined;
  const apiKey = typeof raw.apiKey === "string" ? raw.apiKey : undefined;

  if (!id || !label || !modelId || apiKey === undefined) {
    return undefined;
  }

  return {
    id,
    label,
    provider: providerResult.data,
    modelId,
    apiKey
  };
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

    if (!config || !config.defaultModelId) {
      return undefined;
    }

    const entry = config.entries.find((item) => item.id === config.defaultModelId);

    if (!entry || entry.provider === "faux") {
      return undefined;
    }

    return {
      modelRef: { provider: entry.provider, modelId: entry.modelId },
      provider: entry.provider,
      apiKey: entry.apiKey.trim()
    };
  }
}
