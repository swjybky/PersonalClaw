import { describe, expect, it } from "vitest";
import {
  assertTaskCreation,
  assertTaskStatusTransition,
  calculateStepProgressPercent,
  canTransitionTaskStatus
} from "@personal-claw/domain";

describe("task status machine", () => {
  it("allows the Phase 2 happy path statuses once implemented", () => {
    expect(canTransitionTaskStatus("draft", "analyzing")).toBe(true);
    expect(canTransitionTaskStatus("analyzing", "design_ready")).toBe(true);
    expect(canTransitionTaskStatus("queued", "running")).toBe(true);
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
