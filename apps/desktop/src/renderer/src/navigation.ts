export const navigationItems = [
  {
    key: "conversation",
    label: "新建对话",
    eyebrow: "个人任务管理智能体",
    title: "新建对话",
    phase: "Phase 0",
    summary: "当前阶段提供对话工作台壳，后续由 pi-ai-web adapter 与 pi-agent 接管消息流。",
    modules: ["对话入口", "任务草稿", "会话上下文", "pi-ai-web Adapter"]
  },
  {
    key: "project-config",
    label: "项目配置",
    eyebrow: "项目目录",
    title: "项目配置",
    phase: "Phase 1+",
    summary: "用于配置个人项目目录、上下文边界、产物目录和默认权限范围。",
    modules: ["项目目录", "上下文说明", "产物目录", "权限范围"]
  },
  {
    key: "task-sources",
    label: "任务来源",
    eyebrow: "主动任务入口",
    title: "任务来源",
    phase: "Phase 5+",
    summary: "用于配置定时任务与外部来源轮询，首版仍需 Core 持久化调度支撑。",
    modules: ["定时获取", "来源规则", "错过策略", "幂等键"]
  },
  {
    key: "code-agent",
    label: "codeAgent",
    eyebrow: "代码智能体",
    title: "codeAgent",
    phase: "Phase 1+",
    summary: "用于配置支撑项目执行的代码智能体：Kimi、Cursor、Claude Code 和 Codex。",
    modules: ["Kimi", "Cursor", "Claude Code", "Codex"]
  }
] as const;

export type NavigationItem = (typeof navigationItems)[number];
export type NavigationKey = NavigationItem["key"];

export const defaultNavigationKey: NavigationKey = "conversation";

export function getNavigationItem(key: NavigationKey): NavigationItem {
  const item = navigationItems.find((candidate) => candidate.key === key);

  if (!item) {
    throw new Error(`Unknown navigation key: ${key}`);
  }

  return item;
}
