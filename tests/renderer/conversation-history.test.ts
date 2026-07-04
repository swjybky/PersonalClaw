import { describe, expect, it } from "vitest";
import {
  buildConversationHistoryRecord,
  conversationHistoryStorageKey,
  loadConversationHistory,
  saveConversationHistory,
  upsertConversationHistory,
  type StorageLike
} from "../../apps/desktop/src/renderer/src/conversationHistory";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("conversation history storage", () => {
  it("saves and restores validated conversation records", () => {
    const storage = new MemoryStorage();
    const record = buildConversationHistoryRecord({
      id: "conversation-1",
      updatedAt: "2026-07-04T13:30:00.000Z",
      messages: [
        {
          id: "message-user-1",
          role: "user",
          content: "帮我整理今天的任务",
          createdAt: "2026-07-04T13:30:00.000Z"
        },
        {
          id: "message-assistant-1",
          role: "assistant",
          content: "我会先生成任务草稿。",
          createdAt: "2026-07-04T13:30:01.000Z"
        }
      ]
    });

    saveConversationHistory([record], storage);

    expect(loadConversationHistory(storage)).toEqual([record]);
  });

  it("ignores malformed stored values", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      conversationHistoryStorageKey,
      JSON.stringify([
        {
          id: "broken",
          title: "broken",
          detail: "broken",
          updatedAt: "2026-07-04T13:30:00.000Z",
          messages: [
            {
              id: "message-user-1",
              role: "owner",
              content: "bad role",
              createdAt: "2026-07-04T13:30:00.000Z"
            }
          ]
        }
      ])
    );

    expect(loadConversationHistory(storage)).toEqual([]);
  });

  it("upserts active conversations at the top", () => {
    const older = buildConversationHistoryRecord({
      id: "conversation-older",
      updatedAt: "2026-07-04T13:00:00.000Z",
      messages: [
        {
          id: "message-user-older",
          role: "user",
          content: "旧任务",
          createdAt: "2026-07-04T13:00:00.000Z"
        }
      ]
    });
    const newer = buildConversationHistoryRecord({
      id: "conversation-newer",
      updatedAt: "2026-07-04T13:45:00.000Z",
      messages: [
        {
          id: "message-user-newer",
          role: "user",
          content: "新任务",
          createdAt: "2026-07-04T13:45:00.000Z"
        }
      ]
    });

    expect(upsertConversationHistory(newer, [older]).map((record) => record.id)).toEqual([
      "conversation-newer",
      "conversation-older"
    ]);
  });
});
