import { computed, ref, type ComputedRef, type Ref } from "vue";

interface TaskPaneCollapseState {
  isTaskPaneCollapsed: Ref<boolean>;
  taskPaneToggleLabel: ComputedRef<string>;
  toggleTaskPane: () => void;
}

export function useTaskPaneCollapse(): TaskPaneCollapseState {
  const isTaskPaneCollapsed = ref(false);
  const taskPaneToggleLabel = computed(() =>
    isTaskPaneCollapsed.value ? "展开任务信息栏" : "收回任务信息栏"
  );

  function toggleTaskPane(): void {
    isTaskPaneCollapsed.value = !isTaskPaneCollapsed.value;
  }

  return {
    isTaskPaneCollapsed,
    taskPaneToggleLabel,
    toggleTaskPane
  };
}
