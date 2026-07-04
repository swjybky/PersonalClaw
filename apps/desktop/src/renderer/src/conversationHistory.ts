import type { UiMessage } from "@personal-claw/chat-ui-adapter";

export const conversationHistoryStorageKey = "personal-claw.conversation-history.v1";

export interface ConversationHistoryRecord {
  id: string;
  title: string;
  detail: string;
  updatedAt: string;
  messages: UiMessage[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const maxHistoryRecords = 20;

export function createConversationSessionId(now = Date.now()): string {
  return `conversation-${now}`;
}

export function hasUserMessage(messages: readonly UiMessage[]): boolean {
  return messages.some((message) => message.role === "user");
}

export function loadConversationHistory(storage = getBrowserStorage()): ConversationHistoryRecord[] {
  if (!storage) {
    return [];
  }

  const rawValue = storage.getItem(conversationHistoryStorageKey);

  if (!rawValue) {
    return [];
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter(isConversationHistoryRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, maxHistoryRecords);
  } catch {
    return [];
  }
}

export function saveConversationHistory(
  records: readonly ConversationHistoryRecord[],
  storage = getBrowserStorage()
): void {
  if (!storage) {
    return;
  }

  storage.setItem(conversationHistoryStorageKey, JSON.stringify(normalizeRecords(records)));
}

export function upsertConversationHistory(
  record: ConversationHistoryRecord,
  records: readonly ConversationHistoryRecord[]
): ConversationHistoryRecord[] {
  return normalizeRecords([record, ...records.filter((item) => item.id !== record.id)]);
}

export function buildConversationHistoryRecord(input: {
  id: string;
  messages: readonly UiMessage[];
  updatedAt?: string;
}): ConversationHistoryRecord {
  const messages = input.messages.map((message) => ({ ...message }));

  return {
    id: input.id,
    title: getConversationTitle(messages),
    detail: getConversationDetail(messages),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    messages
  };
}

function normalizeRecords(records: readonly ConversationHistoryRecord[]): ConversationHistoryRecord[] {
  return [...records]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, maxHistoryRecords);
}

function getConversationTitle(messages: readonly UiMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const titleSource = firstUserMessage?.content ?? messages.find((message) => message.content.trim())?.content;

  return truncateText(compactText(titleSource ?? "新建对话"), 18);
}

function getConversationDetail(messages: readonly UiMessage[]): string {
  const detailSource = [...messages].reverse().find((message) => message.content.trim())?.content;

  return truncateText(compactText(detailSource ?? "等待输入"), 28);
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function isConversationHistoryRecord(value: unknown): value is ConversationHistoryRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.detail === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.messages) &&
    value.messages.every(isUiMessage)
  );
}

function isUiMessage(value: unknown): value is UiMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isUiMessageRole(value.role) &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string"
  );
}

function isUiMessageRole(value: unknown): value is UiMessage["role"] {
  return value === "user" || value === "assistant" || value === "system";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBrowserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}
