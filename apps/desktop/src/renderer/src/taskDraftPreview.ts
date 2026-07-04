import type { TaskDraftPreview } from "@personal-claw/contracts";

export interface TaskProgressItem {
  id: string;
  label: string;
  status: "done" | "active" | "pending";
}

export interface TaskDraftSummary {
  title: string;
  source: string;
  project: string;
  automationLevel: string;
  missingInformation: string;
  nextStep: string;
}

export function buildTaskProgressItems(
  draft: TaskDraftPreview | null,
  isDraftRunning: boolean
): readonly TaskProgressItem[] {
  if (draft) {
    return [
      { id: "task-intake", label: "Task intake", status: "done" },
      { id: "task-analysis", label: "Loop analysis", status: "done" },
      { id: "task-plan", label: "Draft plan", status: "done" },
      { id: "task-approval", label: "User approval", status: "active" }
    ];
  }

  if (isDraftRunning) {
    return [
      { id: "task-intake", label: "Task intake", status: "done" },
      { id: "task-analysis", label: "Loop analysis", status: "active" },
      { id: "task-plan", label: "Draft plan", status: "pending" },
      { id: "task-approval", label: "User approval", status: "pending" }
    ];
  }

  return [
    { id: "task-intake", label: "Task intake", status: "active" },
    { id: "task-analysis", label: "Loop analysis", status: "pending" },
    { id: "task-plan", label: "Draft plan", status: "pending" },
    { id: "task-approval", label: "User approval", status: "pending" }
  ];
}

export function summarizeTaskDraft(draft: TaskDraftPreview | null): TaskDraftSummary {
  if (!draft) {
    return {
      title: "Personal task assistant",
      source: "New description",
      project: "PersonalClaw",
      automationLevel: "L0 suggestion",
      missingInformation: "Waiting for a task description",
      nextStep: "Describe a task to generate a draft"
    };
  }

  return {
    title: draft.title,
    source: "Manual description",
    project: "PersonalClaw",
    automationLevel: `${draft.suggestedAutomationLevel} suggestion`,
    missingInformation: draft.missingInformation.length
      ? `${draft.missingInformation.length} item(s)`
      : "None",
    nextStep: draft.approvalRequired ? "Review the draft before execution" : "Ready for review"
  };
}

export function taskProgressPercent(items: readonly TaskProgressItem[]): number {
  const completed = items.filter((item) => item.status === "done").length;
  const active = items.some((item) => item.status === "active") ? 0.5 : 0;

  return Math.round(((completed + active) / items.length) * 100);
}
