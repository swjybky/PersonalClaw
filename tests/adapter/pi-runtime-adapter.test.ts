import { describe, expect, it } from "vitest";
import {
  PERSONAL_TASK_TOOL_NAMES,
  PiAgentRuntimeAdapter,
  createPersonalTaskTools,
  createPersonalTaskToolsForMode,
  createPiModelRefFromEnv,
  providerApiKeyEnvVar,
  type AgentRuntimeEvent
} from "@personal-claw/pi-runtime-adapter";

describe("pi runtime adapter", () => {
  const noopTaskExecutor = async () => ({
    content: [{ type: "text" as const, text: "noop" }],
    details: {
      toolName: "task_list" as const,
      commandType: "task.list" as const,
      routedThrough: "core" as const,
      status: "accepted" as const,
      requestId: "cmd_noop",
      payload: {}
    }
  });

  it("exposes only PersonalClaw task-system tools to the agent", () => {
    const tools = createPersonalTaskTools({ executor: noopTaskExecutor });

    expect(tools.map((tool) => tool.name)).toEqual([...PERSONAL_TASK_TOOL_NAMES]);
    expect(tools.map((tool) => tool.name)).not.toContain("read_file");
    expect(tools.map((tool) => tool.name)).not.toContain("bash");
    expect(tools.map((tool) => tool.name)).not.toContain("http_request");
    expect(tools.map((tool) => tool.name)).not.toContain("browser_open");
    expect(tools.map((tool) => tool.name)).not.toContain("task_start");
  });

  it("accepts awaiting_approval in the task_list status filter", () => {
    const tool = createPersonalTaskTools({ executor: noopTaskExecutor }).find(
      (candidate) => candidate.name === "task_list"
    );

    if (!tool) {
      throw new Error("task_list tool missing");
    }

    const parameters = tool.parameters as {
      properties?: {
        statuses?: {
          items?: {
            anyOf?: Array<{ const?: unknown }>;
          };
        };
      };
    };
    const allowedStatuses = parameters.properties?.statuses?.items?.anyOf?.map(
      (variant) => variant.const
    );

    expect(allowedStatuses).toContain("awaiting_approval");
    expect(allowedStatuses).not.toContain("not_a_task_status");
  });

  it("injects zero task tools and emits no task tool requests in planning mode", async () => {
    let taskToolExecutions = 0;
    const taskToolExecutor = async () => {
      taskToolExecutions += 1;
      return noopTaskExecutor();
    };

    expect(createPersonalTaskToolsForMode("none", { executor: taskToolExecutor })).toEqual([]);

    const runtime = new PiAgentRuntimeAdapter({ taskToolExecutor });
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_planning_mode",
      sessionId: "session_planning_mode",
      prompt: "只生成任务规划草稿，不创建或启动任务。",
      toolMode: "none"
    })) {
      events.push(event);
    }

    expect(taskToolExecutions).toBe(0);
    expect(events.some((event) => event.type === "agent.tool_requested")).toBe(false);
    expect(events.find((event) => event.type === "agent.completed")?.payload.content).toContain(
      "无工具规划模式"
    );
  });

  it("throws instead of returning a fake tool result when Core executor is missing", async () => {
    const tool = createPersonalTaskTools().find((candidate) => candidate.name === "task_create");

    if (!tool) {
      throw new Error("task_create tool missing");
    }

    await expect(tool.execute("tool_call_test", {})).rejects.toThrow("Core task command executor was not injected");
  });

  it("routes task tools through the injected Core executor", async () => {
    const tool = createPersonalTaskTools({
      executor: async (input) => {
        expect(input.toolName).toBe("task_create");
        expect(input.commandType).toBe("task.create");
        expect(input.args).toEqual({
          projectId: "project_1",
          title: "测试任务",
          goal: "验证 Core 工具路由",
          source: {
            kind: "conversation"
          }
        });

        return {
          content: [{ type: "text", text: "Core accepted task.create." }],
          details: {
            toolName: input.toolName,
            commandType: input.commandType,
            routedThrough: "core",
            status: "accepted",
            requestId: "cmd_tool_1",
            payload: {
              id: "task_1",
              status: "draft"
            }
          }
        };
      }
    }).find((candidate) => candidate.name === "task_create");

    if (!tool) {
      throw new Error("task_create tool missing");
    }

    const result = await tool.execute("tool_call_test", {
      projectId: "project_1",
      title: "测试任务",
      goal: "验证 Core 工具路由",
      source: {
        kind: "conversation"
      }
    });

    expect(result.details).toEqual({
      toolName: "task_create",
      commandType: "task.create",
      routedThrough: "core",
      status: "accepted",
      requestId: "cmd_tool_1",
      payload: {
        id: "task_1",
        status: "draft"
      }
    });
  });

  it("streams a local PersonalClaw task response through pi-agent-core", async () => {
    const runtime = new PiAgentRuntimeAdapter();
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.start({
      runId: "run_test_1",
      sessionId: "session_test_1",
      prompt: "帮我整理今天要完成的三件事"
    })) {
      events.push(event);
    }

    const completed = events.find((event) => event.type === "agent.completed");

    expect(completed?.payload.content).toContain("**pi-agent-core**");
    expect(completed?.payload.content).toContain("| 项目 | 当前判断 |");
    expect(completed?.payload.content).toContain("任务新建、任务列表、任务详情、元数据和进度更新");
    expect(completed?.payload.content).toContain("Core 持久化任务库");
    expect(completed?.payload.runtime.mode).toBe("local-faux");
  });

  it("rejects unsupported provider names from environment config", () => {
    expect(() => createPiModelRefFromEnv({ PERSONAL_CLAW_PI_PROVIDER: "unknown-provider" })).toThrow(
      "Unsupported PERSONAL_CLAW_PI_PROVIDER"
    );
  });

  it("maps each real provider to its pi-ai api key env var and skips faux", () => {
    expect(providerApiKeyEnvVar("openai")).toBe("OPENAI_API_KEY");
    expect(providerApiKeyEnvVar("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(providerApiKeyEnvVar("deepseek")).toBe("DEEPSEEK_API_KEY");
    expect(providerApiKeyEnvVar("kimi-coding")).toBe("KIMI_API_KEY");
    expect(providerApiKeyEnvVar("faux")).toBeUndefined();
  });

  it("prefers an explicit model ref, then the resolver, then the default", () => {
    const resolverRuntime = new PiAgentRuntimeAdapter({
      modelRefResolver: () => ({ provider: "faux", modelId: "from-resolver" })
    });

    expect(resolverRuntime.describe().model).toBe("from-resolver");

    const explicitRuntime = new PiAgentRuntimeAdapter({
      defaultModelRef: { provider: "faux", modelId: "from-default" },
      modelRefResolver: () => ({ provider: "faux", modelId: "from-resolver" })
    });

    expect(explicitRuntime.describe({ modelRef: { provider: "faux", modelId: "explicit" } }).model).toBe(
      "explicit"
    );
  });

  it("fails fast when a real provider has no api key configured", () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    try {
      const runtime = new PiAgentRuntimeAdapter({
        defaultModelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        apiKeyResolver: () => ""
      });

      expect(() => runtime.describe()).toThrow("Missing API key for provider deepseek");
    } finally {
      if (previous === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previous;
      }
    }
  });

  it("falls back to the default model ref when the resolver throws or returns undefined", () => {
    const throwing = new PiAgentRuntimeAdapter({
      defaultModelRef: { provider: "faux", modelId: "from-default" },
      modelRefResolver: () => {
        throw new Error("config unavailable");
      }
    });

    expect(throwing.describe().model).toBe("from-default");

    const empty = new PiAgentRuntimeAdapter({
      defaultModelRef: { provider: "faux", modelId: "from-default" },
      modelRefResolver: () => undefined
    });

    expect(empty.describe().model).toBe("from-default");
  });

  it("describes a configured OpenAI-compatible custom endpoint", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const runtime = new PiAgentRuntimeAdapter({
        defaultModelRef: {
          provider: "openai",
          modelId: "local-model",
          baseUrl: "http://localhost:11434/v1",
          api: "openai-completions"
        },
        apiKeyResolver: () => "sk-local"
      });

      expect(runtime.describe()).toEqual({
        provider: "openai",
        model: "local-model",
        mode: "provider"
      });
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});
