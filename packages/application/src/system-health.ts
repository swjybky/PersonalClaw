import type { SystemHealthPayload } from "@personal-claw/contracts";

export interface SystemHealthPort {
  collectHealth(): Promise<SystemHealthPayload>;
}

export class GetSystemHealth {
  constructor(private readonly healthPort: SystemHealthPort) {}

  execute(): Promise<SystemHealthPayload> {
    return this.healthPort.collectHealth();
  }
}
