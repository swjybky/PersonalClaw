import { contextBridge, ipcRenderer } from "electron";
import {
  CommandResultSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  SessionPromptCommandPayloadSchema,
  TaskDraftAcceptedPayloadSchema,
  TaskDraftFromDescriptionCommandPayloadSchema,
  CodeAgentDeleteCommandPayloadSchema,
  CodeAgentListCommandPayloadSchema,
  CodeAgentListPayloadSchema,
  CodeAgentProfileInputSchema,
  ProjectArchiveCommandPayloadSchema,
  ProjectCreateCommandPayloadSchema,
  ProjectListCommandPayloadSchema,
  ProjectListPayloadSchema,
  ProjectUpdateCommandPayloadSchema,
  TaskAssignCodeAgentCommandPayloadSchema,
  TaskAnalysisSummarySchema,
  TaskApprovePlanCommandPayloadSchema,
  TaskCreateCommandPayloadSchema,
  TaskDeleteCommandPayloadSchema,
  TaskGetCommandPayloadSchema,
  TaskListCommandPayloadSchema,
  TaskListPayloadSchema,
  TaskPlanSummarySchema,
  TaskRequestPlanApprovalCommandPayloadSchema,
  TaskSaveAnalysisCommandPayloadSchema,
  TaskSavePlanCommandPayloadSchema,
  TaskSetStatusCommandPayloadSchema,
  TaskStatusViewSchema,
  TaskSummarySchema,
  TaskUpdateCommandPayloadSchema,
  TaskUpdateProgressCommandPayloadSchema,
  ModelConfigSummaryListPayloadSchema,
  ModelConfigDeleteCommandPayloadSchema,
  ModelConfigEntryInputSchema,
  ModelConfigSetDefaultCommandPayloadSchema,
  ModelConfigTestCommandPayloadSchema,
  ModelConfigTestResultPayloadSchema,
  createEnvelope,
  type CommandType,
  type CodeAgentDeleteCommandPayload,
  type CodeAgentListCommandPayload,
  type CodeAgentListPayload,
  type CodeAgentProfileInput,
  type ModelConfigDeleteCommandPayload,
  type ModelConfigEntryInput,
  type ModelConfigSetDefaultCommandPayload,
  type ModelConfigSummaryListPayload,
  type ModelConfigTestCommandPayload,
  type ModelConfigTestResultPayload,
  type PersonalClawApi,
  type ProjectArchiveCommandPayload,
  type ProjectCreateCommandPayload,
  type ProjectListCommandPayload,
  type ProjectListPayload,
  type ProjectUpdateCommandPayload,
  type SessionPromptAcceptedPayload,
  type SessionPromptCommandPayload,
  type SystemEventEnvelope,
  type SystemHealthPayload,
  type TaskDraftAcceptedPayload,
  type TaskDraftFromDescriptionCommandPayload,
  type TaskAssignCodeAgentCommandPayload,
  type TaskAnalysisSummary,
  type TaskApprovePlanCommandPayload,
  type TaskCreateCommandPayload,
  type TaskDeleteCommandPayload,
  type TaskGetCommandPayload,
  type TaskListCommandPayload,
  type TaskListPayload,
  type TaskPlanSummary,
  type TaskRequestPlanApprovalCommandPayload,
  type TaskSaveAnalysisCommandPayload,
  type TaskSavePlanCommandPayload,
  type TaskSetStatusCommandPayload,
  type TaskStatusView,
  type TaskSummary,
  type TaskUpdateCommandPayload,
  type TaskUpdateProgressCommandPayload
} from "@personal-claw/contracts";

function createBrowserId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

async function invokeCommand<TPayload>(type: CommandType, payload: unknown): Promise<TPayload> {
  const commandId = createBrowserId("cmd");
  const result = CommandResultSchema.parse(
    await ipcRenderer.invoke(
      IPC_COMMAND_CHANNEL,
      createEnvelope(type, payload, {
        id: commandId,
        context: {
          correlationId: commandId
        }
      })
    )
  );

  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }

  return result.payload as TPayload;
}

const api: PersonalClawApi = {
  system: {
    async health(): Promise<SystemHealthPayload> {
      return SystemHealthPayloadSchema.parse(await invokeCommand<SystemHealthPayload>("system.health", {}));
    }
  },
  session: {
    async prompt(payload: SessionPromptCommandPayload): Promise<SessionPromptAcceptedPayload> {
      return SessionPromptAcceptedPayloadSchema.parse(
        await invokeCommand<SessionPromptAcceptedPayload>("session.prompt", SessionPromptCommandPayloadSchema.parse(payload))
      );
    }
  },
  task: {
    async draftFromDescription(
      payload: TaskDraftFromDescriptionCommandPayload
    ): Promise<TaskDraftAcceptedPayload> {
      return TaskDraftAcceptedPayloadSchema.parse(
        await invokeCommand<TaskDraftAcceptedPayload>(
          "task.draftFromDescription",
          TaskDraftFromDescriptionCommandPayloadSchema.parse(payload)
        )
      );
    },
    async create(payload: TaskCreateCommandPayload): Promise<TaskSummary> {
      return TaskSummarySchema.parse(
        await invokeCommand<TaskSummary>("task.create", TaskCreateCommandPayloadSchema.parse(payload))
      );
    },
    async list(payload: TaskListCommandPayload): Promise<TaskListPayload> {
      return TaskListPayloadSchema.parse(
        await invokeCommand<TaskListPayload>("task.list", TaskListCommandPayloadSchema.parse(payload))
      );
    },
    async get(payload: TaskGetCommandPayload): Promise<TaskStatusView> {
      return TaskStatusViewSchema.parse(
        await invokeCommand<TaskStatusView>("task.get", TaskGetCommandPayloadSchema.parse(payload))
      );
    },
    async update(payload: TaskUpdateCommandPayload): Promise<TaskSummary> {
      return TaskSummarySchema.parse(
        await invokeCommand<TaskSummary>("task.update", TaskUpdateCommandPayloadSchema.parse(payload))
      );
    },
    async delete(payload: TaskDeleteCommandPayload): Promise<TaskSummary> {
      return TaskSummarySchema.parse(
        await invokeCommand<TaskSummary>("task.delete", TaskDeleteCommandPayloadSchema.parse(payload))
      );
    },
    async setStatus(payload: TaskSetStatusCommandPayload): Promise<TaskSummary> {
      return TaskSummarySchema.parse(
        await invokeCommand<TaskSummary>("task.setStatus", TaskSetStatusCommandPayloadSchema.parse(payload))
      );
    },
    async updateProgress(payload: TaskUpdateProgressCommandPayload): Promise<TaskSummary> {
      return TaskSummarySchema.parse(
        await invokeCommand<TaskSummary>(
          "task.updateProgress",
          TaskUpdateProgressCommandPayloadSchema.parse(payload)
        )
      );
    },
    async assignCodeAgent(payload: TaskAssignCodeAgentCommandPayload): Promise<TaskSummary> {
      return TaskSummarySchema.parse(
        await invokeCommand<TaskSummary>(
          "task.assignCodeAgent",
          TaskAssignCodeAgentCommandPayloadSchema.parse(payload)
        )
      );
    },
    async saveAnalysis(payload: TaskSaveAnalysisCommandPayload): Promise<TaskAnalysisSummary> {
      return TaskAnalysisSummarySchema.parse(
        await invokeCommand<TaskAnalysisSummary>(
          "task.saveAnalysis",
          TaskSaveAnalysisCommandPayloadSchema.parse(payload)
        )
      );
    },
    async savePlan(payload: TaskSavePlanCommandPayload): Promise<TaskPlanSummary> {
      return TaskPlanSummarySchema.parse(
        await invokeCommand<TaskPlanSummary>(
          "task.savePlan",
          TaskSavePlanCommandPayloadSchema.parse(payload)
        )
      );
    },
    async requestPlanApproval(
      payload: TaskRequestPlanApprovalCommandPayload
    ): Promise<TaskPlanSummary> {
      return TaskPlanSummarySchema.parse(
        await invokeCommand<TaskPlanSummary>(
          "task.requestPlanApproval",
          TaskRequestPlanApprovalCommandPayloadSchema.parse(payload)
        )
      );
    },
    async approvePlan(payload: TaskApprovePlanCommandPayload): Promise<TaskPlanSummary> {
      return TaskPlanSummarySchema.parse(
        await invokeCommand<TaskPlanSummary>(
          "task.approvePlan",
          TaskApprovePlanCommandPayloadSchema.parse(payload)
        )
      );
    }
  },
  project: {
    async create(payload: ProjectCreateCommandPayload): Promise<ProjectListPayload> {
      return ProjectListPayloadSchema.parse(
        await invokeCommand<ProjectListPayload>("project.create", ProjectCreateCommandPayloadSchema.parse(payload))
      );
    },
    async list(payload: ProjectListCommandPayload = {}): Promise<ProjectListPayload> {
      return ProjectListPayloadSchema.parse(
        await invokeCommand<ProjectListPayload>("project.list", ProjectListCommandPayloadSchema.parse(payload))
      );
    },
    async update(payload: ProjectUpdateCommandPayload): Promise<ProjectListPayload> {
      return ProjectListPayloadSchema.parse(
        await invokeCommand<ProjectListPayload>("project.update", ProjectUpdateCommandPayloadSchema.parse(payload))
      );
    },
    async archive(payload: ProjectArchiveCommandPayload): Promise<ProjectListPayload> {
      return ProjectListPayloadSchema.parse(
        await invokeCommand<ProjectListPayload>("project.archive", ProjectArchiveCommandPayloadSchema.parse(payload))
      );
    }
  },
  codeAgent: {
    async list(payload: CodeAgentListCommandPayload = {}): Promise<CodeAgentListPayload> {
      return CodeAgentListPayloadSchema.parse(
        await invokeCommand<CodeAgentListPayload>("codeAgent.list", CodeAgentListCommandPayloadSchema.parse(payload))
      );
    },
    async upsert(profile: CodeAgentProfileInput): Promise<CodeAgentListPayload> {
      return CodeAgentListPayloadSchema.parse(
        await invokeCommand<CodeAgentListPayload>(
          "codeAgent.upsert",
          { profile: CodeAgentProfileInputSchema.parse(profile) }
        )
      );
    },
    async delete(payload: CodeAgentDeleteCommandPayload): Promise<CodeAgentListPayload> {
      return CodeAgentListPayloadSchema.parse(
        await invokeCommand<CodeAgentListPayload>(
          "codeAgent.delete",
          CodeAgentDeleteCommandPayloadSchema.parse(payload)
        )
      );
    }
  },
  modelConfig: {
    async list(): Promise<ModelConfigSummaryListPayload> {
      return ModelConfigSummaryListPayloadSchema.parse(
        await invokeCommand<ModelConfigSummaryListPayload>("modelConfig.list", {})
      );
    },
    async upsert(entry: ModelConfigEntryInput): Promise<ModelConfigSummaryListPayload> {
      return ModelConfigSummaryListPayloadSchema.parse(
        await invokeCommand<ModelConfigSummaryListPayload>(
          "modelConfig.upsert",
          { entry: ModelConfigEntryInputSchema.parse(entry) }
        )
      );
    },
    async delete(payload: ModelConfigDeleteCommandPayload): Promise<ModelConfigSummaryListPayload> {
      return ModelConfigSummaryListPayloadSchema.parse(
        await invokeCommand<ModelConfigSummaryListPayload>(
          "modelConfig.delete",
          ModelConfigDeleteCommandPayloadSchema.parse(payload)
        )
      );
    },
    async setDefault(payload: ModelConfigSetDefaultCommandPayload): Promise<ModelConfigSummaryListPayload> {
      return ModelConfigSummaryListPayloadSchema.parse(
        await invokeCommand<ModelConfigSummaryListPayload>(
          "modelConfig.setDefault",
          ModelConfigSetDefaultCommandPayloadSchema.parse(payload)
        )
      );
    },
    async test(payload: ModelConfigTestCommandPayload): Promise<ModelConfigTestResultPayload> {
      return ModelConfigTestResultPayloadSchema.parse(
        await invokeCommand<ModelConfigTestResultPayload>(
          "modelConfig.test",
          ModelConfigTestCommandPayloadSchema.parse(payload)
        )
      );
    }
  },
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, rawEvent: unknown): void => {
        const parsed = SystemEventEnvelopeSchema.safeParse(rawEvent);

        if (parsed.success) {
          listener(parsed.data as SystemEventEnvelope);
          return;
        }

        console.error(
          "[PersonalClaw] Dropped an invalid system event:",
          parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
        );
      };

      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);

      return () => {
        ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
      };
    }
  }
};

contextBridge.exposeInMainWorld("personalClaw", api);
