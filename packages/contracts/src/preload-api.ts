import type { SessionPromptAcceptedPayload, SessionPromptCommandPayload } from "./session";
import type { SystemEventEnvelope, SystemHealthPayload } from "./system";
import type {
  ModelConfigDeleteCommandPayload,
  ModelConfigEntryInput,
  ModelConfigSetDefaultCommandPayload,
  ModelConfigSummaryListPayload
} from "./model-config";

export interface PersonalClawApi {
  system: {
    health(): Promise<SystemHealthPayload>;
  };
  session: {
    prompt(payload: SessionPromptCommandPayload): Promise<SessionPromptAcceptedPayload>;
  };
  modelConfig: {
    list(): Promise<ModelConfigSummaryListPayload>;
    upsert(entry: ModelConfigEntryInput): Promise<ModelConfigSummaryListPayload>;
    delete(payload: ModelConfigDeleteCommandPayload): Promise<ModelConfigSummaryListPayload>;
    setDefault(payload: ModelConfigSetDefaultCommandPayload): Promise<ModelConfigSummaryListPayload>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
