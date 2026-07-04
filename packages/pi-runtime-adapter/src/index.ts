import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  envApiKeyAuth,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
  type Provider,
  type Usage
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { xiaomiTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-cn";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

export interface UserMessage {
  role: "user";
  content: string;
}

export type SupportedPiProviderId =
  | "anthropic"
  | "deepseek"
  | "faux"
  | "kimi-coding"
  | "moonshotai-cn"
  | "openai"
  | "xiaomi-token-plan-cn"
  | "zai-coding-cn";
type RealPiProviderId = Exclude<SupportedPiProviderId, "faux">;
type ConfiguredPiModelApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export interface PiModelRef {
  provider: SupportedPiProviderId;
  modelId?: string;
  baseUrl?: string;
  api?: ConfiguredPiModelApi;
  reasoning?: boolean;
}

export type PiRuntimeMode = "local-faux" | "provider";

export interface PiRuntimeRef {
  provider: string;
  model: string;
  mode: PiRuntimeMode;
}

export interface AgentRunInput {
  runId: string;
  sessionId?: string;
  taskId?: string;
  prompt: string;
  thinkingLevel?: ThinkingLevel;
  modelRef?: PiModelRef;
}

export type AgentRuntimeEvent =
  | {
      type: "agent.delta";
      runId: string;
      sessionId?: string;
      payload: {
        messageId: string;
        delta: string;
        runtime: PiRuntimeRef;
      };
    }
  | {
      type: "agent.thinking_delta";
      runId: string;
      sessionId?: string;
      payload: {
        messageId: string;
        delta: string;
        runtime: PiRuntimeRef;
      };
    }
  | {
      type: "agent.completed";
      runId: string;
      sessionId?: string;
      payload: {
        messageId: string;
        content: string;
        stopReason?: string;
        usage?: Usage;
        runtime: PiRuntimeRef;
      };
    }
  | {
      type: "agent.tool_requested";
      runId: string;
      sessionId?: string;
      payload: {
        toolCallId: string;
        toolName: string;
        args: unknown;
        runtime: PiRuntimeRef;
      };
    }
  | {
      type: "agent.error";
      runId: string;
      sessionId?: string;
      payload: {
        code: string;
        message: string;
        details?: unknown;
        runtime?: PiRuntimeRef;
      };
    };

export interface AgentCheckpoint {
  runId: string;
  createdAt: string;
  state: {
    runtime?: PiRuntimeRef;
    mode: "pi-agent-core";
  };
}

export interface AgentRuntime {
  describe(input?: { modelRef?: PiModelRef }): PiRuntimeRef;
  start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
  steer(runId: string, message: UserMessage): Promise<void>;
  abort(runId: string): Promise<void>;
  checkpoint(runId: string): Promise<AgentCheckpoint>;
}

interface PiRuntimeAdapterOptions {
  defaultModelRef?: PiModelRef | undefined;
  modelRefResolver?: () => PiModelRef | undefined;
  apiKeyResolver?: (provider: SupportedPiProviderId) => string | undefined;
  systemPrompt?: string;
  requestTimeoutMs?: number;
}

type PiRuntimeSession =
  | {
      kind: "faux";
      models: Models;
      model: Model<Api>;
      runtime: PiRuntimeRef;
      setPrompt(prompt: string): void;
    }
  | {
      kind: "provider";
      models: Models;
      model: Model<Api>;
      runtime: PiRuntimeRef;
    };

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();

    if (waiter) {
      waiter({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  close(): void {
    this.closed = true;

    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();

        if (value) {
          return Promise.resolve({ value, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    };
  }
}

export function createPiModelRefFromEnv(env: Record<string, string | undefined>): PiModelRef | undefined {
  const provider = env.PERSONAL_CLAW_PI_PROVIDER?.trim();
  const modelId = env.PERSONAL_CLAW_PI_MODEL?.trim();

  if (!provider) {
    return undefined;
  }

  if (!isSupportedPiProviderId(provider)) {
    throw new Error(`Unsupported PERSONAL_CLAW_PI_PROVIDER: ${provider}`);
  }

  return {
    provider,
    ...(modelId ? { modelId } : {})
  };
}

/**
 * pi-ai provider 读取 API key 的环境变量名。Agent Utility 在创建 provider 前，
 * 把模型配置中的 key 注入对应环境变量；faux 不需要 key。
 */
export function providerApiKeyEnvVar(provider: SupportedPiProviderId): string | undefined {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "deepseek":
      return "DEEPSEEK_API_KEY";
    case "kimi-coding":
      return "KIMI_API_KEY";
    case "moonshotai-cn":
      return "MOONSHOT_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "xiaomi-token-plan-cn":
      return "XIAOMI_TOKEN_PLAN_CN_API_KEY";
    case "zai-coding-cn":
      return "ZAI_CODING_CN_API_KEY";
    case "faux":
      return undefined;
  }
}

export class PiAgentRuntimeAdapter implements AgentRuntime {
  private readonly defaultModelRef: PiModelRef | undefined;
  private readonly modelRefResolver: (() => PiModelRef | undefined) | undefined;
  private readonly apiKeyResolver: ((provider: SupportedPiProviderId) => string | undefined) | undefined;
  private readonly systemPrompt: string;
  private readonly requestTimeoutMs: number;

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.defaultModelRef = options.defaultModelRef;
    this.modelRefResolver = options.modelRefResolver;
    this.apiKeyResolver = options.apiKeyResolver;
    this.systemPrompt = options.systemPrompt ?? buildPersonalTaskSystemPrompt();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 45_000;
  }

  describe(input: { modelRef?: PiModelRef } = {}): PiRuntimeRef {
    return this.createRuntimeSession(this.resolveModelRef(input.modelRef)).runtime;
  }

  async *start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    const queue = new AsyncEventQueue<AgentRuntimeEvent>();
    const runtimeSession = this.createRuntimeSession(
      this.resolveModelRef(input.modelRef)
    );
    const messageId = `${input.runId}_assistant`;

    if (runtimeSession.kind === "faux") {
      runtimeSession.setPrompt(input.prompt);
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: this.systemPrompt,
        model: runtimeSession.model,
        thinkingLevel: input.thinkingLevel ?? "off",
        tools: []
      },
      streamFn: runtimeSession.models.streamSimple.bind(runtimeSession.models),
      beforeToolCall: async () => ({
        block: true,
        reason: "PersonalClaw Policy Engine has not approved this tool call yet."
      }),
      toolExecution: "sequential"
    });

    let isSettled = false;
    let timeout: NodeJS.Timeout | undefined;
    const unsubscribe = agent.subscribe((event) => {
      for (const runtimeEvent of toRuntimeEvents(event, input, runtimeSession.runtime, messageId)) {
        queue.push(runtimeEvent);
      }
    });
    const cleanup = (): void => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      unsubscribe();
      queue.close();
    };

    if (this.requestTimeoutMs > 0) {
      timeout = setTimeout(() => {
        queue.push({
          type: "agent.error",
          runId: input.runId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          payload: {
            code: "pi_agent.prompt_timeout",
            message: `Pi agent prompt timed out after ${this.requestTimeoutMs}ms.`,
            runtime: runtimeSession.runtime
          }
        });
        cleanup();
      }, this.requestTimeoutMs);
      timeout.unref();
    }

    void agent
      .prompt({
        role: "user",
        content: input.prompt,
        timestamp: Date.now()
      })
      .catch((error: unknown) => {
        if (isSettled) {
          return;
        }

        queue.push({
          type: "agent.error",
          runId: input.runId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          payload: {
            code: "pi_agent.prompt_failed",
            message: error instanceof Error ? error.message : "Pi agent prompt failed.",
            details: serializeError(error),
            runtime: runtimeSession.runtime
          }
        });
      })
      .finally(() => {
        cleanup();
      });

    for await (const event of queue) {
      yield event;
    }
  }

  steer(): Promise<void> {
    return Promise.resolve();
  }

  abort(): Promise<void> {
    return Promise.resolve();
  }

  checkpoint(runId: string): Promise<AgentCheckpoint> {
    return Promise.resolve({
      runId,
      createdAt: new Date().toISOString(),
      state: {
        runtime: this.describe(),
        mode: "pi-agent-core"
      }
    });
  }

  private resolveModelRef(explicit?: PiModelRef): PiModelRef | undefined {
    if (explicit) {
      return explicit;
    }

    if (this.modelRefResolver) {
      try {
        const resolved = this.modelRefResolver();

        if (resolved) {
          return resolved;
        }
      } catch {
        return this.defaultModelRef;
      }
    }

    return this.defaultModelRef;
  }

  private createRuntimeSession(modelRef?: PiModelRef): PiRuntimeSession {
    const effectiveRef = modelRef ?? { provider: "faux" };
    const models = createModels();

    if (effectiveRef.provider === "faux") {
      const faux = fauxProvider({
        api: "personal-claw-faux",
        provider: "personal-claw",
        models: [
          {
            id: effectiveRef.modelId ?? "personal-task-manager",
            name: "PersonalClaw Local Task Manager"
          }
        ],
        tokensPerSecond: 160
      });
      models.setProvider(faux.provider);
      const model = faux.getModel(effectiveRef.modelId ?? "personal-task-manager");

      if (!model) {
        throw new Error("PersonalClaw faux model is not available.");
      }

      return {
        kind: "faux",
        models,
        model,
        runtime: {
          provider: "personal-claw",
          model: model.id,
          mode: "local-faux"
        },
        setPrompt(prompt: string): void {
          faux.setResponses([fauxAssistantMessage(buildLocalTaskPlannerResponse(prompt))]);
        }
      };
    }

    this.injectApiKey(effectiveRef.provider);
    this.requireApiKey(effectiveRef.provider);
    if (!effectiveRef.modelId) {
      throw new Error(`PERSONAL_CLAW_PI_MODEL is required for provider ${effectiveRef.provider}.`);
    }

    const provider = effectiveRef.baseUrl
      ? createConfiguredProvider({
          ...effectiveRef,
          provider: effectiveRef.provider,
          baseUrl: effectiveRef.baseUrl,
          modelId: effectiveRef.modelId
        })
      : createSupportedProvider(effectiveRef.provider);
    models.setProvider(provider);

    const model = models.getModel(provider.id, effectiveRef.modelId);

    if (!model) {
      throw new Error(`Model ${effectiveRef.modelId} was not found for provider ${provider.id}.`);
    }

    return {
      kind: "provider",
      models,
      model,
      runtime: {
        provider: provider.id,
        model: model.id,
        mode: "provider"
      }
    };
  }

  private injectApiKey(provider: SupportedPiProviderId): void {
    if (!this.apiKeyResolver) {
      return;
    }

    const envVar = providerApiKeyEnvVar(provider);

    if (!envVar) {
      return;
    }

    const key = this.apiKeyResolver(provider);

    if (key) {
      process.env[envVar] = key;
    }
  }

  private requireApiKey(provider: SupportedPiProviderId): void {
    const envVar = providerApiKeyEnvVar(provider);

    if (!envVar) {
      return;
    }

    if (!process.env[envVar]?.trim()) {
      throw new Error(
        `Missing API key for provider ${provider}. Please configure the model API key before sending a message.`
      );
    }
  }
}

export class Phase0AgentRuntimeAdapter extends PiAgentRuntimeAdapter {}

function isSupportedPiProviderId(value: string): value is SupportedPiProviderId {
  return [
    "anthropic",
    "deepseek",
    "faux",
    "kimi-coding",
    "moonshotai-cn",
    "openai",
    "xiaomi-token-plan-cn",
    "zai-coding-cn"
  ].includes(value);
}

function createSupportedProvider(provider: RealPiProviderId): Provider<Api> {
  switch (provider) {
    case "anthropic":
      return anthropicProvider();
    case "deepseek":
      return deepseekProvider();
    case "kimi-coding":
      return kimiCodingProvider();
    case "moonshotai-cn":
      return moonshotaiCnProvider();
    case "openai":
      return openaiProvider();
    case "xiaomi-token-plan-cn":
      return xiaomiTokenPlanCnProvider();
    case "zai-coding-cn":
      return zaiCodingCnProvider();
  }
}

function createConfiguredProvider(
  modelRef: PiModelRef & { provider: RealPiProviderId; baseUrl: string; modelId: string }
): Provider<Api> {
  const api = modelRef.api ?? defaultApiForProvider(modelRef.provider);
  const envVar = providerApiKeyEnvVar(modelRef.provider);

  return createProvider({
    id: modelRef.provider,
    name: modelRef.provider,
    baseUrl: modelRef.baseUrl,
    auth: {
      apiKey: envApiKeyAuth(`${modelRef.provider} API key`, envVar ? [envVar] : [])
    },
    models: [
      {
        id: modelRef.modelId,
        name: modelRef.modelId,
        api,
        provider: modelRef.provider,
        baseUrl: modelRef.baseUrl,
        reasoning: Boolean(modelRef.reasoning),
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 32_000
      }
    ],
    api: createProviderApi(api)
  });
}

function defaultApiForProvider(provider: RealPiProviderId): ConfiguredPiModelApi {
  if (provider === "anthropic") {
    return "anthropic-messages";
  }

  return "openai-completions";
}

function createProviderApi(api: ConfiguredPiModelApi) {
  switch (api) {
    case "anthropic-messages":
      return anthropicMessagesApi();
    case "google-generative-ai":
      return googleGenerativeAIApi();
    case "openai-responses":
      return openAIResponsesApi();
    case "openai-completions":
      return openAICompletionsApi();
  }
}

function toRuntimeEvents(
  event: AgentEvent,
  input: AgentRunInput,
  runtime: PiRuntimeRef,
  messageId: string
): AgentRuntimeEvent[] {
  if (event.type === "message_update" && isAssistantMessage(event.message)) {
    const streamEvent = event.assistantMessageEvent;

    if (streamEvent.type === "text_delta") {
      return [
        {
          type: "agent.delta",
          runId: input.runId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          payload: {
            messageId,
            delta: streamEvent.delta,
            runtime
          }
        }
      ];
    }

    if (streamEvent.type === "thinking_delta") {
      return [
        {
          type: "agent.thinking_delta",
          runId: input.runId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          payload: {
            messageId,
            delta: streamEvent.delta,
            runtime
          }
        }
      ];
    }
  }

  if (event.type === "message_end" && isAssistantMessage(event.message)) {
    return [
      {
        type: "agent.completed",
        runId: input.runId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        payload: {
          messageId,
          content: readAssistantText(event.message),
          stopReason: event.message.stopReason,
          usage: event.message.usage,
          runtime
        }
      }
    ];
  }

  if (event.type === "tool_execution_start") {
    const args: unknown = event.args;

    return [
      {
        type: "agent.tool_requested",
        runId: input.runId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        payload: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args,
          runtime
        }
      }
    ];
  }

  return [];
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return isRecord(message) && message.role === "assistant" && Array.isArray(message.content);
}

function readAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
}

function buildPersonalTaskSystemPrompt(): string {
  return [
    "你是 PersonalClaw 的个人任务管理智能体核心。",
    "你的职责是把用户输入整理成可理解、可审批、可恢复的个人任务草稿。",
    "当用户描述任务时，你以 loop agent 的方式循环完成 intake、analysis、plan design 和 approval gate。",
    "当前实现阶段不执行文件、Shell、网络或外部发送工具；任何工具调用都必须等待 Policy Engine 审批。",
    "回答时先给任务目标，再给缺失信息、建议自动化等级和下一步。"
  ].join("\n");
}

function buildLocalTaskPlannerResponse(prompt: string): string {
  const goal = prompt.trim().replace(/\s+/g, " ").slice(0, 180);

  return [
    "我已经把这条输入接入 **pi-agent-core** 的 loop agent 任务草稿流程。",
    "",
    `**任务目标**：${goal || "等待补充任务目标"}`,
    "",
    "| 项目 | 当前判断 |",
    "| --- | --- |",
    "| 建议自动化等级 | L0 建议 |",
    "| loop agent | intake -> analysis -> plan design -> approval gate |",
    "| 当前阶段 | 只做分析和方案草稿，不执行工具 |",
    "| 缺失信息 | 项目范围、完成标准、是否允许读取本地项目上下文 |",
    "",
    "下一步：确认项目与边界后，由 Core 在后续 Phase 生成 TaskAnalysis、Plan 和审批记录。当前草稿不会改变 Task/Plan/Run 持久状态。"
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    value: error
  };
}
