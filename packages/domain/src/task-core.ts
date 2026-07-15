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

export interface PlanStepDagInput {
  key: string;
  dependsOn?: readonly string[];
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

/**
 * Validates the dependency graph for a persisted plan version. Transport DTOs
 * may omit a key while they are still drafts, but the application layer must
 * assign stable keys before invoking this domain rule.
 */
export function assertPlanStepDag(steps: readonly PlanStepDagInput[]): void {
  const dependenciesByKey = new Map<string, readonly string[]>();

  for (const step of steps) {
    const key = step.key.trim();

    if (!key) {
      throw new DomainError("plan.step_key_required", "Every plan step must have a stable key.");
    }

    if (dependenciesByKey.has(key)) {
      throw new DomainError("plan.duplicate_step_key", `Plan step key is duplicated: ${key}.`);
    }

    dependenciesByKey.set(
      key,
      (step.dependsOn ?? []).map((dependency) => dependency.trim())
    );
  }

  for (const [key, dependencies] of dependenciesByKey) {
    for (const dependency of dependencies) {
      if (dependency === key) {
        throw new DomainError("plan.self_dependency", `Plan step cannot depend on itself: ${key}.`);
      }

      if (!dependenciesByKey.has(dependency)) {
        throw new DomainError(
          "plan.unknown_dependency",
          `Plan step ${key} depends on an unknown step: ${dependency}.`
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string): void => {
    if (visited.has(key)) {
      return;
    }

    if (visiting.has(key)) {
      throw new DomainError("plan.cyclic_dependency", `Plan contains a dependency cycle at step: ${key}.`);
    }

    visiting.add(key);

    for (const dependency of dependenciesByKey.get(key) ?? []) {
      visit(dependency);
    }

    visiting.delete(key);
    visited.add(key);
  };

  for (const key of dependenciesByKey.keys()) {
    visit(key);
  }
}
