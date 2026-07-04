import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  CodeAgentListPayloadSchema,
  CodeAgentProfileSchema,
  DEFAULT_OWNER_ID,
  ProjectListPayloadSchema,
  ProjectSummarySchema,
  TaskListPayloadSchema,
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
  type TaskAssignCodeAgentCommandPayload,
  type TaskCreateCommandPayload,
  type TaskDeleteCommandPayload,
  type TaskEventSummary,
  type TaskGetCommandPayload,
  type TaskListCommandPayload,
  type TaskListPayload,
  type TaskSetStatusCommandPayload,
  type TaskStatusDto,
  type TaskStatusView,
  type TaskSummary,
  type TaskUpdateCommandPayload,
  type TaskUpdateProgressCommandPayload
} from "@personal-claw/contracts";
import {
  assertTaskCreation,
  assertTaskProgress,
  assertTaskStatusChange,
  calculateStepProgressPercent,
  canArchiveTaskStatus,
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

function parseStringArray(value: string): string[] {
  const raw = parseJson(value);

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is string => typeof item === "string");
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
    const archivedAt = this.now();

    this.db
      .prepare(
        "UPDATE code_agent_profiles SET archived_at = @archivedAt, enabled = 0, updated_at = @archivedAt WHERE id = @id"
      )
      .run({ id: payload.id, archivedAt });
    this.db
      .prepare("UPDATE tasks SET code_agent_id = NULL, updated_at = @archivedAt WHERE code_agent_id = @id")
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
    const steps = this.db
      .prepare("SELECT * FROM plan_steps WHERE task_id = @taskId ORDER BY sequence ASC")
      .all({ taskId: payload.id }) as PlanStepRow[];

    return TaskStatusViewSchema.parse({
      task,
      steps: steps.map(toPlanStepSummary),
      recentEvents: events.map(toTaskEventSummary),
      blockedReason: task.blockedReason,
      nextStep: task.nextStep
    });
  }

  createTask(payload: TaskCreateCommandPayload): TaskMutationResult {
    const result = this.db.transaction(() => {
      const project = this.requireProject(payload.projectId);
      const source = TaskSourceSchema.parse(payload.source);
      const steps = payload.steps ?? [];
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

      for (const [index, step] of steps.entries()) {
        this.db
          .prepare(
            `INSERT INTO plan_steps (
              id, task_id, sequence, type, title, goal, status,
              input_json, depends_on_json, success_criteria_json, created_at, updated_at
            ) VALUES (
              @id, @taskId, @sequence, @type, @title, @goal, @status,
              @inputJson, @dependsOnJson, @successCriteriaJson, @createdAt, @createdAt
            )`
          )
          .run({
            id: this.makeId("step"),
            taskId: id,
            sequence: index + 1,
            type: step.type,
            title: step.title.trim(),
            goal: step.goal.trim(),
            status: step.status ?? "pending",
            inputJson: stringifyJson(step.input ?? {}),
            dependsOnJson: stringifyJson(step.dependsOn ?? []),
            successCriteriaJson: stringifyJson(step.successCriteria ?? []),
            createdAt: now
          });
      }

      const task = this.requireTask(id);
      this.appendTaskEvent(task, "task.created", { task }, now);
      return task;
    })();

    return {
      task: result,
      eventType: "task.created",
      eventPayload: { task: result }
    };
  }

  updateTask(payload: TaskUpdateCommandPayload): TaskMutationResult {
    const task = this.requireTask(payload.id);
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
  }

  deleteTask(payload: TaskDeleteCommandPayload): TaskMutationResult {
    const task = this.requireTask(payload.id);
    const archivedAt = this.now();
    const nextStatus = canArchiveTaskStatus(task.status) ? "archived" : task.status;

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
        status: nextStatus,
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
  }

  setTaskStatus(payload: TaskSetStatusCommandPayload): TaskMutationResult {
    const task = this.requireTask(payload.id);
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
        blockedReason: payload.status === "blocked" ? payload.reason ?? task.blockedReason : task.blockedReason,
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
  }

  updateTaskProgress(payload: TaskUpdateProgressCommandPayload): TaskMutationResult {
    assertTaskProgress(payload.progressPercent);
    const task = this.requireTask(payload.id);
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

      CREATE INDEX IF NOT EXISTS idx_projects_owner_status ON projects(owner_id, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_archived ON tasks(project_id, archived_at, updated_at);
      CREATE INDEX IF NOT EXISTS idx_task_events_task_sequence ON task_events(task_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_plan_steps_task_sequence ON plan_steps(task_id, sequence);
    `);
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
