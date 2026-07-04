import { describe, expect, it } from "vitest";
import {
  useHistorySectionCollapse,
  useSidebarCollapse
} from "../../apps/desktop/src/renderer/src/sidebarPane";

describe("sidebar collapse state", () => {
  it("starts expanded and toggles the workspace sidebar", () => {
    const state = useSidebarCollapse();

    expect(state.isSidebarCollapsed.value).toBe(false);
    expect(state.sidebarToggleLabel.value).toBe("收回左侧栏");

    state.toggleSidebar();

    expect(state.isSidebarCollapsed.value).toBe(true);
    expect(state.sidebarToggleLabel.value).toBe("展开左侧栏");

    state.toggleSidebar();

    expect(state.isSidebarCollapsed.value).toBe(false);
    expect(state.sidebarToggleLabel.value).toBe("收回左侧栏");
  });

  it("starts expanded and toggles the conversation history list", () => {
    const state = useHistorySectionCollapse();

    expect(state.isHistoryCollapsed.value).toBe(false);
    expect(state.historyToggleLabel.value).toBe("收回历史对话");

    state.toggleHistory();

    expect(state.isHistoryCollapsed.value).toBe(true);
    expect(state.historyToggleLabel.value).toBe("展开历史对话");

    state.toggleHistory();

    expect(state.isHistoryCollapsed.value).toBe(false);
    expect(state.historyToggleLabel.value).toBe("收回历史对话");
  });
});
