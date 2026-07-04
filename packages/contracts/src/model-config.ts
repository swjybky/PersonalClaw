import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";

/**
 * 模型配置 provider 枚举。与 `@personal-claw/pi-runtime-adapter` 的
 * `SupportedPiProviderId` 保持同步；contracts 层不依赖 runtime adapter，
 * 以避免 Renderer 间接引入 pi SDK。
 */
export const ModelProviderSchema = z.enum([
  "anthropic",
  "deepseek",
  "faux",
  "kimi-coding",
  "moonshotai-cn",
  "openai",
  "xiaomi-token-plan-cn",
  "zai-coding-cn"
]);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

/**
 * 自定义 base_url 模型可选择的底层 API 协议。内置 provider 由 pi-ai 决定，
 * 此字段仅对配置了 base_url 的 owner 模型生效。
 */
export const ModelApiSchema = z.enum([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai"
]);
export type ModelApi = z.infer<typeof ModelApiSchema>;

/**
 * Renderer 写入 Main 的模型配置条目。`apiKey` 为只写字段：
 * Main 持久化后不会通过 IPC 回传明文 key，Renderer 只看到 `hasSecret`。
 */
export const ModelConfigEntryInputSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  provider: ModelProviderSchema,
  modelId: z.string().min(1).max(120),
  baseUrl: z.string().url().max(400).optional(),
  api: ModelApiSchema.optional(),
  reasoning: z.boolean().optional(),
  apiKey: z.string().max(400).optional()
});
export type ModelConfigEntryInput = z.infer<typeof ModelConfigEntryInputSchema>;

/**
 * Renderer 读取的模型配置摘要。不含明文 key，只有 `secretRef` 与 `hasSecret`。
 * `secretRef` 是 Main 维护的密钥引用句柄，供后续 Core/Agent 解析使用。
 */
export const ModelConfigSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  provider: ModelProviderSchema,
  modelId: z.string().min(1),
  baseUrl: z.string().url().optional(),
  api: ModelApiSchema.optional(),
  reasoning: z.boolean().optional(),
  hasSecret: z.boolean(),
  secretRef: z.string().min(1)
});
export type ModelConfigSummary = z.infer<typeof ModelConfigSummarySchema>;

export const ModelConfigSummaryListPayloadSchema = z.object({
  summaries: z.array(ModelConfigSummarySchema),
  defaultModelId: z.string().min(1).nullable(),
  version: z.literal(1)
});
export type ModelConfigSummaryListPayload = z.infer<typeof ModelConfigSummaryListPayloadSchema>;

export const ModelConfigListCommandPayloadSchema = z.object({});
export type ModelConfigListCommandPayload = z.infer<typeof ModelConfigListCommandPayloadSchema>;

export const ModelConfigUpsertCommandPayloadSchema = z.object({
  entry: ModelConfigEntryInputSchema
});
export type ModelConfigUpsertCommandPayload = z.infer<typeof ModelConfigUpsertCommandPayloadSchema>;

export const ModelConfigDeleteCommandPayloadSchema = z.object({
  id: z.string().min(1)
});
export type ModelConfigDeleteCommandPayload = z.infer<typeof ModelConfigDeleteCommandPayloadSchema>;

export const ModelConfigSetDefaultCommandPayloadSchema = z.object({
  id: z.string().min(1)
});
export type ModelConfigSetDefaultCommandPayload = z.infer<typeof ModelConfigSetDefaultCommandPayloadSchema>;

export const ModelConfigListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("modelConfig.list"),
  payload: ModelConfigListCommandPayloadSchema
});

export const ModelConfigUpsertCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("modelConfig.upsert"),
  payload: ModelConfigUpsertCommandPayloadSchema
});

export const ModelConfigDeleteCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("modelConfig.delete"),
  payload: ModelConfigDeleteCommandPayloadSchema
});

export const ModelConfigSetDefaultCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("modelConfig.setDefault"),
  payload: ModelConfigSetDefaultCommandPayloadSchema
});

export type ModelConfigListCommandEnvelope = Envelope<
  ModelConfigListCommandPayload,
  "modelConfig.list"
>;
export type ModelConfigUpsertCommandEnvelope = Envelope<
  ModelConfigUpsertCommandPayload,
  "modelConfig.upsert"
>;
export type ModelConfigDeleteCommandEnvelope = Envelope<
  ModelConfigDeleteCommandPayload,
  "modelConfig.delete"
>;
export type ModelConfigSetDefaultCommandEnvelope = Envelope<
  ModelConfigSetDefaultCommandPayload,
  "modelConfig.setDefault"
>;
