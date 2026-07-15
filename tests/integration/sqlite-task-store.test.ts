import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PersonalClawSqliteStore } from "@personal-claw/infrastructure-sqlite";

const nodeRequire = createRequire(import.meta.url);

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

  it("creates pending plans and rejects progress before a Run exists", () => {
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
    expect(created.task.progressPercent).toBe(0);
    expect(created.task.status).toBe("draft");
    expect(store.getTask({ id: created.task.id }).steps.every((step) => step.status === "pending")).toBe(
      true
    );

    const statusChanged = store.setTaskStatus({
      id: created.task.id,
      status: "analyzing"
    });

    expect(statusChanged.eventType).toBe("task.status_changed");
    expect(statusChanged.task.status).toBe("analyzing");

    expect(() =>
      store.updateTaskProgress({
        id: created.task.id,
        progressPercent: 75
      })
    ).toThrow("active Run Coordinator");

    const view = store.getTask({ id: created.task.id });
    expect(view.steps).toHaveLength(2);
    expect(view.recentEvents.map((event) => event.eventType)).toContain("task.created");

    expect(() => store.deleteTask({ id: created.task.id })).toThrow(
      "cancel or finish the active workflow first"
    );
    store.setTaskStatus({ id: created.task.id, status: "cancelled" });
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

  it("persists versioned analysis and plans and gates queueing on plan approval", () => {
    const project = store.listProjects().projects[0];
    if (!project) {
      throw new Error("default project missing");
    }

    const created = store.createTask({
      projectId: project.id,
      title: "实现任务流转",
      goal: "形成可审阅、可批准的任务方案",
      source: { kind: "conversation", referenceId: "session_1" },
      analysis: {
        objective: "形成可审阅、可批准的任务方案",
        knownInformation: ["任务属于 PersonalClaw 项目"],
        missingInformation: [],
        constraints: ["PersonalClaw 不直接读写目标项目文件"],
        risks: ["未批准方案不得排队"],
        expectedArtifacts: ["任务详情", "版本化方案"],
        completionDefinition: ["方案通过用户批准后进入排队状态"],
        suggestedAutomationLevel: "L2"
      },
      planSummary: "先完善任务分析，再提交方案审批。",
      steps: [
        {
          key: "analysis",
          type: "agent",
          title: "完善分析",
          goal: "补齐约束和完成定义"
        },
        {
          key: "approval",
          type: "approval",
          title: "用户批准",
          goal: "确认执行方案",
          dependsOn: ["analysis"],
          successCriteria: ["用户明确批准最新方案版本"]
        }
      ]
    });

    expect(created.additionalEvents?.map((event) => event.eventType)).toEqual([
      "task.analysis_saved",
      "plan.version_created"
    ]);

    let view = store.getTask({ id: created.task.id });
    expect(view.analysis?.version).toBe(1);
    expect(view.plan?.version).toBe(1);
    expect(view.plan?.steps[1]?.dependsOn).toEqual(["analysis"]);

    const savedAnalysis = store.saveTaskAnalysis({
      taskId: created.task.id,
      expectedTaskVersion: created.task.version,
      analysis: {
        objective: "形成可审阅、可批准、可恢复的任务方案",
        knownInformation: ["任务属于 PersonalClaw 项目"],
        missingInformation: ["执行器将在 Phase 4 接入"],
        constraints: ["Core 是唯一 Task/Plan/Run 写入者"],
        risks: ["外部执行需要审批和审计"],
        expectedArtifacts: ["任务详情", "版本化方案"],
        completionDefinition: ["最新方案批准后进入排队状态"],
        suggestedAutomationLevel: "L2"
      }
    });
    const savedPlan = store.saveTaskPlan({
      taskId: created.task.id,
      expectedTaskVersion: savedAnalysis.view.task.version,
      summary: "保存第二版方案并等待批准。",
      steps: [
        {
          key: "review",
          type: "verification",
          title: "复核方案",
          goal: "确认范围和完成条件"
        },
        {
          key: "approval",
          type: "approval",
          title: "用户批准",
          goal: "批准最新方案",
          dependsOn: ["review"]
        }
      ]
    });

    view = savedPlan.view;
    expect(view.analysisVersions.map((item) => item.version)).toEqual([2, 1]);
    expect(view.planVersions.map((item) => item.version)).toEqual([2, 1]);
    expect(() =>
      store.saveTaskAnalysis({
        taskId: created.task.id,
        expectedTaskVersion: created.task.version,
        analysis: savedAnalysis.view.analysis ?? {
          objective: "不会写入的过期分析",
          knownInformation: [],
          missingInformation: [],
          constraints: [],
          risks: [],
          expectedArtifacts: [],
          completionDefinition: ["不应写入"],
          suggestedAutomationLevel: "L0"
        }
      })
    ).toThrow("Task version conflict");

    store.setTaskStatus({ id: created.task.id, status: "analyzing" });
    store.setTaskStatus({ id: created.task.id, status: "design_ready" });
    expect(() => store.setTaskStatus({ id: created.task.id, status: "queued" })).toThrow(
      "controlled by plan approval or the Run Coordinator"
    );

    const plan = store.getTask({ id: created.task.id }).plan;
    if (!plan) {
      throw new Error("current plan missing");
    }
    const beforeRequest = store.getTask({ id: created.task.id });
    expect(beforeRequest.availableTransitions).toContain("awaiting_approval");
    const requested = store.requestTaskPlanApproval({
      taskId: created.task.id,
      planId: plan.id,
      expectedTaskVersion: beforeRequest.task.version
    });
    expect(requested.view.task.status).toBe("awaiting_approval");
    expect(requested.view.plan?.approvalState).toBe("pending");
    expect(requested.view.plan?.basedOnAnalysisVersion).toBe(2);
    expect(requested.view.plan?.approvalSnapshot?.taskVersion).toBe(requested.view.task.version);
    expect(requested.view.plan?.approvalSnapshot?.analysisVersion).toBe(2);
    expect(requested.view.availableTransitions).toEqual(["analyzing", "design_ready", "queued"]);

    const approvalRequestId = requested.view.plan?.approvalSnapshot?.requestId;
    if (!approvalRequestId) {
      throw new Error("approval request snapshot missing");
    }
    const approved = store.approveTaskPlan({
      taskId: created.task.id,
      planId: plan.id,
      approvalRequestId,
      expectedTaskVersion: requested.view.task.version
    });
    expect(approved.view.task.status).toBe("queued");
    expect(approved.view.plan?.approvalState).toBe("approved");
    expect(approved.view.availableTransitions).toEqual(["cancelled"]);
    expect(() => store.setTaskStatus({ id: created.task.id, status: "paused" })).toThrow(
      "controlled by plan approval or the Run Coordinator"
    );

    store.close();
    store = new PersonalClawSqliteStore(join(tempDir, "task-core.sqlite3"));
    const restored = store.getTask({ id: created.task.id });
    expect(restored.task.status).toBe("queued");
    expect(restored.analysisVersions).toHaveLength(2);
    expect(restored.planVersions).toHaveLength(2);
    expect(restored.recentEvents.map((event) => event.eventType)).toContain("plan.approved");
  });

  it("freezes the exact task, analysis, and codeAgent snapshot while approval is pending", () => {
    const project = store.listProjects().projects[0];
    const codeAgent = store.listCodeAgents().profiles[0];
    if (!project || !codeAgent) {
      throw new Error("default project or codeAgent missing");
    }

    const task = store.createTask({
      projectId: project.id,
      title: "冻结审批快照",
      goal: "保证批准对象不会在审批期间漂移",
      source: { kind: "manual" },
      codeAgentId: codeAgent.id,
      analysis: {
        objective: "冻结审批对象",
        knownInformation: [],
        missingInformation: [],
        constraints: ["审批后才能排队"],
        risks: ["执行器配置漂移"],
        expectedArtifacts: ["审批快照"],
        completionDefinition: ["批准时所有快照版本一致"],
        suggestedAutomationLevel: "L2"
      },
      planSummary: "审批后进入队列",
      steps: [
        {
          key: "approval",
          type: "approval",
          title: "批准",
          goal: "批准不可变方案"
        }
      ]
    }).task;

    store.setTaskStatus({ id: task.id, status: "analyzing" });
    store.setTaskStatus({ id: task.id, status: "design_ready" });
    const ready = store.getTask({ id: task.id });
    const plan = ready.plan;
    if (!plan) {
      throw new Error("plan missing");
    }

    const requested = store.requestTaskPlanApproval({
      taskId: task.id,
      planId: plan.id,
      expectedTaskVersion: ready.task.version
    });
    const snapshot = requested.view.plan?.approvalSnapshot;
    if (!snapshot) {
      throw new Error("approval snapshot missing");
    }

    expect(snapshot.analysisVersion).toBe(1);
    expect(snapshot.codeAgentId).toBe(codeAgent.id);
    expect(snapshot.codeAgentUpdatedAt).toBe(codeAgent.updatedAt);
    expect(() => store.updateTask({ id: task.id, goal: "偷偷改变目标" })).toThrow("frozen");
    expect(() => store.assignCodeAgent({ id: task.id, codeAgentId: null })).toThrow("frozen");
    expect(() => store.deleteTask({ id: task.id })).toThrow("awaiting approval");
    expect(() => store.setTaskStatus({ id: task.id, status: "cancelled" })).toThrow(
      "only change through plan approval"
    );
    expect(() =>
      store.upsertCodeAgent({
        id: codeAgent.id,
        kind: codeAgent.kind,
        label: `${codeAgent.label} changed`,
        enabled: true
      })
    ).toThrow("frozen by task");
    expect(() =>
      store.approveTaskPlan({
        taskId: task.id,
        planId: plan.id,
        approvalRequestId: "stale_request",
        expectedTaskVersion: requested.view.task.version
      })
    ).toThrow("stale or does not match");

    const approved = store.approveTaskPlan({
      taskId: task.id,
      planId: plan.id,
      approvalRequestId: snapshot.requestId,
      expectedTaskVersion: requested.view.task.version
    });
    expect(approved.view.task.status).toBe("queued");
    expect(() => store.updateTask({ id: task.id, goal: "排队后改变目标" })).toThrow("frozen");
    expect(() => store.deleteTask({ id: task.id })).toThrow(
      "cancel or finish the active workflow first"
    );
    expect(() => store.deleteCodeAgent({ id: codeAgent.id })).toThrow("assigned to task");
  });

  it("requires a plan version based on the latest analysis before approval", () => {
    const project = store.listProjects().projects[0];
    if (!project) {
      throw new Error("default project missing");
    }

    const created = store.createTask({
      projectId: project.id,
      title: "绑定分析版本",
      goal: "只批准基于最新分析生成的方案",
      source: { kind: "manual" },
      planSummary: "旧方案",
      steps: [{ key: "old", type: "agent", title: "旧步骤", goal: "旧目标" }]
    }).task;
    const analyzed = store.saveTaskAnalysis({
      taskId: created.id,
      expectedTaskVersion: created.version,
      analysis: {
        objective: "建立分析与方案绑定",
        knownInformation: [],
        missingInformation: [],
        constraints: [],
        risks: [],
        expectedArtifacts: ["新方案"],
        completionDefinition: ["方案记录分析版本"],
        suggestedAutomationLevel: "L1"
      }
    });
    store.setTaskStatus({ id: created.id, status: "analyzing" });
    store.setTaskStatus({ id: created.id, status: "design_ready" });
    const stale = store.getTask({ id: created.id });
    if (!stale.plan) {
      throw new Error("stale plan missing");
    }
    expect(stale.plan.basedOnAnalysisVersion).toBeNull();
    expect(() =>
      store.requestTaskPlanApproval({
        taskId: created.id,
        planId: stale.plan!.id,
        expectedTaskVersion: stale.task.version
      })
    ).toThrow("save a new plan for analysis v1");

    const savedPlan = store.saveTaskPlan({
      taskId: created.id,
      expectedTaskVersion: stale.task.version,
      summary: "基于最新分析的新方案",
      steps: [{ key: "new", type: "agent", title: "新步骤", goal: "新目标" }]
    });
    expect(savedPlan.view.plan?.version).toBe(2);
    expect(savedPlan.view.plan?.basedOnAnalysisVersion).toBe(analyzed.view.analysis?.version);
    const requested = store.requestTaskPlanApproval({
      taskId: created.id,
      planId: savedPlan.view.plan!.id,
      expectedTaskVersion: savedPlan.view.task.version
    });
    expect(requested.view.task.status).toBe("awaiting_approval");

    const revised = store.saveTaskPlan({
      taskId: created.id,
      expectedTaskVersion: requested.view.task.version,
      summary: "送审后修订的第三版方案",
      steps: [{ key: "revised", type: "verification", title: "复核", goal: "复核修订方案" }]
    });
    expect(revised.view.task.status).toBe("design_ready");
    expect(revised.view.planVersions.map((item) => item.version)).toEqual([3, 2, 1]);
    expect(revised.view.planVersions[1]?.approvalState).toBe("rejected");
    expect(revised.events.map((event) => event.eventType)).toEqual([
      "task.status_changed",
      "plan.rejected",
      "plan.version_created"
    ]);
    expect(revised.view.recentEvents.map((event) => event.eventType)).toContain("plan.rejected");
  });

  it("rejects invalid plan dependency graphs before writing a new version", () => {
    const project = store.listProjects().projects[0];
    if (!project) {
      throw new Error("default project missing");
    }
    expect(() =>
      store.createTask({
        projectId: project.id,
        title: "不完整方案",
        goal: "不能静默丢弃方案摘要",
        source: { kind: "manual" },
        planSummary: "缺少步骤"
      })
    ).toThrow("requires at least one plan step");
    const task = store.createTask({
      projectId: project.id,
      title: "校验 DAG",
      goal: "拒绝悬空依赖",
      source: { kind: "manual" }
    }).task;

    expect(() =>
      store.saveTaskPlan({
        taskId: task.id,
        expectedTaskVersion: task.version,
        summary: "无效方案",
        steps: [
          {
            key: "verify",
            type: "verification",
            title: "验证",
            goal: "验证不存在的前置步骤",
            dependsOn: ["missing"]
          }
        ]
      })
    ).toThrow("unknown step");
    expect(store.getTask({ id: task.id }).planVersions).toHaveLength(0);
  });

  it("materializes Phase 1 plan_steps as plan v1 and keeps them after newer versions", () => {
    const legacyPath = join(tempDir, "phase1-task-core.sqlite3");
    const sqlite = nodeRequire("node:sqlite") as {
      DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
    };
    const legacyDatabase = new sqlite.DatabaseSync(legacyPath);
    legacyDatabase.exec(`
      CREATE TABLE user_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        root_path TEXT,
        description TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        source_json TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        progress_percent INTEGER NOT NULL,
        due_at TEXT,
        code_agent_id TEXT,
        blocked_reason TEXT,
        next_step TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE plan_steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL,
        depends_on_json TEXT NOT NULL,
        success_criteria_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO user_profiles VALUES (
        'local-user', 'Local User', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      );
      INSERT INTO projects VALUES (
        'legacy_project', 'local-user', 'Legacy', NULL, NULL, 'active',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL
      );
      INSERT INTO tasks VALUES (
        'legacy_task', 'legacy_project', 'local-user', '旧任务', '保留旧方案历史',
        '{"kind":"manual"}', 'draft', 'normal', 0, NULL, NULL, NULL, NULL,
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL, 1
      );
      INSERT INTO plan_steps VALUES (
        'legacy_step_1', 'legacy_task', 1, 'agent', '旧分析', '完成旧分析', 'done',
        '{}', '[]', '["旧分析完成"]',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      );
      INSERT INTO plan_steps VALUES (
        'legacy_step_2', 'legacy_task', 2, 'verification', '旧验证', '验证旧结果', 'pending',
        '{}', '["legacy_step_1"]', '["旧结果通过"]',
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      );
    `);
    legacyDatabase.close();

    let legacyStore = new PersonalClawSqliteStore(legacyPath, { driver: "node:sqlite" });
    const migrated = legacyStore.getTask({ id: "legacy_task" });
    expect(migrated.planVersions).toHaveLength(1);
    expect(migrated.plan?.id.startsWith("legacy_")).toBe(false);
    expect(migrated.plan?.version).toBe(1);
    expect(migrated.plan?.steps[1]?.dependsOn).toEqual(["step_1"]);
    expect(migrated.plan?.steps[0]?.status).toBe("done");

    const v2 = legacyStore.saveTaskPlan({
      taskId: "legacy_task",
      expectedTaskVersion: migrated.task.version,
      summary: "Phase 2 新方案",
      steps: [{ key: "new_step", type: "agent", title: "新步骤", goal: "完成新方案" }]
    });
    expect(v2.view.planVersions.map((planVersion) => planVersion.version)).toEqual([2, 1]);
    legacyStore.close();

    legacyStore = new PersonalClawSqliteStore(legacyPath, { driver: "node:sqlite" });
    expect(legacyStore.getTask({ id: "legacy_task" }).planVersions.map((item) => item.version)).toEqual([
      2,
      1
    ]);
    legacyStore.close();
  });
});
