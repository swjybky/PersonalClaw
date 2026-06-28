<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { NButton, NConfigProvider, NTag } from "naive-ui";
import { useSystemStore } from "./stores/system";

const system = useSystemStore();

const workerRows = computed(() => system.health?.workers ?? []);
const overallStatus = computed(() => system.health?.status ?? "starting");

const navigationItems = [
  "收件箱",
  "任务中心",
  "项目",
  "运行中心",
  "审批中心",
  "主动任务",
  "智能体",
  "设置"
];

const phaseModules = [
  "pnpm workspace",
  "Electron Main",
  "Preload API",
  "Vue Renderer",
  "Core Utility",
  "Agent Utility",
  "Tool Utility",
  "IPC Envelope"
];

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
    <main class="shell">
      <aside class="sidebar" aria-label="主导航">
        <div class="brand">
          <span class="brand-mark">PC</span>
          <div>
            <strong>PersonalClaw</strong>
            <span>Phase 0</span>
          </div>
        </div>
        <nav>
          <button v-for="item in navigationItems" :key="item" type="button" class="nav-item">
            {{ item }}
          </button>
        </nav>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">本地优先个人智能体</p>
            <h1>工程骨架与进程健康</h1>
          </div>
          <NButton type="primary" :loading="system.isLoading" @click="system.refreshHealth">
            刷新健康检查
          </NButton>
        </header>

        <section class="status-band">
          <div class="status-summary">
            <span>系统状态</span>
            <NTag :type="statusType(overallStatus)" round>
              {{ overallStatus }}
            </NTag>
            <small v-if="system.health">检查时间 {{ new Date(system.health.checkedAt).toLocaleTimeString() }}</small>
          </div>
          <p v-if="system.error" class="error-line">{{ system.error }}</p>
        </section>

        <section class="content-grid">
          <article class="panel">
            <div class="panel-heading">
              <h2>Utility Process</h2>
              <span>Core / Agent / Tool</span>
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
          </article>

          <article class="panel">
            <div class="panel-heading">
              <h2>Phase 0 模块</h2>
              <span>只搭边界，不做业务</span>
            </div>
            <div class="module-grid">
              <span v-for="module in phaseModules" :key="module">{{ module }}</span>
            </div>
          </article>

          <article class="panel timeline">
            <div class="panel-heading">
              <h2>事件流</h2>
              <span>来自 Main IPC Router</span>
            </div>
            <ol v-if="system.events.length" class="event-list">
              <li v-for="event in system.events" :key="event.id">
                <time>{{ new Date(event.timestamp).toLocaleTimeString() }}</time>
                <strong>{{ event.type }}</strong>
                <code>{{ event.id }}</code>
              </li>
            </ol>
            <p v-else class="empty">等待系统事件。</p>
          </article>
        </section>
      </section>
    </main>
  </NConfigProvider>
</template>
