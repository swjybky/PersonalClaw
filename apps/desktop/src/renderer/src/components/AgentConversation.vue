<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  configurePiWebMessageEditor,
  configurePiWebMessageList,
  registerPiWebUiElements,
  type PiWebMessageEditorElement,
  type PiWebMessageListElement,
  type UiMessage,
  type UiToolCall
} from "@personal-claw/chat-ui-adapter";
import { useModelConfigStore } from "../stores/modelConfig";

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

const modelConfig = useModelConfigStore();
const messageListElement = ref<PiWebMessageListElement | null>(null);
const messageEditorElement = ref<PiWebMessageEditorElement | null>(null);
const conversationScrollElement = ref<HTMLElement | null>(null);
const modelPickerRef = ref<HTMLElement | null>(null);
const isPiWebReady = ref(false);
const isModelMenuOpen = ref(false);

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

function handleNativeInput(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value;
  emit("update:draft", value);
}

function handleNativeKeyDown(event: KeyboardEvent): void {
  if (event.isComposing || event.key === "Process") {
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendDraft();
  }
}

const canSend = computed(() => props.draft.trim().length > 0 && !isStreaming.value);

const sortedModelSummaries = computed(() =>
  [...modelConfig.summaries].sort((left, right) => {
    if (left.id === modelConfig.defaultModelId) {
      return -1;
    }

    if (right.id === modelConfig.defaultModelId) {
      return 1;
    }

    return left.label.localeCompare(right.label, "zh-CN");
  })
);

function toggleModelMenu(event: MouseEvent): void {
  event.stopPropagation();
  isModelMenuOpen.value = !isModelMenuOpen.value;
}

function closeModelMenu(): void {
  isModelMenuOpen.value = false;
}

function handleDocumentClick(event: MouseEvent): void {
  const target = event.target;

  if (!(target instanceof Node) || modelPickerRef.value?.contains(target)) {
    return;
  }

  closeModelMenu();
}

async function selectModel(id: string): Promise<void> {
  if (id === modelConfig.defaultModelId) {
    closeModelMenu();
    return;
  }

  await modelConfig.setDefault(id);
  closeModelMenu();
}

function openModelConfigPage(): void {
  closeModelMenu();
  emit("open-model-config");
}

function sendDraft(): void {
  const content = props.draft.trim();

  if (content && !isStreaming.value) {
    emit("send", content);
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
  document.addEventListener("click", handleDocumentClick);

  registerPiWebUiElements().then(async () => {
    isPiWebReady.value = true;
    await nextTick();
    syncPiWebElements();
    scrollToLatestMessage();
  }).catch((error: unknown) => {
    throw error instanceof Error ? error : new Error("pi-web-ui 组件注册失败。");
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick);
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
    <div v-if="isEmptyState" class="conversation-hero">
      <h1>我们应该在 PersonalClaw 中构建什么？</h1>
      <p class="conversation-hero-hint">
        描述一个任务，pi-agent 会通过 loop agent 循环把它整理成可执行的任务草稿。
      </p>
    </div>

    <div v-else class="conversation-stage" ref="conversationScrollElement">
      <div class="conversation-stream pi-web-message-scroll">
        <message-list v-if="isPiWebReady" ref="messageListElement" class="pi-message-list"></message-list>

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
        <div class="composer-input pi-web-composer">
          <textarea
            v-if="!isPiWebReady"
            class="composer-native-input"
            :value="draft"
            placeholder="描述一个任务，按 Enter 发送，Shift+Enter 换行"
            :disabled="isStreaming"
            @input="handleNativeInput"
            @keydown="handleNativeKeyDown"
          ></textarea>
          <message-editor
            v-else
            ref="messageEditorElement"
            class="pi-message-editor"
          ></message-editor>
        </div>

        <div class="composer-toolbar" aria-label="对话操作栏">
          <div class="composer-toolbar-left">
            <button type="button" class="composer-icon-btn" title="添加附件" aria-label="添加附件">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>

            <span class="composer-toolbar-chip is-access" :title="modeLabel">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="composer-access-icon">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>
                <path d="M12 8v5M12 16.5v.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
              {{ modeLabel }}
            </span>

            <span class="composer-toolbar-divider" aria-hidden="true"></span>

            <span class="composer-toolbar-chip is-goal" title="目标">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/>
                <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/>
                <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
              目标
            </span>
          </div>

          <div class="composer-toolbar-right">
            <div ref="modelPickerRef" class="composer-model-picker">
              <button
                type="button"
                class="composer-toolbar-chip is-model"
                :title="`当前模型：${modelLabel}`"
                :aria-expanded="isModelMenuOpen"
                aria-haspopup="listbox"
                @click="toggleModelMenu"
              >
                <span class="composer-model-label">{{ modelLabel }}</span>
                <span class="composer-chip-chevron" aria-hidden="true"></span>
              </button>

              <div
                v-if="isModelMenuOpen"
                class="composer-model-menu"
                role="listbox"
                aria-label="选择模型"
              >
                <p v-if="!sortedModelSummaries.length" class="composer-model-menu-empty">
                  暂无可用模型
                </p>
                <button
                  v-for="summary in sortedModelSummaries"
                  :key="summary.id"
                  type="button"
                  class="composer-model-menu-item"
                  :class="{ 'is-selected': summary.id === modelConfig.defaultModelId }"
                  role="option"
                  :aria-selected="summary.id === modelConfig.defaultModelId"
                  :disabled="modelConfig.isSaving"
                  @click="selectModel(summary.id)"
                >
                  <span class="composer-model-menu-item-label">{{ summary.label }}</span>
                  <span v-if="summary.id === modelConfig.defaultModelId" class="composer-model-menu-check" aria-hidden="true">✓</span>
                </button>
                <button
                  type="button"
                  class="composer-model-menu-footer"
                  @click="openModelConfigPage"
                >
                  管理模型配置…
                </button>
              </div>
            </div>

            <button type="button" class="composer-icon-btn" title="语音输入" aria-label="语音输入">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/>
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </button>

            <button
              type="button"
              class="composer-send-btn"
              title="发送"
              aria-label="发送"
              :disabled="!canSend"
              @click="sendDraft"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5M7 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
