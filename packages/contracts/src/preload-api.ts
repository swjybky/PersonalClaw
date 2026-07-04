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
