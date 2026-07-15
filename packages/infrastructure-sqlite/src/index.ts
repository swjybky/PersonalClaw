import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  CodeAgentListPayloadSchema,
  CodeAgentProfileSchema,
  DEFAULT_OWNER_ID,
  PlanStepSummarySchema,
  ProjectListPayloadSchema,
  ProjectSummarySchema,
  TaskAnalysisSummarySchema,
  TaskListPayloadSchema,
  TaskPlanSummarySchema,
  TaskSourceSchema,
  TaskStatusViewSchema,
  TaskSummarySchema,
  type CodeAgentDeleteCommandPayload,
  type CodeAgentListCommandPayload,
  type CodeAgentListPayload,
  type CodeAgentProfile,
  type CodeAgentProfileInput,
  type ProjectArchiveCommandPayload,
  type ProjectCreateCommandPayload,
  type ProjectListCommandPayload,
  type ProjectListPayload,
  type ProjectSummary,
  type ProjectUpdateCommandPayload,
  type PlanStepInput,
  type TaskAssignCodeAgentCommandPayload,
  type TaskApprovePlanCommandPayload,
  type TaskAnalysisInput,
  type TaskAnalysisSummary,
  type TaskCreateCommandPayload,
  type TaskDeleteCommandPayload,
  type TaskEventSummary,
  type TaskGetCommandPayload,
  type TaskListCommandPayload,
  type TaskListPayload,
  type TaskPlanSummary,
  type TaskPlanApprovalState,
  type TaskRequestPlanApprovalCommandPayload,
  type TaskSaveAnalysisCommandPayload,
  type TaskSavePlanCommandPayload,
  type TaskSetStatusCommandPayload,
  type TaskStatusDto,
  type TaskStatusView,
  type TaskSummary,
  type TaskUpdateCommandPayload,
  type TaskUpdateProgressCommandPayload
} from "@personal-claw/contracts";
import {
  assertTaskCreation,
  assertPlanStepDag,
  assertTaskProgress,
  assertTaskStatusChange,
  calculateStepProgressPercent,
  canArchiveTaskStatus,
  getAvailableTaskStatusTransitions,
  type PlanStepProgressStatus
} from "@personal-claw/domain";
import { createId, nowIso } from "@personal-claw/shared";

export interface SqliteRuntimeBoundary {
  owner: "core";
  walRequired: true;
  migrationsRequired: true;
}

export const sqliteRuntimeBoundary: SqliteRuntimeBoundary = {
  owner: "core",
  walRequired: true,
  migrationsRequired: true
};

export interface TaskMutationResult {
  task: TaskSummary;
  additionalEvents?: TaskPlanningEvent[];
  eventType:
    | "task.created"
    | "task.updated"
    | "task.status_changed"
    | "task.progress_changed"
    | "task.archived";
  eventPayload:
    | { task: TaskSummary }
    | {
        taskId: string;
        projectId: string;
        fromStatus: TaskStatusDto;
        toStatus: TaskStatusDto;
        task: TaskSummary;
      }
    | {
        taskId: string;
        projectId: string;
        progressPercent: number;
        task: TaskSummary;
      }
    | { taskId: string; projectId: string; task: TaskSummary };
}

export interface ProjectMutationResult {
  project: ProjectSummary;
  list: ProjectListPayload;
}

export interface CodeAgentMutationResult {
  profile: CodeAgentProfile;
  list: CodeAgentListPayload;
}

export type TaskPlanningEvent =
  | {
      eventType: "task.analysis_saved";
      eventPayload: { analysis: TaskAnalysisSummary };
    }
  | {
      eventType: "plan.version_created";
      eventPayload: { plan: TaskPlanSummary };
    }
  | {
      eventType: "plan.approval_requested";
      eventPayload: { plan: TaskPlanSummary };
    }
  | {
      eventType: "plan.approved";
      eventPayload: { plan: TaskPlanSummary };
    }
  | {
      eventType: "plan.rejected";
      eventPayload: {
        plan: TaskPlanSummary;
        reason: "analysis_revised" | "plan_revised";
      };
    }
  | {
      eventType: "task.status_changed";
      eventPayload: {
        taskId: string;
        projectId: string;
        fromStatus: TaskStatusDto;
        toStatus: TaskStatusDto;
        task: TaskSummary;
      };
    };

export interface TaskPlanningMutationResult {
  view: TaskStatusView;
  events: TaskPlanningEvent[];
}

interface StoreOptions {
  now?: () => string;
  createId?: (prefix: string) => string;
  driver?: SqliteDriverName;
}

type SqliteDriverName = "better-sqlite3" | "node:sqlite";

interface SqliteStatement {
  all(parameters?: Record<string, unknown>): unknown[];
  get(parameters?: Record<string, unknown>): unknown;
  run(parameters?: Record<string, unknown>): unknown;
}

interface SqliteConnection {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  transaction<T>(fn: () => T): () => T;
}

interface NodeSqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (location: string) => NodeSqliteDatabase;
}

type BetterSqliteConstructor = new (location: string) => SqliteConnection;

const nodeRequire = createRequire(import.meta.url);

function firstColumn(row: unknown): unknown {
  if (typeof row !== "object" || row === null) {
    return row;
  }

  const values = Object.values(row);
  return values[0];
}

class NodeSqliteConnection implements SqliteConnection {
  constructor(private readonly db: NodeSqliteDatabase) {}

  prepare(sql: string): SqliteStatement {
    return this.db.prepare(sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  pragma(sql: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.db.prepare(`PRAGMA ${sql}`).all();

    if (options.simple) {
      return firstColumn(rows[0]);
    }

    return rows;
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.db.exec("BEGIN IMMEDIATE");

      try {
        const result = fn();
        this.db.exec("COMMIT");
        return result;
      } catch (error: unknown) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // Preserve the original domain or SQLite error.
        }

        throw error;
      }
    };
  }
}

function resolveSqliteDriver(requested?: SqliteDriverName): SqliteDriverName {
  const envDriver = process.env.PERSONAL_CLAW_SQLITE_DRIVER;

  if (requested) {
    return requested;
  }

  if (envDriver === "better-sqlite3" || envDriver === "node:sqlite") {
    return envDriver;
  }

  // Electron 42 currently loads the better-sqlite3 Electron prebuild but is killed
  // when the native addon initializes on the local macOS SDK. Keep Core ownership
  // intact and use Node's built-in SQLite driver inside Electron until the ABI path
  // is proven stable by a compatibility test.
  if (process.versions.electron) {
    return "node:sqlite";
  }

  return "better-sqlite3";
}

function createSqliteConnection(databasePath: string, driver: SqliteDriverName): SqliteConnection {
  if (driver === "node:sqlite") {
    const sqlite = nodeRequire("node:sqlite") as NodeSqliteModule;
    return new NodeSqliteConnection(new sqlite.DatabaseSync(databasePath));
  }

  const Database = nodeRequire("better-sqlite3") as BetterSqliteConstructor;
  return new Database(databasePath);
}

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  root_path: string | null;
  description: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface CodeAgentRow {
  id: string;
  owner_id: string;
  kind: "codex" | "claude_code" | "cursor" | "kimi" | "custom";
  label: string;
  description: string | null;
  command: string | null;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface TaskRow {
  id: string;
  project_id: string;
  owner_id: string;
  title: string;
  goal: string;
  source_json: string;
  status: TaskStatusDto;
  priority: "low" | "normal" | "high" | "urgent";
  progress_percent: number;
  due_at: string | null;
  code_agent_id: string | null;
  blocked_reason: string | null;
  next_step: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  version: number;
}

interface TaskEventRow {
  id: string;
  task_id: string;
  project_id: string;
  sequence: number;
  event_type: string;
  payload_json: string;
  created_at: string;
}

interface PlanStepRow {
  id: string;
  task_id: string;
  sequence: number;
  type: "agent" | "tool" | "human_input" | "verification" | "notification";
  title: string;
  goal: string;
  status: PlanStepProgressStatus;
  input_json: string;
  depends_on_json: string;
  success_criteria_json: string;
  created_at: string;
  updated_at: string;
}

interface TaskAnalysisRow {
  id: string;
  task_id: string;
  version: number;
  objective: string;
  known_information_json: string;
  missing_information_json: string;
  constraints_json: string;
  risks_json: string;
  expected_artifacts_json: string;
  completion_definition_json: string;
  suggested_automation_level: "L0" | "L1" | "L2" | "L3" | "L4";
  created_at: string;
  updated_at: string;
}

interface TaskPlanRow {
  id: string;
  task_id: string;
  version: number;
  summary: string;
  based_on_analysis_version: number | null;
  approval_state: "not_requested" | "pending" | "approved" | "rejected";
  approval_request_id: string | null;
  approval_task_version: number | null;
  approval_analysis_version: number | null;
  approval_code_agent_id: string | null;
  approval_code_agent_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskPlanStepRow {
  id: string;
  plan_id: string;
  task_id: string;
  step_key: string;
  sequence: number;
  type: "agent" | "tool" | "human_input" | "approval" | "verification" | "notification";
  title: string;
  goal: string;
  status: PlanStepProgressStatus;
  depends_on_json: string;
  success_criteria_json: string;
  updated_at: string;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function nullable(value: string | null | undefined): string | null {
  return value === undefined ? null : value;
}

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return ProjectSummarySchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    rootPath: row.root_path,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  });
}

function toCodeAgentProfile(row: CodeAgentRow): CodeAgentProfile {
  return CodeAgentProfileSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    label: row.label,
    description: row.description,
    command: row.command,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  });
}

function toTaskSummary(row: TaskRow): TaskSummary {
  return TaskSummarySchema.parse({
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    progressPercent: row.progress_percent,
    source: TaskSourceSchema.parse(parseJson(row.source_json)),
    priority: row.priority,
    dueAt: row.due_at,
    codeAgentId: row.code_agent_id,
    blockedReason: row.blocked_reason,
    nextStep: row.next_step,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    version: row.version
  });
}

function toTaskEventSummary(row: TaskEventRow): TaskEventSummary {
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    sequence: row.sequence,
    eventType: row.event_type,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at
  };
}

function toPlanStepSummary(row: PlanStepRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    sequence: row.sequence,
    type: row.type,
    title: row.title,
    goal: row.goal,
    status: row.status,
    dependsOn: parseStringArray(row.depends_on_json),
    successCriteria: parseStringArray(row.success_criteria_json),
    updatedAt: row.updated_at
  };
}

function toTaskAnalysisSummary(row: TaskAnalysisRow): TaskAnalysisSummary {
  return TaskAnalysisSummarySchema.parse({
    id: row.id,
    taskId: row.task_id,
    version: row.version,
    objective: row.objective,
    knownInformation: parseStringArray(row.known_information_json),
    missingInformation: parseStringArray(row.missing_information_json),
    constraints: parseStringArray(row.constraints_json),
    risks: parseStringArray(row.risks_json),
    expectedArtifacts: parseStringArray(row.expected_artifacts_json),
    completionDefinition: parseStringArray(row.completion_definition_json),
    suggestedAutomationLevel: row.suggested_automation_level,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function toTaskPlanStepSummary(row: TaskPlanStepRow) {
  return PlanStepSummarySchema.parse({
    id: row.id,
    key: row.step_key,
    taskId: row.task_id,
    sequence: row.sequence,
    type: row.type,
    title: row.title,
    goal: row.goal,
    status: row.status,
    dependsOn: parseStringArray(row.depends_on_json),
    successCriteria: parseStringArray(row.success_criteria_json),
    updatedAt: row.updated_at
  });
}

function toTaskPlanSummary(row: TaskPlanRow, steps: readonly TaskPlanStepRow[]): TaskPlanSummary {
  return TaskPlanSummarySchema.parse({
    id: row.id,
    taskId: row.task_id,
    version: row.version,
    summary: row.summary,
    basedOnAnalysisVersion: row.based_on_analysis_version,
    approvalState: row.approval_state,
    approvalSnapshot:
      row.approval_request_id &&
      row.approval_task_version !== null &&
      row.approval_analysis_version !== null
        ? {
            requestId: row.approval_request_id,
            taskVersion: row.approval_task_version,
            analysisVersion: row.approval_analysis_version,
            codeAgentId: row.approval_code_agent_id,
            codeAgentUpdatedAt: row.approval_code_agent_updated_at
          }
        : null,
    steps: steps.map(toTaskPlanStepSummary),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function parseStringArray(value: string): string[] {
  const raw = parseJson(value);

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is string => typeof item === "string");
}

interface NormalizedPlanStep extends PlanStepInput {
  key: string;
}

function normalizePlanSteps(steps: readonly PlanStepInput[]): NormalizedPlanStep[] {
  const normalized = steps.map((step, index) => ({
    ...step,
    key: step.key?.trim() || `step_${index + 1}`,
    // Phase 2 plans describe future work. Runtime status is owned by the
    // Phase 4 Run Coordinator and cannot be supplied by a draft or Renderer.
    status: "pending" as const,
    dependsOn: (step.dependsOn ?? []).map((dependency) => dependency.trim())
  }));

  assertPlanStepDag(normalized);
  return normalized;
}

const workflowOwnedStatusTargets = new Set<TaskStatusDto>([
  "awaiting_approval",
  "queued",
  "running",
  "paused",
  "verifying",
  "succeeded"
]);

function getAvailableTaskCommandTransitions(status: TaskStatusDto): TaskStatusDto[] {
  if (status === "awaiting_approval") {
    // These are reached through saveAnalysis, savePlan, and approvePlan,
    // never through the generic task.setStatus command.
    return ["analyzing", "design_ready", "queued"];
  }

  return getAvailableTaskStatusTransitions(status).filter(
    (target) =>
      (status === "design_ready" && target === "awaiting_approval") ||
      !workflowOwnedStatusTargets.has(target)
  );
}

function isSqliteError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

export class PersonalClawSqliteStore {
  private readonly db: SqliteConnection;
  private readonly now: () => string;
  private readonly makeId: (prefix: string) => string;

  constructor(databasePath: string, options: StoreOptions = {}) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = createSqliteConnection(databasePath, resolveSqliteDriver(options.driver));
    this.now = options.now ?? nowIso;
    this.makeId = options.createId ?? createId;
    this.configure();
    this.migrate();
    this.seed();
  }

  close(): void {
    this.db.close();
  }

  getJournalMode(): string {
    const row = this.db.pragma("journal_mode", { simple: true });
    return typeof row === "string" ? row : String(row);
  }

  listProjects(payload: ProjectListCommandPayload = {}): ProjectListPayload {
    const rows = this.db
      .prepare(
        payload.includeArchived
          ? "SELECT * FROM projects ORDER BY updated_at DESC"
          : "SELECT * FROM projects WHERE archived_at IS NULL AND status = 'active' ORDER BY updated_at DESC"
      )
      .all() as ProjectRow[];
    const projects = rows.map(toProjectSummary);

    return ProjectListPayloadSchema.parse({
      projects,
      activeProjectId: projects[0]?.id ?? null
    });
  }

  createProject(payload: ProjectCreateCommandPayload): ProjectMutationResult {
    const createdAt = this.now();
    const id = this.makeId("project");

    this.db
      .prepare(
        `INSERT INTO projects (
          id, owner_id, name, root_path, description, status, created_at, updated_at, archived_at
        ) VALUES (
          @id, @ownerId, @name, @rootPath, @description, 'active', @createdAt, @createdAt, NULL
        )`
      )
      .run({
        id,
        ownerId: DEFAULT_OWNER_ID,
        name: payload.name.trim(),
        rootPath: nullable(payload.rootPath?.trim()),
        description: nullable(payload.description?.trim()),
        createdAt
      });

    const project = this.requireProject(id);
    return {
      project,
      list: this.listProjects()
    };
  }

  updateProject(payload: ProjectUpdateCommandPayload): ProjectMutationResult {
    this.requireProject(payload.id);
    const updatedAt = this.now();
    const current = this.requireProjectRow(payload.id);
    const name = payload.name === undefined ? current.name : payload.name.trim();
    const rootPath = payload.rootPath === undefined ? current.root_path : nullable(payload.rootPath?.trim());
    const description =
      payload.description === undefined ? current.description : nullable(payload.description?.trim());

    this.db
      .prepare(
        `UPDATE projects
        SET name = @name,
            root_path = @rootPath,
            description = @description,
            updated_at = @updatedAt
        WHERE id = @id`
      )
      .run({
        id: payload.id,
        name,
        rootPath,
        description,
        updatedAt
      });

    return {
      project: this.requireProject(payload.id),
      list: this.listProjects()
    };
  }

  archiveProject(payload: ProjectArchiveCommandPayload): ProjectMutationResult {
    const project = this.requireProject(payload.id);
    const archivedAt = this.now();

    this.db
      .prepare(
        "UPDATE projects SET status = 'archived', archived_at = @archivedAt, updated_at = @archivedAt WHERE id = @id"
      )
      .run({ id: payload.id, archivedAt });

    return {
      project: ProjectSummarySchema.parse({
        ...project,
        status: "archived",
        archivedAt,
        updatedAt: archivedAt
      }),
      list: this.listProjects()
    };
  }

  listCodeAgents(payload: CodeAgentListCommandPayload = {}): CodeAgentListPayload {
    const rows = this.db
      .prepare(
        payload.includeArchived
          ? "SELECT * FROM code_agent_profiles ORDER BY updated_at DESC"
          : "SELECT * FROM code_agent_profiles WHERE archived_at IS NULL ORDER BY updated_at DESC"
      )
      .all() as CodeAgentRow[];

    return CodeAgentListPayloadSchema.parse({
      profiles: rows.map(toCodeAgentProfile)
    });
  }

  upsertCodeAgent(profile: CodeAgentProfileInput): CodeAgentMutationResult {
    const now = this.now();
    const id = profile.id?.trim() || this.makeId("code_agent");
    const existing = this.getCodeAgentRow(id);

    if (existing) {
      this.assertCodeAgentProfileMutable(id);
      this.db
        .prepare(
          `UPDATE code_agent_profiles
          SET kind = @kind,
              label = @label,
              description = @description,
              command = @command,
              enabled = @enabled,
              updated_at = @updatedAt,
              archived_at = NULL
          WHERE id = @id`
        )
        .run({
          id,
          kind: profile.kind,
          label: profile.label.trim(),
          description: nullable(profile.description?.trim()),
          command: nullable(profile.command?.trim()),
          enabled: profile.enabled === false ? 0 : 1,
          updatedAt: now
        });
    } else {
      this.db
        .prepare(
          `INSERT INTO code_agent_profiles (
            id, owner_id, kind, label, description, command, enabled, created_at, updated_at, archived_at
          ) VALUES (
            @id, @ownerId, @kind, @label, @description, @command, @enabled, @createdAt, @createdAt, NULL
          )`
        )
        .run({
          id,
          ownerId: DEFAULT_OWNER_ID,
          kind: profile.kind,
          label: profile.label.trim(),
          description: nullable(profile.description?.trim()),
          command: nullable(profile.command?.trim()),
          enabled: profile.enabled === false ? 0 : 1,
          createdAt: now
        });
    }

    return {
      profile: this.requireCodeAgent(id),
      list: this.listCodeAgents()
    };
  }

  deleteCodeAgent(payload: CodeAgentDeleteCommandPayload): CodeAgentMutationResult {
    const profile = this.requireCodeAgent(payload.id);
    const assignedTask = this.db
      .prepare(
        `SELECT id FROM tasks
        WHERE code_agent_id = @id AND archived_at IS NULL
        LIMIT 1`
      )
      .get({ id: payload.id }) as { id: string } | undefined;
    if (assignedTask) {
      throw new Error(
        `codeAgent profile ${payload.id} is assigned to task ${assignedTask.id}; unassign it before deleting the profile.`
      );
    }
    const archivedAt = this.now();

    this.db
      .prepare(
        "UPDATE code_agent_profiles SET archived_at = @archivedAt, enabled = 0, updated_at = @archivedAt WHERE id = @id"
      )
      .run({ id: payload.id, archivedAt });

    return {
      profile,
      list: this.listCodeAgents()
    };
  }

  listTasks(payload: TaskListCommandPayload): TaskListPayload {
    this.requireProject(payload.projectId);
    const includeArchived = payload.includeArchived === true;
    const rows = this.db
      .prepare(
        includeArchived
          ? "SELECT * FROM tasks WHERE project_id = @projectId ORDER BY updated_at DESC"
          : "SELECT * FROM tasks WHERE project_id = @projectId AND archived_at IS NULL ORDER BY updated_at DESC"
      )
      .all({ projectId: payload.projectId }) as TaskRow[];
    const statuses = new Set(payload.statuses ?? []);
    const tasks = rows
      .map(toTaskSummary)
      .filter((task) => statuses.size === 0 || statuses.has(task.status));

    return TaskListPayloadSchema.parse({ tasks });
  }

  getTask(payload: TaskGetCommandPayload): TaskStatusView {
    const task = this.requireTask(payload.id);
    const events = this.db
      .prepare("SELECT * FROM task_events WHERE task_id = @taskId ORDER BY sequence DESC LIMIT 12")
      .all({ taskId: payload.id }) as TaskEventRow[];
    const analysisVersions = this.listTaskAnalyses(payload.id);
    const planVersions = this.listTaskPlans(task);
    const plan = planVersions[0] ?? null;

    return TaskStatusViewSchema.parse({
      task,
      steps: plan?.steps ?? [],
      recentEvents: events.map(toTaskEventSummary),
      blockedReason: task.blockedReason,
      nextStep: task.nextStep,
      analysis: analysisVersions[0] ?? null,
      analysisVersions,
      plan,
      planVersions,
      availableTransitions: getAvailableTaskCommandTransitions(task.status)
    });
  }

  createTask(payload: TaskCreateCommandPayload): TaskMutationResult {
    const result = this.db.transaction(() => {
      const project = this.requireProject(payload.projectId);
      const source = TaskSourceSchema.parse(payload.source);
      const steps = normalizePlanSteps(payload.steps ?? []);
      if (payload.planSummary && steps.length === 0) {
        throw new Error("Task planSummary requires at least one plan step.");
      }
      const now = this.now();
      const id = this.makeId("task");
      const progressPercent = calculateStepProgressPercent(
        steps.map((step) => ({ status: step.status ?? "pending" }))
      );

      assertTaskCreation({
        projectId: project.id,
        ownerId: DEFAULT_OWNER_ID,
        title: payload.title,
        goal: payload.goal
      });
      assertTaskProgress(progressPercent);

      if (payload.codeAgentId) {
        this.requireCodeAgent(payload.codeAgentId);
      }

      this.db
        .prepare(
          `INSERT INTO tasks (
            id, project_id, owner_id, title, goal, source_json, status, priority,
            progress_percent, due_at, code_agent_id, blocked_reason, next_step,
            created_at, updated_at, archived_at, version
          ) VALUES (
            @id, @projectId, @ownerId, @title, @goal, @sourceJson, 'draft', @priority,
            @progressPercent, @dueAt, @codeAgentId, NULL, @nextStep,
            @createdAt, @createdAt, NULL, 1
          )`
        )
        .run({
          id,
          projectId: payload.projectId,
          ownerId: DEFAULT_OWNER_ID,
          title: payload.title.trim(),
          goal: payload.goal.trim(),
          sourceJson: stringifyJson(source),
          priority: payload.priority ?? "normal",
          progressPercent,
          dueAt: payload.dueAt ?? null,
          codeAgentId: payload.codeAgentId ?? null,
          nextStep: steps.length > 0 ? "Review the first plan step." : "Define the first executable step.",
          createdAt: now
        });

      const analysis = payload.analysis
        ? this.insertAnalysisVersion(id, 1, payload.analysis, now)
        : null;
      const plan = steps.length > 0
        ? this.insertPlanVersion(
            id,
            1,
            payload.planSummary?.trim() || payload.goal.trim(),
            steps,
            now,
            "not_requested"
          )
        : null;

      const task = this.requireTask(id);
      this.appendTaskEvent(task, "task.created", { task }, now);
      if (analysis) {
        this.appendTaskEvent(task, "task.analysis_saved", { analysis }, now);
      }
      if (plan) {
        this.appendTaskEvent(task, "plan.version_created", { plan }, now);
      }
      const additionalEvents: TaskPlanningEvent[] = [];
      if (analysis) {
        additionalEvents.push({
          eventType: "task.analysis_saved",
          eventPayload: { analysis }
        });
      }
      if (plan) {
        additionalEvents.push({
          eventType: "plan.version_created",
          eventPayload: { plan }
        });
      }
      return { task, additionalEvents };
    })();

    return {
      task: result.task,
      eventType: "task.created",
      eventPayload: { task: result.task },
      additionalEvents: result.additionalEvents
    };
  }

  updateTask(payload: TaskUpdateCommandPayload): TaskMutationResult {
    return this.db.transaction<TaskMutationResult>(() => {
    const task = this.requireTask(payload.id);
    if (["awaiting_approval", "queued", "running", "verifying"].includes(task.status)) {
      throw new Error(`Task metadata is frozen while task is ${task.status}.`);
    }
    if (payload.codeAgentId) {
      this.requireCodeAgent(payload.codeAgentId);
    }

    const updatedAt = this.now();
    const next = {
      title: payload.title === undefined ? task.title : payload.title.trim(),
      goal: payload.goal === undefined ? task.goal : payload.goal.trim(),
      priority: payload.priority ?? task.priority,
      dueAt: payload.dueAt === undefined ? task.dueAt : payload.dueAt,
      blockedReason:
        payload.blockedReason === undefined ? task.blockedReason : nullable(payload.blockedReason?.trim()),
      nextStep: payload.nextStep === undefined ? task.nextStep : nullable(payload.nextStep?.trim()),
      codeAgentId: payload.codeAgentId === undefined ? task.codeAgentId : payload.codeAgentId
    };

    this.db
      .prepare(
        `UPDATE tasks
        SET title = @title,
            goal = @goal,
            priority = @priority,
            due_at = @dueAt,
            blocked_reason = @blockedReason,
            next_step = @nextStep,
            code_agent_id = @codeAgentId,
            updated_at = @updatedAt,
            version = version + 1
        WHERE id = @id`
      )
      .run({
        id: payload.id,
        title: next.title,
        goal: next.goal,
        priority: next.priority,
        dueAt: next.dueAt,
        blockedReason: next.blockedReason,
        nextStep: next.nextStep,
        codeAgentId: next.codeAgentId,
        updatedAt
      });

    const updated = this.requireTask(payload.id);
    this.appendTaskEvent(updated, "task.updated", { task: updated }, updatedAt);

    return {
      task: updated,
      eventType: "task.updated",
      eventPayload: { task: updated }
    };
    })();
  }

  deleteTask(payload: TaskDeleteCommandPayload): TaskMutationResult {
    return this.db.transaction<TaskMutationResult>(() => {
    const task = this.requireTask(payload.id);
    if (task.status === "awaiting_approval") {
      throw new Error("Revise the pending plan before archiving a task that is awaiting approval.");
    }
    if (!canArchiveTaskStatus(task.status)) {
      throw new Error(
        `Task cannot be archived while it is ${task.status}; cancel or finish the active workflow first.`
      );
    }
    const archivedAt = this.now();

    this.db
      .prepare(
        `UPDATE tasks
        SET status = @status,
            archived_at = @archivedAt,
            updated_at = @archivedAt,
            version = version + 1
        WHERE id = @id`
      )
      .run({
        id: payload.id,
        status: "archived",
        archivedAt
      });

    const archived = this.requireTask(payload.id);
    this.appendTaskEvent(archived, "task.archived", { taskId: archived.id, projectId: archived.projectId, task: archived }, archivedAt);

    return {
      task: archived,
      eventType: "task.archived",
      eventPayload: {
        taskId: archived.id,
        projectId: archived.projectId,
        task: archived
      }
    };
    })();
  }

  setTaskStatus(payload: TaskSetStatusCommandPayload): TaskMutationResult {
    return this.db.transaction<TaskMutationResult>(() => {
    const task = this.requireTask(payload.id);
    if (task.status === "awaiting_approval") {
      throw new Error("An awaiting approval task can only change through plan approval or plan revision.");
    }
    if (workflowOwnedStatusTargets.has(payload.status)) {
      throw new Error(
        `Task status ${payload.status} is controlled by plan approval or the Run Coordinator and cannot be set directly.`
      );
    }
    assertTaskStatusChange(task.status, payload.status);
    const updatedAt = this.now();

    this.db
      .prepare(
        `UPDATE tasks
        SET status = @status,
            blocked_reason = @blockedReason,
            updated_at = @updatedAt,
            version = version + 1
        WHERE id = @id`
      )
      .run({
        id: payload.id,
        status: payload.status,
        blockedReason: payload.status === "blocked" ? payload.reason ?? task.blockedReason : null,
        updatedAt
      });

    const updated = this.requireTask(payload.id);
    const eventPayload = {
      taskId: updated.id,
      projectId: updated.projectId,
      fromStatus: task.status,
      toStatus: updated.status,
      task: updated
    };
    this.appendTaskEvent(updated, "task.status_changed", eventPayload, updatedAt);

    return {
      task: updated,
      eventType: "task.status_changed",
      eventPayload
    };
    })();
  }

  updateTaskProgress(payload: TaskUpdateProgressCommandPayload): TaskMutationResult {
    return this.db.transaction<TaskMutationResult>(() => {
    assertTaskProgress(payload.progressPercent);
    const task = this.requireTask(payload.id);
    if (!["running", "paused", "blocked"].includes(task.status)) {
      throw new Error(
        `Task progress can only be reported by an active Run Coordinator; got ${task.status}.`
      );
    }
    const updatedAt = this.now();

    this.db
      .prepare(
        `UPDATE tasks
        SET progress_percent = @progressPercent,
            next_step = @nextStep,
            blocked_reason = @blockedReason,
            updated_at = @updatedAt,
            version = version + 1
        WHERE id = @id`
      )
      .run({
        id: payload.id,
        progressPercent: payload.progressPercent,
        nextStep: payload.nextStep === undefined ? task.nextStep : nullable(payload.nextStep?.trim()),
        blockedReason:
          payload.blockedReason === undefined ? task.blockedReason : nullable(payload.blockedReason?.trim()),
        updatedAt
      });

    const updated = this.requireTask(payload.id);
    const eventPayload = {
      taskId: updated.id,
      projectId: updated.projectId,
      progressPercent: updated.progressPercent,
      task: updated
    };
    this.appendTaskEvent(updated, "task.progress_changed", eventPayload, updatedAt);

    return {
      task: updated,
      eventType: "task.progress_changed",
      eventPayload
    };
    })();
  }

  assignCodeAgent(payload: TaskAssignCodeAgentCommandPayload): TaskMutationResult {
    if (payload.codeAgentId) {
      this.requireCodeAgent(payload.codeAgentId);
    }

    return this.updateTask({
      id: payload.id,
      codeAgentId: payload.codeAgentId
    });
  }

  saveTaskAnalysis(payload: TaskSaveAnalysisCommandPayload): TaskPlanningMutationResult {
    const result = this.db.transaction(() => {
      const task = this.requireTask(payload.taskId);
      this.assertExpectedTaskVersion(task, payload.expectedTaskVersion);
      if (["queued", "running", "verifying", "succeeded", "archived"].includes(task.status)) {
        throw new Error(`Task analysis cannot be edited while task is ${task.status}.`);
      }
      const previousPlan = this.listTaskPlans(task)[0] ?? null;
      const current = this.db
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM task_analysis_versions WHERE task_id = @taskId"
        )
        .get({ taskId: task.id }) as { version: number };
      const updatedAt = this.now();
      const analysis = this.insertAnalysisVersion(task.id, current.version + 1, payload.analysis, updatedAt);
      const events: TaskPlanningEvent[] = [
        {
          eventType: "task.analysis_saved",
          eventPayload: { analysis }
        }
      ];
      let rejectedPlan: TaskPlanSummary | null = null;

      if (
        task.status === "awaiting_approval" &&
        previousPlan?.approvalState === "pending" &&
        !previousPlan.id.startsWith("legacy_")
      ) {
        this.db
          .prepare(
            `UPDATE task_plan_versions
            SET approval_state = 'rejected', updated_at = @updatedAt
            WHERE id = @planId AND task_id = @taskId`
          )
          .run({ planId: previousPlan.id, taskId: task.id, updatedAt });
        rejectedPlan = this.requirePersistedPlan(previousPlan.id);
        events.push({
          eventType: "plan.rejected",
          eventPayload: { plan: rejectedPlan, reason: "analysis_revised" }
        });
      }

      if (task.status === "design_ready" || task.status === "awaiting_approval") {
        this.updateTaskStatusRow(task.id, "analyzing", updatedAt, null);
      } else {
        this.touchTask(task.id, updatedAt);
      }
      const updatedTask = this.requireTask(task.id);
      this.appendTaskEvent(updatedTask, "task.analysis_saved", { analysis }, updatedAt);
      if (rejectedPlan) {
        this.appendTaskEvent(
          updatedTask,
          "plan.rejected",
          { plan: rejectedPlan, reason: "analysis_revised" },
          updatedAt
        );
      }
      if (updatedTask.status !== task.status) {
        const statusPayload = {
          taskId: updatedTask.id,
          projectId: updatedTask.projectId,
          fromStatus: task.status,
          toStatus: updatedTask.status,
          task: updatedTask
        };
        this.appendTaskEvent(updatedTask, "task.status_changed", statusPayload, updatedAt);
        events.push({ eventType: "task.status_changed", eventPayload: statusPayload });
      }
      return { analysis, events, view: this.getTask({ id: task.id }) };
    })();

    return {
      view: result.view,
      events: result.events
    };
  }

  saveTaskPlan(payload: TaskSavePlanCommandPayload): TaskPlanningMutationResult {
    const steps = normalizePlanSteps(payload.steps);
    const result = this.db.transaction(() => {
      const task = this.requireTask(payload.taskId);
      this.assertExpectedTaskVersion(task, payload.expectedTaskVersion);
      if (["queued", "running", "verifying", "succeeded", "archived"].includes(task.status)) {
        throw new Error(`Plan cannot be edited while task is ${task.status}.`);
      }
      const previousPlan = this.listTaskPlans(task)[0] ?? null;

      const current = this.db
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM task_plan_versions WHERE task_id = @taskId"
        )
        .get({ taskId: task.id }) as { version: number };
      const updatedAt = this.now();
      let rejectedPlan: TaskPlanSummary | null = null;
      if (
        task.status === "awaiting_approval" &&
        previousPlan?.approvalState === "pending" &&
        !previousPlan.id.startsWith("legacy_")
      ) {
        this.db
          .prepare(
            `UPDATE task_plan_versions
            SET approval_state = 'rejected', updated_at = @updatedAt
            WHERE id = @planId AND task_id = @taskId`
          )
          .run({ planId: previousPlan.id, taskId: task.id, updatedAt });
        rejectedPlan = this.requirePersistedPlan(previousPlan.id);
      }
      const plan = this.insertPlanVersion(
        task.id,
        current.version + 1,
        payload.summary,
        steps,
        updatedAt,
        "not_requested"
      );
      const events: TaskPlanningEvent[] = [
        {
          eventType: "plan.version_created",
          eventPayload: { plan }
        }
      ];
      if (rejectedPlan) {
        events.unshift({
          eventType: "plan.rejected",
          eventPayload: { plan: rejectedPlan, reason: "plan_revised" }
        });
      }

      if (task.status === "awaiting_approval") {
        this.updateTaskStatusRow(task.id, "design_ready", updatedAt, null);
        const updatedTask = this.requireTask(task.id);
        const statusPayload = {
          taskId: updatedTask.id,
          projectId: updatedTask.projectId,
          fromStatus: task.status,
          toStatus: updatedTask.status,
          task: updatedTask
        };
        this.appendTaskEvent(updatedTask, "task.status_changed", statusPayload, updatedAt);
        events.unshift({ eventType: "task.status_changed", eventPayload: statusPayload });
      } else {
        this.touchTask(task.id, updatedAt);
      }

      const updatedTask = this.requireTask(task.id);
      if (rejectedPlan) {
        this.appendTaskEvent(
          updatedTask,
          "plan.rejected",
          { plan: rejectedPlan, reason: "plan_revised" },
          updatedAt
        );
      }
      this.appendTaskEvent(updatedTask, "plan.version_created", { plan }, updatedAt);
      return { plan, events, view: this.getTask({ id: task.id }) };
    })();

    return {
      view: result.view,
      events: result.events
    };
  }

  requestTaskPlanApproval(
    payload: TaskRequestPlanApprovalCommandPayload
  ): TaskPlanningMutationResult {
    const result = this.db.transaction(() => {
      const task = this.requireTask(payload.taskId);
      this.assertExpectedTaskVersion(task, payload.expectedTaskVersion);
      if (task.status !== "design_ready") {
        throw new Error(`Task must be design_ready before approval is requested; got ${task.status}.`);
      }
      const analysis = this.listTaskAnalyses(task.id)[0];
      if (!analysis) {
        throw new Error("Task analysis must be saved before plan approval is requested.");
      }

      const currentPlan = this.requireCurrentPlan(task);
      if (currentPlan.id !== payload.planId) {
        throw new Error("Only the latest plan version can be submitted for approval.");
      }
      if (currentPlan.id.startsWith("legacy_")) {
        throw new Error("Legacy task steps must be saved as a versioned plan before approval.");
      }
      if (currentPlan.basedOnAnalysisVersion !== analysis.version) {
        throw new Error(
          `Plan version ${currentPlan.version} is based on analysis v${currentPlan.basedOnAnalysisVersion ?? "none"}; save a new plan for analysis v${analysis.version} before requesting approval.`
        );
      }
      if (currentPlan.approvalState === "pending" || currentPlan.approvalState === "approved") {
        throw new Error(`Plan is already ${currentPlan.approvalState}.`);
      }

      const updatedAt = this.now();
      const approvalRequestId = this.makeId("approval");
      const codeAgent = task.codeAgentId ? this.requireCodeAgent(task.codeAgentId) : null;
      this.updateTaskStatusRow(task.id, "awaiting_approval", updatedAt, null);
      const updatedTask = this.requireTask(task.id);
      this.db
        .prepare(
          `UPDATE task_plan_versions
          SET approval_state = 'pending',
              approval_request_id = @approvalRequestId,
              approval_task_version = @approvalTaskVersion,
              approval_analysis_version = @approvalAnalysisVersion,
              approval_code_agent_id = @approvalCodeAgentId,
              approval_code_agent_updated_at = @approvalCodeAgentUpdatedAt,
              updated_at = @updatedAt
          WHERE id = @planId AND task_id = @taskId`
        )
        .run({
          planId: currentPlan.id,
          taskId: task.id,
          approvalRequestId,
          approvalTaskVersion: updatedTask.version,
          approvalAnalysisVersion: analysis.version,
          approvalCodeAgentId: codeAgent?.id ?? null,
          approvalCodeAgentUpdatedAt: codeAgent?.updatedAt ?? null,
          updatedAt
        });

      const plan = this.requirePersistedPlan(currentPlan.id);
      const planPayload = { plan };
      const statusPayload = {
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        fromStatus: task.status,
        toStatus: updatedTask.status,
        task: updatedTask
      };
      this.appendTaskEvent(updatedTask, "plan.approval_requested", planPayload, updatedAt);
      this.appendTaskEvent(updatedTask, "task.status_changed", statusPayload, updatedAt);
      return { plan, statusPayload, view: this.getTask({ id: task.id }) };
    })();

    return {
      view: result.view,
      events: [
        {
          eventType: "plan.approval_requested",
          eventPayload: { plan: result.plan }
        },
        {
          eventType: "task.status_changed",
          eventPayload: result.statusPayload
        }
      ]
    };
  }

  approveTaskPlan(payload: TaskApprovePlanCommandPayload): TaskPlanningMutationResult {
    const result = this.db.transaction(() => {
      const task = this.requireTask(payload.taskId);
      this.assertExpectedTaskVersion(task, payload.expectedTaskVersion);
      if (task.status !== "awaiting_approval") {
        throw new Error(`Task must be awaiting_approval before approval; got ${task.status}.`);
      }

      const currentPlan = this.requireCurrentPlan(task);
      if (currentPlan.id !== payload.planId || currentPlan.approvalState !== "pending") {
        throw new Error("Only the latest pending plan version can be approved.");
      }
      const snapshot = currentPlan.approvalSnapshot;
      if (!snapshot || snapshot.requestId !== payload.approvalRequestId) {
        throw new Error("Approval request is stale or does not match the pending plan snapshot.");
      }
      if (snapshot.taskVersion !== task.version) {
        throw new Error(
          `Approval snapshot is stale: task was v${snapshot.taskVersion} and is now v${task.version}.`
        );
      }
      const analysis = this.listTaskAnalyses(task.id)[0];
      if (!analysis || analysis.version !== snapshot.analysisVersion) {
        throw new Error("Approval snapshot is stale because the task analysis changed.");
      }
      if (task.codeAgentId !== snapshot.codeAgentId) {
        throw new Error("Approval snapshot is stale because the selected codeAgent changed.");
      }
      const codeAgent = task.codeAgentId ? this.requireCodeAgent(task.codeAgentId) : null;
      if ((codeAgent?.updatedAt ?? null) !== snapshot.codeAgentUpdatedAt) {
        throw new Error("Approval snapshot is stale because the codeAgent profile changed.");
      }

      const updatedAt = this.now();
      this.db
        .prepare(
          `UPDATE task_plan_versions
          SET approval_state = 'approved', updated_at = @updatedAt
          WHERE id = @planId AND task_id = @taskId
            AND approval_state = 'pending'
            AND approval_request_id = @approvalRequestId`
        )
        .run({
          planId: currentPlan.id,
          taskId: task.id,
          approvalRequestId: payload.approvalRequestId,
          updatedAt
        });
      this.updateTaskStatusRow(task.id, "queued", updatedAt, null);

      const updatedTask = this.requireTask(task.id);
      const plan = this.requirePersistedPlan(currentPlan.id);
      const planPayload = { plan };
      const statusPayload = {
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        fromStatus: task.status,
        toStatus: updatedTask.status,
        task: updatedTask
      };
      this.appendTaskEvent(updatedTask, "plan.approved", planPayload, updatedAt);
      this.appendTaskEvent(updatedTask, "task.status_changed", statusPayload, updatedAt);
      return { plan, statusPayload, view: this.getTask({ id: task.id }) };
    })();

    return {
      view: result.view,
      events: [
        {
          eventType: "plan.approved",
          eventPayload: { plan: result.plan }
        },
        {
          eventType: "task.status_changed",
          eventPayload: result.statusPayload
        }
      ]
    };
  }

  countTasks(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    return row.count;
  }

  private configure(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES user_profiles(id),
        name TEXT NOT NULL,
        root_path TEXT,
        description TEXT,
        status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS code_agent_profiles (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES user_profiles(id),
        kind TEXT NOT NULL CHECK(kind IN ('codex', 'claude_code', 'cursor', 'kimi', 'custom')),
        label TEXT NOT NULL,
        description TEXT,
        command TEXT,
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        owner_id TEXT NOT NULL REFERENCES user_profiles(id),
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        source_json TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
        progress_percent INTEGER NOT NULL CHECK(progress_percent >= 0 AND progress_percent <= 100),
        due_at TEXT,
        code_agent_id TEXT REFERENCES code_agent_profiles(id),
        blocked_reason TEXT,
        next_step TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        version INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        project_id TEXT NOT NULL REFERENCES projects(id),
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS plan_steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'done', 'blocked', 'failed')),
        input_json TEXT NOT NULL,
        depends_on_json TEXT NOT NULL,
        success_criteria_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_analysis_versions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        version INTEGER NOT NULL,
        objective TEXT NOT NULL,
        known_information_json TEXT NOT NULL,
        missing_information_json TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        risks_json TEXT NOT NULL,
        expected_artifacts_json TEXT NOT NULL,
        completion_definition_json TEXT NOT NULL,
        suggested_automation_level TEXT NOT NULL CHECK(suggested_automation_level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(task_id, version)
      );

      CREATE TABLE IF NOT EXISTS task_plan_versions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        version INTEGER NOT NULL,
        summary TEXT NOT NULL,
        based_on_analysis_version INTEGER,
        approval_state TEXT NOT NULL CHECK(approval_state IN ('not_requested', 'pending', 'approved', 'rejected')),
        approval_request_id TEXT,
        approval_task_version INTEGER,
        approval_analysis_version INTEGER,
        approval_code_agent_id TEXT,
        approval_code_agent_updated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(task_id, version)
      );

      CREATE TABLE IF NOT EXISTS task_plan_steps (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES task_plan_versions(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        step_key TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('agent', 'tool', 'human_input', 'approval', 'verification', 'notification')),
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'done', 'blocked', 'failed')),
        input_json TEXT NOT NULL,
        depends_on_json TEXT NOT NULL,
        success_criteria_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(plan_id, step_key),
        UNIQUE(plan_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS idx_projects_owner_status ON projects(owner_id, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_archived ON tasks(project_id, archived_at, updated_at);
      CREATE INDEX IF NOT EXISTS idx_task_events_task_sequence ON task_events(task_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_plan_steps_task_sequence ON plan_steps(task_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_task_analysis_versions_task ON task_analysis_versions(task_id, version);
      CREATE INDEX IF NOT EXISTS idx_task_plan_versions_task ON task_plan_versions(task_id, version);
      CREATE INDEX IF NOT EXISTS idx_task_plan_steps_plan_sequence ON task_plan_steps(plan_id, sequence);
    `);

    this.ensureColumn("task_plan_versions", "based_on_analysis_version", "INTEGER");
    this.ensureColumn("task_plan_versions", "approval_request_id", "TEXT");
    this.ensureColumn("task_plan_versions", "approval_task_version", "INTEGER");
    this.ensureColumn("task_plan_versions", "approval_analysis_version", "INTEGER");
    this.ensureColumn("task_plan_versions", "approval_code_agent_id", "TEXT");
    this.ensureColumn("task_plan_versions", "approval_code_agent_updated_at", "TEXT");
    this.runMigration("phase2_materialize_legacy_plans", () => this.materializeLegacyPlans());
    this.runMigration("phase2_reconcile_unbound_approval_snapshots", () =>
      this.reconcileUnboundApprovalSnapshots()
    );
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.pragma(`table_info(${table})`) as Array<{ name?: unknown }>;
    if (columns.some((item) => item.name === column)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private runMigration(id: string, migrate: () => void): void {
    const applied = this.db
      .prepare("SELECT id FROM schema_migrations WHERE id = @id")
      .get({ id });
    if (applied) {
      return;
    }

    this.db.transaction(() => {
      migrate();
      this.db
        .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (@id, @appliedAt)")
        .run({ id, appliedAt: this.now() });
    })();
  }

  private materializeLegacyPlans(): void {
    const taskRows = this.db
      .prepare(
        `SELECT DISTINCT tasks.*
        FROM tasks
        INNER JOIN plan_steps ON plan_steps.task_id = tasks.id
        ORDER BY tasks.created_at ASC`
      )
      .all() as TaskRow[];

    for (const taskRow of taskRows) {
      const legacySteps = this.db
        .prepare("SELECT * FROM plan_steps WHERE task_id = @taskId ORDER BY sequence ASC")
        .all({ taskId: taskRow.id }) as PlanStepRow[];
      if (legacySteps.length === 0) {
        continue;
      }

      const existing = this.db
        .prepare("SELECT COUNT(*) AS count FROM task_plan_versions WHERE task_id = @taskId")
        .get({ taskId: taskRow.id }) as { count: number };
      if (existing.count > 0) {
        this.db
          .prepare(
            "UPDATE task_plan_versions SET version = version + 1000000 WHERE task_id = @taskId"
          )
          .run({ taskId: taskRow.id });
        this.db
          .prepare(
            "UPDATE task_plan_versions SET version = version - 999999 WHERE task_id = @taskId"
          )
          .run({ taskId: taskRow.id });
      }

      const analysisRow = this.db
        .prepare(
          "SELECT version FROM task_analysis_versions WHERE task_id = @taskId ORDER BY version DESC LIMIT 1"
        )
        .get({ taskId: taskRow.id }) as { version: number } | undefined;
      const planId = this.makeId("plan");
      this.db
        .prepare(
          `INSERT INTO task_plan_versions (
            id, task_id, version, summary, based_on_analysis_version, approval_state,
            approval_request_id, approval_task_version, approval_analysis_version,
            approval_code_agent_id, approval_code_agent_updated_at, created_at, updated_at
          ) VALUES (
            @id, @taskId, 1, @summary, @basedOnAnalysisVersion, 'not_requested',
            NULL, NULL, NULL, NULL, NULL, @createdAt, @updatedAt
          )`
        )
        .run({
          id: planId,
          taskId: taskRow.id,
          summary: taskRow.goal,
          basedOnAnalysisVersion: analysisRow?.version ?? null,
          createdAt: taskRow.created_at,
          updatedAt: taskRow.updated_at
        });

      const keyById = new Map(
        legacySteps.map((step, index) => [step.id, `step_${index + 1}`] as const)
      );
      for (const [index, step] of legacySteps.entries()) {
        this.db
          .prepare(
            `INSERT INTO task_plan_steps (
              id, plan_id, task_id, step_key, sequence, type, title, goal, status,
              input_json, depends_on_json, success_criteria_json, created_at, updated_at
            ) VALUES (
              @id, @planId, @taskId, @stepKey, @sequence, @type, @title, @goal, @status,
              @inputJson, @dependsOnJson, @successCriteriaJson, @createdAt, @updatedAt
            )`
          )
          .run({
            id: this.makeId("plan_step"),
            planId,
            taskId: taskRow.id,
            stepKey: keyById.get(step.id) ?? `step_${index + 1}`,
            sequence: index + 1,
            type: step.type,
            title: step.title,
            goal: step.goal,
            status: step.status,
            inputJson: step.input_json,
            dependsOnJson: stringifyJson(
              parseStringArray(step.depends_on_json).map(
                (dependency) => keyById.get(dependency) ?? dependency
              )
            ),
            successCriteriaJson: step.success_criteria_json,
            createdAt: step.created_at,
            updatedAt: step.updated_at
          });
      }
    }
  }

  private reconcileUnboundApprovalSnapshots(): void {
    const rows = this.db
      .prepare(
        `SELECT * FROM task_plan_versions
        WHERE approval_state IN ('pending', 'approved')
          AND approval_request_id IS NULL`
      )
      .all() as TaskPlanRow[];

    for (const row of rows) {
      const taskRow = this.db
        .prepare("SELECT * FROM tasks WHERE id = @taskId")
        .get({ taskId: row.task_id }) as TaskRow | undefined;
      if (!taskRow) {
        throw new Error(`Cannot reconcile approval for missing task: ${row.task_id}`);
      }

      const updatedAt = this.now();
      const analysisRow = this.db
        .prepare(
          `SELECT version FROM task_analysis_versions
          WHERE task_id = @taskId
          ORDER BY version DESC LIMIT 1`
        )
        .get({ taskId: row.task_id }) as { version: number } | undefined;

      if (row.approval_state === "pending" || !analysisRow) {
        this.db
          .prepare(
            `UPDATE task_plan_versions
            SET approval_state = 'rejected', updated_at = @updatedAt
            WHERE id = @planId`
          )
          .run({ planId: row.id, updatedAt });

        const fallbackStatus =
          taskRow.status === "awaiting_approval"
            ? "design_ready"
            : taskRow.status === "queued"
              ? "cancelled"
              : taskRow.status;
        if (fallbackStatus !== taskRow.status) {
          this.updateTaskStatusRow(taskRow.id, fallbackStatus, updatedAt, null);
        }
        continue;
      }

      const codeAgentRow = taskRow.code_agent_id
        ? this.getCodeAgentRow(taskRow.code_agent_id)
        : undefined;
      this.db
        .prepare(
          `UPDATE task_plan_versions
          SET approval_request_id = @approvalRequestId,
              approval_task_version = @approvalTaskVersion,
              approval_analysis_version = @approvalAnalysisVersion,
              approval_code_agent_id = @approvalCodeAgentId,
              approval_code_agent_updated_at = @approvalCodeAgentUpdatedAt,
              updated_at = @updatedAt
          WHERE id = @planId`
        )
        .run({
          planId: row.id,
          approvalRequestId: `legacy_approval_${row.id}`,
          approvalTaskVersion: Math.max(
            1,
            taskRow.version - (taskRow.status === "queued" ? 1 : 0)
          ),
          approvalAnalysisVersion: analysisRow.version,
          approvalCodeAgentId: codeAgentRow?.id ?? null,
          approvalCodeAgentUpdatedAt: codeAgentRow?.updated_at ?? null,
          updatedAt
        });
    }
  }

  private seed(): void {
    const now = this.now();

    this.db
      .prepare(
        `INSERT INTO user_profiles (id, display_name, created_at, updated_at)
        VALUES (@id, @displayName, @createdAt, @createdAt)
        ON CONFLICT(id) DO NOTHING`
      )
      .run({
        id: DEFAULT_OWNER_ID,
        displayName: "Local User",
        createdAt: now
      });

    this.db
      .prepare(
        `INSERT INTO projects (
          id, owner_id, name, root_path, description, status, created_at, updated_at, archived_at
        ) VALUES (
          'project_personalclaw', @ownerId, 'PersonalClaw', NULL,
          'Default local project for PersonalClaw task management.', 'active', @createdAt, @createdAt, NULL
        )
        ON CONFLICT(id) DO NOTHING`
      )
      .run({
        ownerId: DEFAULT_OWNER_ID,
        createdAt: now
      });

    const defaults: readonly CodeAgentProfileInput[] = [
      { id: "code_agent_codex", kind: "codex", label: "Codex", command: "codex" },
      { id: "code_agent_claude_code", kind: "claude_code", label: "Claude Code", command: "claude" },
      { id: "code_agent_cursor", kind: "cursor", label: "Cursor" },
      { id: "code_agent_kimi", kind: "kimi", label: "Kimi" }
    ];

    for (const profile of defaults) {
      this.db
        .prepare(
          `INSERT INTO code_agent_profiles (
            id, owner_id, kind, label, description, command, enabled, created_at, updated_at, archived_at
          ) VALUES (
            @id, @ownerId, @kind, @label, NULL, @command, 1, @createdAt, @createdAt, NULL
          )
          ON CONFLICT(id) DO NOTHING`
        )
        .run({
          id: profile.id,
          ownerId: DEFAULT_OWNER_ID,
          kind: profile.kind,
          label: profile.label,
          command: profile.command ?? null,
          createdAt: now
        });
    }
  }

  private appendTaskEvent(task: TaskSummary, eventType: string, payload: unknown, createdAt: string): void {
    const current = this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM task_events WHERE task_id = @taskId")
      .get({ taskId: task.id }) as { sequence: number };
    const sequence = current.sequence + 1;

    this.db
      .prepare(
        `INSERT INTO task_events (
          id, task_id, project_id, sequence, event_type, payload_json, created_at
        ) VALUES (
          @id, @taskId, @projectId, @sequence, @eventType, @payloadJson, @createdAt
        )`
      )
      .run({
        id: this.makeId("task_event"),
        taskId: task.id,
        projectId: task.projectId,
        sequence,
        eventType,
        payloadJson: stringifyJson(payload),
        createdAt
      });
  }

  private listTaskAnalyses(taskId: string): TaskAnalysisSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM task_analysis_versions WHERE task_id = @taskId ORDER BY version DESC")
      .all({ taskId }) as TaskAnalysisRow[];

    return rows.map(toTaskAnalysisSummary);
  }

  private insertAnalysisVersion(
    taskId: string,
    version: number,
    analysis: TaskAnalysisInput,
    timestamp: string
  ): TaskAnalysisSummary {
    const id = this.makeId("analysis");
    this.db
      .prepare(
        `INSERT INTO task_analysis_versions (
          id, task_id, version, objective, known_information_json, missing_information_json,
          constraints_json, risks_json, expected_artifacts_json, completion_definition_json,
          suggested_automation_level, created_at, updated_at
        ) VALUES (
          @id, @taskId, @version, @objective, @knownInformationJson, @missingInformationJson,
          @constraintsJson, @risksJson, @expectedArtifactsJson, @completionDefinitionJson,
          @suggestedAutomationLevel, @createdAt, @createdAt
        )`
      )
      .run({
        id,
        taskId,
        version,
        objective: analysis.objective.trim(),
        knownInformationJson: stringifyJson(analysis.knownInformation),
        missingInformationJson: stringifyJson(analysis.missingInformation),
        constraintsJson: stringifyJson(analysis.constraints),
        risksJson: stringifyJson(analysis.risks),
        expectedArtifactsJson: stringifyJson(analysis.expectedArtifacts),
        completionDefinitionJson: stringifyJson(analysis.completionDefinition),
        suggestedAutomationLevel: analysis.suggestedAutomationLevel,
        createdAt: timestamp
      });

    const row = this.db
      .prepare("SELECT * FROM task_analysis_versions WHERE id = @id")
      .get({ id }) as TaskAnalysisRow;
    return toTaskAnalysisSummary(row);
  }

  private insertPlanVersion(
    taskId: string,
    version: number,
    summary: string,
    steps: readonly NormalizedPlanStep[],
    timestamp: string,
    approvalState: TaskPlanApprovalState
  ): TaskPlanSummary {
    const id = this.makeId("plan");
    const analysisRow = this.db
      .prepare(
        "SELECT version FROM task_analysis_versions WHERE task_id = @taskId ORDER BY version DESC LIMIT 1"
      )
      .get({ taskId }) as { version: number } | undefined;
    this.db
      .prepare(
        `INSERT INTO task_plan_versions (
          id, task_id, version, summary, based_on_analysis_version, approval_state,
          approval_request_id, approval_task_version, approval_analysis_version,
          approval_code_agent_id, approval_code_agent_updated_at, created_at, updated_at
        ) VALUES (
          @id, @taskId, @version, @summary, @basedOnAnalysisVersion, @approvalState,
          NULL, NULL, NULL, NULL, NULL, @createdAt, @createdAt
        )`
      )
      .run({
        id,
        taskId,
        version,
        summary: summary.trim(),
        basedOnAnalysisVersion: analysisRow?.version ?? null,
        approvalState,
        createdAt: timestamp
      });

    for (const [index, step] of steps.entries()) {
      this.db
        .prepare(
          `INSERT INTO task_plan_steps (
            id, plan_id, task_id, step_key, sequence, type, title, goal, status,
            input_json, depends_on_json, success_criteria_json, created_at, updated_at
          ) VALUES (
            @id, @planId, @taskId, @stepKey, @sequence, @type, @title, @goal, @status,
            @inputJson, @dependsOnJson, @successCriteriaJson, @createdAt, @createdAt
          )`
        )
        .run({
          id: this.makeId("plan_step"),
          planId: id,
          taskId,
          stepKey: step.key,
          sequence: index + 1,
          type: step.type,
          title: step.title.trim(),
          goal: step.goal.trim(),
          status: step.status ?? "pending",
          inputJson: stringifyJson(step.input ?? {}),
          dependsOnJson: stringifyJson(step.dependsOn ?? []),
          successCriteriaJson: stringifyJson(step.successCriteria ?? []),
          createdAt: timestamp
        });
    }

    const row = this.db
      .prepare("SELECT * FROM task_plan_versions WHERE id = @id")
      .get({ id }) as TaskPlanRow;
    const stepRows = this.db
      .prepare("SELECT * FROM task_plan_steps WHERE plan_id = @planId ORDER BY sequence ASC")
      .all({ planId: id }) as TaskPlanStepRow[];
    return toTaskPlanSummary(row, stepRows);
  }

  private listTaskPlans(task: TaskSummary): TaskPlanSummary[] {
    const planRows = this.db
      .prepare("SELECT * FROM task_plan_versions WHERE task_id = @taskId ORDER BY version DESC")
      .all({ taskId: task.id }) as TaskPlanRow[];
    const plans = planRows.map((planRow) => {
      const stepRows = this.db
        .prepare("SELECT * FROM task_plan_steps WHERE plan_id = @planId ORDER BY sequence ASC")
        .all({ planId: planRow.id }) as TaskPlanStepRow[];

      return toTaskPlanSummary(planRow, stepRows);
    });

    if (plans.length > 0) {
      return plans;
    }

    const legacyRows = this.db
      .prepare("SELECT * FROM plan_steps WHERE task_id = @taskId ORDER BY sequence ASC")
      .all({ taskId: task.id }) as PlanStepRow[];

    if (legacyRows.length === 0) {
      return [];
    }

    const keyById = new Map(legacyRows.map((row) => [row.id, `step_${row.sequence}`] as const));
    const legacySteps = legacyRows.map((row) => ({
      ...toPlanStepSummary(row),
      key: keyById.get(row.id) ?? `step_${row.sequence}`,
      dependsOn: parseStringArray(row.depends_on_json).map(
        (dependency) => keyById.get(dependency) ?? dependency
      )
    }));

    return [
      TaskPlanSummarySchema.parse({
        id: `legacy_${task.id}`,
        taskId: task.id,
        version: 1,
        summary: task.goal,
        basedOnAnalysisVersion: null,
        approvalState: "not_requested",
        approvalSnapshot: null,
        steps: legacySteps,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      })
    ];
  }

  private requireCurrentPlan(task: TaskSummary): TaskPlanSummary {
    const plan = this.listTaskPlans(task)[0];
    if (!plan) {
      throw new Error(`Task has no plan version: ${task.id}`);
    }
    return plan;
  }

  private assertExpectedTaskVersion(task: TaskSummary, expectedVersion: number | undefined): void {
    if (expectedVersion !== undefined && task.version !== expectedVersion) {
      throw new Error(
        `Task version conflict: expected ${expectedVersion}, current ${task.version}. Refresh before saving a new version.`
      );
    }
  }

  private requirePersistedPlan(planId: string): TaskPlanSummary {
    const row = this.db
      .prepare("SELECT * FROM task_plan_versions WHERE id = @planId")
      .get({ planId }) as TaskPlanRow | undefined;
    if (!row) {
      throw new Error(`Plan version not found: ${planId}`);
    }
    const steps = this.db
      .prepare("SELECT * FROM task_plan_steps WHERE plan_id = @planId ORDER BY sequence ASC")
      .all({ planId }) as TaskPlanStepRow[];
    return toTaskPlanSummary(row, steps);
  }

  private touchTask(taskId: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE tasks
        SET updated_at = @updatedAt,
            version = version + 1
        WHERE id = @taskId`
      )
      .run({ taskId, updatedAt });
  }

  private updateTaskStatusRow(
    taskId: string,
    status: TaskStatusDto,
    updatedAt: string,
    blockedReason: string | null
  ): void {
    this.db
      .prepare(
        `UPDATE tasks
        SET status = @status,
            blocked_reason = @blockedReason,
            updated_at = @updatedAt,
            version = version + 1
        WHERE id = @taskId`
      )
      .run({ taskId, status, blockedReason, updatedAt });
  }

  private requireProject(id: string): ProjectSummary {
    return toProjectSummary(this.requireProjectRow(id));
  }

  private requireProjectRow(id: string): ProjectRow {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = @id").get({ id }) as ProjectRow | undefined;

    if (!row || row.archived_at !== null || row.status === "archived") {
      throw new Error(`Project not found or archived: ${id}`);
    }

    return row;
  }

  private getCodeAgentRow(id: string): CodeAgentRow | undefined {
    return this.db.prepare("SELECT * FROM code_agent_profiles WHERE id = @id").get({ id }) as
      | CodeAgentRow
      | undefined;
  }

  private requireCodeAgent(id: string): CodeAgentProfile {
    const row = this.getCodeAgentRow(id);

    if (!row || row.archived_at !== null) {
      throw new Error(`codeAgent profile not found or archived: ${id}`);
    }

    return toCodeAgentProfile(row);
  }

  private assertCodeAgentProfileMutable(id: string): void {
    const lockedTask = this.db
      .prepare(
        `SELECT id, status FROM tasks
        WHERE code_agent_id = @id
          AND archived_at IS NULL
          AND status IN ('awaiting_approval', 'queued', 'running', 'paused', 'blocked', 'verifying')
        LIMIT 1`
      )
      .get({ id }) as { id: string; status: TaskStatusDto } | undefined;

    if (lockedTask) {
      throw new Error(
        `codeAgent profile ${id} is frozen by task ${lockedTask.id} while it is ${lockedTask.status}.`
      );
    }
  }

  private requireTask(id: string): TaskSummary {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = @id").get({ id }) as TaskRow | undefined;

    if (!row) {
      throw new Error(`Task not found: ${id}`);
    }

    try {
      return toTaskSummary(row);
    } catch (error: unknown) {
      if (isSqliteError(error)) {
        throw new Error(error.message);
      }

      throw error;
    }
  }
}

export function resolvePersonalClawDatabasePath(userDataDir: string): string {
  return join(userDataDir, "personal-claw.sqlite3");
}

export function createPersonalClawSqliteStore(
  userDataDir: string,
  options: StoreOptions = {}
): PersonalClawSqliteStore {
  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true });
  }

  return new PersonalClawSqliteStore(resolvePersonalClawDatabasePath(userDataDir), options);
}
