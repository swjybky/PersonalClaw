import { describe, expect, it } from "vitest";
import {
  defaultNavigationKey,
  getNavigationItem,
  navigationItems
} from "../../apps/desktop/src/renderer/src/navigation";

describe("renderer navigation model", () => {
  it("defaults to the Phase 0 conversation workspace", () => {
    const defaultItem = getNavigationItem(defaultNavigationKey);

    expect(defaultItem.key).toBe("conversation");
    expect(defaultItem.phase).toBe("Phase 0");
  });

  it("provides stable keys for each sidebar entry", () => {
    expect(navigationItems.map((item) => item.key)).toEqual([
      "conversation",
      "project-config",
      "task-sources",
      "code-agent"
    ]);
  });
});
