import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type TSchema } from "typebox";

export const PERSONAL_TASK_TOOL_NAMES = [
  "task_create",
  "task_list",
  "task_get",
  "task_update",
  "task_start",
  "task_update_progress"
] as const;

export type PersonalTaskToolName = (typeof PERSONAL_TASK_TOOL_NAMES)[number];

export type TaskToolCommandType =
  | "task.create"
  | "task.list"
  | "task.get"
  | "task.update"
  | "task.setStatus"
  | "task.updateProgress";

export interface TaskToolProxyDetails {
  toolName: PersonalTaskToolName;
  commandType: TaskToolCommandType;
  routedThrough: "core";
  status: "accepted" | "rejected";
  requestId?: string;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface TaskToolExecutionInput {
  toolCallId: string;
  toolName: PersonalTaskToolName;
  commandType: TaskToolCommandType;
  args: unknown;
  runId?: string;
  sessionId?: string;
  projectId?: string;
  taskId?: string;
  signal?: AbortSignal | undefined;
}

export type TaskToolExecutor = (
  input: TaskToolExecutionInput
) => Promise<AgentToolResult<TaskToolProxyDetails>>;

const taskStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("analyzing"),
  Type.Literal("design_ready"),
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("paused"),
  Type.Literal("blocked"),
  Type.Literal("verifying"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("archived")
]);

const taskPrioritySchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("normal"),
  Type.Literal("high"),
  Type.Literal("urgent")
]);

const taskSourceKindSchema = Type.Union([
  Type.Literal("manual"),
  Type.Literal("conversation"),
  Type.Literal("active_pull"),
  Type.Literal("schedule")
]);

const taskSourceSchema = Type.Object(
  {
    kind: taskSourceKindSchema,
    label: Type.Optional(Type.String({ minLength: 1 })),
    referenceId: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const planStepTypeSchema = Type.Union([
  Type.Literal("agent"),
  Type.Literal("tool"),
  Type.Literal("human_input"),
  Type.Literal("verification"),
  Type.Literal("notification")
]);

const planStepStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("active"),
  Type.Literal("done"),
  Type.Literal("blocked"),
  Type.Literal("failed")
]);

const planStepSchema = Type.Object(
  {
    title: Type.String({
      minLength: 1,
      description: "Human-readable step title."
    }),
    goal: Type.String({
      minLength: 1,
      description: "What this step must accomplish."
    }),
    type: planStepTypeSchema,
    dependsOn: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    successCriteria: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    status: Type.Optional(planStepStatusSchema)
  },
  { additionalProperties: false }
);

function createTaskTool(input: {
  name: PersonalTaskToolName;
  label: string;
  commandType: TaskToolCommandType;
  description: string;
  parameters: TSchema;
  executor?: TaskToolExecutor | undefined;
}): AgentTool<TSchema, TaskToolProxyDetails> {
  return {
    name: input.name,
    label: input.label,
    description: input.description,
    parameters: input.parameters,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal): Promise<AgentToolResult<TaskToolProxyDetails>> => {
      if (input.executor) {
        return input.executor({
          toolCallId,
          toolName: input.name,
          commandType: input.commandType,
          args: params,
          signal
        });
      }

      throw new Error(
        `Task tool ${input.name} cannot run because the Core task command executor was not injected.`
      );
    }
  };
}

export function createPersonalTaskTools(
  options: { executor?: TaskToolExecutor | undefined } = {}
): AgentTool<TSchema, TaskToolProxyDetails>[] {
  return [
    createTaskTool({
      name: "task_create",
      label: "Create Task",
      commandType: "task.create",
      description:
        "Create a persisted PersonalClaw task through Core. Use this when the user asks to add, record, or create a backend task.",
      parameters: Type.Object(
        {
          projectId: Type.String({
            minLength: 1,
            description: "Target PersonalClaw project id."
          }),
          title: Type.String({
            minLength: 1,
            description: "Task title shown in the task center."
          }),
          goal: Type.String({
            minLength: 1,
            description: "Clear task objective and definition of done."
          }),
          source: taskSourceSchema,
          priority: Type.Optional(taskPrioritySchema),
          dueAt: Type.Optional(
            Type.Union([
              Type.String({
                format: "date-time",
                description: "Optional ISO datetime deadline."
              }),
              Type.Null()
            ])
          ),
          codeAgentId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
          steps: Type.Optional(Type.Array(planStepSchema))
        },
        { additionalProperties: false }
      ),
      executor: options.executor
    }),
    createTaskTool({
      name: "task_list",
      label: "List Tasks",
      commandType: "task.list",
      description: "List persisted PersonalClaw tasks from Core, optionally filtered by status.",
      parameters: Type.Object(
        {
          projectId: Type.String({
            minLength: 1,
            description: "Project id whose tasks should be listed."
          }),
          includeArchived: Type.Optional(Type.Boolean()),
          statuses: Type.Optional(Type.Array(taskStatusSchema))
        },
        { additionalProperties: false }
      ),
      executor: options.executor
    }),
    createTaskTool({
      name: "task_get",
      label: "Get Task",
      commandType: "task.get",
      description: "Get one persisted task from Core, including current steps, progress, and recent task events.",
      parameters: Type.Object(
        {
          id: Type.String({
            minLength: 1,
            description: "Task id to inspect."
          })
        },
        { additionalProperties: false }
      ),
      executor: options.executor
    }),
    createTaskTool({
      name: "task_update",
      label: "Update Task",
      commandType: "task.update",
      description: "Update editable task metadata through Core without bypassing task persistence rules.",
      parameters: Type.Object(
        {
          id: Type.String({ minLength: 1 }),
          title: Type.Optional(Type.String({ minLength: 1 })),
          goal: Type.Optional(Type.String({ minLength: 1 })),
          priority: Type.Optional(taskPrioritySchema),
          dueAt: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
          blockedReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          nextStep: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          codeAgentId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()]))
        },
        { additionalProperties: false }
      ),
      executor: options.executor
    }),
    createTaskTool({
      name: "task_start",
      label: "Start Task",
      commandType: "task.setStatus",
      description:
        "Move a task into the queued or running state through Core. This changes task status only; it does not execute arbitrary tools.",
      parameters: Type.Object(
        {
          id: Type.String({
            minLength: 1,
            description: "Task id to queue or run."
          }),
          status: Type.Optional(Type.Union([Type.Literal("queued"), Type.Literal("running")])),
          reason: Type.Optional(Type.String())
        },
        { additionalProperties: false }
      ),
      executor: options.executor
    }),
    createTaskTool({
      name: "task_update_progress",
      label: "Update Task Progress",
      commandType: "task.updateProgress",
      description: "Update a task's progress percentage, next step, or blocked reason through Core.",
      parameters: Type.Object(
        {
          id: Type.String({ minLength: 1 }),
          progressPercent: Type.Integer({ minimum: 0, maximum: 100 }),
          nextStep: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          blockedReason: Type.Optional(Type.Union([Type.String(), Type.Null()]))
        },
        { additionalProperties: false }
      ),
      executor: options.executor
    })
  ];
}
