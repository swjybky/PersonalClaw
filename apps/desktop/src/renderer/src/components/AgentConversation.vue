<script setup lang="ts">
import type { UiMessage, UiToolCall } from "@personal-claw/chat-ui-adapter";

const props = defineProps<{
  messages: readonly UiMessage[];
  toolCalls: readonly UiToolCall[];
  draft: string;
}>();

const emit = defineEmits<{
  send: [content: string];
  "update:draft": [value: string];
}>();

function updateDraft(event: Event): void {
  const target = event.target;

  if (!(target instanceof HTMLTextAreaElement)) {
    throw new Error("Composer event target is not a textarea.");
  }

  emit("update:draft", target.value);
}

function sendDraft(): void {
  const content = props.draft.trim();

  if (!content) {
    return;
  }

  emit("send", content);
}
</script>

<template>
  <section class="agent-conversation" aria-label="个人任务管理智能体对话">
    <div class="conversation-scroll">
      <article v-for="message in messages" :key="message.id" class="message-row" :class="`is-${message.role}`">
        <div class="message-avatar">{{ message.role === "user" ? "我" : "AI" }}</div>
        <div class="message-bubble">
          <div class="message-meta">
            <strong>{{ message.role === "user" ? "用户" : "个人任务管理智能体" }}</strong>
            <time>{{ new Date(message.createdAt).toLocaleTimeString() }}</time>
          </div>
          <p>{{ message.content }}</p>
        </div>
      </article>

      <div v-if="toolCalls.length" class="tool-call-strip" aria-label="工具调用状态">
        <div v-for="tool in toolCalls" :key="tool.id" class="tool-call">
          <span>{{ tool.name }}</span>
          <strong>{{ tool.status }}</strong>
          <small>{{ tool.summary }}</small>
        </div>
      </div>
    </div>

    <form class="composer" @submit.prevent="sendDraft">
      <textarea
        :value="draft"
        rows="3"
        aria-label="输入任务"
        placeholder="把要处理的个人任务写在这里"
        @input="updateDraft"
        @keydown.meta.enter.prevent="sendDraft"
        @keydown.ctrl.enter.prevent="sendDraft"
      />
      <button type="submit" :disabled="!draft.trim()">发送</button>
    </form>
  </section>
</template>
