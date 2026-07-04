import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";

export const PiRuntimeModeSchema = z.enum(["local-faux", "provider"]);
export type PiRuntimeMode = z.infer<typeof PiRuntimeModeSchema>;

export const PiRuntimeRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  mode: PiRuntimeModeSchema
});

export type PiRuntimeRef = z.infer<typeof PiRuntimeRefSchema>;

export const ThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high"]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

export const SessionPromptCommandPayloadSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1).max(20_000),
  thinkingLevel: ThinkingLevelSchema.optional(),
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional()
});

export type SessionPromptCommandPayload = z.infer<typeof SessionPromptCommandPayloadSchema>;

export const SessionPromptAcceptedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  acceptedAt: z.string().datetime(),
  runtime: PiRuntimeRefSchema
});

export type SessionPromptAcceptedPayload = z.infer<typeof SessionPromptAcceptedPayloadSchema>;

export const SessionPromptCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("session.prompt"),
  payload: SessionPromptCommandPayloadSchema
});

export const AgentMessageDeltaPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  messageId: z.string().min(1),
  delta: z.string(),
  runtime: PiRuntimeRefSchema
});

export type AgentMessageDeltaPayload = z.infer<typeof AgentMessageDeltaPayloadSchema>;

export const AgentThinkingDeltaPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  messageId: z.string().min(1),
  delta: z.string(),
  runtime: PiRuntimeRefSchema
});

export type AgentThinkingDeltaPayload = z.infer<typeof AgentThinkingDeltaPayloadSchema>;

export const AgentMessageCompletedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  messageId: z.string().min(1),
  role: z.literal("assistant"),
  content: z.string(),
  stopReason: z.string().min(1).optional(),
  usage: z.unknown().optional(),
  runtime: PiRuntimeRefSchema
});

export type AgentMessageCompletedPayload = z.infer<typeof AgentMessageCompletedPayloadSchema>;

export const AgentToolRequestedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  args: z.unknown(),
  runtime: PiRuntimeRefSchema
});

export type AgentToolRequestedPayload = z.infer<typeof AgentToolRequestedPayloadSchema>;

export const AgentErrorPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
  runtime: PiRuntimeRefSchema.optional()
});

export type AgentErrorPayload = z.infer<typeof AgentErrorPayloadSchema>;

export const AgentMessageDeltaEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.message_delta"),
  payload: AgentMessageDeltaPayloadSchema
});

export const AgentThinkingDeltaEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.thinking_delta"),
  payload: AgentThinkingDeltaPayloadSchema
});

export const AgentMessageCompletedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.message_completed"),
  payload: AgentMessageCompletedPayloadSchema
});

export const AgentToolRequestedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("tool.call_requested"),
  payload: AgentToolRequestedPayloadSchema
});

export const AgentErrorEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.error"),
  payload: AgentErrorPayloadSchema
});

export type AgentMessageDeltaEventEnvelope = Envelope<AgentMessageDeltaPayload, "agent.message_delta">;
export type AgentThinkingDeltaEventEnvelope = Envelope<AgentThinkingDeltaPayload, "agent.thinking_delta">;
export type AgentMessageCompletedEventEnvelope = Envelope<AgentMessageCompletedPayload, "agent.message_completed">;
export type AgentToolRequestedEventEnvelope = Envelope<AgentToolRequestedPayload, "tool.call_requested">;
export type AgentErrorEventEnvelope = Envelope<AgentErrorPayload, "agent.error">;
