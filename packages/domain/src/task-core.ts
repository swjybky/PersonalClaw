import { DomainError } from "./errors";
import { type TaskStatus, assertTaskStatusTransition, canTransitionTaskStatus } from "./task-state";

export const LOCAL_OWNER_ID = "local-user";

export type PlanStepProgressStatus = "pending" | "active" | "done" | "blocked" | "failed";

export interface TaskCreationInput {
  projectId: string;
  ownerId: string;
  title: string;
  goal: string;
}

export interface PlanStepProgressInput {
  status: PlanStepProgressStatus;
}

function assertNonEmpty(value: string, code: string, message: string): void {
  if (!value.trim()) {
    throw new DomainError(code, message);
  }
}

export function assertTaskCreation(input: TaskCreationInput): void {
  assertNonEmpty(input.projectId, "task.project_required", "Task must be bound to a project.");
  assertNonEmpty(input.ownerId, "task.owner_required", "Task must be bound to an owner.");
  assertNonEmpty(input.title, "task.title_required", "Task title is required.");
  assertNonEmpty(input.goal, "task.goal_required", "Task goal is required.");
}

export function assertTaskProgress(progressPercent: number): void {
  if (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100) {
    throw new DomainError("task.invalid_progress", "Task progress must be an integer between 0 and 100.");
  }
}

export function calculateStepProgressPercent(steps: readonly PlanStepProgressInput[]): number {
  if (steps.length === 0) {
    return 0;
  }

  const score = steps.reduce((total, step) => {
    if (step.status === "done") {
      return total + 1;
    }

    if (step.status === "active") {
      return total + 0.5;
    }

    return total;
  }, 0);

  return Math.round((score / steps.length) * 100);
}

export function assertTaskStatusChange(from: TaskStatus, to: TaskStatus): void {
  assertTaskStatusTransition(from, to);
}

export function canArchiveTaskStatus(status: TaskStatus): boolean {
  return status === "archived" || canTransitionTaskStatus(status, "archived");
}
