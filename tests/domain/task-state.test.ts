import { describe, expect, it } from "vitest";
import { assertTaskStatusTransition, canTransitionTaskStatus } from "@personal-claw/domain";

describe("task status machine", () => {
  it("allows the Phase 2 happy path statuses once implemented", () => {
    expect(canTransitionTaskStatus("draft", "analyzing")).toBe(true);
    expect(canTransitionTaskStatus("analyzing", "design_ready")).toBe(true);
    expect(canTransitionTaskStatus("queued", "running")).toBe(true);
  });

  it("rejects illegal direct success", () => {
    expect(() => assertTaskStatusTransition("draft", "succeeded")).toThrow("Cannot transition task");
  });
});
