<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { NConfigProvider, NTag } from "naive-ui";
import type { UiMessage, UiToolCall } from "@personal-claw/chat-ui-adapter";
import AgentConversation from "./components/AgentConversation.vue";
import {
  defaultNavigationKey,
  getNavigationItem,
  navigationItems,
  type NavigationKey
} from "./navigation";
import { useSystemStore } from "./stores/system";

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
const activeNavigationKey = ref<NavigationKey>(defaultNavigationKey);
const composerDraft = ref("");
const messages = ref<UiMessage[]>([
  {
    id: "message-system-1",
    role: "system",
    content: "个人任务管理智能体已就绪。当前桌面端保持 Phase 0 进程边界。",
    createdAt: new Date("2026-07-03T09:00:00+08:00").toISOString()
  },
  {
    id: "message-assistant-1",
    role: "assistant",
    content: "可以直接描述一个任务，我会把它放入对话工作台。",
    createdAt: new Date("2026-07-03T09:01:00+08:00").toISOString()
  }
]);

const toolCalls = ref<UiToolCall[]>([
  {
    id: "tool-policy-1",
    name: "Policy Engine",
    status: "requested",
    summary: "等待后续阶段接入审批链路"
  }
]);

const historyItems = ref<HistoryItem[]>([
  {
    id: "history-1",
    title: "个人claw运行时管理",
    detail: "Core / Agent / Tool 健康检查",
    isActive: true
  },
  {
    id: "history-2",
    title: "需求系统运行管理",
    detail: "项目目录与任务来源规划",
    isActive: false
  },
  {
    id: "history-3",
    title: "中转站",
    detail: "待归类的个人任务输入",
    isActive: false
  }
]);

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
  activeNavigationKey.value = key;
}

function sendConversationMessage(content: string): void {
  const now = new Date().toISOString();
  const nextIndex = messages.value.length + 1;

  messages.value = [
    ...messages.value,
    {
      id: `message-user-${nextIndex}`,
      role: "user",
      content,
      createdAt: now
    },
    {
      id: `message-assistant-${nextIndex}`,
      role: "assistant",
      content: "已记录到当前对话。后续阶段会把它转成 Task、Plan 和 Run。",
      createdAt: now
    }
  ];
  composerDraft.value = "";
  historyItems.value = [
    {
      id: `history-${Date.now()}`,
      title: content.slice(0, 18),
      detail: "刚刚创建的对话",
      isActive: true
    },
    ...historyItems.value.map((item) => ({ ...item, isActive: false }))
  ].slice(0, 8);
}

onMounted(() => {
  system.subscribe();
  void system.refreshHealth();
});

onBeforeUnmount(() => {
  system.teardown();
});
</script>

<template>
  <NConfigProvider>
    <main class="desktop-shell">
      <aside class="left-rail" aria-label="工作区导航">
        <div class="brand-row">
          <img class="brand-mark" src="/icon-128.png" width="28" height="28" alt="PersonalClaw" />
          <div>
            <strong>PersonalClaw</strong>
            <span>个人任务管理</span>
          </div>
        </div>

        <nav class="primary-nav" aria-label="功能入口">
          <button
            v-for="item in navigationItems"
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
          >
            <strong>{{ item.title }}</strong>
            <span>{{ item.detail }}</span>
          </button>
        </section>
      </aside>

      <section class="center-pane" aria-label="主工作区">
        <header class="pane-header">
          <div>
            <p class="eyebrow">{{ activeNavigation.eyebrow }}</p>
            <h1>{{ activeNavigation.title }}</h1>
          </div>
          <NTag :type="activeNavigation.phase === 'Phase 0' ? 'success' : 'warning'" round>
            {{ activeNavigation.phase }}
          </NTag>
        </header>

        <AgentConversation
          v-if="activeNavigationKey === 'conversation'"
          v-model:draft="composerDraft"
          :messages="messages"
          :tool-calls="toolCalls"
          @send="sendConversationMessage"
        />

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

      <aside class="right-pane" aria-label="任务信息">
        <section class="task-panel">
          <div class="task-heading">
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
      </aside>
    </main>
  </NConfigProvider>
</template>
