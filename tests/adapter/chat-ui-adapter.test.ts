import { describe, expect, it } from "vitest";
import {
  configurePiWebMessageList,
  piWebUiAdapterStatus,
  registerPiWebUiElements,
  toPiWebMessages,
  type PiWebMessageListElement
} from "@personal-claw/chat-ui-adapter";

describe("chat UI adapter", () => {
  it("uses pi-web-ui through adapter-managed components", () => {
    expect(piWebUiAdapterStatus.packageName).toBe("@earendil-works/pi-web-ui");
    expect(piWebUiAdapterStatus.requestedVersion).toBe("0.75.3");
    expect(piWebUiAdapterStatus.integration).toBe("adapter-components");
  });

  it("maps PersonalClaw UI messages to pi-web agent messages", () => {
    const messages = toPiWebMessages([
      {
        id: "message-user-1",
        role: "user",
        content: "整理我的任务",
        createdAt: "2026-07-04T13:30:00.000Z"
      },
      {
        id: "message-assistant-1",
        role: "assistant",
        content: "我会先生成任务草稿。",
        createdAt: "2026-07-04T13:30:01.000Z"
      },
      {
        id: "message-system-1",
        role: "system",
        content: "系统消息以 assistant 方式展示。",
        createdAt: "2026-07-04T13:30:02.000Z"
      }
    ]);

    expect(messages[0]).toMatchObject({
      role: "user",
      content: "整理我的任务"
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      api: "personal-claw-ui",
      provider: "personal-claw",
      model: "personal-task-manager",
      stopReason: "stop"
    });
    expect(messages[2]).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "系统消息以 assistant 方式展示。"
        }
      ]
    });
  });

  it("does not register browser custom elements in the node test process", async () => {
    await expect(registerPiWebUiElements()).resolves.toBeUndefined();
  });

  it("passes streaming state through to the pi-web message list", () => {
    const element = {
      messages: [],
      tools: [],
      pendingToolCalls: new Set<string>(),
      isStreaming: false
    } as unknown as PiWebMessageListElement;

    configurePiWebMessageList(element, {
      messages: [
        {
          id: "message-user-1",
          role: "user",
          content: "生成任务草稿",
          createdAt: "2026-07-04T13:30:00.000Z"
        }
      ],
      toolCalls: [],
      isStreaming: true
    });

    expect(element.isStreaming).toBe(true);
    expect(element.pendingToolCalls?.size).toBe(0);
  });
});
