import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "./envelope";

export const OwnerIdSchema = z.string().min(1);
export const DEFAULT_OWNER_ID = "local-user" as const;

export const ProjectStatusSchema = z.enum(["active", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectCreateCommandPayloadSchema = z.object({
  name: z.string().min(1).max(120),
  rootPath: z.string().min(1).max(1_000).optional(),
  description: z.string().max(4_000).optional()
});
export type ProjectCreateCommandPayload = z.infer<typeof ProjectCreateCommandPayloadSchema>;

export const ProjectUpdateCommandPayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  rootPath: z.string().min(1).max(1_000).nullable().optional(),
  description: z.string().max(4_000).nullable().optional()
});
export type ProjectUpdateCommandPayload = z.infer<typeof ProjectUpdateCommandPayloadSchema>;

export const ProjectArchiveCommandPayloadSchema = z.object({
  id: z.string().min(1)
});
export type ProjectArchiveCommandPayload = z.infer<typeof ProjectArchiveCommandPayloadSchema>;

export const ProjectListCommandPayloadSchema = z.object({
  includeArchived: z.boolean().optional()
});
export type ProjectListCommandPayload = z.infer<typeof ProjectListCommandPayloadSchema>;

export const ProjectSummarySchema = z.object({
  id: z.string().min(1),
  ownerId: OwnerIdSchema,
  name: z.string().min(1),
  rootPath: z.string().min(1).nullable(),
  description: z.string().nullable(),
  status: ProjectStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable()
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectListPayloadSchema = z.object({
  projects: z.array(ProjectSummarySchema),
  activeProjectId: z.string().min(1).nullable()
});
export type ProjectListPayload = z.infer<typeof ProjectListPayloadSchema>;

export const CodeAgentKindSchema = z.enum(["codex", "claude_code", "cursor", "kimi", "custom"]);
export type CodeAgentKind = z.infer<typeof CodeAgentKindSchema>;

export const CodeAgentProfileInputSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  kind: CodeAgentKindSchema,
  label: z.string().min(1).max(120),
  description: z.string().max(1_000).optional(),
  command: z.string().max(1_000).optional(),
  enabled: z.boolean().optional()
});
export type CodeAgentProfileInput = z.infer<typeof CodeAgentProfileInputSchema>;

export const CodeAgentProfileSchema = z.object({
  id: z.string().min(1),
  ownerId: OwnerIdSchema,
  kind: CodeAgentKindSchema,
  label: z.string().min(1),
  description: z.string().nullable(),
  command: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable()
});
export type CodeAgentProfile = z.infer<typeof CodeAgentProfileSchema>;

export const CodeAgentListCommandPayloadSchema = z.object({
  includeArchived: z.boolean().optional()
});
export type CodeAgentListCommandPayload = z.infer<typeof CodeAgentListCommandPayloadSchema>;

export const CodeAgentUpsertCommandPayloadSchema = z.object({
  profile: CodeAgentProfileInputSchema
});
export type CodeAgentUpsertCommandPayload = z.infer<typeof CodeAgentUpsertCommandPayloadSchema>;

export const CodeAgentDeleteCommandPayloadSchema = z.object({
  id: z.string().min(1)
});
export type CodeAgentDeleteCommandPayload = z.infer<typeof CodeAgentDeleteCommandPayloadSchema>;

export const CodeAgentListPayloadSchema = z.object({
  profiles: z.array(CodeAgentProfileSchema)
});
export type CodeAgentListPayload = z.infer<typeof CodeAgentListPayloadSchema>;

export const TaskStatusSchema = z.enum([
  "draft",
  "analyzing",
  "design_ready",
  "queued",
  "running",
  "paused",
  "blocked",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
  "archived"
]);
export type TaskStatusDto = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSourceKindSchema = z.enum(["manual", "conversation", "active_pull", "schedule"]);
export type TaskSourceKind = z.infer<typeof TaskSourceKindSchema>;

export const TaskSourceSchema = z.object({
  kind: TaskSourceKindSchema,
  label: z.string().min(1).max(160).optional(),
  referenceId: z.string().min(1).max(160).optional()
});
export type TaskSource = z.infer<typeof TaskSourceSchema>;

export const PlanStepStatusSchema = z.enum(["pending", "active", "done", "blocked", "failed"]);
export type PlanStepStatus = z.infer<typeof PlanStepStatusSchema>;

export const PlanStepTypeSchema = z.enum([
  "agent",
  "tool",
  "human_input",
  "verification",
  "notification"
]);
export type PlanStepType = z.infer<typeof PlanStepTypeSchema>;

export const PlanStepInputSchema = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(2_000),
  type: PlanStepTypeSchema,
  input: z.record(z.string(), z.unknown()).optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  successCriteria: z.array(z.string().min(1)).optional(),
  status: PlanStepStatusSchema.optional()
});
export type PlanStepInput = z.infer<typeof PlanStepInputSchema>;

export const PlanStepSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  sequence: z.number().int().min(1),
  type: PlanStepTypeSchema,
  title: z.string().min(1),
  goal: z.string().min(1),
  status: PlanStepStatusSchema,
  dependsOn: z.array(z.string().min(1)),
  successCriteria: z.array(z.string().min(1)),
  updatedAt: z.string().datetime()
});
export type PlanStepSummary = z.infer<typeof PlanStepSummarySchema>;

export const TaskCreateCommandPayloadSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(8_000),
  source: TaskSourceSchema,
  priority: TaskPrioritySchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  steps: z.array(PlanStepInputSchema).optional(),
  codeAgentId: z.string().min(1).nullable().optional()
});
export type TaskCreateCommandPayload = z.infer<typeof TaskCreateCommandPayloadSchema>;

export const TaskListCommandPayloadSchema = z.object({
  projectId: z.string().min(1),
  includeArchived: z.boolean().optional(),
  statuses: z.array(TaskStatusSchema).optional()
});
export type TaskListCommandPayload = z.infer<typeof TaskListCommandPayloadSchema>;

export const TaskGetCommandPayloadSchema = z.object({
  id: z.string().min(1)
});
export type TaskGetCommandPayload = z.infer<typeof TaskGetCommandPayloadSchema>;

export const TaskUpdateCommandPayloadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  goal: z.string().min(1).max(8_000).optional(),
  priority: TaskPrioritySchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  blockedReason: z.string().max(2_000).nullable().optional(),
  nextStep: z.string().max(2_000).nullable().optional(),
  codeAgentId: z.string().min(1).nullable().optional()
});
export type TaskUpdateCommandPayload = z.infer<typeof TaskUpdateCommandPayloadSchema>;

export const TaskDeleteCommandPayloadSchema = z.object({
  id: z.string().min(1)
});
export type TaskDeleteCommandPayload = z.infer<typeof TaskDeleteCommandPayloadSchema>;

export const TaskSetStatusCommandPayloadSchema = z.object({
  id: z.string().min(1),
  status: TaskStatusSchema,
  reason: z.string().max(2_000).optional()
});
export type TaskSetStatusCommandPayload = z.infer<typeof TaskSetStatusCommandPayloadSchema>;

export const TaskUpdateProgressCommandPayloadSchema = z.object({
  id: z.string().min(1),
  progressPercent: z.number().int().min(0).max(100),
  nextStep: z.string().max(2_000).nullable().optional(),
  blockedReason: z.string().max(2_000).nullable().optional()
});
export type TaskUpdateProgressCommandPayload = z.infer<typeof TaskUpdateProgressCommandPayloadSchema>;

export const TaskAssignCodeAgentCommandPayloadSchema = z.object({
  id: z.string().min(1),
  codeAgentId: z.string().min(1).nullable()
});
export type TaskAssignCodeAgentCommandPayload = z.infer<typeof TaskAssignCodeAgentCommandPayloadSchema>;

export const TaskSummarySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  ownerId: OwnerIdSchema,
  title: z.string().min(1),
  goal: z.string().min(1),
  status: TaskStatusSchema,
  progressPercent: z.number().int().min(0).max(100),
  source: TaskSourceSchema,
  priority: TaskPrioritySchema,
  dueAt: z.string().datetime().nullable(),
  codeAgentId: z.string().min(1).nullable(),
  blockedReason: z.string().nullable(),
  nextStep: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  version: z.number().int().min(1)
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const TaskListPayloadSchema = z.object({
  tasks: z.array(TaskSummarySchema)
});
export type TaskListPayload = z.infer<typeof TaskListPayloadSchema>;

export const TaskEventSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  sequence: z.number().int().min(1),
  eventType: z.string().min(1),
  payload: z.unknown(),
  createdAt: z.string().datetime()
});
export type TaskEventSummary = z.infer<typeof TaskEventSummarySchema>;

export const TaskStatusViewSchema = z.object({
  task: TaskSummarySchema,
  steps: z.array(PlanStepSummarySchema),
  recentEvents: z.array(TaskEventSummarySchema),
  blockedReason: z.string().nullable(),
  nextStep: z.string().nullable()
});
export type TaskStatusView = z.infer<typeof TaskStatusViewSchema>;

export const ProjectCreateCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("project.create"),
  payload: ProjectCreateCommandPayloadSchema
});
export const ProjectListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("project.list"),
  payload: ProjectListCommandPayloadSchema
});
export const ProjectUpdateCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("project.update"),
  payload: ProjectUpdateCommandPayloadSchema
});
export const ProjectArchiveCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("project.archive"),
  payload: ProjectArchiveCommandPayloadSchema
});

export const TaskCreateCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.create"),
  payload: TaskCreateCommandPayloadSchema
});
export const TaskListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.list"),
  payload: TaskListCommandPayloadSchema
});
export const TaskGetCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.get"),
  payload: TaskGetCommandPayloadSchema
});
export const TaskUpdateCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.update"),
  payload: TaskUpdateCommandPayloadSchema
});
export const TaskDeleteCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.delete"),
  payload: TaskDeleteCommandPayloadSchema
});
export const TaskSetStatusCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.setStatus"),
  payload: TaskSetStatusCommandPayloadSchema
});
export const TaskUpdateProgressCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.updateProgress"),
  payload: TaskUpdateProgressCommandPayloadSchema
});
export const TaskAssignCodeAgentCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.assignCodeAgent"),
  payload: TaskAssignCodeAgentCommandPayloadSchema
});

export const CodeAgentListCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("codeAgent.list"),
  payload: CodeAgentListCommandPayloadSchema
});
export const CodeAgentUpsertCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("codeAgent.upsert"),
  payload: CodeAgentUpsertCommandPayloadSchema
});
export const CodeAgentDeleteCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("codeAgent.delete"),
  payload: CodeAgentDeleteCommandPayloadSchema
});

export const ProjectCreatedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("project.created"),
  payload: z.object({
    project: ProjectSummarySchema
  })
});
export const TaskCreatedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.created"),
  payload: z.object({
    task: TaskSummarySchema
  })
});
export const TaskUpdatedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.updated"),
  payload: z.object({
    task: TaskSummarySchema
  })
});
export const TaskStatusChangedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.status_changed"),
  payload: z.object({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    fromStatus: TaskStatusSchema,
    toStatus: TaskStatusSchema,
    task: TaskSummarySchema
  })
});
export const TaskProgressChangedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.progress_changed"),
  payload: z.object({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    progressPercent: z.number().int().min(0).max(100),
    task: TaskSummarySchema
  })
});
export const TaskArchivedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("task.archived"),
  payload: z.object({
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    task: TaskSummarySchema
  })
});
export const CodeAgentUpdatedEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("codeAgent.updated"),
  payload: z.object({
    profile: CodeAgentProfileSchema
  })
});

export type ProjectCreatedEventEnvelope = Envelope<
  { project: ProjectSummary },
  "project.created"
>;
export type TaskCreatedEventEnvelope = Envelope<{ task: TaskSummary }, "task.created">;
export type TaskUpdatedEventEnvelope = Envelope<{ task: TaskSummary }, "task.updated">;
export type TaskStatusChangedEventEnvelope = Envelope<
  {
    taskId: string;
    projectId: string;
    fromStatus: TaskStatusDto;
    toStatus: TaskStatusDto;
    task: TaskSummary;
  },
  "task.status_changed"
>;
export type TaskProgressChangedEventEnvelope = Envelope<
  {
    taskId: string;
    projectId: string;
    progressPercent: number;
    task: TaskSummary;
  },
  "task.progress_changed"
>;
export type TaskArchivedEventEnvelope = Envelope<
  { taskId: string; projectId: string; task: TaskSummary },
  "task.archived"
>;
export type CodeAgentUpdatedEventEnvelope = Envelope<
  { profile: CodeAgentProfile },
  "codeAgent.updated"
>;
