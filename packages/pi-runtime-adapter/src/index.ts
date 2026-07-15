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
import {
  createPersonalTaskTools,
  createPersonalTaskToolsForMode,
  type PersonalTaskToolMode,
  type TaskToolExecutor
} from "./task-tools";

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
  projectId?: string;
  taskId?: string;
  prompt: string;
  toolMode?: PersonalTaskToolMode;
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
        thinking?: string;
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
  taskToolExecutor?: TaskToolExecutor;
  requestTimeoutMs?: number;
}

type PiRuntimeSession =
  | {
      kind: "faux";
      models: Models;
      model: Model<Api>;
      runtime: PiRuntimeRef;
      setPrompt(prompt: string, toolMode: PersonalTaskToolMode): void;
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
  private readonly taskToolExecutor: TaskToolExecutor | undefined;
  private readonly requestTimeoutMs: number;

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.defaultModelRef = options.defaultModelRef;
    this.modelRefResolver = options.modelRefResolver;
    this.apiKeyResolver = options.apiKeyResolver;
    this.systemPrompt = options.systemPrompt ?? buildPersonalTaskSystemPrompt();
    this.taskToolExecutor = options.taskToolExecutor;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 45_000;
  }

  describe(input: { modelRef?: PiModelRef } = {}): PiRuntimeRef {
    return this.createRuntimeSession(this.resolveModelRef(input.modelRef)).runtime;
  }

  async *start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    const queue = new AsyncEventQueue<AgentRuntimeEvent>();
    const toolMode = input.toolMode ?? "task_management";
    const runtimeSession = this.createRuntimeSession(
      this.resolveModelRef(input.modelRef)
    );
    const messageId = `${input.runId}_assistant`;
    const userPrompt = buildTaskManagerUserPrompt(input);
    const taskToolExecutor = this.taskToolExecutor;
    const taskTools = taskToolExecutor
      ? createPersonalTaskToolsForMode(toolMode, {
          executor: (toolInput) =>
            taskToolExecutor({
              ...toolInput,
              runId: input.runId,
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
              ...(input.projectId ? { projectId: input.projectId } : {}),
              ...(input.taskId ? { taskId: input.taskId } : {})
            })
        })
      : [];

    if (runtimeSession.kind === "faux") {
      runtimeSession.setPrompt(userPrompt, toolMode);
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: buildSystemPromptForToolMode(this.systemPrompt, toolMode),
        model: runtimeSession.model,
        thinkingLevel: input.thinkingLevel ?? "off",
        tools: taskTools
      },
      streamFn: runtimeSession.models.streamSimple.bind(runtimeSession.models),
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
        content: userPrompt,
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
        setPrompt(prompt: string, toolMode: PersonalTaskToolMode): void {
          faux.setResponses([fauxAssistantMessage(buildLocalTaskPlannerResponse(prompt, toolMode))]);
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
    const thinking = readAssistantThinking(event.message);

    return [
      {
        type: "agent.completed",
        runId: input.runId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        payload: {
          messageId,
          content: readAssistantText(event.message),
          ...(thinking ? { thinking } : {}),
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

function readAssistantThinking(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === "thinking")
    .map((item) => item.thinking)
    .join("\n\n");
}

function buildPersonalTaskSystemPrompt(): string {
  return [
    "你是 PersonalClaw 的后端任务管理智能体核心。",
    "你的唯一产品职责是帮助用户管理 PersonalClaw Core 中持久化的任务体系：任务新建、任务列表、任务详情、任务元数据更新和任务进度更新。",
    "Core 的任务数据库是唯一事实来源。只要用户要创建、查询、更新或推进任务进度，必须优先调用对应任务工具，而不是在聊天里编造状态。",
    "当前可用任务工具只有：task_create、task_list、task_get、task_update、task_update_progress。",
    "工具到 Core 的映射是：task_create -> task.create，task_list -> task.list，task_get -> task.get，task_update -> task.update，task_update_progress -> task.updateProgress。",
    "任务进入 queued/running 必须经过计划审批与 Core 执行门禁；你没有直接启动任务或绕过审批改变执行状态的工具。",
    "不得使用或声称拥有文件、Shell、HTTP、浏览器、邮件、日历、代码执行、数据库直连等非任务系统工具。",
    "Agent Utility 不直接访问 SQLite；所有持久化状态变化必须通过工具路由到 Core。只有工具结果 status 为 accepted 时，才可以说任务已经创建、更新或推进。",
    "如果 Context Pack 提供 activeProjectId，创建和列出任务时默认使用它；如果缺少 projectId 或 taskId，先问一个必要问题，不要猜测。",
    "新建任务时提炼 title、goal、priority、source，并在用户提供足够信息时补充 steps；source.kind 默认使用 conversation。",
    "查询任务列表时先调用 task_list；查看某个任务状态时先调用 task_get；更新进度时先调用 task_update_progress；用户要求开始执行时，说明需要先完成计划审批，不得自行把任务改为 queued/running。",
    "回复以任务结果为中心，简短说明任务 id、状态、进度、下一步或缺失信息。",
    "使用 Markdown 排版：不同要点之间空一行；并列信息用无序列表；关键项加粗。不要输出一整段无换行的长文字。"
  ].join("\n");
}

function buildSystemPromptForToolMode(
  basePrompt: string,
  toolMode: PersonalTaskToolMode
): string {
  if (toolMode === "task_management") {
    return basePrompt;
  }

  return [
    basePrompt,
    "",
    "本次运行是无工具规划模式（toolMode=none）。",
    "本次运行未注入任何任务工具，不得发起工具调用，不得创建、更新、启动任务，也不得声称已改变 Core 持久化状态。",
    "只输出当前规划请求要求的草稿内容，等待用户审批后再由 Core 进入后续流程。"
  ].join("\n");
}

function buildLocalTaskPlannerResponse(
  prompt: string,
  toolMode: PersonalTaskToolMode
): string {
  const goal = extractUserRequest(prompt).replace(/\s+/g, " ").slice(0, 180);

  if (toolMode === "none") {
    if (prompt.includes("PERSONAL_CLAW_TASK_DRAFT_JSON_V1")) {
      const description = extractTaskDraftDescription(prompt);
      return JSON.stringify({
        title: description.replace(/[.!?。！？]+$/u, "").slice(0, 72) || "待确认任务",
        objective: description || "确认任务目标与完成定义",
        assumptions: ["该草稿需要用户确认后才会由 Core 持久化"],
        constraints: ["规划阶段不调用工具，不改变外部状态"],
        missingInformation: [],
        expectedArtifacts: ["结构化任务分析", "可审批的方案版本"],
        suggestedAutomationLevel: "L0",
        steps: [
          {
            id: "step_1",
            type: "agent",
            title: "完善任务分析",
            goal: "确认目标、约束、风险与完成条件",
            dependsOn: [],
            expectedSideEffects: [],
            successCriteria: ["任务分析可由用户审阅"],
            retryStrategy: "根据用户补充信息生成新分析版本",
            rollbackNotes: "保留上一版分析"
          },
          {
            id: "step_2",
            type: "approval",
            title: "批准执行方案",
            goal: "由用户批准最新方案版本",
            dependsOn: ["step_1"],
            expectedSideEffects: [],
            successCriteria: ["用户明确批准最新方案版本"],
            retryStrategy: "未批准时返回方案编辑",
            rollbackNotes: "未批准方案不得进入执行队列"
          }
        ]
      });
    }

    return [
      "本次运行处于 **无工具规划模式**。",
      "",
      `**规划输入**：${goal || "等待补充任务目标"}`,
      "",
      "| 项目 | 当前判断 |",
      "| --- | --- |",
      "| toolMode | none |",
      "| 当前工具 | 无 |",
      "| 持久化状态 | 不创建、不更新、不启动任务 |",
      "| 注意 | 本地 faux 模型用于链路验证；不发起任务工具请求 |"
    ].join("\n");
  }

  return [
    "我已经通过 **pi-agent-core** 接入 **PersonalClaw Core 任务管理智能体**。",
    "",
    `**用户请求**：${goal || "等待补充任务目标"}`,
    "",
    "| 项目 | 当前判断 |",
    "| --- | --- |",
    "| 智能体职责 | 任务新建、任务列表、任务详情、元数据和进度更新 |",
    "| 当前工具 | task_create / task_list / task_get / task_update / task_update_progress |",
    "| 状态来源 | Core 持久化任务库 |",
    "| 注意 | 本地 faux 模型用于链路验证，不会主动发起真实工具调用 |",
    "",
    "使用真实模型时，我会先调用对应任务工具，只有 Core 返回 accepted 后才确认任务状态变化。"
  ].join("\n");
}

function extractTaskDraftDescription(prompt: string): string {
  const marker = "\nUser description:\n";
  const markerIndex = prompt.lastIndexOf(marker);
  if (markerIndex === -1) {
    return extractUserRequest(prompt).trim();
  }
  return prompt.slice(markerIndex + marker.length).trim();
}

function buildTaskManagerUserPrompt(input: AgentRunInput): string {
  const toolMode = input.toolMode ?? "task_management";
  const contextLines = [
    "Context Pack:",
    `- sessionId: ${input.sessionId ?? "unavailable"}`,
    `- runId: ${input.runId}`,
    `- toolMode: ${toolMode}`,
    input.projectId
      ? `- activeProjectId: ${input.projectId}`
      : "- activeProjectId: unavailable; ask for the target project before creating or listing persisted tasks.",
    input.taskId
      ? `- activeTaskId: ${input.taskId}`
      : "- activeTaskId: unavailable; ask for or search the task before updating a specific task.",
    "",
    "User request:",
    input.prompt
  ];

  return contextLines.join("\n");
}

function extractUserRequest(prompt: string): string {
  const marker = "\nUser request:\n";
  const markerIndex = prompt.indexOf(marker);

  if (markerIndex === -1) {
    return prompt.trim();
  }

  return prompt.slice(markerIndex + marker.length).trim();
}

export {
  PERSONAL_TASK_TOOL_NAMES,
  createPersonalTaskTools,
  createPersonalTaskToolsForMode,
  type PersonalTaskToolMode,
  type TaskToolExecutionInput,
  type TaskToolExecutor
} from "./task-tools";

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
