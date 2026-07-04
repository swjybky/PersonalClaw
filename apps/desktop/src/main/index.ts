import { app, BrowserWindow, ipcMain, nativeImage, shell } from "electron";
import { join } from "node:path";
import { resolveAppIconPath } from "./icon-path";
import {
  CommandEnvelopeSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  SystemHealthPayloadSchema,
  createEnvelope,
  type CommandResult,
  type SystemEventEnvelope,
  type UtilityWorkerName
} from "@personal-claw/contracts";
import { createId, createLogger, nowIso } from "@personal-claw/shared";
import { UtilitySupervisor } from "./supervisor";

const logger = createLogger({ process: "main" });
const startedAt = nowIso();
let mainWindow: BrowserWindow | undefined;
let isQuitting = false;

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

    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "ipc.unsupported_command",
        message: `Unsupported command: ${command.type}`
      }
    };
  });
}

function isRendererSmokeSummary(value: unknown): value is RendererSmokeSummary {
  if (typeof value !== "object" || value === null || !("status" in value) || !("workers" in value)) {
    return false;
  }

  const candidate = value as { status: unknown; workers: unknown; navigation?: unknown };

  if (typeof candidate.status !== "string" || !Array.isArray(candidate.workers)) {
    return false;
  }

  if (typeof candidate.navigation !== "object" || candidate.navigation === null) {
    return false;
  }

  const navigation = candidate.navigation as {
    beforeTitle?: unknown;
    afterTitle?: unknown;
    activeKey?: unknown;
  };

  const hasNullableString = (item: unknown): item is string | null => typeof item === "string" || item === null;

  return (
    hasNullableString(navigation.beforeTitle) &&
    hasNullableString(navigation.afterTitle) &&
    hasNullableString(navigation.activeKey)
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
          status: "ready",
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
        const beforeTitle = document.querySelector("h1")?.textContent?.trim() ?? null;
        const projectButton = document.querySelector('[data-nav-key="projects"]');

        if (projectButton instanceof HTMLButtonElement) {
          projectButton.click();
        }

        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const afterTitle = document.querySelector("h1")?.textContent?.trim() ?? null;
        const activeKey = document.querySelector(".nav-item.is-active")?.getAttribute("data-nav-key") ?? null;
        const navigationUpdated =
          projectButton instanceof HTMLButtonElement &&
          beforeTitle !== afterTitle &&
          afterTitle === "项目" &&
          activeKey === "projects";

        return {
          status: navigationUpdated ? health.status : "navigation_click_failed",
          workers: health.workers.map((worker) => ({
            name: worker.name,
            status: worker.status
          })),
          navigation: {
            beforeTitle,
            afterTitle,
            activeKey
          }
        };
      })()
    `),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Renderer smoke timed out.")), 4000);
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
  validateAppIcon();
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
