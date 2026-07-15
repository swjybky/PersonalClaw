import { describe, expect, it } from "vitest";
import {
  assertTaskCreation,
  assertTaskStatusTransition,
  calculateStepProgressPercent,
  canTransitionTaskStatus,
  getAvailableTaskStatusTransitions
} from "@personal-claw/domain";

describe("task status machine", () => {
  it("requires plan approval before a task can be queued", () => {
    expect(canTransitionTaskStatus("draft", "analyzing")).toBe(true);
    expect(canTransitionTaskStatus("analyzing", "design_ready")).toBe(true);
    expect(canTransitionTaskStatus("design_ready", "queued")).toBe(false);
    expect(canTransitionTaskStatus("design_ready", "awaiting_approval")).toBe(true);
    expect(canTransitionTaskStatus("awaiting_approval", "queued")).toBe(true);
    expect(canTransitionTaskStatus("queued", "running")).toBe(true);
  });

  it("returns the available transitions for task detail views", () => {
    expect(getAvailableTaskStatusTransitions("design_ready")).toEqual([
      "awaiting_approval",
      "analyzing",
      "archived",
      "cancelled"
    ]);
    expect(getAvailableTaskStatusTransitions("archived")).toEqual([]);
  });

  it("rejects illegal direct success", () => {
    expect(() => assertTaskStatusTransition("draft", "succeeded")).toThrow("Cannot transition task");
  });

  it("requires tasks to be bound to a project and owner", () => {
    expect(() =>
      assertTaskCreation({
        projectId: "",
        ownerId: "local-user",
        title: "整理任务",
        goal: "形成可追踪任务"
      })
    ).toThrow("Task must be bound to a project");

    expect(() =>
      assertTaskCreation({
        projectId: "project_1",
        ownerId: "",
        title: "整理任务",
        goal: "形成可追踪任务"
      })
    ).toThrow("Task must be bound to an owner");
  });

  it("calculates progress from step status deterministically", () => {
    expect(
      calculateStepProgressPercent([
        { status: "done" },
        { status: "active" },
        { status: "pending" },
        { status: "blocked" }
      ])
    ).toBe(38);
  });
});
