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
      "model-config",
      "project-config",
      "task-sources",
      "code-agent"
    ]);
  });
});
