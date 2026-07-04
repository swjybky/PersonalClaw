import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PersonalClawSqliteStore } from "@personal-claw/infrastructure-sqlite";

describe("PersonalClaw SQLite task store", () => {
  let tempDir: string;
  let store: PersonalClawSqliteStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "personal-claw-sqlite-"));
    store = new PersonalClawSqliteStore(join(tempDir, "task-core.sqlite3"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a WAL-backed empty database with default project and code agents", () => {
    expect(store.getJournalMode()).toBe("wal");
    expect(store.listProjects().projects[0]?.name).toBe("PersonalClaw");
    expect(store.listCodeAgents().profiles.map((profile) => profile.kind)).toContain("codex");
  });

  it("creates, updates, tracks progress, and archives project-bound tasks", () => {
    const project = store.listProjects().projects[0];

    if (!project) {
      throw new Error("default project missing");
    }

    const created = store.createTask({
      projectId: project.id,
      title: "搭建任务系统",
      goal: "创建可持久化、可追踪的个人任务",
      source: {
        kind: "manual"
      },
      steps: [
        {
          type: "agent",
          title: "确认目标",
          goal: "确认任务系统目标",
          status: "done"
        },
        {
          type: "verification",
          title: "验证",
          goal: "运行最小验证",
          status: "pending"
        }
      ]
    });

    expect(created.task.projectId).toBe(project.id);
    expect(created.task.progressPercent).toBe(50);

    const statusChanged = store.setTaskStatus({
      id: created.task.id,
      status: "analyzing"
    });

    expect(statusChanged.eventType).toBe("task.status_changed");
    expect(statusChanged.task.status).toBe("analyzing");

    const progressed = store.updateTaskProgress({
      id: created.task.id,
      progressPercent: 75
    });

    expect(progressed.eventType).toBe("task.progress_changed");
    expect(progressed.task.progressPercent).toBe(75);

    const view = store.getTask({ id: created.task.id });
    expect(view.steps).toHaveLength(2);
    expect(view.recentEvents.map((event) => event.eventType)).toContain("task.created");

    const archived = store.deleteTask({ id: created.task.id });
    expect(archived.eventType).toBe("task.archived");
    expect(store.listTasks({ projectId: project.id }).tasks).toHaveLength(0);
    expect(store.listTasks({ projectId: project.id, includeArchived: true }).tasks).toHaveLength(1);
  });

  it("archives a project and removes it from the active project list", () => {
    const created = store.createProject({ name: "临时项目" });
    const projectId = created.project.id;

    expect(store.listProjects().projects.some((item) => item.id === projectId)).toBe(true);

    const archived = store.archiveProject({ id: projectId });

    expect(archived.project.status).toBe("archived");
    expect(archived.project.archivedAt).not.toBeNull();
    expect(store.listProjects().projects.some((item) => item.id === projectId)).toBe(false);
  });

  it("rolls back task creation when the project is missing", () => {
    expect(() =>
      store.createTask({
        projectId: "missing_project",
        title: "孤立任务",
        goal: "这条任务不应该被创建",
        source: {
          kind: "manual"
        }
      })
    ).toThrow("Project not found");

    expect(store.countTasks()).toBe(0);
  });
});
