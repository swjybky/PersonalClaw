import { app, BrowserWindow, Menu, ipcMain, nativeImage, shell } from "electron";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

const isSmokeRuntime =
  process.env.PERSONAL_CLAW_SMOKE === "1" ||
  process.env.PERSONAL_CLAW_RENDERER_SMOKE === "1";
const smokeUserDataPath = isSmokeRuntime
  ? process.env.PERSONAL_CLAW_SMOKE_USER_DATA_DIR ??
    mkdtempSync(join(tmpdir(), "personal-claw-smoke-"))
  : null;
if (smokeUserDataPath) {
  app.setPath("userData", smokeUserDataPath);
}

const logger = createLogger({ process: "main" });
const startedAt = nowIso();
let mainWindow: BrowserWindow | undefined;
let isQuitting = false;
let modelConfigStore: ModelConfigStore | undefined;

function removeTemporarySmokeUserData(): void {
  if (!smokeUserDataPath) {
    return;
  }

  try {
    rmSync(smokeUserDataPath, { recursive: true, force: true });
  } catch (error: unknown) {
    logger.warn(
      { error: serializeError(error), smokeUserDataPath },
      "failed to remove temporary smoke userData"
    );
  }
}

if (smokeUserDataPath) {
  process.once("exit", removeTemporarySmokeUserData);
}

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
  phase2TaskFlow: {
    status: string;
    draftReviewable: boolean;
    taskCountUnchangedBeforeConfirmation: boolean;
    createdWithAnalysisAndPlan: boolean;
    createdAnalysisVersion: number;
    createdPlanVersion: number;
    editedAnalysisVersion: number;
    editedPlanVersion: number;
    stateFlow: string[];
    approvalRequestId: string | null;
    approvalSnapshotMatched: boolean;
    queuedStatus: string | null;
    fiveStageDomCount: number;
    executionBoundaryVisible: boolean;
    runEventCount: number;
    cleanupStatus: string;
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
    phase2TaskFlow?: unknown;
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

  if (typeof candidate.phase2TaskFlow !== "object" || candidate.phase2TaskFlow === null) {
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
  const phase2TaskFlow = candidate.phase2TaskFlow as {
    status?: unknown;
    draftReviewable?: unknown;
    taskCountUnchangedBeforeConfirmation?: unknown;
    createdWithAnalysisAndPlan?: unknown;
    createdAnalysisVersion?: unknown;
    createdPlanVersion?: unknown;
    editedAnalysisVersion?: unknown;
    editedPlanVersion?: unknown;
    stateFlow?: unknown;
    approvalRequestId?: unknown;
    approvalSnapshotMatched?: unknown;
    queuedStatus?: unknown;
    fiveStageDomCount?: unknown;
    executionBoundaryVisible?: unknown;
    runEventCount?: unknown;
    cleanupStatus?: unknown;
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
    typeof taskCore.codeAgentCount === "number" &&
    typeof phase2TaskFlow.status === "string" &&
    typeof phase2TaskFlow.draftReviewable === "boolean" &&
    typeof phase2TaskFlow.taskCountUnchangedBeforeConfirmation === "boolean" &&
    typeof phase2TaskFlow.createdWithAnalysisAndPlan === "boolean" &&
    typeof phase2TaskFlow.createdAnalysisVersion === "number" &&
    typeof phase2TaskFlow.createdPlanVersion === "number" &&
    typeof phase2TaskFlow.editedAnalysisVersion === "number" &&
    typeof phase2TaskFlow.editedPlanVersion === "number" &&
    Array.isArray(phase2TaskFlow.stateFlow) &&
    phase2TaskFlow.stateFlow.every((status) => typeof status === "string") &&
    hasNullableString(phase2TaskFlow.approvalRequestId) &&
    typeof phase2TaskFlow.approvalSnapshotMatched === "boolean" &&
    hasNullableString(phase2TaskFlow.queuedStatus) &&
    typeof phase2TaskFlow.fiveStageDomCount === "number" &&
    typeof phase2TaskFlow.executionBoundaryVisible === "boolean" &&
    typeof phase2TaskFlow.runEventCount === "number" &&
    typeof phase2TaskFlow.cleanupStatus === "string"
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
    minWidth: 1080,
    minHeight: 720,
    title: "PersonalClaw",
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#f6f7f8",
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
        const phase2TaskFlow = {
          status: "not_started",
          draftReviewable: false,
          taskCountUnchangedBeforeConfirmation: false,
          createdWithAnalysisAndPlan: false,
          createdAnalysisVersion: 0,
          createdPlanVersion: 0,
          editedAnalysisVersion: 0,
          editedPlanVersion: 0,
          stateFlow: [],
          approvalRequestId: null,
          approvalSnapshotMatched: false,
          queuedStatus: null,
          fiveStageDomCount: 0,
          executionBoundaryVisible: false,
          runEventCount: 0,
          cleanupStatus: "not_needed"
        };
        let phase2SmokeTaskId = null;

        try {
          const projectList = await window.personalClaw.project.list();
          const projectId = projectList.activeProjectId ?? projectList.projects[0]?.id;

          if (!projectId) {
            throw new Error("phase2_smoke_missing_project");
          }

          const suffix = Date.now().toString(36);
          const smokeTaskTitle = "Phase 2A renderer smoke " + suffix;
          const draftSessionId = "phase2-renderer-smoke-" + suffix;
          const beforeDraft = await window.personalClaw.task.list({ projectId });
          const draftEventPromise = new Promise((resolve, reject) => {
            let settled = false;
            let unsubscribe = () => undefined;
            const timeoutId = setTimeout(() => {
              if (!settled) {
                settled = true;
                unsubscribe();
                reject(new Error("phase2_task_draft_timeout"));
              }
            }, 6000);

            unsubscribe = window.personalClaw.events.subscribe((event) => {
              if (
                !settled &&
                event.type === "task.draft_created" &&
                event.payload.sessionId === draftSessionId
              ) {
                settled = true;
                clearTimeout(timeoutId);
                unsubscribe();
                resolve(event.payload);
              }
            });
          });
          const draftAccepted = await window.personalClaw.task.draftFromDescription({
            description:
              "为 PersonalClaw 整理一个只生成分析和 DAG 方案、不执行任何外部工具的 Phase 2A 冒烟任务。",
            sessionId: draftSessionId,
            projectId
          });
          const draftCreated = await draftEventPromise;
          const draft = draftCreated.draft;
          const afterDraft = await window.personalClaw.task.list({ projectId });
          const beforeDraftTaskIds = beforeDraft.tasks.map((task) => task.id).sort();
          const afterDraftTaskIds = afterDraft.tasks.map((task) => task.id).sort();

          phase2TaskFlow.draftReviewable =
            draftAccepted.runId === draftCreated.runId &&
            draftAccepted.draftId === draft.draftId &&
            draft.status === "draft" &&
            draft.title.length > 0 &&
            draft.steps.length > 0;
          phase2TaskFlow.taskCountUnchangedBeforeConfirmation =
            JSON.stringify(beforeDraftTaskIds) === JSON.stringify(afterDraftTaskIds);

          const orderedDraftSteps = [...draft.steps].sort(
            (left, right) => left.sequence - right.sequence
          );
          const stepKeyByDraftId = new Map(
            orderedDraftSteps.map((step) => [step.id, "step_" + step.sequence])
          );
          const planSteps = orderedDraftSteps.map((step) => ({
            key: stepKeyByDraftId.get(step.id),
            title: step.title,
            goal: step.goal,
            type: step.type,
            dependsOn: step.dependsOn.map((dependency) => {
              const dependencyKey = stepKeyByDraftId.get(dependency);

              if (!dependencyKey) {
                throw new Error("phase2_task_draft_unknown_dependency");
              }

              return dependencyKey;
            }),
            successCriteria: step.successCriteria,
            status: "pending"
          }));
          const completionDefinition = [
            ...new Set(orderedDraftSteps.flatMap((step) => step.successCriteria))
          ];
          const analysis = {
            objective: draft.objective,
            knownInformation: [...new Set(draft.assumptions)],
            missingInformation: [...new Set(draft.missingInformation)],
            constraints: [...new Set(draft.constraints)],
            risks: [...new Set(orderedDraftSteps.flatMap((step) => step.expectedSideEffects))],
            expectedArtifacts: [...new Set(draft.expectedArtifacts)],
            completionDefinition:
              completionDefinition.length > 0
                ? completionDefinition
                : ["完成：" + draft.objective],
            suggestedAutomationLevel: draft.suggestedAutomationLevel
          };
          const createdTask = await window.personalClaw.task.create({
            projectId,
            title: smokeTaskTitle,
            goal: draft.objective,
            source: {
              kind: "conversation",
              label: "Electron renderer smoke",
              referenceId: draft.draftId
            },
            priority: "normal",
            analysis,
            planSummary: "Phase 2A smoke 初始方案",
            steps: planSteps,
            codeAgentId: null
          });
          phase2SmokeTaskId = createdTask.id;

          let taskView = await window.personalClaw.task.get({ id: createdTask.id });
          phase2TaskFlow.stateFlow.push(taskView.task.status);
          phase2TaskFlow.createdAnalysisVersion = taskView.analysis?.version ?? 0;
          phase2TaskFlow.createdPlanVersion = taskView.plan?.version ?? 0;
          phase2TaskFlow.createdWithAnalysisAndPlan =
            taskView.task.source.referenceId === draft.draftId &&
            taskView.analysis?.version === 1 &&
            taskView.plan?.version === 1 &&
            taskView.plan.steps.length === planSteps.length;

          const editedAnalysis = await window.personalClaw.task.saveAnalysis({
            taskId: createdTask.id,
            expectedTaskVersion: taskView.task.version,
            analysis: {
              ...analysis,
              knownInformation: [...analysis.knownInformation, "草稿已由用户确认后才持久化"],
              completionDefinition: [
                ...analysis.completionDefinition,
                "任务进入 queued 后仍不产生 Run 或启动执行器"
              ]
            }
          });
          phase2TaskFlow.editedAnalysisVersion = editedAnalysis.version;
          taskView = await window.personalClaw.task.get({ id: createdTask.id });

          const editedPlan = await window.personalClaw.task.savePlan({
            taskId: createdTask.id,
            expectedTaskVersion: taskView.task.version,
            summary: "Phase 2A smoke 审批前方案 v2",
            steps: planSteps
          });
          phase2TaskFlow.editedPlanVersion = editedPlan.version;
          taskView = await window.personalClaw.task.get({ id: createdTask.id });

          await window.personalClaw.task.setStatus({ id: createdTask.id, status: "analyzing" });
          taskView = await window.personalClaw.task.get({ id: createdTask.id });
          phase2TaskFlow.stateFlow.push(taskView.task.status);
          await window.personalClaw.task.setStatus({ id: createdTask.id, status: "design_ready" });
          taskView = await window.personalClaw.task.get({ id: createdTask.id });
          phase2TaskFlow.stateFlow.push(taskView.task.status);

          const approvalPlan = await window.personalClaw.task.requestPlanApproval({
            taskId: createdTask.id,
            planId: taskView.plan.id,
            expectedTaskVersion: taskView.task.version
          });
          taskView = await window.personalClaw.task.get({ id: createdTask.id });
          phase2TaskFlow.stateFlow.push(taskView.task.status);
          const approvalSnapshot = approvalPlan.approvalSnapshot;
          phase2TaskFlow.approvalRequestId = approvalSnapshot?.requestId ?? null;
          phase2TaskFlow.approvalSnapshotMatched =
            approvalSnapshot !== null &&
            approvalSnapshot.taskVersion === taskView.task.version &&
            approvalSnapshot.analysisVersion === editedAnalysis.version &&
            approvalSnapshot.codeAgentId === null;

          if (!approvalSnapshot) {
            throw new Error("phase2_smoke_missing_approval_snapshot");
          }

          await window.personalClaw.task.approvePlan({
            taskId: createdTask.id,
            planId: approvalPlan.id,
            approvalRequestId: approvalSnapshot.requestId,
            expectedTaskVersion: taskView.task.version
          });
          const queuedView = await window.personalClaw.task.get({ id: createdTask.id });
          phase2TaskFlow.stateFlow.push(queuedView.task.status);
          phase2TaskFlow.queuedStatus = queuedView.task.status;
          phase2TaskFlow.runEventCount = queuedView.recentEvents.filter((event) =>
            event.eventType.startsWith("run.")
          ).length;

          const taskCenterButton = document.querySelector('[data-nav-key="task-center"]');
          if (!(taskCenterButton instanceof HTMLButtonElement)) {
            throw new Error("phase2_smoke_missing_task_center_navigation");
          }
          taskCenterButton.click();

          const smokeTaskButton = await waitFor(
            () =>
              Array.from(document.querySelectorAll(".task-center-list-item")).find((item) =>
                (item.textContent ?? "").includes(smokeTaskTitle)
              ) ?? null,
            6000
          );
          if (!(smokeTaskButton instanceof HTMLButtonElement)) {
            throw new Error("phase2_smoke_task_not_rendered");
          }
          smokeTaskButton.click();
          const smokeTaskSelected = await waitFor(
            () =>
              document.querySelector(".task-center-detail-header h1")?.textContent?.trim() ===
                smokeTaskTitle,
            6000
          );
          if (!smokeTaskSelected) {
            throw new Error("phase2_smoke_task_detail_not_selected");
          }
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );

          const stageIds = [
            "task-stage-goal",
            "task-stage-analysis",
            "task-stage-plan",
            "task-stage-execution",
            "task-stage-result"
          ];
          phase2TaskFlow.fiveStageDomCount = stageIds.filter((id) =>
            document.getElementById(id)
          ).length;
          const executionSection = document
            .getElementById("task-stage-execution")
            ?.closest(".task-stage-card");
          phase2TaskFlow.executionBoundaryVisible =
            (executionSection?.textContent ?? "").includes("不会启动真实 codeAgent") &&
            !("run" in queuedView);

          phase2TaskFlow.status =
            phase2TaskFlow.draftReviewable &&
            phase2TaskFlow.taskCountUnchangedBeforeConfirmation &&
            phase2TaskFlow.createdWithAnalysisAndPlan &&
            phase2TaskFlow.createdAnalysisVersion === 1 &&
            phase2TaskFlow.createdPlanVersion === 1 &&
            phase2TaskFlow.editedAnalysisVersion === 2 &&
            phase2TaskFlow.editedPlanVersion === 2 &&
            JSON.stringify(phase2TaskFlow.stateFlow) ===
              JSON.stringify([
                "draft",
                "analyzing",
                "design_ready",
                "awaiting_approval",
                "queued"
              ]) &&
            phase2TaskFlow.approvalRequestId !== null &&
            phase2TaskFlow.approvalSnapshotMatched &&
            phase2TaskFlow.queuedStatus === "queued" &&
            phase2TaskFlow.fiveStageDomCount === 5 &&
            phase2TaskFlow.executionBoundaryVisible &&
            phase2TaskFlow.runEventCount === 0
              ? "ok"
              : "phase2_task_flow_failed";
        } catch (error) {
          phase2TaskFlow.status =
            error instanceof Error ? error.message : "phase2_task_flow_failed";
        } finally {
          if (phase2SmokeTaskId) {
            try {
              let cleanupView = await window.personalClaw.task.get({ id: phase2SmokeTaskId });
              if (cleanupView.task.status === "awaiting_approval" && cleanupView.analysis) {
                await window.personalClaw.task.saveAnalysis({
                  taskId: phase2SmokeTaskId,
                  expectedTaskVersion: cleanupView.task.version,
                  analysis: {
                    objective: cleanupView.analysis.objective,
                    knownInformation: cleanupView.analysis.knownInformation,
                    missingInformation: cleanupView.analysis.missingInformation,
                    constraints: cleanupView.analysis.constraints,
                    risks: cleanupView.analysis.risks,
                    expectedArtifacts: cleanupView.analysis.expectedArtifacts,
                    completionDefinition: cleanupView.analysis.completionDefinition,
                    suggestedAutomationLevel: cleanupView.analysis.suggestedAutomationLevel
                  }
                });
                cleanupView = await window.personalClaw.task.get({ id: phase2SmokeTaskId });
              }
              if (cleanupView.availableTransitions.includes("cancelled")) {
                await window.personalClaw.task.setStatus({
                  id: phase2SmokeTaskId,
                  status: "cancelled",
                  reason: "Electron renderer smoke cleanup"
                });
                cleanupView = await window.personalClaw.task.get({ id: phase2SmokeTaskId });
              }
              if (!cleanupView.availableTransitions.includes("archived")) {
                throw new Error(
                  "phase2_smoke_cleanup_not_archivable_" + cleanupView.task.status
                );
              }
              const archivedTask = await window.personalClaw.task.delete({ id: phase2SmokeTaskId });
              phase2TaskFlow.cleanupStatus = archivedTask.status;
            } catch (error) {
              phase2TaskFlow.cleanupStatus =
                error instanceof Error ? error.message : "phase2_smoke_cleanup_failed";
            }
          }
        }
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
            taskCore.codeAgentCount > 0 &&
            phase2TaskFlow.status === "ok" &&
            phase2TaskFlow.cleanupStatus === "archived"
              ? health.status
              : "renderer_smoke_failed",
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
          taskCore,
          phase2TaskFlow
        };
      })()
    `),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Renderer smoke timed out.")), 25000);
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
  for (const window of BrowserWindow.getAllWindows()) {
    window.destroy();
  }
  removeTemporarySmokeUserData();
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
