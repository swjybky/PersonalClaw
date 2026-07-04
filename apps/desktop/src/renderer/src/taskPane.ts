import { computed, ref, type ComputedRef, type Ref } from "vue";

interface TaskPaneCollapseState {
  isTaskPaneCollapsed: Ref<boolean>;
  taskPaneToggleLabel: ComputedRef<string>;
  collapseTaskPane: () => void;
  toggleTaskPane: () => void;
}

export function useTaskPaneCollapse(): TaskPaneCollapseState {
  const isTaskPaneCollapsed = ref(true);
  const taskPaneToggleLabel = computed(() =>
    isTaskPaneCollapsed.value ? "展开任务信息栏" : "收回任务信息栏"
  );

  function collapseTaskPane(): void {
    isTaskPaneCollapsed.value = true;
  }

  function toggleTaskPane(): void {
    isTaskPaneCollapsed.value = !isTaskPaneCollapsed.value;
  }

  return {
    isTaskPaneCollapsed,
    taskPaneToggleLabel,
    collapseTaskPane,
    toggleTaskPane
  };
}
