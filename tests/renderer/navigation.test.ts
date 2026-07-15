import { describe, expect, it } from "vitest";
import {
  defaultNavigationKey,
  getNavigationItem,
  navigationItems
} from "../../apps/desktop/src/renderer/src/navigation";

describe("renderer navigation model", () => {
  it("defaults to the Phase 1 conversation workspace", () => {
    const defaultItem = getNavigationItem(defaultNavigationKey);

    expect(defaultItem.key).toBe("conversation");
    expect(defaultItem.phase).toBe("Phase 1");
  });

  it("provides stable keys for each sidebar entry", () => {
    expect(navigationItems.map((item) => item.key)).toEqual([
      "conversation",
      "task-center",
      "model-config",
      "project-config",
      "task-sources",
      "code-agent"
    ]);
  });

  it("exposes the Phase 2A task center as a first-level workspace", () => {
    const taskCenter = getNavigationItem("task-center");

    expect(taskCenter.label).toBe("任务中心");
    expect(taskCenter.phase).toBe("Phase 2A");
    expect(taskCenter.modules).toContain("DAG 方案");
  });

  it("keeps settings addressable without adding it to the primary sidebar list", () => {
    expect(getNavigationItem("settings").title).toBe("设置");
    expect(navigationItems.some((item) => item.key === "settings")).toBe(false);
  });
});
