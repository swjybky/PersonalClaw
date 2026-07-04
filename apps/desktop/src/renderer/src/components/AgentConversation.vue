<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  configurePiWebMessageEditor,
  configurePiWebMessageList,
  registerPiWebUiElements,
  type PiWebMessageEditorElement,
  type PiWebMessageListElement,
  type UiMessage,
  type UiToolCall
} from "@personal-claw/chat-ui-adapter";

const props = defineProps<{
  messages: readonly UiMessage[];
  toolCalls: readonly UiToolCall[];
  draft: string;
  modelLabel: string;
  modeLabel: string;
}>();

const emit = defineEmits<{
  send: [content: string];
  "update:draft": [value: string];
  "open-model-config": [];
}>();

const messageListElement = ref<PiWebMessageListElement | null>(null);
const messageEditorElement = ref<PiWebMessageEditorElement | null>(null);
const conversationScrollElement = ref<HTMLElement | null>(null);
const isPiWebReady = ref(false);

const hasUserMessage = computed(() => props.messages.some((message) => message.role === "user"));
const isEmptyState = computed(() => !hasUserMessage.value);
const isStreaming = computed(() =>
  props.toolCalls.some((toolCall) =>
    toolCall.status === "requested" || toolCall.status === "approved" || toolCall.status === "running"
  )
);

function syncPiWebElements(): void {
  if (!isPiWebReady.value) {
    return;
  }

  if (messageListElement.value) {
    configurePiWebMessageList(messageListElement.value, {
      messages: props.messages,
      toolCalls: props.toolCalls,
      isStreaming: isStreaming.value
    });
  }

  if (messageEditorElement.value) {
    configurePiWebMessageEditor(messageEditorElement.value, {
      value: props.draft,
      isStreaming: isStreaming.value,
      onInput: (value) => emit("update:draft", value),
      onSend: (value) => emit("send", value)
    });
  }
}

function scrollToLatestMessage(): void {
  const scrollElement = conversationScrollElement.value;

  if (!scrollElement) {
    return;
  }

  scrollElement.scrollTop = scrollElement.scrollHeight;
}

onMounted(() => {
  registerPiWebUiElements().then(async () => {
    isPiWebReady.value = true;
    await nextTick();
    syncPiWebElements();
    scrollToLatestMessage();
  }).catch((error: unknown) => {
    throw error instanceof Error ? error : new Error("pi-web-ui 组件注册失败。");
  });
});

watch(
  () => [props.messages, props.toolCalls, props.draft, isStreaming.value],
  async () => {
    syncPiWebElements();
    await nextTick();
    scrollToLatestMessage();
  },
  { deep: true }
);
</script>

<template>
  <section class="conversation-workspace" :class="{ 'is-empty': isEmptyState }">
    <div class="conversation-stage" ref="conversationScrollElement">
      <div v-if="isEmptyState" class="conversation-hero">
        <h1>我们应该在 PersonalClaw 中构建什么？</h1>
        <p class="conversation-hero-hint">
          描述一个任务，pi-agent 会通过 loop agent 循环把它整理成可执行的任务草稿。
        </p>
      </div>

      <div v-else class="conversation-stream pi-web-message-scroll">
        <message-list ref="messageListElement" class="pi-message-list"></message-list>

        <div v-if="toolCalls.length" class="tool-call-strip" aria-label="工具调用状态">
          <div v-for="tool in toolCalls" :key="tool.id" class="tool-call">
            <span>{{ tool.name }}</span>
            <strong>{{ tool.status }}</strong>
            <small>{{ tool.summary }}</small>
          </div>
        </div>
      </div>
    </div>

    <div class="composer-dock">
      <div class="composer-card">
        <div class="composer-action-bar" aria-label="对话操作栏">
          <div class="composer-action-left">
            <span class="composer-chip is-goal" title="目标">
              <span class="composer-chip-dot" aria-hidden="true"></span>
              目标
            </span>
          </div>
          <div class="composer-action-right">
            <button
              type="button"
              class="composer-chip is-model"
              :title="`当前模型：${modelLabel}`"
              @click="emit('open-model-config')"
            >
              <span class="composer-chip-model">{{ modelLabel }}</span>
              <span class="composer-chip-chevron" aria-hidden="true"></span>
            </button>
          </div>
        </div>

        <div class="composer pi-web-composer">
          <message-editor ref="messageEditorElement" class="pi-message-editor"></message-editor>
        </div>

        <div class="composer-status-bar" aria-label="上下文状态">
          <span class="composer-status-item">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="composer-status-icon">
              <path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            </svg>
            PersonalClaw
          </span>
          <span class="composer-status-item">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="composer-status-icon">
              <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>
              <path d="M8 20h8M12 16v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            {{ modeLabel }}
          </span>
          <span class="composer-status-item">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="composer-status-icon">
              <circle cx="6" cy="6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
              <circle cx="6" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
              <circle cx="18" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
              <path d="M6 8.4v7.2M8 6.4h6a4 4 0 0 1 2.6 4.6" fill="none" stroke="currentColor" stroke-width="1.6"/>
            </svg>
            main
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
