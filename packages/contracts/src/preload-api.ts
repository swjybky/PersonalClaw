import type { SystemEventEnvelope, SystemHealthPayload } from "./system";

export interface PersonalClawApi {
  system: {
    health(): Promise<SystemHealthPayload>;
  };
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void;
  };
}
