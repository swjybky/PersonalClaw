<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NConfigProvider, NTag } from "naive-ui";
import type { UiMessage, UiToolCall } from "@personal-claw/chat-ui-adapter";
import type { PiRuntimeRef, SystemEventEnvelope } from "@personal-claw/contracts";
import AgentConversation from "./components/AgentConversation.vue";
import ModelConfig from "./components/ModelConfig.vue";
import {
  buildConversationHistoryRecord,
  createConversationSessionId,
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
import { useTaskPaneCollapse } from "./taskPane";

interface HistoryItem {
  id: string;
  title: string;
  detail: string;
  isActive: boolean;
}

interface TaskProgressItem {
  id: string;
  label: string;
  status: "done" | "active" | "pending";
}

interface DetailRow {
  id: string;
  label: string;
  value: string;
}

const system = useSystemStore();
const modelConfig = useModelConfigStore();
const activeSessionId = ref(createConversationSessionId());
const activeNavigationKey = ref<NavigationKey>(defaultNavigationKey);
const composerDraft = ref("");
const { isTaskPaneCollapsed, taskPaneToggleLabel, toggleTaskPane } = useTaskPaneCollapse();
const assistantMessageByRun = new Map<string, string>();
let skipNextHistoryPersist = false;
const messages = ref<UiMessage[]>(createDefaultConversationMessages());

const toolCalls = ref<UiToolCall[]>([
  {
    id: "tool-policy-1",
    name: "pi-agent-core",
    status: "completed",
    summary: "Agent Utility 已接入，工具调用仍等待 Policy Engine"
  }
]);

const historyRecords = ref<ConversationHistoryRecord[]>([]);

const taskProgressItems: readonly TaskProgressItem[] = [
  { id: "task-intake", label: "任务输入", status: "done" },
  { id: "task-analysis", label: "需求分析", status: "active" },
  { id: "task-plan", label: "执行方案", status: "pending" },
  { id: "task-run", label: "执行验证", status: "pending" }
];

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

const activeNavigation = computed(() => getNavigationItem(activeNavigationKey.value));
const isFullBleedView = computed(
  () => activeNavigationKey.value === "conversation" || activeNavigationKey.value === "model-config"
);
const actionNavItems = computed(() =>
  navigationItems.filter((item) => item.key === "conversation" || item.key === "model-config")
);
const configNavItems = computed(() =>
  navigationItems.filter((item) => item.key !== "conversation" && item.key !== "model-config")
);
const modelLabel = computed(() => modelConfig.defaultSummary?.label ?? "本地 Faux");
const modeLabel = computed(() => (modelConfig.hasRealProvider ? "已配置模型" : "本地模式"));
const historyItems = computed<HistoryItem[]>(() =>
  historyRecords.value.map((record) => ({
    id: record.id,
    title: record.title,
    detail: record.detail,
    isActive: record.id === activeSessionId.value
  }))
);
const workerRows = computed(() => system.health?.workers ?? []);
const overallStatus = computed(() => system.health?.status ?? "starting");
const taskProgressPercent = computed(() => {
  const completed = taskProgressItems.filter((item) => item.status === "done").length;
  const active = taskProgressItems.some((item) => item.status === "active") ? 0.5 : 0;

  return Math.round(((completed + active) / taskProgressItems.length) * 100);
});

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

function startNewConversation(): void {
  activeSessionId.value = createConversationSessionId();
  composerDraft.value = "";
  assistantMessageByRun.clear();
  skipNextHistoryPersist = true;
  messages.value = createDefaultConversationMessages();
  activeNavigationKey.value = "conversation";
  persistActiveConversation();
}

function createDefaultConversationMessages(): UiMessage[] {
  return [
    {
      id: "message-system-1",
      role: "system",
      content: "个人任务管理智能体已接入 pi-agent-core。当前仍保持桌面端进程边界。",
      createdAt: new Date("2026-07-03T09:00:00+08:00").toISOString()
    },
    {
      id: "message-assistant-1",
      role: "assistant",
      content: "可以直接描述一个任务，我会通过 Agent Utility 把它整理成任务草稿。",
      createdAt: new Date("2026-07-03T09:01:00+08:00").toISOString()
    }
  ];
}

function initializeConversationHistory(): void {
  const loadedRecords = loadConversationHistory();

  if (loadedRecords.length > 0) {
    const [latestRecord] = loadedRecords;

    if (!latestRecord) {
      throw new Error("历史记录加载失败。");
    }

    historyRecords.value = loadedRecords;
    activeSessionId.value = latestRecord.id;
    skipNextHistoryPersist = true;
    messages.value = latestRecord.messages.map((message) => ({ ...message }));
    return;
  }

  persistActiveConversation();
}

function persistActiveConversation(): void {
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
  skipNextHistoryPersist = true;
  messages.value = record.messages.map((message) => ({ ...message }));
}

function ensureAssistantMessage(runId: string, runtime?: PiRuntimeRef): string {
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
      content: runtime?.mode === "provider" ? "" : "正在通过本地 pi faux provider 生成任务草稿...",
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
  messages.value = messages.value.map((message) =>
    message.id === messageId
      ? {
          ...message,
          content:
            message.content === "正在通过本地 pi faux provider 生成任务草稿..."
              ? delta
              : `${message.content}${delta}`,
          createdAt: new Date().toISOString()
        }
      : message
  );
}

function handleAgentEvent(event: SystemEventEnvelope): void {
  if (event.type === "agent.message_delta") {
    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    const messageId = ensureAssistantMessage(event.payload.runId, event.payload.runtime);
    appendAssistantDelta(messageId, event.payload.delta);
    return;
  }

  if (event.type === "agent.message_completed") {
    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    const messageId = ensureAssistantMessage(event.payload.runId, event.payload.runtime);
    updateAssistantMessage(messageId, event.payload.content);
    return;
  }

  if (event.type === "tool.call_requested") {
    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    toolCalls.value = [
      {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        status: "requested" as const,
        summary: "已拦截，等待 Policy Engine 审批"
      },
      ...toolCalls.value
    ].slice(0, 6);
    return;
  }

  if (event.type === "agent.error") {
    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    const messageId = ensureAssistantMessage(event.payload.runId, event.payload.runtime);
    updateAssistantMessage(messageId, `Agent 运行失败：${event.payload.message}`);
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

  try {
    const accepted = await window.personalClaw.session.prompt({
      sessionId: activeSessionId.value,
      message: content
    });
    ensureAssistantMessage(accepted.runId, accepted.runtime);
  } catch (error) {
    messages.value = [
      ...messages.value,
      {
        id: `message-assistant-error-${Date.now()}`,
        role: "assistant",
        content: error instanceof Error ? error.message : "Agent 命令提交失败。",
        createdAt: new Date().toISOString()
      }
    ];
  }
}

onMounted(() => {
  initializeConversationHistory();
  system.subscribe();
  void system.refreshHealth();
  void modelConfig.refresh();
});

watch(
  () => system.events[0],
  (event) => {
    if (event) {
      handleAgentEvent(event);
    }
  }
);

watch(messages, () => {
  if (skipNextHistoryPersist) {
    skipNextHistoryPersist = false;
    return;
  }

  persistActiveConversation();
}, { deep: true });

onBeforeUnmount(() => {
  system.teardown();
});
</script>

<template>
  <NConfigProvider>
    <main class="desktop-shell" :class="{ 'is-task-pane-collapsed': isTaskPaneCollapsed }">
      <aside class="left-rail" aria-label="工作区导航">
        <div class="brand-row">
          <img class="brand-mark" src="/icon-128.png" width="28" height="28" alt="PersonalClaw" />
          <div>
            <strong>PersonalClaw</strong>
            <span>个人任务管理</span>
          </div>
        </div>

        <div class="action-group" aria-label="主操作">
          <button
            v-for="item in actionNavItems"
            :key="item.key"
            type="button"
            class="nav-action"
            :class="{ 'is-active': activeNavigationKey === item.key }"
            :aria-current="activeNavigationKey === item.key ? 'page' : undefined"
            :data-nav-key="item.key"
            @click="selectNavigation(item.key)"
          >
            <svg
              v-if="item.key === 'conversation'"
              viewBox="0 0 24 24"
              class="nav-action-icon"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              class="nav-action-icon"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <span>{{ item.label }}</span>
          </button>
        </div>

        <nav class="primary-nav" aria-label="功能入口">
          <button
            v-for="item in configNavItems"
            :key="item.key"
            type="button"
            class="nav-item"
            :class="{ 'is-active': activeNavigationKey === item.key }"
            :aria-current="activeNavigationKey === item.key ? 'page' : undefined"
            :data-nav-key="item.key"
            @click="selectNavigation(item.key)"
          >
            <span class="nav-dot" aria-hidden="true"></span>
            {{ item.label }}
          </button>
        </nav>

        <section class="history-section" aria-label="历史对话">
          <div class="section-label">历史对话</div>
          <button
            v-for="item in historyItems"
            :key="item.id"
            type="button"
            class="history-item"
            :class="{ 'is-active': item.isActive }"
            @click="selectHistory(item.id)"
          >
            <strong>{{ item.title }}</strong>
            <span>{{ item.detail }}</span>
          </button>
        </section>
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
          :model-label="modelLabel"
          :mode-label="modeLabel"
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
