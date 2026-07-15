import { describe, expect, it } from "vitest";
import {
  buildTaskDraftPreview,
  buildTaskDraftPrompt,
  parseTaskDraftModelOutput
} from "../../apps/desktop/src/utilities/task-draft-planning";

describe("task draft planning JSON", () => {
  it("requests one strict JSON object with the complete planning shape", () => {
    const prompt = buildTaskDraftPrompt("整理并执行版本发布任务", 4);

    expect(prompt).toContain("PERSONAL_CLAW_TASK_DRAFT_JSON_V1");
    expect(prompt).toContain("Return exactly one valid JSON object and no other text.");
    expect(prompt).toContain("This run is planning-only and has zero tools.");
    expect(prompt).toContain('"suggestedAutomationLevel": "L0"');
    expect(prompt).toContain('"expectedArtifacts"');
    expect(prompt).toContain('"retryStrategy"');
    expect(prompt).toContain("整理并执行版本发布任务");
  });

  it("builds the preview from validated model JSON instead of canned values", () => {
    const assistantText = JSON.stringify({
      title: "准备桌面端版本发布",
      objective: "完成桌面端发布准备，并以构建和回归结果作为完成证据。",
      assumptions: ["发布分支已经冻结"],
      constraints: ["未经审批不得发布到生产环境"],
      missingInformation: ["目标版本号"],
      expectedArtifacts: ["构建产物", "回归测试报告"],
      suggestedAutomationLevel: "L2",
      steps: [
        {
          id: "inspect",
          type: "agent",
          title: "检查发布输入",
          goal: "确认版本、变更记录和构建配置完整。",
          dependsOn: [],
          expectedSideEffects: [],
          successCriteria: ["发布输入清单无缺项"],
          retryStrategy: "补齐缺少的发布资料后重新检查",
          rollbackNotes: "不修改已冻结的发布分支"
        },
        {
          id: "verify",
          type: "verification",
          title: "构建并回归",
          goal: "生成构建产物并完成最小回归。",
          dependsOn: ["inspect"],
          expectedSideEffects: ["生成本地构建产物"],
          successCriteria: ["构建成功", "回归测试通过"],
          retryStrategy: "保留失败日志，修复后仅重跑失败检查",
          rollbackNotes: "删除未发布的失败构建产物"
        }
      ]
    });
    const preview = buildTaskDraftPreview({
      draftId: "draft_json_1",
      description: "帮我准备桌面端版本发布",
      assistantText,
      createdAt: "2026-07-15T08:00:00.000Z",
      maxIterations: 4
    });

    expect(preview.title).toBe("准备桌面端版本发布");
    expect(preview.objective).toContain("构建和回归结果");
    expect(preview.assumptions).toEqual(["发布分支已经冻结"]);
    expect(preview.constraints).toEqual(["未经审批不得发布到生产环境"]);
    expect(preview.missingInformation).toEqual(["目标版本号"]);
    expect(preview.expectedArtifacts).toEqual(["构建产物", "回归测试报告"]);
    expect(preview.suggestedAutomationLevel).toBe("L2");
    expect(preview.steps.map((step) => step.title)).toEqual(["检查发布输入", "构建并回归"]);
    expect(preview.steps[1]?.dependsOn).toEqual([preview.steps[0]?.id]);
    expect(preview.generatedSummary).toBe(assistantText);
  });

  it("uses an explicit fallback while preserving invalid model output", () => {
    const assistantText = "```json\n{\"title\":\"不完整草稿\"}\n```";
    const parsed = parseTaskDraftModelOutput(assistantText);
    const preview = buildTaskDraftPreview({
      draftId: "draft_fallback_1",
      description: "帮我整理一个待审批任务",
      assistantText,
      createdAt: "2026-07-15T08:00:00.000Z",
      maxIterations: 3
    });

    expect(parsed.ok).toBe(false);
    expect(preview.generatedSummary).toBe(assistantText);
    expect(preview.assumptions[0]).toContain("deterministic fallback");
    expect(preview.constraints.some((item) => item.startsWith("Explicit fallback reason:"))).toBe(true);
    expect(preview.loopIterations[1]?.summary).toContain("failed");
    expect(preview.steps).toHaveLength(3);
  });
});
