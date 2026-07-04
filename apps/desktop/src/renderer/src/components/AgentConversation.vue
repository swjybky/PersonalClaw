<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  configurePiWebMessageEditor,
  registerPiWebUiElements,
  type PiWebMessageEditorElement,
  type UiMessage,
  type UiToolCall
} from "@personal-claw/chat-ui-adapter";
import type { ThinkingLevel } from "@personal-claw/contracts";
import { useModelConfigStore } from "../stores/modelConfig";

const props = defineProps<{
  messages: readonly UiMessage[];
  toolCalls: readonly UiToolCall[];
  isStreaming: boolean;
  draft: string;
  modelLabel: string;
  diagnosticMessage: string | null;
  thinkingPreview: string;
  thinkingLevel: ThinkingLevel;
  canUseThinking: boolean;
  workStatusLabel: string;
}>();

const emit = defineEmits<{
  send: [content: string];
  "update:draft": [value: string];
  "update:thinking-level": [value: ThinkingLevel];
  "open-model-config": [];
}>();

const modelConfig = useModelConfigStore();
const messageEditorElement = ref<PiWebMessageEditorElement | null>(null);
const conversationScrollElement = ref<HTMLElement | null>(null);
const modelPickerRef = ref<HTMLElement | null>(null);
const thinkingPickerRef = ref<HTMLElement | null>(null);
const isMarkdownReady = ref(false);
const isEditorReady = ref(false);
const piWebLoadError = ref<string | null>(null);
const isModelMenuOpen = ref(false);
const isThinkingMenuOpen = ref(false);

const thinkingOptions: ReadonlyArray<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "关" },
  { value: "minimal", label: "极简" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" }
];

const hasUserMessage = computed(() => props.messages.some((message) => message.role === "user"));
const isEmptyState = computed(() => !hasUserMessage.value);
const hasPendingToolCall = computed(() =>
  props.toolCalls.some((toolCall) =>
    toolCall.status === "requested" || toolCall.status === "approved" || toolCall.status === "running"
  )
);
const isStreaming = computed(() => props.isStreaming || hasPendingToolCall.value);
const thinkingLabel = computed(
  () => thinkingOptions.find((option) => option.value === props.thinkingLevel)?.label ?? "关"
);
const thinkingButtonLabel = computed(() => (props.canUseThinking ? thinkingLabel.value : "跟随模型"));
const thinkingButtonTitle = computed(() =>
  props.canUseThinking ? `思考等级：${thinkingLabel.value}` : "当前模型未标记支持 thinking，发送时自动关闭"
);
const shouldShowThinkingWaiting = computed(
  () => props.canUseThinking && props.thinkingLevel !== "off" && isStreaming.value && !props.thinkingPreview
);
const toolCallSummary = computed(() => (props.toolCalls.length > 0 ? `${props.toolCalls.length} 个` : "暂无"));

function syncPiWebEditor(): void {
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

function toggleThinkingMenu(event: MouseEvent): void {
  event.stopPropagation();

  if (!props.canUseThinking) {
    closeThinkingMenu();
    return;
  }

  isThinkingMenuOpen.value = !isThinkingMenuOpen.value;
}

function closeThinkingMenu(): void {
  isThinkingMenuOpen.value = false;
}

function handleDocumentClick(event: MouseEvent): void {
  const target = event.target;

  if (!(target instanceof Node)) {
    return;
  }

  if (!modelPickerRef.value?.contains(target)) {
    closeModelMenu();
  }

  if (!thinkingPickerRef.value?.contains(target)) {
    closeThinkingMenu();
  }
}

function refreshCustomElementFlags(): void {
  isMarkdownReady.value = customElements.get("markdown-block") !== undefined;
  isEditorReady.value = customElements.get("message-editor") !== undefined;
}

function messageDisplayContent(message: UiMessage): string {
  if (message.content) {
    return message.content;
  }

  if (message.role === "assistant" && isStreaming.value) {
    return "正在等待模型输出...";
  }

  return "";
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

function selectThinkingLevel(level: ThinkingLevel): void {
  if (!props.canUseThinking) {
    emit("update:thinking-level", "off");
    closeThinkingMenu();
    return;
  }

  emit("update:thinking-level", level);
  closeThinkingMenu();
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
    refreshCustomElementFlags();

    if (!isMarkdownReady.value) {
      piWebLoadError.value = "Markdown 渲染组件未注册";
    }

    await nextTick();
    syncPiWebEditor();
    scrollToLatestMessage();
  }).catch((error: unknown) => {
    refreshCustomElementFlags();
    piWebLoadError.value = error instanceof Error ? error.message : "pi-web-ui 组件注册失败。";
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick);
});

watch(
  () => [props.messages, props.toolCalls, props.draft, isStreaming.value],
  async () => {
    syncPiWebEditor();
    await nextTick();
    scrollToLatestMessage();
  },
  { deep: true }
);

watch(
  () => props.canUseThinking,
  (canUseThinking) => {
    if (!canUseThinking) {
      closeThinkingMenu();
    }
  }
);
</script>

<template>
  <section
    class="conversation-workspace"
    :class="{ 'is-empty': isEmptyState, 'has-diagnostic': diagnosticMessage }"
  >
    <div v-if="isEmptyState" class="conversation-hero">
      <h1>我们应该在 PersonalClaw 中构建什么？</h1>
      <p class="conversation-hero-hint">
        描述一个任务，pi-agent 会通过 loop agent 循环把它整理成可执行的任务草稿。
      </p>
    </div>

    <div v-if="diagnosticMessage" class="conversation-diagnostic" role="alert">
      <strong>模型接口错误</strong>
      <pre>{{ diagnosticMessage }}</pre>
    </div>

    <div v-if="!isEmptyState" class="conversation-stage" ref="conversationScrollElement">
      <div v-if="workStatusLabel" class="conversation-work-status">
        {{ workStatusLabel }}
      </div>

      <div class="conversation-run-meta" aria-label="运行状态">
        <span>思考：{{ canUseThinking ? thinkingLabel : "跟随模型" }}</span>
        <span>工具调用：{{ toolCallSummary }}</span>
        <span>{{ isStreaming ? "等待模型输出" : "空闲" }}</span>
      </div>

      <div v-if="piWebLoadError" class="conversation-inline-warning" role="status">
        {{ piWebLoadError }}，已切换为内置消息渲染。
      </div>

      <div v-if="thinkingPreview" class="conversation-thinking-preview" aria-label="模型思考">
        <strong>模型思考</strong>
        <pre>{{ thinkingPreview }}</pre>
      </div>
      <div v-else-if="shouldShowThinkingWaiting" class="conversation-thinking-preview is-waiting" aria-label="模型思考">
        <strong>模型思考</strong>
        <p>正在等待模型返回思考流...</p>
      </div>

      <div v-if="toolCalls.length" class="conversation-tool-call-list" aria-label="工具调用">
        <strong>工具调用</strong>
        <div v-for="toolCall in toolCalls" :key="toolCall.id" class="conversation-tool-call">
          <span>{{ toolCall.name }}</span>
          <small>{{ toolCall.status }} · {{ toolCall.summary }}</small>
        </div>
      </div>

      <div class="conversation-stream pi-web-message-scroll">
        <div class="native-message-list">
          <article
            v-for="message in messages"
            :key="message.id"
            class="native-message"
            :class="`is-${message.role}`"
          >
            <div class="native-message-bubble">
              <markdown-block
                v-if="isMarkdownReady"
                class="native-message-markdown"
                :content.prop="messageDisplayContent(message)"
              ></markdown-block>
              <span v-else>{{ messageDisplayContent(message) }}</span>
            </div>
          </article>
        </div>
      </div>
    </div>

    <div class="composer-dock">
      <div class="composer-card">
        <div class="composer-input pi-web-composer">
          <textarea
            v-if="!isEditorReady"
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

          </div>

          <div class="composer-toolbar-right">
            <div ref="thinkingPickerRef" class="composer-model-picker">
              <button
                type="button"
                class="composer-toolbar-chip is-thinking"
                :class="{ 'is-disabled': !canUseThinking }"
                :title="thinkingButtonTitle"
                :aria-expanded="isThinkingMenuOpen"
                aria-haspopup="listbox"
                :disabled="!canUseThinking"
                @click="toggleThinkingMenu"
              >
                <span class="composer-model-label">思考 {{ thinkingButtonLabel }}</span>
                <span class="composer-chip-chevron" aria-hidden="true"></span>
              </button>

              <div
                v-if="canUseThinking && isThinkingMenuOpen"
                class="composer-model-menu"
                role="listbox"
                aria-label="选择思考等级"
              >
                <button
                  v-for="option in thinkingOptions"
                  :key="option.value"
                  type="button"
                  class="composer-model-menu-item"
                  :class="{ 'is-selected': option.value === thinkingLevel }"
                  role="option"
                  :aria-selected="option.value === thinkingLevel"
                  @click="selectThinkingLevel(option.value)"
                >
                  <span class="composer-model-menu-item-label">{{ option.label }}</span>
                  <span v-if="option.value === thinkingLevel" class="composer-model-menu-check" aria-hidden="true">✓</span>
                </button>
              </div>
            </div>

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
