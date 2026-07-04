import { describe, expect, it } from "vitest";
import { useTaskPaneCollapse } from "../../apps/desktop/src/renderer/src/taskPane";

describe("task pane collapse state", () => {
  it("starts collapsed and toggles the task information pane", () => {
    const state = useTaskPaneCollapse();

    expect(state.isTaskPaneCollapsed.value).toBe(true);
    expect(state.taskPaneToggleLabel.value).toBe("展开任务信息栏");

    state.toggleTaskPane();

    expect(state.isTaskPaneCollapsed.value).toBe(false);
    expect(state.taskPaneToggleLabel.value).toBe("收回任务信息栏");

    state.collapseTaskPane();

    expect(state.isTaskPaneCollapsed.value).toBe(true);
    expect(state.taskPaneToggleLabel.value).toBe("展开任务信息栏");

    state.toggleTaskPane();

    expect(state.isTaskPaneCollapsed.value).toBe(false);
    expect(state.taskPaneToggleLabel.value).toBe("收回任务信息栏");
  });
});
