import type { SessionPromptAcceptedPayload, SessionPromptCommandPayload } from "./session";
import type { SystemEventEnvelope, SystemHealthPayload } from "./system";
import type {
  ModelConfigDeleteCommandPayload,
  ModelConfigEntryInput,
  ModelConfigSetDefaultCommandPayload,
  ModelConfigSummaryListPayload,
  ModelConfigTestCommandPayload,
  ModelConfigTestResultPayload
} from "./model-config";
import type {
  TaskDraftAcceptedPayload,
  TaskDraftFromDescriptionCommandPayload
} from "./task-draft";
import type {
  CodeAgentDeleteCommandPayload,
  CodeAgentListCommandPayload,
  CodeAgentListPayload,
  CodeAgentProfileInput,
  ProjectArchiveCommandPayload,
  ProjectCreateCommandPayload,
  ProjectListCommandPayload,
  ProjectListPayload,
  ProjectUpdateCommandPayload,
  TaskAssignCodeAgentCommandPayload,
  TaskAnalysisSummary,
  TaskApprovePlanCommandPayload,
  TaskCreateCommandPayload,
  TaskDeleteCommandPayload,
  TaskGetCommandPayload,
  TaskListCommandPayload,
  TaskListPayload,
  TaskPlanSummary,
  TaskRequestPlanApprovalCommandPayload,
  TaskSaveAnalysisCommandPayload,
  TaskSavePlanCommandPayload,
  TaskSetStatusCommandPayload,
  TaskStatusView,
  TaskSummary,
  TaskUpdateCommandPayload,
  TaskUpdateProgressCommandPayload
} from "./task-core";

export interface PersonalClawApi {
  system: {
    health(): Promise<SystemHealthPayload>;
  };
  session: {
    prompt(payload: SessionPromptCommandPayload): Promise<SessionPromptAcceptedPayload>;
  };
  task: {
    draftFromDescription(
      payload: TaskDraftFromDescriptionCommandPayload
    ): Promise<TaskDraftAcceptedPayload>;
    create(payload: TaskCreateCommandPayload): Promise<TaskSummary>;
    list(payload: TaskListCommandPayload): Promise<TaskListPayload>;
    get(payload: TaskGetCommandPayload): Promise<TaskStatusView>;
    update(payload: TaskUpdateCommandPayload): Promise<TaskSummary>;
    delete(payload: TaskDeleteCommandPayload): Promise<TaskSummary>;
    setStatus(payload: TaskSetStatusCommandPayload): Promise<TaskSummary>;
    updateProgress(payload: TaskUpdateProgressCommandPayload): Promise<TaskSummary>;
    assignCodeAgent(payload: TaskAssignCodeAgentCommandPayload): Promise<TaskSummary>;
    saveAnalysis(payload: TaskSaveAnalysisCommandPayload): Promise<TaskAnalysisSummary>;
    savePlan(payload: TaskSavePlanCommandPayload): Promise<TaskPlanSummary>;
    requestPlanApproval(
      payload: TaskRequestPlanApprovalCommandPayload
    ): Promise<TaskPlanSummary>;
    approvePlan(payload: TaskApprovePlanCommandPayload): Promise<TaskPlanSummary>;
  };
  project: {
    create(payload: ProjectCreateCommandPayload): Promise<ProjectListPayload>;
    list(payload?: ProjectListCommandPayload): Promise<ProjectListPayload>;
    update(payload: ProjectUpdateCommandPayload): Promise<ProjectListPayload>;
    archive(payload: ProjectArchiveCommandPayload): Promise<ProjectListPayload>;
  };
  codeAgent: {
    list(payload?: CodeAgentListCommandPayload): Promise<CodeAgentListPayload>;
    upsert(profile: CodeAgentProfileInput): Promise<CodeAgentListPayload>;
    delete(payload: CodeAgentDeleteCommandPayload): Promise<CodeAgentListPayload>;
  };
  modelConfig: {
    list(): Promise<ModelConfigSummaryListPayload>;
    upsert(entry: ModelConfigEntryInput): Promise<ModelConfigSummaryListPayload>;
    delete(payload: ModelConfigDeleteCommandPayload): Promise<ModelConfigSummaryListPayload>;
    setDefault(payload: ModelConfigSetDefaultCommandPayload): Promise<ModelConfigSummaryListPayload>;
    test(payload: ModelConfigTestCommandPayload): Promise<ModelConfigTestResultPayload>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
