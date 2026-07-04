import { computed, ref, type ComputedRef, type Ref } from "vue";

interface SidebarCollapseState {
  isSidebarCollapsed: Ref<boolean>;
  sidebarToggleLabel: ComputedRef<string>;
  toggleSidebar: () => void;
}

interface HistorySectionCollapseState {
  isHistoryCollapsed: Ref<boolean>;
  historyToggleLabel: ComputedRef<string>;
  toggleHistory: () => void;
}

export function useSidebarCollapse(): SidebarCollapseState {
  const isSidebarCollapsed = ref(false);
  const sidebarToggleLabel = computed(() => (isSidebarCollapsed.value ? "展开左侧栏" : "收回左侧栏"));

  function toggleSidebar(): void {
    isSidebarCollapsed.value = !isSidebarCollapsed.value;
  }

  return {
    isSidebarCollapsed,
    sidebarToggleLabel,
    toggleSidebar
  };
}

export function useHistorySectionCollapse(): HistorySectionCollapseState {
  const isHistoryCollapsed = ref(false);
  const historyToggleLabel = computed(() =>
    isHistoryCollapsed.value ? "展开历史对话" : "收回历史对话"
  );

  function toggleHistory(): void {
    isHistoryCollapsed.value = !isHistoryCollapsed.value;
  }

  return {
    isHistoryCollapsed,
    historyToggleLabel,
    toggleHistory
  };
}
