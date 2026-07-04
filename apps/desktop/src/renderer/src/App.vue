<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NConfigProvider, NDropdown, NTag } from "naive-ui";
import type { DropdownOption } from "naive-ui";
import type { UiMessage, UiToolCall } from "@personal-claw/chat-ui-adapter";
import type {
  PiRuntimeRef,
  SystemEventEnvelope,
  TaskDraftPreview,
  ThinkingLevel
} from "@personal-claw/contracts";
import AgentConversation from "./components/AgentConversation.vue";
import ModelConfig from "./components/ModelConfig.vue";
import {
  buildConversationHistoryRecord,
  createConversationSessionId,
  hasUserMessage,
  loadConversationHistory,
  saveConversationHistory,
  upsertConversationHistory,
  type ConversationHistoryRecord
} from "./conversationHistory";
import {
  defaultNavigationKey,
  getNavigationItem,
  navigationItems,
  type NavigationKey
} from "./navigation";
import { useSystemStore } from "./stores/system";
import { useModelConfigStore } from "./stores/modelConfig";
import { useHistorySectionCollapse, useSidebarCollapse } from "./sidebarPane";
import { useTaskPaneCollapse } from "./taskPane";
import {
  buildTaskProgressItems,
  summarizeTaskDraft,
  taskProgressPercent as calculateTaskProgressPercent
} from "./taskDraftPreview";
import {
  defaultThinkingLevelForModel,
  resolveThinkingLevelForModel,
  supportsThinkingLevel
} from "./modelCapabilities";

interface HistoryItem {
  id: string;
  title: string;
  detail: string;
  isActive: boolean;
}

interface DetailRow {
  id: string;
  label: string;
  value: string;
}

interface ActiveAgentRun {
  sessionId: string;
  runId: string;
  startedAtMs: number;
}

const system = useSystemStore();
const modelConfig = useModelConfigStore();
const activeSessionId = ref(createConversationSessionId());
const activeNavigationKey = ref<NavigationKey>(defaultNavigationKey);
const composerDraft = ref("");
const thinkingLevel = ref<ThinkingLevel>("off");
const { isSidebarCollapsed, sidebarToggleLabel, toggleSidebar } = useSidebarCollapse();
const { isHistoryCollapsed, historyToggleLabel, toggleHistory } = useHistorySectionCollapse();
const { isTaskPaneCollapsed, taskPaneToggleLabel, toggleTaskPane } = useTaskPaneCollapse();
const assistantMessageByRun = new Map<string, string>();
const finishedAgentRunKeys = new Set<string>();
const handledEventIds = new Set<string>();
const agentRunTimeouts = new Map<string, number>();
let skipNextHistoryPersist = false;
const messages = ref<UiMessage[]>(createDefaultConversationMessages());
const activeAgentRuns = ref<ActiveAgentRun[]>([]);
const toolCalls = ref<UiToolCall[]>([]);
const latestTaskDraft = ref<TaskDraftPreview | null>(null);
const latestAgentDiagnostic = ref<string | null>(null);
const latestThinkingPreview = ref("");
const lastRunDurationMs = ref<number | null>(null);
const elapsedNowMs = ref(Date.now());
let elapsedTimerId: number | undefined;

const historyRecords = ref<ConversationHistoryRecord[]>([]);

const projectRows: readonly DetailRow[] = [
  { id: "project-name", label: "项目名称", value: "PersonalClaw" },
  { id: "project-root", label: "个人项目目录", value: "/home/swj/project/ai/PersonalClaw/repo" },
  { id: "artifact-root", label: "产物目录", value: "应用数据目录 / artifacts" },
  { id: "scope", label: "权限范围", value: "项目目录内受控读写" }
];

const sourceRows: readonly DetailRow[] = [
  { id: "manual", label: "手动输入", value: "启用" },
  { id: "schedule", label: "定时任务", value: "待 Core Scheduler 接入" },
  { id: "missed", label: "错过策略", value: "run_once_now / skip" },
  { id: "identity", label: "幂等键", value: "occurrenceId + sourceId" }
];

const codeAgentRows: readonly DetailRow[] = [
  { id: "kimi", label: "Kimi", value: "可配置模型入口" },
  { id: "cursor", label: "Cursor", value: "可配置桌面代码助手" },
  { id: "claude-code", label: "Claude Code", value: "可配置 CLI Agent" },
  { id: "codex", label: "Codex", value: "可配置 CLI Agent" }
];

const navigationShortcutByKey: Partial<Record<NavigationKey, string>> = {
  conversation: "Ctrl+N"
};

const activeNavigation = computed(() => getNavigationItem(activeNavigationKey.value));
const isFullBleedView = computed(
  () => activeNavigationKey.value === "conversation" || activeNavigationKey.value === "model-config"
);
const modelLabel = computed(() => modelConfig.defaultSummary?.label ?? "本地 Faux");
const modeLabel = computed(() => (modelConfig.hasRealProvider ? "个人任务助手" : "本地模式"));
const activeModelSupportsThinking = computed(() => supportsThinkingLevel(modelConfig.defaultSummary));
const effectiveThinkingLevel = computed(() =>
  resolveThinkingLevelForModel(modelConfig.defaultSummary, thinkingLevel.value)
);
const isConversationStreaming = computed(() =>
  activeAgentRuns.value.some((run) => run.sessionId === activeSessionId.value)
);
const activeConversationRun = computed(() =>
  activeAgentRuns.value.find((run) => run.sessionId === activeSessionId.value)
);
const workStatusLabel = computed(() => {
  const activeRun = activeConversationRun.value;

  if (activeRun) {
    return `Working for ${formatRunDuration(elapsedNowMs.value - activeRun.startedAtMs)}`;
  }

  if (lastRunDurationMs.value !== null) {
    return `Worked for ${formatRunDuration(lastRunDurationMs.value)}`;
  }

  return "";
});
const historyItems = computed<HistoryItem[]>(() =>
  historyRecords.value.map((record) => ({
    id: record.id,
    title: record.title,
    detail: record.detail,
    isActive: record.id === activeSessionId.value
  }))
);
const historyActionOptions: DropdownOption[] = [{ label: "删除", key: "delete" }];
const workerRows = computed(() => system.health?.workers ?? []);
const overallStatus = computed(() => system.health?.status ?? "starting");
const isTaskDraftRunning = computed(() => activeConversationRun.value !== undefined && latestTaskDraft.value === null);
const taskProgressItems = computed(() =>
  buildTaskProgressItems(latestTaskDraft.value, isTaskDraftRunning.value)
);
const latestTaskDraftSummary = computed(() => summarizeTaskDraft(latestTaskDraft.value));
const taskProgressPercent = computed(() => calculateTaskProgressPercent(taskProgressItems.value));

function statusType(status: string): "success" | "warning" | "error" | "default" {
  if (status === "ok" || status === "ready") {
    return "success";
  }

  if (status === "starting") {
    return "warning";
  }

  if (status === "stopped" || status === "degraded") {
    return "error";
  }

  return "default";
}

function selectNavigation(key: NavigationKey): void {
  if (key === "conversation") {
    startNewConversation();
    return;
  }

  activeNavigationKey.value = key;
}

function openModelConfig(): void {
  activeNavigationKey.value = "model-config";
}

function updateThinkingLevel(value: ThinkingLevel): void {
  thinkingLevel.value = activeModelSupportsThinking.value ? value : "off";
}

function formatRunDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function removeHistorySession(sessionId: string): void {
  const nextRecords = historyRecords.value.filter((record) => record.id !== sessionId);

  if (nextRecords.length === historyRecords.value.length) {
    return;
  }

  historyRecords.value = nextRecords;
  saveConversationHistory(historyRecords.value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function redactDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 12).map(redactDiagnosticValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (/api.?key|authorization|bearer|cookie|password|secret|token/i.test(key)) {
      redacted[key] = "[redacted]";
      continue;
    }

    redacted[key] = redactDiagnosticValue(item);
  }

  return redacted;
}

function stringifyDiagnosticDetails(details: unknown): string | undefined {
  if (details === undefined) {
    return undefined;
  }

  if (typeof details === "string") {
    return details.slice(0, 1200);
  }

  try {
    return JSON.stringify(redactDiagnosticValue(details), null, 2).slice(0, 1200);
  } catch {
    return String(details).slice(0, 1200);
  }
}

function stringifyToolCallSummary(args: unknown): string {
  const prefix = "已拦截，等待 Policy Engine 审批";

  if (args === undefined) {
    return prefix;
  }

  try {
    const details = JSON.stringify(redactDiagnosticValue(args), null, 2);

    return `${prefix} · 参数 ${details.slice(0, 180)}`;
  } catch (error: unknown) {
    return `${prefix} · 参数 ${String(error instanceof Error ? error.message : args).slice(0, 180)}`;
  }
}

function formatAgentDiagnostic(event: Extract<SystemEventEnvelope, { type: "agent.error" }>): string {
  const lines = [
    `code: ${event.payload.code}`,
    `message: ${event.payload.message}`
  ];

  if (event.payload.runtime) {
    lines.push(`provider: ${event.payload.runtime.provider}`);
    lines.push(`model: ${event.payload.runtime.model}`);
    lines.push(`mode: ${event.payload.runtime.mode}`);
  }

  const details = stringifyDiagnosticDetails(event.payload.details);

  if (details) {
    lines.push("details:");
    lines.push(details);
  }

  return lines.join("\n");
}

function deleteHistorySession(sessionId: string): void {
  removeHistorySession(sessionId);

  if (sessionId !== activeSessionId.value) {
    return;
  }

  activeSessionId.value = createConversationSessionId();
  composerDraft.value = "";
  assistantMessageByRun.clear();
  toolCalls.value = [];
  latestTaskDraft.value = null;
  latestAgentDiagnostic.value = null;
  latestThinkingPreview.value = "";
  lastRunDurationMs.value = null;
  skipNextHistoryPersist = true;
  messages.value = createDefaultConversationMessages();
  activeNavigationKey.value = "conversation";
}

function handleHistoryAction(sessionId: string, actionKey: string | number): void {
  if (actionKey === "delete") {
    deleteHistorySession(sessionId);
    return;
  }

  throw new Error(`未知历史对话操作：${String(actionKey)}`);
}

function startNewConversation(): void {
  collapseTaskPane();

  if (!hasUserMessage(messages.value)) {
    removeHistorySession(activeSessionId.value);
  }

  activeSessionId.value = createConversationSessionId();
  composerDraft.value = "";
  assistantMessageByRun.clear();
  toolCalls.value = [];
  latestTaskDraft.value = null;
  latestAgentDiagnostic.value = null;
  latestThinkingPreview.value = "";
  lastRunDurationMs.value = null;
  skipNextHistoryPersist = true;
  messages.value = createDefaultConversationMessages();
  activeNavigationKey.value = "conversation";
}

function createDefaultConversationMessages(): UiMessage[] {
  return [];
}

function initializeConversationHistory(): void {
  const loadedRecords = loadConversationHistory().filter((record) => hasUserMessage(record.messages));

  if (loadedRecords.length > 0) {
    const [latestRecord] = loadedRecords;

    if (!latestRecord) {
      throw new Error("历史记录加载失败。");
    }

    historyRecords.value = loadedRecords;
    saveConversationHistory(historyRecords.value);
    activeSessionId.value = latestRecord.id;
    skipNextHistoryPersist = true;
    messages.value = latestRecord.messages.map((message) => ({ ...message }));
    return;
  }

  historyRecords.value = [];
  saveConversationHistory(historyRecords.value);
}

function persistActiveConversation(): void {
  if (!hasUserMessage(messages.value)) {
    return;
  }

  const record = buildConversationHistoryRecord({
    id: activeSessionId.value,
    messages: messages.value
  });

  historyRecords.value = upsertConversationHistory(record, historyRecords.value);
  saveConversationHistory(historyRecords.value);
}

function selectHistory(id: string): void {
  const record = historyRecords.value.find((item) => item.id === id);

  if (!record) {
    throw new Error(`未找到历史对话：${id}`);
  }

  activeSessionId.value = record.id;
  activeNavigationKey.value = "conversation";
  composerDraft.value = "";
  assistantMessageByRun.clear();
  toolCalls.value = [];
  latestTaskDraft.value = null;
  latestAgentDiagnostic.value = null;
  latestThinkingPreview.value = "";
  lastRunDurationMs.value = null;
  skipNextHistoryPersist = true;
  messages.value = record.messages.map((message) => ({ ...message }));
}

function agentRunKey(sessionId: string, runId: string): string {
  return `${sessionId}:${runId}`;
}

function markRunStreaming(sessionId: string, runId: string): void {
  const key = agentRunKey(sessionId, runId);

  if (finishedAgentRunKeys.has(key)) {
    return;
  }

  if (activeAgentRuns.value.some((run) => run.sessionId === sessionId && run.runId === runId)) {
    return;
  }

  activeAgentRuns.value = [...activeAgentRuns.value, { sessionId, runId, startedAtMs: Date.now() }];
}

function finishRun(sessionId: string, runId: string): void {
  const key = agentRunKey(sessionId, runId);
  const timeoutId = agentRunTimeouts.get(key);
  const activeRun = activeAgentRuns.value.find(
    (run) => run.sessionId === sessionId && run.runId === runId
  );

  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId);
    agentRunTimeouts.delete(key);
  }

  if (activeRun && sessionId === activeSessionId.value) {
    lastRunDurationMs.value = Math.max(0, Date.now() - activeRun.startedAtMs);
  }

  finishedAgentRunKeys.add(key);
  activeAgentRuns.value = activeAgentRuns.value.filter(
    (run) => run.sessionId !== sessionId || run.runId !== runId
  );
}

function watchRunProgress(sessionId: string, runId: string): void {
  const key = agentRunKey(sessionId, runId);

  if (agentRunTimeouts.has(key)) {
    return;
  }

  const timeoutId = window.setTimeout(() => {
    if (finishedAgentRunKeys.has(key)) {
      return;
    }

    finishRun(sessionId, runId);

    if (sessionId !== activeSessionId.value) {
      return;
    }

    const messageId = ensureAssistantMessage(runId);
    latestAgentDiagnostic.value =
      "code: renderer.agent_event_timeout\nmessage: Agent 已接受请求，但超过 60 秒没有收到模型输出或错误事件。请检查模型配置、API Key、网络，或查看右侧最近事件。";
    updateAssistantMessage(
      messageId,
      latestAgentDiagnostic.value
    );
  }, 60_000);

  agentRunTimeouts.set(key, timeoutId);
}

function ensureAssistantMessage(runId: string): string {
  const existingId = assistantMessageByRun.get(runId);

  if (existingId) {
    return existingId;
  }

  const id = `message-assistant-${runId}`;
  assistantMessageByRun.set(runId, id);
  messages.value = [
    ...messages.value,
    {
      id,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString()
    }
  ];

  return id;
}

function updateAssistantMessage(messageId: string, nextContent: string): void {
  messages.value = messages.value.map((message) =>
    message.id === messageId
      ? {
          ...message,
          content: nextContent,
          createdAt: new Date().toISOString()
        }
      : message
  );
}

function appendAssistantDelta(messageId: string, delta: string): void {
  if (!delta) {
    return;
  }

  messages.value = messages.value.map((message) =>
    message.id === messageId
      ? {
          ...message,
          content: `${message.content}${delta}`,
          createdAt: new Date().toISOString()
        }
      : message
  );
}

function handleAgentEvent(event: SystemEventEnvelope): void {
  if (handledEventIds.has(event.id)) {
    return;
  }

  handledEventIds.add(event.id);
  if (handledEventIds.size > 200) {
    const [oldestEventId] = handledEventIds;
    if (oldestEventId) {
      handledEventIds.delete(oldestEventId);
    }
  }

  if (event.type === "agent.message_delta") {
    markRunStreaming(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    latestAgentDiagnostic.value = null;

    const messageId = ensureAssistantMessage(event.payload.runId);
    appendAssistantDelta(messageId, event.payload.delta);
    return;
  }

  if (event.type === "agent.thinking_delta") {
    markRunStreaming(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    latestThinkingPreview.value = `${latestThinkingPreview.value}${event.payload.delta}`.slice(-2000);
    return;
  }

  if (event.type === "agent.message_completed") {
    finishRun(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    latestAgentDiagnostic.value = null;
    const messageId = ensureAssistantMessage(event.payload.runId);
    if (event.payload.content.trim()) {
      updateAssistantMessage(messageId, event.payload.content);
    }
    return;
  }

  if (event.type === "tool.call_requested") {
    markRunStreaming(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    toolCalls.value = [
      {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        status: "requested" as const,
        summary: stringifyToolCallSummary(event.payload.args)
      },
      ...toolCalls.value
    ].slice(0, 6);
    return;
  }

  if (event.type === "task.draft_created") {
    finishRun(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    latestTaskDraft.value = event.payload.draft;
    latestAgentDiagnostic.value = null;

    if (isTaskPaneCollapsed.value) {
      toggleTaskPane();
    }
    return;
  }

  if (event.type === "agent.error") {
    finishRun(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    const messageId = ensureAssistantMessage(event.payload.runId);
    const diagnostic = formatAgentDiagnostic(event);
    latestAgentDiagnostic.value = diagnostic;
    updateAssistantMessage(messageId, `Agent 运行失败\n\n${diagnostic}`);
  }
}

async function sendConversationMessage(content: string): Promise<void> {
  const now = new Date().toISOString();
  const nextIndex = messages.value.length + 1;

  messages.value = [
    ...messages.value,
    {
      id: `message-user-${nextIndex}`,
      role: "user",
      content,
      createdAt: now
    }
  ];
  composerDraft.value = "";
  latestAgentDiagnostic.value = null;
  latestTaskDraft.value = null;
  latestThinkingPreview.value = "";
  lastRunDurationMs.value = null;

  try {
    const accepted = await window.personalClaw.session.prompt({
      sessionId: activeSessionId.value,
      message: content,
      thinkingLevel: effectiveThinkingLevel.value
    });
    markRunStreaming(accepted.sessionId, accepted.runId);
    watchRunProgress(accepted.sessionId, accepted.runId);
    ensureAssistantMessage(accepted.runId);
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : "Agent 命令提交失败。";
    latestAgentDiagnostic.value = diagnostic;
    messages.value = [
      ...messages.value,
      {
        id: `message-assistant-error-${Date.now()}`,
        role: "assistant",
        content: diagnostic,
        createdAt: new Date().toISOString()
      }
    ];
  }
}

onMounted(() => {
  elapsedTimerId = window.setInterval(() => {
    elapsedNowMs.value = Date.now();
  }, 1000);
  initializeConversationHistory();
  system.subscribe(handleAgentEvent);
  void system.refreshHealth();
  void modelConfig.refresh();
});

watch(messages, () => {
  if (skipNextHistoryPersist) {
    skipNextHistoryPersist = false;
    return;
  }

  persistActiveConversation();
}, { deep: true });

watch(
  activeModelSupportsThinking,
  (canUseThinking) => {
    if (!canUseThinking) {
      thinkingLevel.value = "off";
      return;
    }

    if (thinkingLevel.value === "off") {
      thinkingLevel.value = defaultThinkingLevelForModel(modelConfig.defaultSummary);
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (elapsedTimerId !== undefined) {
    window.clearInterval(elapsedTimerId);
  }
  for (const timeoutId of agentRunTimeouts.values()) {
    window.clearTimeout(timeoutId);
  }
  agentRunTimeouts.clear();
  system.teardown();
});
</script>

<template>
  <NConfigProvider>
    <main
      class="desktop-shell"
      :class="{
        'is-sidebar-collapsed': isSidebarCollapsed,
        'is-task-pane-collapsed': isTaskPaneCollapsed
      }"
    >
      <aside class="left-rail" :class="{ 'is-collapsed': isSidebarCollapsed }" aria-label="工作区导航">
        <div class="sidebar-chrome">
          <div class="sidebar-toolbar">
            <button
              type="button"
              class="sidebar-pane-toggle"
              :class="{ 'is-collapsed': isSidebarCollapsed }"
              :aria-expanded="!isSidebarCollapsed"
              aria-controls="sidebar-content"
              :aria-label="sidebarToggleLabel"
              :title="sidebarToggleLabel"
              @click="toggleSidebar"
            >
              <span class="task-pane-toggle-icon sidebar-pane-toggle-icon" aria-hidden="true"></span>
            </button>
          </div>
        </div>

        <nav id="sidebar-content" class="sidebar-nav" aria-label="功能入口">
          <button
            v-for="item in navigationItems"
            :key="item.key"
            type="button"
            class="nav-item sidebar-nav-item"
            :class="{ 'is-active': activeNavigationKey === item.key }"
            :aria-current="activeNavigationKey === item.key ? 'page' : undefined"
            :data-nav-key="item.key"
            @click="selectNavigation(item.key)"
          >
            <span class="sidebar-nav-icon" aria-hidden="true">
              <svg v-if="item.key === 'conversation'" viewBox="0 0 24 24">
                <path d="M4 6l16-2-6 16-3-7-7-3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M11 13l4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <svg v-else-if="item.key === 'model-config'" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M19.8 7.5L17.2 9M6.8 15l-2.6 1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <svg v-else-if="item.key === 'project-config'" viewBox="0 0 24 24">
                <path d="M3.5 7.5h6l2 2H20.5v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              </svg>
              <svg v-else-if="item.key === 'task-sources'" viewBox="0 0 24 24">
                <rect x="5" y="5" width="14" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M9 3v4M15 3v4M8 11h8M8 15h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <svg v-else viewBox="0 0 24 24">
                <rect x="4" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <rect x="13" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <rect x="4" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M16.5 14.5v4M14.5 16.5h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
            </span>
            <span class="sidebar-nav-label">{{ item.label }}</span>
            <span v-if="navigationShortcutByKey[item.key]" class="sidebar-shortcut">
              {{ navigationShortcutByKey[item.key] }}
            </span>
          </button>
        </nav>

        <section class="history-section" :class="{ 'is-collapsed': isHistoryCollapsed }" aria-label="历史对话">
          <div class="history-section-header">
            <span class="section-label">历史对话</span>
            <button
              type="button"
              class="history-collapse-toggle"
              :class="{ 'is-collapsed': isHistoryCollapsed }"
              :aria-expanded="!isHistoryCollapsed"
              aria-controls="history-list"
              :aria-label="historyToggleLabel"
              :title="historyToggleLabel"
              @click="toggleHistory"
            >
              <span class="history-collapse-chevron" aria-hidden="true"></span>
            </button>
          </div>

          <div v-if="!isHistoryCollapsed" id="history-list" class="history-list">
            <div
              v-for="item in historyItems"
              :key="item.id"
              class="history-row"
              :class="{ 'is-active': item.isActive }"
            >
              <button
                type="button"
                class="history-item"
                :title="item.detail"
                @click="selectHistory(item.id)"
              >
                <span class="history-dot" aria-hidden="true"></span>
                <span class="history-title">{{ item.title }}</span>
              </button>
              <NDropdown
                trigger="click"
                placement="bottom-end"
                :options="historyActionOptions"
                @select="(key) => handleHistoryAction(item.id, key)"
              >
                <button
                  type="button"
                  class="history-action"
                  :aria-label="`历史对话操作：${item.title}`"
                  title="更多操作"
                >
                  <span aria-hidden="true"></span>
                </button>
              </NDropdown>
            </div>
            <p v-if="!historyItems.length" class="history-empty">
              <span class="history-dot is-muted" aria-hidden="true"></span>
              暂无历史对话
            </p>
          </div>
        </section>

        <div class="sidebar-footer">
          <div class="sidebar-account">
            <img class="sidebar-account-mark" src="/icon-128.png" width="30" height="30" alt="" />
            <div class="sidebar-account-copy">
              <strong>PersonalClaw</strong>
              <span>{{ modeLabel }}</span>
            </div>
            <button type="button" class="sidebar-footer-icon" title="模型配置" aria-label="模型配置" @click="openModelConfig">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M19.8 7.5L17.2 9M6.8 15l-2.6 1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <section class="center-pane" :class="{ 'is-full-bleed': isFullBleedView }" aria-label="主工作区">
        <header v-if="!isFullBleedView" class="pane-header">
          <div>
            <p class="eyebrow">{{ activeNavigation.eyebrow }}</p>
            <h1>{{ activeNavigation.title }}</h1>
          </div>
        </header>

        <AgentConversation
          v-if="activeNavigationKey === 'conversation'"
          v-model:draft="composerDraft"
          :messages="messages"
          :tool-calls="toolCalls"
          :is-streaming="isConversationStreaming"
          :model-label="modelLabel"
          :diagnostic-message="latestAgentDiagnostic"
          :thinking-preview="latestThinkingPreview"
          :thinking-level="thinkingLevel"
          :can-use-thinking="activeModelSupportsThinking"
          :work-status-label="workStatusLabel"
          @update:thinking-level="updateThinkingLevel"
          @send="sendConversationMessage"
          @open-model-config="openModelConfig"
        />

        <ModelConfig v-else-if="activeNavigationKey === 'model-config'" />

        <section v-else class="config-workspace" :aria-label="activeNavigation.title">
          <div class="config-summary">
            <p>{{ activeNavigation.summary }}</p>
            <div class="module-list">
              <span v-for="module in activeNavigation.modules" :key="module">{{ module }}</span>
            </div>
          </div>

          <div v-if="activeNavigationKey === 'project-config'" class="settings-list">
            <div v-for="row in projectRows" :key="row.id" class="settings-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>

          <div v-else-if="activeNavigationKey === 'task-sources'" class="settings-list">
            <div v-for="row in sourceRows" :key="row.id" class="settings-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>

          <div v-else class="settings-list">
            <div v-for="row in codeAgentRows" :key="row.id" class="settings-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>

      <aside class="right-pane" :class="{ 'is-collapsed': isTaskPaneCollapsed }" aria-label="任务信息">
        <button
          type="button"
          class="task-pane-toggle"
          :class="{ 'is-collapsed': isTaskPaneCollapsed }"
          :aria-expanded="!isTaskPaneCollapsed"
          aria-controls="task-information-content"
          :aria-label="taskPaneToggleLabel"
          :title="taskPaneToggleLabel"
          @click="toggleTaskPane"
        >
          <span class="task-pane-toggle-icon" aria-hidden="true"></span>
        </button>

        <div v-if="!isTaskPaneCollapsed" id="task-information-content" class="right-pane-content">
          <section class="task-panel">
            <div class="task-heading task-heading-with-toggle">
              <span>任务信息</span>
              <NTag type="info" size="small">分析中</NTag>
            </div>
            <h2>个人任务管理智能体</h2>
            <dl class="task-meta">
              <div>
                <dt>来源</dt>
                <dd>新建对话</dd>
              </div>
              <div>
                <dt>项目</dt>
                <dd>PersonalClaw</dd>
              </div>
              <div>
                <dt>自动化等级</dt>
                <dd>L0 建议</dd>
              </div>
            </dl>

            <div class="progress-block">
              <div>
                <span>完成进度</span>
                <strong>{{ taskProgressPercent }}%</strong>
              </div>
              <div class="progress-track" aria-hidden="true">
                <span :style="{ width: `${taskProgressPercent}%` }"></span>
              </div>
            </div>

            <ol class="progress-list">
              <li v-for="item in taskProgressItems" :key="item.id" :class="`is-${item.status}`">
                <span></span>
                {{ item.label }}
              </li>
            </ol>
          </section>

          <section class="task-panel">
            <div class="task-heading">
              <span>运行时</span>
              <NTag :type="statusType(overallStatus)" size="small">{{ overallStatus }}</NTag>
            </div>
            <div class="worker-list">
              <div v-for="worker in workerRows" :key="worker.name" class="worker-row">
                <div>
                  <strong>{{ worker.name }}</strong>
                  <small>PID {{ worker.pid ?? "pending" }}</small>
                </div>
                <NTag :type="statusType(worker.status)" size="small">
                  {{ worker.status }}
                </NTag>
              </div>
            </div>
            <p v-if="system.error" class="error-line">{{ system.error }}</p>
          </section>

          <section class="task-panel">
            <div class="task-heading">
              <span>最近事件</span>
              <small>{{ system.events.length }}</small>
            </div>
            <ol v-if="system.events.length" class="event-list">
              <li v-for="event in system.events.slice(0, 4)" :key="event.id">
                <time>{{ new Date(event.timestamp).toLocaleTimeString() }}</time>
                <span>{{ event.type }}</span>
              </li>
            </ol>
            <p v-else class="empty">等待系统事件。</p>
          </section>
        </div>
      </aside>
    </main>
  </NConfigProvider>
</template>
