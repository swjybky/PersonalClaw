import {
  createEnvelope,
  SystemEventEnvelopeSchema,
  type CodeAgentListPayload,
  type CommandResult,
  type ProjectListPayload,
  type SystemEventEnvelope,
  type TaskStatusView,
  type TaskSummary
} from "@personal-claw/contracts";
import {
  createPersonalClawSqliteStore,
  type CodeAgentMutationResult,
  type PersonalClawSqliteStore,
  type ProjectMutationResult,
  type TaskMutationResult,
  type TaskPlanningMutationResult
} from "@personal-claw/infrastructure-sqlite";
import { createId } from "@personal-claw/shared";
import { bootUtility } from "./runtime";

let store: PersonalClawSqliteStore | undefined;

function getStore(): PersonalClawSqliteStore {
  if (!store) {
    const userDataDir = process.env.PERSONAL_CLAW_USER_DATA_DIR;

    if (!userDataDir) {
      throw new Error("PERSONAL_CLAW_USER_DATA_DIR is required for Core task persistence.");
    }

    store = createPersonalClawSqliteStore(userDataDir);
  }

  return store;
}

function createEvent<TType extends SystemEventEnvelope["type"]>(
  type: TType,
  payload: Extract<SystemEventEnvelope, { type: TType }>["payload"],
  correlationId: string,
  context: {
    projectId?: string;
    taskId?: string;
  } = {}
): SystemEventEnvelope {
  return SystemEventEnvelopeSchema.parse(
    createEnvelope(type, payload, {
      id: createId("evt"),
      context: {
        correlationId,
        ...context
      }
    })
  ) as SystemEventEnvelope;
}

function emitTaskMutation(
  result: TaskMutationResult,
  correlationId: string,
  emitEvent: (event: SystemEventEnvelope) => void
): void {
  emitEvent(
    createEvent(result.eventType, result.eventPayload, correlationId, {
      projectId: result.task.projectId,
      taskId: result.task.id
    })
  );
  for (const event of result.additionalEvents ?? []) {
    emitEvent(
      createEvent(event.eventType, event.eventPayload, correlationId, {
        projectId: result.task.projectId,
        taskId: result.task.id
      })
    );
  }
}

function emitTaskPlanningMutation(
  result: TaskPlanningMutationResult,
  correlationId: string,
  emitEvent: (event: SystemEventEnvelope) => void
): void {
  for (const event of result.events) {
    emitEvent(
      createEvent(event.eventType, event.eventPayload, correlationId, {
        projectId: result.view.task.projectId,
        taskId: result.view.task.id
      })
    );
  }
}

function emitProjectCreated(
  result: ProjectMutationResult,
  correlationId: string,
  emitEvent: (event: SystemEventEnvelope) => void
): void {
  emitEvent(
    createEvent(
      "project.created",
      {
        project: result.project
      },
      correlationId,
      {
        projectId: result.project.id
      }
    )
  );
}

function emitCodeAgentUpdated(
  result: CodeAgentMutationResult,
  correlationId: string,
  emitEvent: (event: SystemEventEnvelope) => void
): void {
  emitEvent(
    createEvent(
      "codeAgent.updated",
      {
        profile: result.profile
      },
      correlationId
    )
  );
}

bootUtility("core", {
  commandHandler(command, emitEvent): CommandResult {
    const taskStore = getStore();
    const correlationId = command.context?.correlationId ?? command.id;

    switch (command.type) {
      case "project.list": {
        const payload: ProjectListPayload = taskStore.listProjects(command.payload);
        return {
          status: "accepted",
          requestId: command.id,
          payload
        };
      }

      case "project.create": {
        const result = taskStore.createProject(command.payload);
        emitProjectCreated(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.list
        };
      }

      case "project.update": {
        const result = taskStore.updateProject(command.payload);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.list
        };
      }

      case "project.archive": {
        const result = taskStore.archiveProject(command.payload);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.list
        };
      }

      case "codeAgent.list": {
        const payload: CodeAgentListPayload = taskStore.listCodeAgents(command.payload);
        return {
          status: "accepted",
          requestId: command.id,
          payload
        };
      }

      case "codeAgent.upsert": {
        const result = taskStore.upsertCodeAgent(command.payload.profile);
        emitCodeAgentUpdated(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.list
        };
      }

      case "codeAgent.delete": {
        const result = taskStore.deleteCodeAgent(command.payload);
        emitCodeAgentUpdated(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.list
        };
      }

      case "task.list": {
        return {
          status: "accepted",
          requestId: command.id,
          payload: taskStore.listTasks(command.payload)
        };
      }

      case "task.get": {
        const payload: TaskStatusView = taskStore.getTask(command.payload);
        return {
          status: "accepted",
          requestId: command.id,
          payload
        };
      }

      case "task.create": {
        const result = taskStore.createTask(command.payload);
        emitTaskMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.task
        };
      }

      case "task.update": {
        const result = taskStore.updateTask(command.payload);
        emitTaskMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.task
        };
      }

      case "task.delete": {
        const result = taskStore.deleteTask(command.payload);
        emitTaskMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.task
        };
      }

      case "task.setStatus": {
        const result = taskStore.setTaskStatus(command.payload);
        emitTaskMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.task
        };
      }

      case "task.updateProgress": {
        const result = taskStore.updateTaskProgress(command.payload);
        emitTaskMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.task
        };
      }

      case "task.assignCodeAgent": {
        const result = taskStore.assignCodeAgent(command.payload);
        emitTaskMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.task satisfies TaskSummary
        };
      }

      case "task.saveAnalysis": {
        const result = taskStore.saveTaskAnalysis(command.payload);
        emitTaskPlanningMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.view.analysis
        };
      }

      case "task.savePlan": {
        const result = taskStore.saveTaskPlan(command.payload);
        emitTaskPlanningMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.view.plan
        };
      }

      case "task.requestPlanApproval": {
        const result = taskStore.requestTaskPlanApproval(command.payload);
        emitTaskPlanningMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.view.plan
        };
      }

      case "task.approvePlan": {
        const result = taskStore.approveTaskPlan(command.payload);
        emitTaskPlanningMutation(result, correlationId, emitEvent);
        return {
          status: "accepted",
          requestId: command.id,
          payload: result.view.plan
        };
      }

      default:
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "core.unsupported_command",
            message: `Core utility does not support ${command.type}.`
          }
        };
    }
  }
});
