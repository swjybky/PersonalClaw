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
