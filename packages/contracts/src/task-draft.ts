import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";
import { PiRuntimeRefSchema, ThinkingLevelSchema } from "./session";

export const AutomationLevelSchema = z.enum(["L0", "L1", "L2", "L3", "L4"]);
export type AutomationLevel = z.infer<typeof AutomationLevelSchema>;

export const DraftStepTypeSchema = z.enum([
  "agent",
  "tool",
  "human_input",
  "approval",
  "verification",
  "notification"
]);
export type DraftStepType = z.infer<typeof DraftStepTypeSchema>;

export const TaskDraftFromDescriptionCommandPayloadSchema = z.object({
  description: z.string().min(1).max(20_000),
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
  loop: z
    .object({
      maxIterations: z.number().int().min(1).max(8).optional()
    })
    .optional()
});

export type TaskDraftFromDescriptionCommandPayload = z.infer<
  typeof TaskDraftFromDescriptionCommandPayloadSchema
>;

export const TaskDraftAcceptedPayloadSchema = z.object({
  draftId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  acceptedAt: z.string().datetime(),
  runtime: PiRuntimeRefSchema
});

export type TaskDraftAcceptedPayload = z.infer<typeof TaskDraftAcceptedPayloadSchema>;

export const TaskDraftLoopIterationSchema = z.object({
  index: z.number().int().min(1),
  phase: z.enum(["intake", "analysis", "plan_design", "approval_gate"]),
  status: z.enum(["done", "active", "pending"]),
  summary: z.string().min(1)
});

export type TaskDraftLoopIteration = z.infer<typeof TaskDraftLoopIterationSchema>;

export const TaskDraftStepSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().min(1),
  type: DraftStepTypeSchema,
  title: z.string().min(1),
  goal: z.string().min(1),
  dependsOn: z.array(z.string().min(1)),
  requiredPermissions: z.array(z.string().min(1)),
  expectedSideEffects: z.array(z.string().min(1)),
  successCriteria: z.array(z.string().min(1)),
  retryStrategy: z.string().min(1),
  rollbackNotes: z.string().min(1)
});

export type TaskDraftStep = z.infer<typeof TaskDraftStepSchema>;

export const TaskDraftPreviewSchema = z.object({
  draftId: z.string().min(1),
  status: z.literal("draft"),
  title: z.string().min(1),
  objective: z.string().min(1),
  source: z.object({
    kind: z.literal("manual_description"),
    description: z.string().min(1)
  }),
  suggestedAutomationLevel: AutomationLevelSchema,
  assumptions: z.array(z.string().min(1)),
  constraints: z.array(z.string().min(1)),
  missingInformation: z.array(z.string().min(1)),
  expectedArtifacts: z.array(z.string().min(1)),
  loopIterations: z.array(TaskDraftLoopIterationSchema),
  steps: z.array(TaskDraftStepSchema),
  approvalRequired: z.boolean(),
  generatedSummary: z.string().min(1),
  createdAt: z.string().datetime()
});

export type TaskDraftPreview = z.infer<typeof TaskDraftPreviewSchema>;

export const TaskDraftCreatedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  draft: TaskDraftPreviewSchema,
  runtime: PiRuntimeRefSchema
});

export type TaskDraftCreatedPayload = z.infer<typeof TaskDraftCreatedPayloadSchema>;

export const TaskDraftFromDescriptionCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.draftFromDescription"),
  payload: TaskDraftFromDescriptionCommandPayloadSchema
});

export const TaskDraftCreatedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.draft_created"),
  payload: TaskDraftCreatedPayloadSchema
});

export type TaskDraftCreatedEventEnvelope = Envelope<
  TaskDraftCreatedPayload,
  "task.draft_created"
>;
