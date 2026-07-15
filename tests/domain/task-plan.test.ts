import { describe, expect, it } from "vitest";
import { assertPlanStepDag } from "@personal-claw/domain";

describe("plan step DAG", () => {
  it("accepts a valid dependency graph", () => {
    expect(() =>
      assertPlanStepDag([
        { key: "inspect", dependsOn: [] },
        { key: "implement", dependsOn: ["inspect"] },
        { key: "test", dependsOn: ["implement"] },
        { key: "review", dependsOn: ["implement", "test"] }
      ])
    ).not.toThrow();
  });

  it("rejects duplicate stable keys", () => {
    expect(() =>
      assertPlanStepDag([
        { key: "inspect" },
        { key: "inspect" }
      ])
    ).toThrowError(expect.objectContaining({ code: "plan.duplicate_step_key" }));
  });

  it("rejects unknown dependencies", () => {
    expect(() =>
      assertPlanStepDag([{ key: "implement", dependsOn: ["missing"] }])
    ).toThrowError(expect.objectContaining({ code: "plan.unknown_dependency" }));
  });

  it("rejects self dependencies", () => {
    expect(() =>
      assertPlanStepDag([{ key: "inspect", dependsOn: ["inspect"] }])
    ).toThrowError(expect.objectContaining({ code: "plan.self_dependency" }));
  });

  it("rejects cycles across multiple steps", () => {
    expect(() =>
      assertPlanStepDag([
        { key: "one", dependsOn: ["three"] },
        { key: "two", dependsOn: ["one"] },
        { key: "three", dependsOn: ["two"] }
      ])
    ).toThrowError(expect.objectContaining({ code: "plan.cyclic_dependency" }));
  });
});
