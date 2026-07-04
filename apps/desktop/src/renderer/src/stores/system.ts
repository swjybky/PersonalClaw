import { defineStore } from "pinia";
import type { SystemEventEnvelope, SystemHealthPayload } from "@personal-claw/contracts";

interface SystemState {
  health: SystemHealthPayload | null;
  events: SystemEventEnvelope[];
  isLoading: boolean;
  error: string | null;
  unsubscribe: (() => void) | null;
}

export const useSystemStore = defineStore("system", {
  state: (): SystemState => ({
    health: null,
    events: [],
    isLoading: false,
    error: null,
    unsubscribe: null
  }),
  actions: {
    async refreshHealth(): Promise<void> {
      this.isLoading = true;
      this.error = null;

      try {
        this.health = await window.personalClaw.system.health();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Health check failed.";
      } finally {
        this.isLoading = false;
      }
    },
    subscribe(listener?: (event: SystemEventEnvelope) => void): void {
      if (this.unsubscribe) {
        return;
      }

      this.unsubscribe = window.personalClaw.events.subscribe((event) => {
        listener?.(event);
        this.events = [event, ...this.events].slice(0, 12);

        if (event.type === "system.health") {
          this.health = event.payload;
        }
      });
    },
    teardown(): void {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }
});
