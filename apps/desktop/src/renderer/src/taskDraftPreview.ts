import type {
  PlanStepInput,
  TaskAnalysisInput,
  TaskCreateCommandPayload,
  TaskDraftPreview,
  TaskPriority
} from "@personal-claw/contracts";

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

export interface TaskDraftConfirmationInput {
  projectId: string;
  sessionId: string;
  title?: string;
  goal?: string;
  priority?: TaskPriority;
  codeAgentId?: string | null;
}

export function buildTaskProgressItems(
  draft: TaskDraftPreview | null,
  isDraftRunning: boolean
): readonly TaskProgressItem[] {
  if (draft) {
    return [
      { id: "task-intake", label: "Task intake", status: "done" },
      { id: "task-analysis", label: "Loop analysis", status: "done" },
      { id: "task-plan", label: "Draft plan", status: "done" }
    ];
  }

  if (isDraftRunning) {
    return [
      { id: "task-intake", label: "Task intake", status: "done" },
      { id: "task-analysis", label: "Loop analysis", status: "active" },
      { id: "task-plan", label: "Draft plan", status: "pending" }
    ];
  }

  return [
    { id: "task-intake", label: "Task intake", status: "active" },
    { id: "task-analysis", label: "Loop analysis", status: "pending" },
    { id: "task-plan", label: "Draft plan", status: "pending" }
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
    nextStep: "Ready for review"
  };
}

export function taskProgressPercent(items: readonly TaskProgressItem[]): number {
  const completed = items.filter((item) => item.status === "done").length;
  const active = items.some((item) => item.status === "active") ? 0.5 : 0;

  return Math.round(((completed + active) / items.length) * 100);
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildStableDraftStepKey(sequence: number): string {
  return `step_${sequence}`;
}

export function buildTaskAnalysisFromDraft(draft: TaskDraftPreview): TaskAnalysisInput {
  const completionDefinition = uniqueNonEmpty(
    draft.steps.flatMap((step) => step.successCriteria)
  );

  return {
    objective: draft.objective,
    knownInformation: uniqueNonEmpty(draft.assumptions),
    missingInformation: uniqueNonEmpty(draft.missingInformation),
    constraints: uniqueNonEmpty(draft.constraints),
    risks: uniqueNonEmpty(draft.steps.flatMap((step) => step.expectedSideEffects)),
    expectedArtifacts: uniqueNonEmpty(draft.expectedArtifacts),
    completionDefinition:
      completionDefinition.length > 0 ? completionDefinition : [`完成：${draft.objective}`],
    suggestedAutomationLevel: draft.suggestedAutomationLevel
  };
}

export function buildTaskPlanStepsFromDraft(draft: TaskDraftPreview): PlanStepInput[] {
  const orderedSteps = [...draft.steps].sort((left, right) => left.sequence - right.sequence);

  if (orderedSteps.length === 0) {
    throw new Error("任务草稿至少需要一个方案步骤。");
  }

  const stableKeys = orderedSteps.map((step) => buildStableDraftStepKey(step.sequence));
  if (new Set(stableKeys).size !== stableKeys.length) {
    throw new Error("任务草稿包含重复的步骤序号，无法生成稳定 key。");
  }

  if (new Set(orderedSteps.map((step) => step.id)).size !== orderedSteps.length) {
    throw new Error("任务草稿包含重复的步骤 id，无法映射 DAG 依赖。");
  }

  const keyByDraftId = new Map(
    orderedSteps.map((step) => [step.id, buildStableDraftStepKey(step.sequence)] as const)
  );

  return orderedSteps.map((step) => {
    const dependsOn = step.dependsOn.map((dependency) => {
      const key = keyByDraftId.get(dependency);

      if (!key) {
        throw new Error(`任务草稿步骤 ${step.id} 引用了未知依赖 ${dependency}。`);
      }

      return key;
    });

    return {
      key: keyByDraftId.get(step.id) ?? buildStableDraftStepKey(step.sequence),
      title: step.title,
      goal: step.goal,
      type: step.type,
      dependsOn: uniqueNonEmpty(dependsOn),
      successCriteria: uniqueNonEmpty(step.successCriteria),
      status: "pending"
    };
  });
}

export function buildTaskCreatePayloadFromDraft(
  draft: TaskDraftPreview,
  input: TaskDraftConfirmationInput
): TaskCreateCommandPayload {
  const title = input.title?.trim() || draft.title;
  const goal = input.goal?.trim() || draft.objective;
  const planSteps = buildTaskPlanStepsFromDraft(draft);
  const planSummary = `共 ${planSteps.length} 个步骤：${planSteps
    .map((step) => step.title)
    .join(" → ")}`.slice(0, 8_000);

  return {
    projectId: input.projectId,
    title,
    goal,
    source: {
      kind: "conversation",
      label: `AI 对话整理 · ${input.sessionId.slice(0, 80)}`,
      referenceId: draft.draftId
    },
    priority: input.priority ?? "normal",
    analysis: buildTaskAnalysisFromDraft(draft),
    planSummary,
    steps: planSteps,
    codeAgentId: input.codeAgentId ?? null
  };
}
