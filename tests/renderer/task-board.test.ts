import { describe, expect, it } from "vitest";
import { pickTaskId, summarizeTaskBoard, taskStatusLabel } from "../../apps/desktop/src/renderer/src/taskBoard";
import type { TaskSummary } from "@personal-claw/contracts";

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

describe("task board helpers", () => {
  it("summarizes current project tasks", () => {
    const counts = summarizeTaskBoard([
      makeTask("task_1", "draft", 0),
      makeTask("task_2", "running", 40),
      makeTask("task_3", "blocked", 40),
      makeTask("task_4", "succeeded", 100)
    ]);

    expect(counts).toEqual({
      total: 4,
      active: 2,
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
    expect(taskStatusLabel("succeeded")).toBe("已完成");
  });
});
