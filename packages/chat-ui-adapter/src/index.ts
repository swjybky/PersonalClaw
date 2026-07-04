import type { AgentMessage, MessageEditor, MessageList } from "@earendil-works/pi-web-ui";
import "@earendil-works/pi-web-ui/app.css";
import { registerAdapterMessageElements } from "./pi-web-message-elements";

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface UiToolCall {
  id: string;
  name: string;
  status: "requested" | "approved" | "running" | "completed" | "failed";
  summary: string;
}

export interface AgentConversationProps {
  messages: readonly UiMessage[];
  toolCalls: readonly UiToolCall[];
}

export interface PiWebUiAdapterStatus {
  packageName: "@earendil-works/pi-web-ui";
  requestedVersion: "0.75.3";
  integration: "adapter-components";
  reason?: string;
}

export interface PiWebMessageListInput extends AgentConversationProps {
  isStreaming: boolean;
}

export interface PiWebMessageEditorInput {
  value: string;
  isStreaming: boolean;
  onInput: (value: string) => void;
  onSend: (value: string) => void;
}

export type PiWebMessageListElement = HTMLElement &
  Pick<MessageList, "messages" | "tools" | "pendingToolCalls" | "isStreaming">;

export type PiWebMessageEditorElement = HTMLElement &
  Pick<
    MessageEditor,
    | "value"
    | "isStreaming"
    | "showAttachmentButton"
    | "showModelSelector"
    | "showThinkingSelector"
    | "attachments"
    | "onInput"
    | "onSend"
  >;

type PiWebAssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type PiWebUsage = PiWebAssistantMessage["usage"];

export const piWebUiAdapterStatus: PiWebUiAdapterStatus = {
  packageName: "@earendil-works/pi-web-ui",
  requestedVersion: "0.75.3",
  integration: "adapter-components",
  reason:
    "MessageList and MessageEditor are registered in the browser through adapter-scoped component imports; Agent runtime remains outside the Renderer."
};

let piWebRegistration: Promise<void> | undefined;

export function registerPiWebUiElements(): Promise<void> {
  if (!canRegisterCustomElements()) {
    return Promise.resolve();
  }

  piWebRegistration ??= Promise.allSettled([
    import("@mariozechner/mini-lit/dist/MarkdownBlock.js"),
    import("../node_modules/@earendil-works/pi-web-ui/dist/components/MessageEditor.js"),
    import("../node_modules/@earendil-works/pi-web-ui/dist/components/MessageList.js")
  ]).then((results) => {
    const criticalFailures = [
      { name: "markdown-block", result: results[0] },
      { name: "message-editor", result: results[1] }
    ].filter((item) => item.result?.status === "rejected");

    if (criticalFailures.length > 0) {
      throw new Error(
        `pi-web-ui 关键组件注册失败：${criticalFailures.map((item) => item.name).join(", ")}`
      );
    }

    if (results[2]?.status === "fulfilled") {
      registerAdapterMessageElements();
    }
  });

  return piWebRegistration;
}

export function toPiWebMessages(messages: readonly UiMessage[]): AgentMessage[] {
  return messages.map((message) => {
    const timestamp = toTimestamp(message.createdAt);

    if (message.role === "user") {
      return {
        role: "user",
        content: message.content,
        timestamp
      };
    }

    return {
      role: "assistant",
      content: [
        {
          type: "text",
          text: message.content
        }
      ],
      api: "personal-claw-ui",
      provider: "personal-claw",
      model: "personal-task-manager",
      usage: createEmptyUsage(),
      stopReason: "stop",
      timestamp
    };
  });
}

export function configurePiWebMessageList(
  element: PiWebMessageListElement,
  input: PiWebMessageListInput
): void {
  element.messages = toPiWebMessages(input.messages);
  element.tools = [];
  element.pendingToolCalls = new Set(input.toolCalls.map((toolCall) => toolCall.id));
  element.isStreaming = input.isStreaming;
}

export function configurePiWebMessageEditor(
  element: PiWebMessageEditorElement,
  input: PiWebMessageEditorInput
): void {
  element.value = input.value;
  element.isStreaming = input.isStreaming;
  element.showAttachmentButton = false;
  element.showModelSelector = false;
  element.showThinkingSelector = false;
  element.attachments = [];
  element.onInput = input.onInput;
  element.onSend = (value) => {
    const content = value.trim();

    if (content) {
      input.onSend(content);
    }
  };
}

function canRegisterCustomElements(): boolean {
  return (
    typeof globalThis === "object" &&
    "customElements" in globalThis &&
    "document" in globalThis &&
    typeof globalThis.document?.createElement === "function"
  );
}

function toTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function createEmptyUsage(): PiWebUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  };
}
