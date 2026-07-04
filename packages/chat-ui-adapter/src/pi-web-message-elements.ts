import { html, LitElement, type TemplateResult } from "lit";
import { prepareMarkdownContent } from "./markdown-content";

type MessageChunk =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments?: unknown };

interface RecordLike {
  [key: string]: unknown;
}

class AdapterUserMessage extends LitElement {
  static override properties = {
    message: { attribute: false }
  };

  message: unknown;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
  }

  override render(): TemplateResult {
    return html`
      <div class="pc-user-message-row">
        <div class="pc-user-message-pill">
          <markdown-block .content=${prepareMarkdownContent(readUserText(this.message))}></markdown-block>
        </div>
      </div>
    `;
  }
}

class AdapterAssistantMessage extends LitElement {
  static override properties = {
    message: { attribute: false },
    isStreaming: { type: Boolean }
  };

  message: unknown;
  isStreaming = false;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
  }

  override render(): TemplateResult {
    const chunks = readAssistantChunks(this.message);

    return html`
      <div class="pc-assistant-message">
        ${chunks.length > 0 ? chunks.map((chunk) => renderAssistantChunk(chunk, this.isStreaming)) : ""}
      </div>
    `;
  }
}

export function registerAdapterMessageElements(): void {
  if (!customElements.get("user-message")) {
    customElements.define("user-message", AdapterUserMessage);
  }

  if (!customElements.get("assistant-message")) {
    customElements.define("assistant-message", AdapterAssistantMessage);
  }
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

function readUserText(message: unknown): string {
  if (!isRecord(message)) {
    return "";
  }

  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .filter((chunk) => chunk.type === "text" && typeof chunk.text === "string")
      .map((chunk) => chunk.text as string)
      .join("\n");
  }

  return "";
}

function readAssistantChunks(message: unknown): MessageChunk[] {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return [];
  }

  const chunks: MessageChunk[] = [];

  for (const chunk of message.content) {
    if (!isRecord(chunk) || typeof chunk.type !== "string") {
      continue;
    }

    if (chunk.type === "text" && typeof chunk.text === "string" && chunk.text.trim()) {
      chunks.push({ type: "text", text: chunk.text });
      continue;
    }

    if (chunk.type === "thinking" && typeof chunk.thinking === "string" && chunk.thinking.trim()) {
      chunks.push({ type: "thinking", thinking: chunk.thinking });
      continue;
    }

    if (chunk.type === "toolCall" && typeof chunk.id === "string" && typeof chunk.name === "string") {
      chunks.push({
        type: "toolCall",
        id: chunk.id,
        name: chunk.name,
        arguments: chunk.arguments
      });
    }
  }

  return chunks;
}

function renderAssistantChunk(chunk: MessageChunk, isStreaming: boolean): TemplateResult {
  if (chunk.type === "text") {
    return html`<markdown-block class="pc-assistant-markdown" .content=${prepareMarkdownContent(chunk.text)}></markdown-block>`;
  }

  if (chunk.type === "thinking") {
    return html`
      <details class="conversation-thinking-inline" ?open=${isStreaming}>
        <summary>思考</summary>
        <pre>${chunk.thinking}</pre>
      </details>
    `;
  }

  return html`
    <div class="conversation-tool-call-inline">
      <strong>${chunk.name}</strong>
      <pre>${formatToolArguments(chunk.arguments)}</pre>
    </div>
  `;
}

function formatToolArguments(value: unknown): string {
  if (value === undefined) {
    return "{}";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
