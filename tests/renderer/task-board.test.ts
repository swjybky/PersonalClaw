import { describe, expect, it } from "vitest";
import {
  filterTaskBoardTasks,
  guardTaskFlowActionForReviewSelection,
  pickTaskId,
  resolveTaskFlowAction,
  splitTaskDependencyKeys,
  splitTaskEditorLines,
  summarizeTaskBoard,
  taskStatusLabel,
  taskStatusTone
} from "../../apps/desktop/src/renderer/src/taskBoard";
import type { TaskAnalysisSummary, TaskPlanSummary, TaskStatusView, TaskSummary } from "@personal-claw/contracts";

function makeTask(id: string, status: TaskSummary["status"], progressPercent: number): TaskSummary {
  const now = new Date().toISOString();

  return {
    id,
    projectId: "project_1",
    ownerId: "local-user",
    title: id,
    goal: `Goal for ${id}`,
    status,
    progressPercent,
    source: {
      kind: "manual"
    },
    priority: "normal",
    dueAt: null,
    codeAgentId: null,
    blockedReason: null,
    nextStep: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    version: 1
  };
}

const now = "2026-07-15T08:00:00.000Z";

function makeAnalysis(): TaskAnalysisSummary {
  return {
    id: "analysis_1",
    taskId: "task_1",
    version: 1,
    objective: "完成任务",
    knownInformation: [],
    missingInformation: [],
    constraints: [],
    risks: [],
    expectedArtifacts: ["结果"],
    completionDefinition: ["通过验证"],
    suggestedAutomationLevel: "L1",
    createdAt: now,
    updatedAt: now
  };
}

function makePlan(approvalState: TaskPlanSummary["approvalState"] = "not_requested"): TaskPlanSummary {
  return {
    id: "plan_1",
    taskId: "task_1",
    version: 1,
    summary: "执行方案",
    basedOnAnalysisVersion: 1,
    approvalState,
    approvalSnapshot:
      approvalState === "pending" || approvalState === "approved"
        ? {
            requestId: "approval_1",
            taskVersion: 3,
            analysisVersion: 1,
            codeAgentId: null,
            codeAgentUpdatedAt: null
          }
        : null,
    steps: [
      {
        id: "step_1",
        key: "step_1",
        taskId: "task_1",
        sequence: 1,
        type: "agent",
        title: "执行",
        goal: "完成任务",
        status: "pending",
        dependsOn: [],
        successCriteria: ["完成"],
        updatedAt: now
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

function makeView(
  status: TaskSummary["status"],
  options: {
    analysis?: TaskAnalysisSummary | null;
    plan?: TaskPlanSummary | null;
    availableTransitions?: TaskStatusView["availableTransitions"];
  } = {}
): TaskStatusView {
  const task = makeTask("task_1", status, 0);
  const analysis = options.analysis === undefined ? makeAnalysis() : options.analysis;
  const plan = options.plan === undefined ? makePlan(status === "awaiting_approval" ? "pending" : "not_requested") : options.plan;
  const availableTransitions =
    options.availableTransitions ??
    ({
      draft: ["analyzing", "archived", "cancelled"],
      analyzing: ["design_ready", "blocked", "failed", "cancelled"],
      design_ready: ["awaiting_approval", "analyzing", "archived", "cancelled"],
      awaiting_approval: ["analyzing", "design_ready", "queued"],
      queued: ["cancelled"]
    } as const)[status as "draft" | "analyzing" | "design_ready" | "awaiting_approval" | "queued"] ?? [];

  return {
    task,
    steps: plan?.steps ?? [],
    recentEvents: [],
    blockedReason: null,
    nextStep: null,
    analysis,
    analysisVersions: analysis ? [analysis] : [],
    plan,
    planVersions: plan ? [plan] : [],
    availableTransitions: [...availableTransitions]
  };
}

describe("task board helpers", () => {
  it("summarizes current project tasks", () => {
    const counts = summarizeTaskBoard([
      makeTask("task_1", "draft", 0),
      makeTask("task_2", "running", 40),
      makeTask("task_waiting", "awaiting_approval", 40),
      makeTask("task_3", "blocked", 40),
      makeTask("task_4", "succeeded", 100)
    ]);

    expect(counts).toEqual({
      total: 5,
      active: 3,
      done: 1,
      blocked: 1
    });
  });

  it("keeps a selected task when it is still visible", () => {
    const tasks = [makeTask("task_1", "draft", 0), makeTask("task_2", "running", 25)];

    expect(pickTaskId(tasks, "task_2")).toBe("task_2");
    expect(pickTaskId(tasks, "missing")).toBe("task_1");
    expect(pickTaskId([], "missing")).toBeNull();
  });

  it("returns Chinese labels for status display", () => {
    expect(taskStatusLabel("design_ready")).toBe("方案就绪");
    expect(taskStatusLabel("awaiting_approval")).toBe("等待审批");
    expect(taskStatusLabel("succeeded")).toBe("已完成");
    expect(taskStatusTone("awaiting_approval")).toBe("warning");
  });

  it("filters awaiting approval tasks as active work", () => {
    const tasks = [
      makeTask("task_1", "awaiting_approval", 0),
      makeTask("task_2", "succeeded", 100)
    ];

    expect(filterTaskBoardTasks(tasks, "todo").map((task) => task.id)).toEqual(["task_1"]);
  });

  it("maps the Phase 2 workflow to semantic actions", () => {
    expect(resolveTaskFlowAction(makeView("draft"))).toMatchObject({
      kind: "set_status",
      status: "analyzing"
    });
    expect(resolveTaskFlowAction(makeView("analyzing"))).toMatchObject({
      kind: "set_status",
      status: "design_ready",
      disabledReason: null
    });
    expect(resolveTaskFlowAction(makeView("design_ready"))).toMatchObject({
      kind: "request_plan_approval",
      planId: "plan_1",
      disabledReason: null
    });
    expect(resolveTaskFlowAction(makeView("awaiting_approval"))).toMatchObject({
      kind: "approve_plan",
      planId: "plan_1",
      disabledReason: null
    });
    expect(resolveTaskFlowAction(makeView("queued"))).toMatchObject({
      kind: "phase4_wait"
    });
  });

  it("honors Core available transitions and required planning data", () => {
    expect(
      resolveTaskFlowAction(makeView("draft", { availableTransitions: [] }))?.disabledReason
    ).toContain("Core");
    expect(
      resolveTaskFlowAction(makeView("analyzing", { analysis: null }))?.disabledReason
    ).toContain("分析");
    expect(
      resolveTaskFlowAction(makeView("design_ready", { plan: null }))?.disabledReason
    ).toContain("方案");
  });

  it("disables approval when the visible analysis, plan, or executor is not current", () => {
    const view = makeView("awaiting_approval");
    const action = resolveTaskFlowAction(view);

    expect(
      guardTaskFlowActionForReviewSelection(action, view, {
        analysisVersion: 1,
        planVersion: 0,
        codeAgentId: null
      })?.disabledReason
    ).toContain("历史方案版本");
    expect(
      guardTaskFlowActionForReviewSelection(action, view, {
        analysisVersion: 0,
        planVersion: 1,
        codeAgentId: null
      })?.disabledReason
    ).toContain("历史分析版本");
    expect(
      guardTaskFlowActionForReviewSelection(action, view, {
        analysisVersion: 1,
        planVersion: 1,
        codeAgentId: "unsaved_agent"
      })?.disabledReason
    ).toContain("尚未保存");
    expect(
      guardTaskFlowActionForReviewSelection(action, view, {
        analysisVersion: 1,
        planVersion: 1,
        codeAgentId: null
      })?.disabledReason
    ).toBeNull();
  });

  it("splits analysis arrays by line while dependency keys also support commas", () => {
    expect(splitTaskEditorLines("Windows, macOS, Linux\nUbuntu")).toEqual([
      "Windows, macOS, Linux",
      "Ubuntu"
    ]);
    expect(splitTaskDependencyKeys("inspect, implement\nverify")).toEqual([
      "inspect",
      "implement",
      "verify"
    ]);
  });
});
