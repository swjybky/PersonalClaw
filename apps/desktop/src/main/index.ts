import { app, BrowserWindow, Menu, ipcMain, nativeImage, shell } from "electron";
import { join } from "node:path";
import { resolveAppIconPath } from "./icon-path";
import {
  CommandEnvelopeSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  SystemHealthPayloadSchema,
  createEnvelope,
  type CommandResult,
  type ModelConfigDeleteCommandPayload,
  type ModelConfigEntryInput,
  type ModelConfigSetDefaultCommandPayload,
  type ModelConfigSummaryListPayload,
  type SystemEventEnvelope,
  type UtilityWorkerName
} from "@personal-claw/contracts";
import { createId, createLogger, nowIso } from "@personal-claw/shared";
import { ModelConfigStore, resolveModelConfigPath } from "./model-config-store";
import { UtilitySupervisor } from "./supervisor";

const logger = createLogger({ process: "main" });
const startedAt = nowIso();
let mainWindow: BrowserWindow | undefined;
let isQuitting = false;
let modelConfigStore: ModelConfigStore | undefined;

function getModelConfigStore(): ModelConfigStore {
  if (!modelConfigStore) {
    modelConfigStore = new ModelConfigStore(resolveModelConfigPath(app.getPath("userData")));
  }

  return modelConfigStore;
}

interface RendererSmokeSummary {
  status: string;
  workers: Array<{
    name: string;
    status: string;
  }>;
  navigation: {
    beforeTitle: string | null;
    afterTitle: string | null;
    activeKey: string | null;
  };
  agent: {
    status: string;
    runtimeMode: string | null;
  };
  piWebComponents: {
    status: string;
    hasMarkdownBlock: boolean;
    hasMessageEditor: boolean;
    canRenderMarkdown: boolean;
  };
  conversationRender: {
    status: string;
    hasAssistantText: boolean;
    hasStrong: boolean;
    hasTable: boolean;
  };
  taskCore: {
    status: string;
    projectCount: number;
    codeAgentCount: number;
  };
}

function broadcastEvent(event: SystemEventEnvelope): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_EVENT_CHANNEL, event);
  }
}

function systemEventId(): string {
  return createId("evt");
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

const supervisor = new UtilitySupervisor({
  onUtilityEvent(event: SystemEventEnvelope) {
    broadcastEvent(event);
  },
  onUnexpectedExit(worker: UtilityWorkerName, reason: string) {
    const event = createEnvelope(
      "system.worker_restarted",
      {
        worker,
        reason,
        restartedAt: nowIso()
      },
      {
        id: systemEventId()
      }
    );

    logger.warn({ worker, reason }, "utility process exited unexpectedly");
    broadcastEvent(event);
    supervisor.startAll();
  }
});

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_COMMAND_CHANNEL, async (_event, rawCommand: unknown): Promise<CommandResult> => {
    const parsed = CommandEnvelopeSchema.safeParse(rawCommand);

    if (!parsed.success) {
      return {
        status: "rejected",
        requestId: "unknown",
        error: {
          code: "ipc.invalid_command",
          message: "Command envelope failed schema validation.",
          details: parsed.error.flatten()
        }
      };
    }

    const command = parsed.data;

    const forwardToUtility = async (
      worker: "core" | "agent",
      failureCode: string
    ): Promise<CommandResult> => {
      try {
        return await supervisor.requestCommand(worker, command);
      } catch (error: unknown) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: failureCode,
            message: error instanceof Error ? error.message : "Utility command failed.",
            details: serializeError(error)
          }
        };
      }
    };

    if (command.type === "system.health") {
      const health = SystemHealthPayloadSchema.parse(await supervisor.collectHealth());
      const event = createEnvelope("system.health", health, {
        id: systemEventId(),
        context: {
          correlationId: command.context?.correlationId ?? command.id
        }
      });

      broadcastEvent(event);

      return {
        status: "accepted",
        requestId: command.id,
        payload: health
      };
    }

    if (
      command.type.startsWith("project.") ||
      command.type.startsWith("codeAgent.") ||
      (command.type.startsWith("task.") && command.type !== "task.draftFromDescription")
    ) {
      return forwardToUtility("core", "ipc.core_command_failed");
    }

    if (command.type === "session.prompt" || command.type === "task.draftFromDescription") {
      return forwardToUtility("agent", "ipc.utility_command_failed");
    }

    if (command.type === "modelConfig.test") {
      return forwardToUtility("agent", "modelConfig.test_failed");
    }

    if (command.type === "modelConfig.list") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: getModelConfigStore().list()
      };
    }

    if (command.type === "modelConfig.upsert") {
      try {
        const payload: ModelConfigSummaryListPayload = getModelConfigStore().upsert(
          command.payload.entry as ModelConfigEntryInput
        );

        return {
          status: "accepted",
          requestId: command.id,
          payload
        };
      } catch (error: unknown) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "modelConfig.upsert_failed",
            message: error instanceof Error ? error.message : "Model config upsert failed.",
            details: serializeError(error)
          }
        };
      }
    }

    if (command.type === "modelConfig.delete") {
      const payload = getModelConfigStore().delete(
        (command.payload as ModelConfigDeleteCommandPayload).id
      );

      return {
        status: "accepted",
        requestId: command.id,
        payload
      };
    }

    if (command.type === "modelConfig.setDefault") {
      const payload = getModelConfigStore().setDefault(
        (command.payload as ModelConfigSetDefaultCommandPayload).id
      );

      return {
        status: "accepted",
        requestId: command.id,
        payload
      };
    }

    return {
      status: "rejected",
      requestId: "unsupported",
      error: {
        code: "ipc.unsupported_command",
        message: "Unsupported command."
      }
    };
  });
}

function isRendererSmokeSummary(value: unknown): value is RendererSmokeSummary {
  if (typeof value !== "object" || value === null || !("status" in value) || !("workers" in value)) {
    return false;
  }

  const candidate = value as {
    status: unknown;
    workers: unknown;
    navigation?: unknown;
    agent?: unknown;
    piWebComponents?: unknown;
    conversationRender?: unknown;
    taskCore?: unknown;
  };

  if (typeof candidate.status !== "string" || !Array.isArray(candidate.workers)) {
    return false;
  }

  if (typeof candidate.navigation !== "object" || candidate.navigation === null) {
    return false;
  }

  if (typeof candidate.agent !== "object" || candidate.agent === null) {
    return false;
  }

  if (typeof candidate.piWebComponents !== "object" || candidate.piWebComponents === null) {
    return false;
  }

  if (typeof candidate.conversationRender !== "object" || candidate.conversationRender === null) {
    return false;
  }

  if (typeof candidate.taskCore !== "object" || candidate.taskCore === null) {
    return false;
  }

  const navigation = candidate.navigation as {
    beforeTitle?: unknown;
    afterTitle?: unknown;
    activeKey?: unknown;
  };

  const hasNullableString = (item: unknown): item is string | null => typeof item === "string" || item === null;
  const agent = candidate.agent as {
    status?: unknown;
    runtimeMode?: unknown;
  };
  const piWebComponents = candidate.piWebComponents as {
    status?: unknown;
    hasMarkdownBlock?: unknown;
    hasMessageEditor?: unknown;
    canRenderMarkdown?: unknown;
  };
  const conversationRender = candidate.conversationRender as {
    status?: unknown;
    hasAssistantText?: unknown;
    hasStrong?: unknown;
    hasTable?: unknown;
  };
  const taskCore = candidate.taskCore as {
    status?: unknown;
    projectCount?: unknown;
    codeAgentCount?: unknown;
  };

  return (
    hasNullableString(navigation.beforeTitle) &&
    hasNullableString(navigation.afterTitle) &&
    hasNullableString(navigation.activeKey) &&
    typeof agent.status === "string" &&
    hasNullableString(agent.runtimeMode) &&
    typeof piWebComponents.status === "string" &&
    typeof piWebComponents.hasMarkdownBlock === "boolean" &&
    typeof piWebComponents.hasMessageEditor === "boolean" &&
    typeof piWebComponents.canRenderMarkdown === "boolean" &&
    typeof conversationRender.status === "string" &&
    typeof conversationRender.hasAssistantText === "boolean" &&
    typeof conversationRender.hasStrong === "boolean" &&
    typeof conversationRender.hasTable === "boolean" &&
    typeof taskCore.status === "string" &&
    typeof taskCore.projectCount === "number" &&
    typeof taskCore.codeAgentCount === "number"
  );
}

function validateAppIcon(): void {
  const iconPath = resolveAppIconPath();
  const icon = nativeImage.createFromPath(iconPath);

  if (icon.isEmpty()) {
    logger.warn({ iconPath }, "app icon missing or unreadable");
  }
}

async function createMainWindow(options: { showWhenReady?: boolean } = {}): Promise<BrowserWindow> {
  const iconPath = resolveAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: "PersonalClaw",
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#f7f7f2",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    if (options.showWhenReady !== false) {
      mainWindow?.show();
    }
  });

  mainWindow.webContents.once("did-finish-load", async () => {
    const health = await supervisor.collectHealth();
    broadcastEvent(
      createEnvelope(
        "system.ready",
        {
          status: "ready" as const,
          startedAt,
          workers: health.workers
        },
        {
          id: systemEventId()
        }
      )
    );
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

async function runSmoke(): Promise<void> {
  const health = await supervisor.collectHealth();
  const summary = {
    status: health.status,
    workers: health.workers.map((worker) => ({
      name: worker.name,
      status: worker.status,
      pid: worker.pid
    }))
  };

  logger.info({ summary }, "desktop smoke completed");
  process.stdout.write(`[personal-claw-smoke] ${JSON.stringify(summary)}\n`);
  await shutdownAndExit(health.status === "ok" ? 0 : 1);
}

async function runRendererSmoke(): Promise<void> {
  const window = await createMainWindow({ showWhenReady: false });
  const rawResult = await Promise.race([
    window.webContents.executeJavaScript(`
      (async () => {
        if (!window.personalClaw) {
          return {
            status: "missing_preload_api",
            workers: []
          };
        }

        const health = await window.personalClaw.system.health();
        const taskCore = await Promise.all([
          window.personalClaw.project.list(),
          window.personalClaw.codeAgent.list()
        ]).then(([projectList, codeAgentList]) => ({
          status: "ok",
          projectCount: projectList.projects.length,
          codeAgentCount: codeAgentList.profiles.length
        })).catch((error) => ({
          status: error instanceof Error ? error.message : "task_core_failed",
          projectCount: 0,
          codeAgentCount: 0
        }));
        const smokeSessionId = "renderer-smoke-session";
        const agent = await new Promise((resolve) => {
          let settled = false;
          const unsubscribe = window.personalClaw.events.subscribe((event) => {
            if (event.type === "agent.message_completed" && event.payload.sessionId === smokeSessionId) {
              settled = true;
              unsubscribe();
              resolve({
                status: "ok",
                runtimeMode: event.payload.runtime.mode
              });
            }

            if (event.type === "agent.error" && event.payload.sessionId === smokeSessionId) {
              settled = true;
              unsubscribe();
              resolve({
                status: event.payload.code,
                runtimeMode: event.payload.runtime?.mode ?? null
              });
            }
          });

          window.personalClaw.session.prompt({
            sessionId: smokeSessionId,
            message: "renderer smoke task"
          }).catch((error) => {
            if (!settled) {
              settled = true;
              unsubscribe();
              resolve({
                status: error instanceof Error ? error.message : "prompt_failed",
                runtimeMode: null
              });
            }
          });

          setTimeout(() => {
            if (!settled) {
              settled = true;
              unsubscribe();
              resolve({
                status: "agent_timeout",
                runtimeMode: null
              });
            }
          }, 3000);
        });
        const waitFor = async (predicate, timeoutMs = 5000) => {
          const startedAt = Date.now();

          while (Date.now() - startedAt < timeoutMs) {
            const value = predicate();

            if (value) {
              return value;
            }

            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          return null;
        };
        const piWebComponents = await Promise.race([
          Promise.all([
            customElements.whenDefined("markdown-block"),
            customElements.whenDefined("message-editor")
          ]).then(async () => {
            const probe = document.createElement("markdown-block");
            probe.content = "**renderer markdown**\\n\\n| A | B |\\n| --- | --- |\\n| 1 | 2 |";
            document.body.appendChild(probe);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const canRenderMarkdown =
              probe.querySelector("strong") !== null &&
              probe.querySelector("table") !== null;
            probe.remove();

            return {
              status: "ok",
              hasMarkdownBlock: customElements.get("markdown-block") !== undefined,
              hasMessageEditor: customElements.get("message-editor") !== undefined,
              canRenderMarkdown
            };
          }),
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                status: "pi_web_timeout",
                hasMarkdownBlock: customElements.get("markdown-block") !== undefined,
                hasMessageEditor: customElements.get("message-editor") !== undefined,
                canRenderMarkdown: false
              });
            }, 3000);
          })
        ]);
        const editor = await waitFor(() => document.querySelector("message-editor textarea, textarea.composer-native-input"));

        if (editor instanceof HTMLTextAreaElement) {
          editor.value = "renderer markdown smoke";
          editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: editor.value }));
          editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }

        const conversationRender = await waitFor(() => {
          const assistant = Array.from(document.querySelectorAll(".native-message.is-assistant")).at(-1);

          if (!assistant) {
            return null;
          }

          const text = assistant.textContent ?? "";
          const result = {
            status: "ok",
            hasAssistantText: text.includes("pi-agent-core"),
            hasStrong: assistant.querySelector("strong") !== null,
            hasTable: assistant.querySelector("table") !== null
          };

          return result.hasAssistantText && result.hasStrong && result.hasTable ? result : null;
        }, 6000) ?? {
          status: "conversation_render_timeout",
          hasAssistantText: false,
          hasStrong: false,
          hasTable: false
        };
        const beforeTitle = document.querySelector("h1")?.textContent?.trim() ?? null;
        const projectButton = document.querySelector('[data-nav-key="project-config"]');

        if (projectButton instanceof HTMLButtonElement) {
          projectButton.click();
        }

        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const afterTitle = document.querySelector("h1")?.textContent?.trim() ?? null;
        const activeKey = document.querySelector(".nav-item.is-active")?.getAttribute("data-nav-key") ?? null;
        const navigationUpdated =
          projectButton instanceof HTMLButtonElement &&
          beforeTitle !== afterTitle &&
          afterTitle === "项目配置" &&
          activeKey === "project-config";

        return {
          status:
            navigationUpdated &&
            agent.status === "ok" &&
            piWebComponents.status === "ok" &&
            piWebComponents.hasMessageEditor &&
            piWebComponents.hasMarkdownBlock &&
            piWebComponents.canRenderMarkdown &&
            conversationRender.status === "ok" &&
            conversationRender.hasAssistantText &&
            conversationRender.hasStrong &&
            conversationRender.hasTable &&
            taskCore.status === "ok" &&
            taskCore.projectCount > 0 &&
            taskCore.codeAgentCount > 0
              ? health.status
              : "navigation_agent_or_pi_web_failed",
          workers: health.workers.map((worker) => ({
            name: worker.name,
            status: worker.status
          })),
          navigation: {
            beforeTitle,
            afterTitle,
            activeKey
          },
          agent,
          piWebComponents,
          conversationRender,
          taskCore
        };
      })()
    `),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Renderer smoke timed out.")), 8000);
    })
  ]);

  if (!isRendererSmokeSummary(rawResult)) {
    logger.error({ rawResult }, "renderer smoke returned an invalid payload");
    await shutdownAndExit(1);
    return;
  }

  logger.info({ summary: rawResult }, "renderer smoke completed");
  process.stdout.write(`[personal-claw-renderer-smoke] ${JSON.stringify(rawResult)}\n`);
  await shutdownAndExit(rawResult.status === "ok" ? 0 : 1);
}

async function shutdownAndExit(exitCode = 0): Promise<void> {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  await supervisor.shutdownAll();
  app.exit(exitCode);
}

registerIpcHandlers();

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  validateAppIcon();
  supervisor.setEnvironment({
    PERSONAL_CLAW_USER_DATA_DIR: app.getPath("userData"),
    ...(process.env.PERSONAL_CLAW_RENDERER_SMOKE === "1" ? { PERSONAL_CLAW_PI_FORCE_FAUX: "1" } : {})
  });
  supervisor.startAll();

  if (process.env.PERSONAL_CLAW_SMOKE === "1") {
    await runSmoke();
    return;
  }

  if (process.env.PERSONAL_CLAW_RENDERER_SMOKE === "1") {
    await runRendererSmoke();
    return;
  }

  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
}).catch((error: unknown) => {
  logger.error({ error: serializeError(error) }, "failed to start desktop app");
  void shutdownAndExit(1);
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (!isQuitting) {
    event.preventDefault();
    void shutdownAndExit(0);
  }
});
