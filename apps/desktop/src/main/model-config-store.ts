import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ModelApiSchema,
  ModelConfigEntryInputSchema,
  ModelConfigSummaryListPayloadSchema,
  ModelConfigSummarySchema,
  ModelProviderSchema,
  type ModelApi,
  type ModelConfigEntryInput,
  type ModelConfigSummary,
  type ModelConfigSummaryListPayload,
  type ModelProvider
} from "@personal-claw/contracts";

interface StoredModelConfigEntry {
  id: string;
  label: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl?: string;
  api?: ModelApi;
  reasoning?: boolean;
  apiKey: string;
}

interface StoredModelConfig {
  version: 1;
  entries: StoredModelConfigEntry[];
  defaultModelId: string | null;
}

const EMPTY_STORE: StoredModelConfig = { version: 1, entries: [], defaultModelId: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStoredEntry(raw: unknown): StoredModelConfigEntry | undefined {
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

  const entry: StoredModelConfigEntry = {
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

function parseStoredConfig(raw: unknown): StoredModelConfig {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) {
    return { ...EMPTY_STORE };
  }

  const entries: StoredModelConfigEntry[] = [];
  const seenIds = new Set<string>();

  for (const item of raw.entries) {
    const entry = parseStoredEntry(item);

    if (entry && !seenIds.has(entry.id)) {
      seenIds.add(entry.id);
      entries.push(entry);
    }
  }

  const defaultModelId =
    typeof raw.defaultModelId === "string" && seenIds.has(raw.defaultModelId)
      ? raw.defaultModelId
      : null;

  return { version: 1, entries, defaultModelId };
}

function toSummary(entry: StoredModelConfigEntry): ModelConfigSummary {
  const summary: ModelConfigSummary = {
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    modelId: entry.modelId,
    hasSecret: entry.apiKey.trim().length > 0,
    secretRef: `model-config:${entry.id}`
  };

  if (entry.baseUrl) {
    summary.baseUrl = entry.baseUrl;
  }
  if (entry.api) {
    summary.api = entry.api;
  }
  if (entry.reasoning !== undefined) {
    summary.reasoning = entry.reasoning;
  }

  return ModelConfigSummarySchema.parse(summary);
}

function normalizeEntryInput(
  input: ModelConfigEntryInput,
  existing?: StoredModelConfigEntry
): StoredModelConfigEntry {
  const parsed = ModelConfigEntryInputSchema.parse(input);
  const entry: StoredModelConfigEntry = {
    id: parsed.id,
    label: parsed.label,
    provider: parsed.provider,
    modelId: parsed.modelId,
    apiKey: parsed.apiKey === undefined ? existing?.apiKey ?? "" : parsed.apiKey.trim()
  };

  if (parsed.baseUrl) {
    entry.baseUrl = parsed.baseUrl;
  }
  if (parsed.api) {
    entry.api = parsed.api;
  }
  if (parsed.reasoning !== undefined) {
    entry.reasoning = parsed.reasoning;
  }

  return entry;
}

export class ModelConfigStore {
  private readonly filePath: string;
  private cache: StoredModelConfig | undefined;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  list(): ModelConfigSummaryListPayload {
    const store = this.read();
    const summaries = store.entries.map(toSummary);

    return ModelConfigSummaryListPayloadSchema.parse({
      summaries,
      defaultModelId: store.defaultModelId,
      version: 1
    });
  }

  upsert(input: ModelConfigEntryInput): ModelConfigSummaryListPayload {
    const store = this.read();
    const existing = store.entries.find((entry) => entry.id === input.id);
    const incoming = normalizeEntryInput(input, existing);
    const entries = [incoming, ...store.entries.filter((entry) => entry.id !== incoming.id)];

    let defaultModelId = store.defaultModelId;
    if (!defaultModelId || !entries.some((entry) => entry.id === defaultModelId)) {
      defaultModelId = incoming.id;
    }

    this.write({ version: 1, entries, defaultModelId });
    return this.list();
  }

  delete(id: string): ModelConfigSummaryListPayload {
    const store = this.read();
    const entries = store.entries.filter((entry) => entry.id !== id);

    let defaultModelId = store.defaultModelId;
    if (defaultModelId === id) {
      defaultModelId = entries[0]?.id ?? null;
    }

    this.write({ version: 1, entries, defaultModelId });
    return this.list();
  }

  setDefault(id: string): ModelConfigSummaryListPayload {
    const store = this.read();

    if (!store.entries.some((entry) => entry.id === id)) {
      return this.list();
    }

    this.write({ version: 1, entries: store.entries, defaultModelId: id });
    return this.list();
  }

  private read(): StoredModelConfig {
    if (this.cache) {
      return this.cache;
    }

    if (!existsSync(this.filePath)) {
      this.cache = { ...EMPTY_STORE };
      return this.cache;
    }

    try {
      const raw = readFileSync(this.filePath, "utf8");
      this.cache = parseStoredConfig(JSON.parse(raw));
    } catch {
      this.cache = { ...EMPTY_STORE };
    }

    return this.cache;
  }

  private write(store: StoredModelConfig): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(store, null, 2), "utf8");
    this.cache = store;
  }
}

export function resolveModelConfigPath(userDataDir: string): string {
  return join(userDataDir, "model-config.json");
}
