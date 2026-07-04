import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";
import {
  AgentErrorEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  SessionPromptCommandEnvelopeSchema,
  type AgentErrorEventEnvelope,
  type AgentMessageCompletedEventEnvelope,
  type AgentMessageDeltaEventEnvelope,
  type AgentToolRequestedEventEnvelope
} from "./session";
import {
  ModelConfigDeleteCommandEnvelopeSchema,
  ModelConfigListCommandEnvelopeSchema,
  ModelConfigSetDefaultCommandEnvelopeSchema,
  ModelConfigUpsertCommandEnvelopeSchema
} from "./model-config";

export const UtilityWorkerNameSchema = z.enum(["core", "agent", "tool"]);
export type UtilityWorkerName = z.infer<typeof UtilityWorkerNameSchema>;

export const UtilityHealthPayloadSchema = z.object({
  name: UtilityWorkerNameSchema,
  status: z.enum(["starting", "ok", "degraded", "stopped"]),
  pid: z.number().int().positive().optional(),
  startedAt: z.string().datetime().optional(),
  lastHeartbeatAt: z.string().datetime().optional(),
  details: z.record(z.string(), z.unknown()).optional()
});

export type UtilityHealthPayload = z.infer<typeof UtilityHealthPayloadSchema>;

export const SystemHealthCommandPayloadSchema = z.object({});
export type SystemHealthCommandPayload = z.infer<typeof SystemHealthCommandPayloadSchema>;

export const SystemHealthPayloadSchema = z.object({
  status: z.enum(["starting", "ok", "degraded"]),
  checkedAt: z.string().datetime(),
  workers: z.array(UtilityHealthPayloadSchema)
});

export type SystemHealthPayload = z.infer<typeof SystemHealthPayloadSchema>;

export const SystemReadyPayloadSchema = z.object({
  status: z.literal("ready"),
  startedAt: z.string().datetime(),
  workers: z.array(UtilityHealthPayloadSchema)
});

export type SystemReadyPayload = z.infer<typeof SystemReadyPayloadSchema>;

export const ErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional()
});

export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export const SystemHealthCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("system.health"),
  payload: SystemHealthCommandPayloadSchema
});

export const CommandEnvelopeSchema = z.discriminatedUnion("type", [
  SystemHealthCommandEnvelopeSchema,
  SessionPromptCommandEnvelopeSchema,
  ModelConfigListCommandEnvelopeSchema,
  ModelConfigUpsertCommandEnvelopeSchema,
  ModelConfigDeleteCommandEnvelopeSchema,
  ModelConfigSetDefaultCommandEnvelopeSchema
]);

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandType = CommandEnvelope["type"];

export const CommandResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("accepted"),
    requestId: z.string().min(1),
    payload: z.unknown()
  }),
  z.object({
    status: z.literal("rejected"),
    requestId: z.string().min(1),
    error: ErrorPayloadSchema
  })
]);

export type CommandResult<TPayload = unknown> =
  | { status: "accepted"; requestId: string; payload: TPayload }
  | { status: "rejected"; requestId: string; error: ErrorPayload };

export const SystemReadyEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("system.ready"),
  payload: SystemReadyPayloadSchema
});

export const SystemHealthEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("system.health"),
  payload: SystemHealthPayloadSchema
});

export const SystemErrorEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("system.error"),
  payload: ErrorPayloadSchema
});

export const SystemWorkerRestartedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("system.worker_restarted"),
  payload: z.object({
    worker: UtilityWorkerNameSchema,
    reason: z.string().min(1),
    restartedAt: z.string().datetime()
  })
});

export const SystemEventEnvelopeSchema = z.discriminatedUnion("type", [
  SystemReadyEventEnvelopeSchema,
  SystemHealthEventEnvelopeSchema,
  SystemErrorEventEnvelopeSchema,
  SystemWorkerRestartedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  AgentMessageCompletedEventEnvelopeSchema,
  AgentToolRequestedEventEnvelopeSchema,
  AgentErrorEventEnvelopeSchema
]);

export type SystemEventEnvelope =
  | Envelope<SystemReadyPayload, "system.ready">
  | Envelope<SystemHealthPayload, "system.health">
  | Envelope<ErrorPayload, "system.error">
  | Envelope<
      {
        worker: UtilityWorkerName;
        reason: string;
        restartedAt: string;
      },
      "system.worker_restarted"
    >
  | AgentMessageDeltaEventEnvelope
  | AgentMessageCompletedEventEnvelope
  | AgentToolRequestedEventEnvelope
  | AgentErrorEventEnvelope;
