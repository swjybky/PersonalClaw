export const navigationItems = [
  {
    key: "conversation",
    label: "新建对话",
    eyebrow: "个人任务管理智能体",
    title: "新建对话",
    phase: "Phase 1",
    summary: "对话工作台通过 Agent Utility 接入 pi-ai 与 pi-agent-core，消息流经协议事件回传。",
    modules: ["对话入口", "任务草稿", "会话上下文", "pi runtime Adapter"]
  },
  {
    key: "task-center",
    label: "任务中心",
    eyebrow: "结构化任务工作台",
    title: "任务中心",
    phase: "Phase 2A",
    summary: "按目标、分析、方案、执行和结果五段管理任务，并维护分析与方案版本。",
    modules: ["任务列表", "结构化分析", "DAG 方案", "计划审批", "审计事件"]
  },
  {
    key: "model-config",
    label: "模型配置",
    eyebrow: "pi-ai 模型与密钥",
    title: "模型配置",
    phase: "Phase 1+",
    summary: "为 pi-ai 配置默认模型、provider 与 API key。密钥仅写入主进程，Renderer 只持有 secretRef。",
    modules: ["模型列表", "默认模型", "Provider", "API Key"]
  },
  {
    key: "project-config",
    label: "项目配置",
    eyebrow: "项目目录",
    title: "项目配置",
    phase: "Phase 1+",
    summary: "管理项目名称、工作目录与背景介绍。",
    modules: ["项目名称", "项目路径", "项目介绍"]
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
export const settingsNavigationItem = {
  key: "settings",
  label: "设置",
  eyebrow: "应用设置",
  title: "设置",
  phase: "Phase 1+",
  summary: "用于配置个人智能体的系统提示词、运行偏好和应用级选项。当前页面仅提供 Renderer 侧编辑草稿。",
  modules: ["系统提示词", "运行偏好", "隐私", "诊断"]
} as const;

export type AppNavigationItem = NavigationItem | typeof settingsNavigationItem;
export type NavigationKey = NavigationItem["key"] | typeof settingsNavigationItem.key;

export const defaultNavigationKey: NavigationKey = "conversation";

export function getNavigationItem(key: NavigationKey): AppNavigationItem {
  if (key === settingsNavigationItem.key) {
    return settingsNavigationItem;
  }

  const item = navigationItems.find((candidate) => candidate.key === key);

  if (!item) {
    throw new Error(`Unknown navigation key: ${key}`);
  }

  return item;
}
