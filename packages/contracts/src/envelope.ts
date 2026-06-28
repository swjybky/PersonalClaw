import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const EnvelopeContextSchema = z.object({
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional()
});

export type EnvelopeContext = z.infer<typeof EnvelopeContextSchema>;

export const EnvelopeBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  context: EnvelopeContextSchema.optional()
});

export interface Envelope<TPayload, TType extends string = string> {
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  type: TType;
  timestamp: string;
  payload: TPayload;
  context?: EnvelopeContext;
}

export function createEnvelope<TPayload, TType extends string>(
  type: TType,
  payload: TPayload,
  options: {
    id: string;
    timestamp?: string;
    context?: EnvelopeContext;
  }
): Envelope<TPayload, TType> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: options.id,
    type,
    timestamp: options.timestamp ?? new Date().toISOString(),
    payload,
    ...(options.context ? { context: options.context } : {})
  };
}
