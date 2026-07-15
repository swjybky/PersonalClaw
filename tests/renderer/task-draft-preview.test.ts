import { describe, expect, it } from "vitest";
import type { TaskDraftPreview } from "@personal-claw/contracts";
import {
  buildStableDraftStepKey,
  buildTaskAnalysisFromDraft,
  buildTaskCreatePayloadFromDraft,
  buildTaskPlanStepsFromDraft
} from "../../apps/desktop/src/renderer/src/taskDraftPreview";

function makeDraft(): TaskDraftPreview {
  return {
    draftId: "draft_123",
    status: "draft",
    title: "实现任务中心",
    objective: "交付可审阅的五段式任务中心",
    source: {
      kind: "manual_description",
      description: "帮我实现任务中心"
    },
    suggestedAutomationLevel: "L1",
    assumptions: ["项目使用 Vue", "Renderer 只调用 Preload"],
    constraints: ["不能直接访问 SQLite"],
    missingInformation: ["最终发布时间"],
    expectedArtifacts: ["任务中心页面", "测试"],
    loopIterations: [
      { index: 1, phase: "intake", status: "done", summary: "接收任务" },
      { index: 2, phase: "analysis", status: "done", summary: "完成分析" },
      { index: 3, phase: "plan_design", status: "done", summary: "完成方案" }
    ],
    steps: [
      {
        id: "draft_step_a",
        sequence: 1,
        type: "agent",
        title: "分析现状",
        goal: "确认边界",
        dependsOn: [],
        expectedSideEffects: [],
        successCriteria: ["形成现状清单"],
        retryStrategy: "重新检查",
        rollbackNotes: "无外部变更"
      },
      {
        id: "draft_step_b",
        sequence: 2,
        type: "verification",
        title: "验证任务中心",
        goal: "运行测试",
        dependsOn: ["draft_step_a"],
        expectedSideEffects: ["可能产生测试缓存"],
        successCriteria: ["Renderer 测试通过"],
        retryStrategy: "修复后重跑",
        rollbackNotes: "保留上一个方案版本"
      }
    ],
    generatedSummary: "生成了两步 DAG 方案。",
    createdAt: "2026-07-15T08:00:00.000Z"
  };
}

describe("task draft review helpers", () => {
  it("maps a draft to one Core task create payload", () => {
    const draft = makeDraft();
    const payload = buildTaskCreatePayloadFromDraft(draft, {
      projectId: "project_1",
      sessionId: "session_1",
      title: "任务中心 v2",
      goal: "完成任务中心 v2",
      priority: "high"
    });

    expect(payload).toMatchObject({
      projectId: "project_1",
      title: "任务中心 v2",
      goal: "完成任务中心 v2",
      priority: "high",
      source: {
        kind: "conversation",
        referenceId: "draft_123"
      },
      analysis: {
        objective: "交付可审阅的五段式任务中心",
        knownInformation: ["项目使用 Vue", "Renderer 只调用 Preload"],
        constraints: ["不能直接访问 SQLite"],
        risks: ["可能产生测试缓存"],
        completionDefinition: ["形成现状清单", "Renderer 测试通过"],
        suggestedAutomationLevel: "L1"
      }
    });
    expect(payload.source.label).toContain("session_1");
    expect(payload.planSummary).toContain("分析现状 → 验证任务中心");
  });

  it("creates deterministic stable keys and rewrites DAG dependencies", () => {
    const steps = buildTaskPlanStepsFromDraft(makeDraft());

    expect(buildStableDraftStepKey(2)).toBe("step_2");
    expect(steps.map((step) => step.key)).toEqual(["step_1", "step_2"]);
    expect(steps[1]?.dependsOn).toEqual(["step_1"]);
  });

  it("does not mutate the draft while producing analysis and plan inputs", () => {
    const draft = makeDraft();
    const before = structuredClone(draft);

    buildTaskAnalysisFromDraft(draft);
    buildTaskPlanStepsFromDraft(draft);

    expect(draft).toEqual(before);
  });

  it("rejects unknown dependencies instead of silently changing the DAG", () => {
    const draft = makeDraft();
    draft.steps[1] = {
      ...draft.steps[1]!,
      dependsOn: ["missing_step"]
    };

    expect(() => buildTaskPlanStepsFromDraft(draft)).toThrow("未知依赖");
  });

  it("rejects duplicate sequence-derived keys and duplicate draft ids", () => {
    const duplicateSequence = makeDraft();
    duplicateSequence.steps[1] = {
      ...duplicateSequence.steps[1]!,
      sequence: 1
    };
    expect(() => buildTaskPlanStepsFromDraft(duplicateSequence)).toThrow("重复的步骤序号");

    const duplicateId = makeDraft();
    duplicateId.steps[1] = {
      ...duplicateId.steps[1]!,
      id: duplicateId.steps[0]!.id
    };
    expect(() => buildTaskPlanStepsFromDraft(duplicateId)).toThrow("重复的步骤 id");
  });
});
