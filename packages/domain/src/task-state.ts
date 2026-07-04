import { DomainError } from "./errors";

export const TASK_STATUSES = [
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
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  draft: ["analyzing", "archived", "cancelled"],
  analyzing: ["design_ready", "blocked", "failed", "cancelled"],
  design_ready: ["queued", "analyzing", "archived", "cancelled"],
  queued: ["running", "paused", "cancelled"],
  running: ["paused", "blocked", "verifying", "failed", "cancelled"],
  paused: ["queued", "running", "cancelled"],
  blocked: ["analyzing", "design_ready", "queued", "running", "failed", "cancelled"],
  verifying: ["succeeded", "failed", "blocked"],
  succeeded: ["archived"],
  failed: ["archived", "draft"],
  cancelled: ["archived", "draft"],
  archived: []
};

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTaskStatusTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTaskStatus(from, to)) {
    throw new DomainError("task.invalid_status_transition", `Cannot transition task from ${from} to ${to}.`);
  }
}
