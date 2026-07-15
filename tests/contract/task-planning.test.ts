import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  PlanStepInputSchema,
  PlanStepSummarySchema,
  SystemEventEnvelopeSchema,
  TaskAnalysisInputSchema,
  TaskAnalysisSummarySchema,
  TaskCreateCommandPayloadSchema,
  TaskPlanSummarySchema,
  TaskStatusSchema,
  TaskStatusViewSchema,
  createEnvelope,
  type TaskAnalysisInput,
  type TaskAnalysisSummary,
  type TaskPlanSummary,
  type TaskSummary
} from "@personal-claw/contracts";

const now = "2026-07-15T08:00:00.000Z";

const analysisInput: TaskAnalysisInput = {
  objective: "完成 Phase 2 任务分析与方案设计",
  knownInformation: ["项目使用 Electron 与 Vue"],
  missingInformation: ["最终执行窗口"],
  constraints: ["Renderer 不得访问 Node"],
  risks: ["计划依赖可能形成环"],
  expectedArtifacts: ["结构化任务分析", "DAG 计划"],
  completionDefinition: ["用户可以审阅并批准计划"],
  suggestedAutomationLevel: "L1"
};

const analysis: TaskAnalysisSummary = {
  id: "analysis_1",
  taskId: "task_1",
  version: 1,
  ...analysisInput,
  createdAt: now,
  updatedAt: now
};

const plan: TaskPlanSummary = {
  id: "plan_1",
  taskId: "task_1",
  version: 1,
  summary: "先分析边界，再实现并验证。",
  basedOnAnalysisVersion: 1,
  approvalState: "not_requested",
  approvalSnapshot: null,
  steps: [
    {
      id: "step_1",
      key: "analyze",
      taskId: "task_1",
      sequence: 1,
      type: "agent",
      title: "分析",
      goal: "确认需求和边界",
      status: "pending",
      dependsOn: [],
      successCriteria: ["形成结构化分析"],
      updatedAt: now
    },
    {
      id: "step_2",
      key: "approval",
      taskId: "task_1",
      sequence: 2,
      type: "approval",
      title: "批准方案",
      goal: "由用户确认执行方案",
      status: "pending",
      dependsOn: ["analyze"],
      successCriteria: ["计划状态为 approved"],
      updatedAt: now
    }
  ],
  createdAt: now,
  updatedAt: now
};

const task: TaskSummary = {
  id: "task_1",
  projectId: "project_1",
  ownerId: "local-user",
  title: "实现 Phase 2A",
  goal: "补齐任务分析和计划合同",
  status: "awaiting_approval",
  progressPercent: 0,
  source: { kind: "conversation" },
  priority: "high",
  dueAt: null,
  codeAgentId: null,
  blockedReason: null,
  nextStep: "批准计划",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  version: 3
};

describe("Phase 2 task planning contracts", () => {
  it("accepts awaiting_approval and approval plan steps", () => {
    expect(TaskStatusSchema.parse("awaiting_approval")).toBe("awaiting_approval");
    expect(
      PlanStepInputSchema.parse({
        key: "approval",
        title: "批准方案",
        goal: "确认计划",
        type: "approval"
      }).key
    ).toBe("approval");
  });

  it("validates structured task analysis inputs and summaries", () => {
    expect(TaskAnalysisInputSchema.parse(analysisInput).suggestedAutomationLevel).toBe("L1");
    expect(TaskAnalysisSummarySchema.parse(analysis).version).toBe(1);
    expect(
      TaskAnalysisInputSchema.safeParse({
        ...analysisInput,
        completionDefinition: []
      }).success
    ).toBe(false);
  });

  it("returns a mandatory stable key from plan step summaries", () => {
    expect(PlanStepSummarySchema.parse(plan.steps[0]).key).toBe("analyze");
    expect(
      PlanStepSummarySchema.safeParse({
        ...plan.steps[0],
        key: undefined
      }).success
    ).toBe(false);
    expect(TaskPlanSummarySchema.parse(plan).steps[1]?.type).toBe("approval");
    expect(
      TaskPlanSummarySchema.safeParse({
        ...plan,
        approvalState: "pending",
        approvalSnapshot: null
      }).success
    ).toBe(false);
    expect(
      TaskPlanSummarySchema.safeParse({
        ...plan,
        approvalState: "not_requested",
        approvalSnapshot: {
          requestId: "approval_invalid",
          taskVersion: 1,
          analysisVersion: 1,
          codeAgentId: null,
          codeAgentUpdatedAt: null
        }
      }).success
    ).toBe(false);
  });

  it("accepts analysis and a plan summary during task creation", () => {
    const payload = TaskCreateCommandPayloadSchema.parse({
      projectId: "project_1",
      title: "实现 Phase 2A",
      goal: "补齐任务分析和方案合同",
      source: { kind: "conversation" },
      analysis: analysisInput,
      planSummary: "先分析，再批准。",
      steps: [
        {
          key: "analyze",
          title: "分析",
          goal: "形成结构化分析",
          type: "agent"
        }
      ]
    });

    expect(payload.analysis?.objective).toContain("Phase 2");
    expect(payload.planSummary).toContain("批准");
    expect(
      TaskCreateCommandPayloadSchema.safeParse({
        projectId: "project_1",
        title: "不完整方案",
        goal: "拒绝静默丢弃方案摘要",
        source: { kind: "manual" },
        planSummary: "只有摘要没有步骤"
      }).success
    ).toBe(false);
  });

  it("registers save and plan approval commands in the shared command union", () => {
    const commands = [
      createEnvelope(
        "task.saveAnalysis",
        { taskId: "task_1", expectedTaskVersion: 3, analysis: analysisInput },
        { id: "cmd_analysis", context: { correlationId: "corr_analysis" } }
      ),
      createEnvelope(
        "task.savePlan",
        {
          taskId: "task_1",
          expectedTaskVersion: 3,
          summary: plan.summary,
          steps: plan.steps.map(({ key, title, goal, type, dependsOn, successCriteria }) => ({
            key,
            title,
            goal,
            type,
            dependsOn,
            successCriteria
          }))
        },
        { id: "cmd_plan", context: { correlationId: "corr_plan" } }
      ),
      createEnvelope(
        "task.requestPlanApproval",
        { taskId: "task_1", planId: "plan_1", expectedTaskVersion: 3 },
        { id: "cmd_request_approval", context: { correlationId: "corr_request_approval" } }
      ),
      createEnvelope(
        "task.approvePlan",
        {
          taskId: "task_1",
          planId: "plan_1",
          approvalRequestId: "approval_1",
          expectedTaskVersion: 4
        },
        { id: "cmd_approve_plan", context: { correlationId: "corr_approve_plan" } }
      )
    ];

    expect(commands.map((command) => CommandEnvelopeSchema.parse(command).type)).toEqual([
      "task.saveAnalysis",
      "task.savePlan",
      "task.requestPlanApproval",
      "task.approvePlan"
    ]);
  });

  it("requires correlationId on new planning commands", () => {
    const uncorrelated = createEnvelope(
      "task.saveAnalysis",
      { taskId: "task_1", expectedTaskVersion: 3, analysis: analysisInput },
      { id: "cmd_uncorrelated" }
    );

    expect(CommandEnvelopeSchema.safeParse(uncorrelated).success).toBe(false);

    const uncorrelatedDraft = createEnvelope(
      "task.draftFromDescription",
      { description: "整理一个任务" },
      { id: "cmd_uncorrelated_draft" }
    );
    expect(CommandEnvelopeSchema.safeParse(uncorrelatedDraft).success).toBe(false);
  });

  it("registers analysis and plan lifecycle events in the system event union", () => {
    const events = [
      createEnvelope("task.analysis_saved", { analysis }, {
        id: "evt_analysis",
        context: { correlationId: "corr_evt_analysis" }
      }),
      createEnvelope("plan.version_created", { plan }, {
        id: "evt_plan",
        context: { correlationId: "corr_evt_plan" }
      }),
      createEnvelope(
        "plan.approval_requested",
        {
          plan: {
            ...plan,
            approvalState: "pending",
            approvalSnapshot: {
              requestId: "approval_1",
              taskVersion: 4,
              analysisVersion: 1,
              codeAgentId: null,
              codeAgentUpdatedAt: null
            }
          }
        },
        { id: "evt_plan_pending", context: { correlationId: "corr_evt_plan_pending" } }
      ),
      createEnvelope(
        "plan.approved",
        {
          plan: {
            ...plan,
            approvalState: "approved",
            approvalSnapshot: {
              requestId: "approval_1",
              taskVersion: 4,
              analysisVersion: 1,
              codeAgentId: null,
              codeAgentUpdatedAt: null
            }
          }
        },
        { id: "evt_plan_approved", context: { correlationId: "corr_evt_plan_approved" } }
      ),
      createEnvelope(
        "plan.rejected",
        {
          plan: {
            ...plan,
            approvalState: "rejected",
            approvalSnapshot: {
              requestId: "approval_1",
              taskVersion: 4,
              analysisVersion: 1,
              codeAgentId: null,
              codeAgentUpdatedAt: null
            }
          },
          reason: "plan_revised"
        },
        { id: "evt_plan_rejected", context: { correlationId: "corr_evt_plan_rejected" } }
      )
    ];

    expect(events.map((event) => SystemEventEnvelopeSchema.parse(event).type)).toEqual([
      "task.analysis_saved",
      "plan.version_created",
      "plan.approval_requested",
      "plan.approved",
      "plan.rejected"
    ]);
  });

  it("exposes current and historical analysis and plan versions in task status views", () => {
    const view = TaskStatusViewSchema.parse({
      task,
      steps: plan.steps,
      recentEvents: [],
      blockedReason: null,
      nextStep: "批准计划",
      analysis,
      analysisVersions: [analysis],
      plan,
      planVersions: [plan],
      availableTransitions: ["queued", "design_ready", "archived", "cancelled"]
    });

    expect(view.analysis?.version).toBe(1);
    expect(view.plan?.steps[1]?.key).toBe("approval");
    expect(view.availableTransitions).toContain("queued");
  });

  it("keeps legacy task status views readable until persistence migrations land", () => {
    const view = TaskStatusViewSchema.parse({
      task: { ...task, status: "draft" },
      steps: [
        {
          id: "legacy_step",
          taskId: "task_1",
          sequence: 1,
          type: "agent",
          title: "旧步骤",
          goal: "验证迁移兼容",
          status: "pending",
          dependsOn: [],
          successCriteria: [],
          updatedAt: now
        }
      ],
      recentEvents: [],
      blockedReason: null,
      nextStep: null
    });

    expect(view.analysis).toBeNull();
    expect(view.steps[0]?.key).toBe("legacy_step");
    expect(view.analysisVersions).toEqual([]);
    expect(view.plan).toBeNull();
    expect(view.planVersions).toEqual([]);
    expect(view.availableTransitions).toEqual([]);
  });
});
