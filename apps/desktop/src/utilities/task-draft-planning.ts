import {
  TaskDraftPreviewSchema,
  type AutomationLevel,
  type DraftStepType,
  type TaskDraftLoopIteration,
  type TaskDraftPreview,
  type TaskDraftStep
} from "@personal-claw/contracts";

const AUTOMATION_LEVELS = new Set<AutomationLevel>(["L0", "L1", "L2", "L3", "L4"]);
const DRAFT_STEP_TYPES = new Set<DraftStepType>([
  "agent",
  "tool",
  "human_input",
  "approval",
  "verification",
  "notification"
]);
const TOP_LEVEL_KEYS = new Set([
  "title",
  "objective",
  "assumptions",
  "constraints",
  "missingInformation",
  "expectedArtifacts",
  "suggestedAutomationLevel",
  "steps"
]);
const STEP_KEYS = new Set([
  "id",
  "type",
  "title",
  "goal",
  "dependsOn",
  "expectedSideEffects",
  "successCriteria",
  "retryStrategy",
  "rollbackNotes"
]);

interface ParsedTaskDraftStep {
  id: string;
  type: DraftStepType;
  title: string;
  goal: string;
  dependsOn: string[];
  expectedSideEffects: string[];
  successCriteria: string[];
  retryStrategy: string;
  rollbackNotes: string;
}

interface ParsedTaskDraftModelOutput {
  title: string;
  objective: string;
  assumptions: string[];
  constraints: string[];
  missingInformation: string[];
  expectedArtifacts: string[];
  suggestedAutomationLevel: AutomationLevel;
  steps: ParsedTaskDraftStep[];
}

export type TaskDraftModelParseResult =
  | { ok: true; value: ParsedTaskDraftModelOutput }
  | { ok: false; error: string };

export function buildTaskDraftPrompt(description: string, maxIterations: number): string {
  const outputShape = {
    title: "Short task title",
    objective: "Concrete objective and definition of done",
    assumptions: ["Assumption grounded in the description"],
    constraints: ["Constraint that limits execution"],
    missingInformation: ["Question or missing fact; use [] when nothing is missing"],
    expectedArtifacts: ["Deliverable produced when the task is complete"],
    suggestedAutomationLevel: "L0",
    steps: [
      {
        id: "step_1",
        type: "human_input",
        title: "Confirm scope",
        goal: "Resolve the information required before execution",
        dependsOn: [],
        expectedSideEffects: [],
        successCriteria: ["Scope and completion criteria are explicit"],
        retryStrategy: "Ask one focused clarification round",
        rollbackNotes: "No external state is changed during planning"
      },
      {
        id: "step_2",
        type: "agent",
        title: "Prepare execution",
        goal: "Prepare the approved work without performing it",
        dependsOn: ["step_1"],
        expectedSideEffects: [],
        successCriteria: ["The plan is executable and reviewable"],
        retryStrategy: "Split vague work into smaller steps",
        rollbackNotes: "Keep the last approved plan"
      }
    ]
  };

  return [
    "PERSONAL_CLAW_TASK_DRAFT_JSON_V1",
    "You are the PersonalClaw planning agent for task intake.",
    "This run is planning-only and has zero tools. Do not call tools and do not claim that Task, Plan, or Run state changed.",
    `Use at most ${maxIterations} internal passes for intake, analysis, and plan design.`,
    "Return exactly one valid JSON object and no other text.",
    "Do not use Markdown fences, comments, trailing commas, or additional properties.",
    "All fields in the following shape are required. Arrays must be present even when empty.",
    "suggestedAutomationLevel must be one of L0, L1, L2, L3, L4.",
    "Each step id must be unique. dependsOn may reference only ids from earlier steps.",
    "Each step type must be one of agent, tool, human_input, approval, verification, notification.",
    "steps and expectedArtifacts must contain at least one item, and every step must have at least one success criterion.",
    "JSON shape example:",
    JSON.stringify(outputShape, null, 2),
    "",
    "User description:",
    description
  ].join("\n");
}

export function parseTaskDraftModelOutput(text: string): TaskDraftModelParseResult {
  const normalized = text.trim();

  if (!normalized) {
    return {
      ok: false,
      error: "Model output was empty; expected one JSON object."
    };
  }

  try {
    const value: unknown = JSON.parse(normalized);
    return {
      ok: true,
      value: validateTaskDraftModelOutput(value)
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown task draft JSON parsing error."
    };
  }
}

export function buildTaskDraftPreview(input: {
  draftId: string;
  description: string;
  assistantText: string;
  createdAt: string;
  maxIterations: number;
}): TaskDraftPreview {
  const parsed = parseTaskDraftModelOutput(input.assistantText);

  if (!parsed.ok) {
    return buildFallbackTaskDraftPreview(input, parsed.error);
  }

  const stepIdMap = new Map(
    parsed.value.steps.map((step, index) => [step.id, `${input.draftId}_step_${index + 1}`])
  );
  const steps: TaskDraftStep[] = parsed.value.steps.map((step, index) => ({
    id: requireMappedStepId(stepIdMap, step.id),
    sequence: index + 1,
    type: step.type,
    title: step.title,
    goal: step.goal,
    dependsOn: step.dependsOn.map((dependency) => requireMappedStepId(stepIdMap, dependency)),
    expectedSideEffects: step.expectedSideEffects,
    successCriteria: step.successCriteria,
    retryStrategy: step.retryStrategy,
    rollbackNotes: step.rollbackNotes
  }));
  const candidate: TaskDraftPreview = {
    draftId: input.draftId,
    status: "draft",
    title: parsed.value.title,
    objective: parsed.value.objective,
    source: {
      kind: "manual_description",
      description: normalizeDescription(input.description)
    },
    suggestedAutomationLevel: parsed.value.suggestedAutomationLevel,
    assumptions: parsed.value.assumptions,
    constraints: parsed.value.constraints,
    missingInformation: parsed.value.missingInformation,
    expectedArtifacts: parsed.value.expectedArtifacts,
    loopIterations: buildLoopIterations(input.maxIterations, true),
    steps,
    generatedSummary: preserveModelOutput(input.assistantText),
    createdAt: input.createdAt
  };
  const validated = TaskDraftPreviewSchema.safeParse(candidate);

  if (!validated.success) {
    const issueSummary = validated.error.issues
      .map((issue) => `${issue.path.join(".") || "draft"}: ${issue.message}`)
      .join("; ");
    return buildFallbackTaskDraftPreview(
      input,
      `Normalized model JSON failed TaskDraftPreview validation: ${issueSummary}`
    );
  }

  return validated.data;
}

function validateTaskDraftModelOutput(value: unknown): ParsedTaskDraftModelOutput {
  const record = requireRecord(value, "draft");
  assertOnlyKeys(record, TOP_LEVEL_KEYS, "draft");
  const stepsValue = record.steps;

  if (!Array.isArray(stepsValue) || stepsValue.length === 0) {
    throw new Error("draft.steps must be a non-empty array.");
  }

  const steps = stepsValue.map((step, index) => validateTaskDraftStep(step, index));
  validateStepDependencies(steps);

  return {
    title: requireString(record, "title", "draft"),
    objective: requireString(record, "objective", "draft"),
    assumptions: requireStringArray(record, "assumptions", "draft"),
    constraints: requireStringArray(record, "constraints", "draft"),
    missingInformation: requireStringArray(record, "missingInformation", "draft"),
    expectedArtifacts: requireStringArray(record, "expectedArtifacts", "draft", 1),
    suggestedAutomationLevel: requireAutomationLevel(record.suggestedAutomationLevel),
    steps
  };
}

function validateTaskDraftStep(value: unknown, index: number): ParsedTaskDraftStep {
  const path = `draft.steps[${index}]`;
  const record = requireRecord(value, path);
  assertOnlyKeys(record, STEP_KEYS, path);
  const id = requireString(record, "id", path);

  if (!/^[A-Za-z0-9_-]+$/u.test(id)) {
    throw new Error(`${path}.id may contain only letters, numbers, underscores, and hyphens.`);
  }

  return {
    id,
    type: requireDraftStepType(record.type, `${path}.type`),
    title: requireString(record, "title", path),
    goal: requireString(record, "goal", path),
    dependsOn: requireStringArray(record, "dependsOn", path),
    expectedSideEffects: requireStringArray(record, "expectedSideEffects", path),
    successCriteria: requireStringArray(record, "successCriteria", path, 1),
    retryStrategy: requireString(record, "retryStrategy", path),
    rollbackNotes: requireString(record, "rollbackNotes", path)
  };
}

function validateStepDependencies(steps: ParsedTaskDraftStep[]): void {
  const indexById = new Map<string, number>();

  for (const [index, step] of steps.entries()) {
    if (indexById.has(step.id)) {
      throw new Error(`draft.steps contains duplicate id ${step.id}.`);
    }
    indexById.set(step.id, index);
  }

  for (const [index, step] of steps.entries()) {
    const seenDependencies = new Set<string>();

    for (const dependency of step.dependsOn) {
      if (seenDependencies.has(dependency)) {
        throw new Error(`draft.steps[${index}].dependsOn contains duplicate id ${dependency}.`);
      }
      seenDependencies.add(dependency);
      const dependencyIndex = indexById.get(dependency);

      if (dependencyIndex === undefined) {
        throw new Error(`draft.steps[${index}].dependsOn references unknown id ${dependency}.`);
      }
      if (dependencyIndex >= index) {
        throw new Error(`draft.steps[${index}].dependsOn must reference an earlier step: ${dependency}.`);
      }
    }
  }
}

function buildFallbackTaskDraftPreview(
  input: {
    draftId: string;
    description: string;
    assistantText: string;
    createdAt: string;
    maxIterations: number;
  },
  parseError: string
): TaskDraftPreview {
  const objective = normalizeDescription(input.description);
  const failureReason = compactError(parseError);
  const steps: TaskDraftStep[] = [
    {
      id: `${input.draftId}_fallback_step_1`,
      sequence: 1,
      type: "human_input",
      title: "Confirm task boundary",
      goal: "Confirm the project, expected result, deadline, and what the assistant may inspect.",
      dependsOn: [],
      expectedSideEffects: [],
      successCriteria: ["User confirms scope and completion criteria."],
      retryStrategy: "Ask one focused clarification round if scope is still ambiguous.",
      rollbackNotes: "No external state changes are made during clarification."
    },
    {
      id: `${input.draftId}_fallback_step_2`,
      sequence: 2,
      type: "agent",
      title: "Refine analysis",
      goal: "Convert the confirmed objective into constraints, assumptions, risks, and deliverables.",
      dependsOn: [`${input.draftId}_fallback_step_1`],
      expectedSideEffects: [],
      successCriteria: ["Task analysis is editable and reviewable by the user."],
      retryStrategy: "Regenerate the analysis from the latest confirmed description.",
      rollbackNotes: "Discard the fallback draft and keep the previous reviewed draft."
    },
    {
      id: `${input.draftId}_fallback_step_3`,
      sequence: 3,
      type: "agent",
      title: "Draft execution plan",
      goal: "Create ordered steps with dependencies and verification checks.",
      dependsOn: [`${input.draftId}_fallback_step_2`],
      expectedSideEffects: [],
      successCriteria: ["Every step has a clear goal, dependency, and success criterion."],
      retryStrategy: "Split any vague step into smaller reviewable steps.",
      rollbackNotes: "Keep the prior plan version until the fallback is reviewed."
    }
  ];
  const fallback: TaskDraftPreview = {
    draftId: input.draftId,
    status: "draft",
    title: makeDraftTitle(objective),
    objective,
    source: {
      kind: "manual_description",
      description: objective
    },
    suggestedAutomationLevel: "L0",
    assumptions: [
      "The model response did not satisfy the task-draft JSON contract, so this deterministic fallback must be reviewed.",
      "Core already owns persisted Project and Task state; this draft remains non-persisted until the user approves it."
    ],
    constraints: [
      "Planning mode has no tools and cannot change Task, Plan, or Run state.",
      "Renderer has no Node, filesystem, SQLite, key, or pi SDK access.",
      `Explicit fallback reason: ${failureReason}`
    ],
    missingInformation: [
      "Target project or workspace",
      "Definition of done",
      "Deadline or priority",
      "Allowed context and data sources"
    ],
    expectedArtifacts: ["Editable task analysis", "Draft plan steps"],
    loopIterations: buildLoopIterations(input.maxIterations, false, failureReason),
    steps,
    generatedSummary: preserveModelOutput(input.assistantText),
    createdAt: input.createdAt
  };

  return TaskDraftPreviewSchema.parse(fallback);
}

function buildLoopIterations(
  maxIterations: number,
  parsedModelJson: boolean,
  parseError?: string
): TaskDraftLoopIteration[] {
  return [
    {
      index: 1,
      phase: "intake",
      status: "done",
      summary: "Captured the user description as manual task input."
    },
    {
      index: 2,
      phase: "analysis",
      status: "done",
      summary: parsedModelJson
        ? "Validated the model JSON and preserved its objective, assumptions, constraints, and missing information."
        : `Model JSON parsing or validation failed; an explicit fallback was used: ${parseError ?? "unknown error"}`
    },
    {
      index: 3,
      phase: "plan_design",
      status: "done",
      summary: parsedModelJson
        ? `Mapped the validated model plan into reviewable steps within the configured ${maxIterations} loop pass limit.`
        : `Generated deterministic non-executing steps within the configured ${maxIterations} loop pass limit.`
    }
  ];
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string
): void {
  const unexpected = Object.keys(record).filter((key) => !allowedKeys.has(key));

  if (unexpected.length > 0) {
    throw new Error(`${path} contains unexpected properties: ${unexpected.join(", ")}.`);
  }
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path}.${key} must be a non-empty string.`);
  }

  return value.trim();
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  minimumItems = 0
): string[] {
  const value = record[key];

  if (!Array.isArray(value) || value.length < minimumItems) {
    throw new Error(`${path}.${key} must be an array with at least ${minimumItems} item(s).`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${path}.${key}[${index}] must be a non-empty string.`);
    }
    return item.trim();
  });
}

function requireAutomationLevel(value: unknown): AutomationLevel {
  if (typeof value !== "string" || !AUTOMATION_LEVELS.has(value as AutomationLevel)) {
    throw new Error("draft.suggestedAutomationLevel must be one of L0, L1, L2, L3, L4.");
  }

  return value as AutomationLevel;
}

function requireDraftStepType(value: unknown, path: string): DraftStepType {
  if (typeof value !== "string" || !DRAFT_STEP_TYPES.has(value as DraftStepType)) {
    throw new Error(`${path} has an unsupported draft step type.`);
  }

  return value as DraftStepType;
}

function requireMappedStepId(stepIdMap: ReadonlyMap<string, string>, modelStepId: string): string {
  const stepId = stepIdMap.get(modelStepId);

  if (!stepId) {
    throw new Error(`Validated model step id was not mapped: ${modelStepId}.`);
  }

  return stepId;
}

function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/gu, " ") || "Clarify the personal task objective.";
}

function preserveModelOutput(assistantText: string): string {
  return assistantText.trim() ? assistantText : "[Model output was empty.]";
}

function compactError(error: string): string {
  const compact = error.trim().replace(/\s+/gu, " ");
  return compact.length > 800 ? `${compact.slice(0, 797)}...` : compact || "Unknown parsing error.";
}

function makeDraftTitle(objective: string): string {
  const compact = objective.replace(/[.!?。！？]+$/u, "").trim();
  const title = compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;

  return title || "Untitled task draft";
}
