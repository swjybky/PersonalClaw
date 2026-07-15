<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NConfigProvider, NDropdown } from "naive-ui";
import type { DropdownOption } from "naive-ui";
import type { UiMessage, UiToolCall } from "@personal-claw/chat-ui-adapter";
import type {
  CodeAgentProfile,
  PlanStepInput,
  ProjectSummary,
  SystemEventEnvelope,
  TaskAnalysisInput,
  TaskCreateCommandPayload,
  TaskDraftPreview,
  TaskPriority,
  TaskStatusView,
  TaskSummary,
  ThinkingLevel
} from "@personal-claw/contracts";
import AgentConversation from "./components/AgentConversation.vue";
import ModelConfig from "./components/ModelConfig.vue";
import ProjectConfig from "./components/ProjectConfig.vue";
import TaskCenter from "./components/TaskCenter.vue";
import TaskDraftReview from "./components/TaskDraftReview.vue";
import {
  buildConversationHistoryRecord,
  createConversationSessionId,
  hasUserMessage,
  loadConversationHistory,
  saveConversationHistory,
  upsertConversationHistory,
  type ConversationHistoryRecord
} from "./conversationHistory";
import {
  defaultNavigationKey,
  getNavigationItem,
  navigationItems,
  type NavigationKey
} from "./navigation";
import { useSystemStore } from "./stores/system";
import { useModelConfigStore } from "./stores/modelConfig";
import { useHistorySectionCollapse, useSidebarCollapse } from "./sidebarPane";
import { useTaskPaneCollapse } from "./taskPane";
import {
  defaultThinkingLevelForModel,
  resolveThinkingLevelForModel,
  supportsThinkingLevel
} from "./modelCapabilities";
import { pickTaskId, taskStatusLabel, type TaskFlowAction } from "./taskBoard";

interface HistoryItem {
  id: string;
  title: string;
  detail: string;
  isActive: boolean;
}

interface DetailRow {
  id: string;
  label: string;
  value: string;
}

interface SettingsSection {
  id: "system-prompt";
  label: string;
  detail: string;
}

interface ActiveAgentRun {
  sessionId: string;
  runId: string;
}

const system = useSystemStore();
const modelConfig = useModelConfigStore();
const activeSessionId = ref(createConversationSessionId());
const activeNavigationKey = ref<NavigationKey>(defaultNavigationKey);
const composerDraft = ref("");
const thinkingLevel = ref<ThinkingLevel>("off");
const { isSidebarCollapsed, sidebarToggleLabel, toggleSidebar } = useSidebarCollapse();
const { isHistoryCollapsed, historyToggleLabel, toggleHistory } = useHistorySectionCollapse();
const { isTaskPaneCollapsed, taskPaneToggleLabel, collapseTaskPane, toggleTaskPane } = useTaskPaneCollapse();
const assistantMessageByRun = new Map<string, string>();
const finishedAgentRunKeys = new Set<string>();
const handledEventIds = new Set<string>();
const agentRunTimeouts = new Map<string, number>();
type BufferedTaskDraftTerminalEvent =
  | Extract<SystemEventEnvelope, { type: "task.draft_created" }>
  | Extract<SystemEventEnvelope, { type: "agent.error" }>;
const bufferedTaskDraftTerminalEvents = new Map<string, BufferedTaskDraftTerminalEvent>();
let selectedTaskViewRequestToken = 0;
let taskListRequestToken = 0;
let skipNextHistoryPersist = false;
const messages = ref<UiMessage[]>(createDefaultConversationMessages());
const activeAgentRuns = ref<ActiveAgentRun[]>([]);
const toolCalls = ref<UiToolCall[]>([]);
const latestTaskDraft = ref<TaskDraftPreview | null>(null);
const latestAgentDiagnostic = ref<string | null>(null);

const historyRecords = ref<ConversationHistoryRecord[]>([]);
const openHistoryActionSessionId = ref<string | null>(null);
const projects = ref<ProjectSummary[]>([]);
const selectedProjectId = ref<string | null>(null);
const taskList = ref<TaskSummary[]>([]);
const selectedTaskId = ref<string | null>(null);
const selectedTaskView = ref<TaskStatusView | null>(null);
const codeAgents = ref<CodeAgentProfile[]>([]);
const taskCoreError = ref<string | null>(null);
const isTaskCoreLoading = ref(false);
const isTaskMutationSaving = ref(false);
const isTaskDraftSaving = ref(false);
const isTaskDraftRunning = ref(false);
const pendingTaskDraftRunId = ref<string | null>(null);
const isCreateTaskDialogOpen = ref(false);
const newTaskTitle = ref("");
const newTaskGoal = ref("");
const newTaskProjectId = ref("");
const newTaskPriority = ref<TaskPriority>("normal");
const newTaskCodeAgentId = ref("");
const activeSettingsSectionId = ref<SettingsSection["id"]>("system-prompt");
const systemPromptDraft = ref(
  "你是 PersonalClaw，一个本地优先、可审批、可恢复、可审计的个人任务智能体。你需要把用户目标拆解为可验证的任务、方案和执行步骤，并在涉及工具、文件、密钥或外部系统时遵守项目权限与人工审批边界。"
);

const taskPriorityOptions: readonly TaskPriority[] = ["low", "normal", "high", "urgent"];

const sourceRows: readonly DetailRow[] = [
  { id: "manual", label: "手动输入", value: "启用" },
  { id: "schedule", label: "定时任务", value: "待 Core Scheduler 接入" },
  { id: "missed", label: "错过策略", value: "run_once_now / skip" },
  { id: "identity", label: "幂等键", value: "occurrenceId + sourceId" }
];

const codeAgentRows: readonly DetailRow[] = [
  { id: "kimi", label: "Kimi", value: "可配置模型入口" },
  { id: "cursor", label: "Cursor", value: "可配置桌面代码助手" },
  { id: "claude-code", label: "Claude Code", value: "可配置 CLI Agent" },
  { id: "codex", label: "Codex", value: "可配置 CLI Agent" }
];

const settingsSections: readonly SettingsSection[] = [
  {
    id: "system-prompt",
    label: "系统提示词",
    detail: "构建这个智能体的任务提示词"
  }
];

const navigationShortcutByKey: Partial<Record<NavigationKey, string>> = {
  conversation: "Ctrl+N"
};

const activeNavigation = computed(() => getNavigationItem(activeNavigationKey.value));
const isFullBleedView = computed(
  () =>
    activeNavigationKey.value === "conversation" ||
    activeNavigationKey.value === "task-center" ||
    activeNavigationKey.value === "model-config" ||
    activeNavigationKey.value === "project-config" ||
    activeNavigationKey.value === "settings"
);
const modelLabel = computed(() => modelConfig.defaultSummary?.label ?? "本地 Faux");
const modeLabel = computed(() => (modelConfig.hasRealProvider ? "个人任务助手" : "本地模式"));
const activeModelSupportsThinking = computed(() => supportsThinkingLevel(modelConfig.defaultSummary));
const effectiveThinkingLevel = computed(() =>
  resolveThinkingLevelForModel(modelConfig.defaultSummary, thinkingLevel.value)
);
const isConversationStreaming = computed(() =>
  activeAgentRuns.value.some((run) => run.sessionId === activeSessionId.value)
);
const historyItems = computed<HistoryItem[]>(() =>
  historyRecords.value.map((record) => ({
    id: record.id,
    title: record.title,
    detail: record.detail,
    isActive: record.id === activeSessionId.value
  }))
);
const historyActionOptions: DropdownOption[] = [{ label: "删除", key: "delete" }];
const selectedTask = computed(() =>
  taskList.value.find((task) => task.id === selectedTaskId.value) ?? null
);
const projectNameById = computed(() =>
  new Map(projects.value.map((project) => [project.id, project.name] as const))
);
const codeAgentOptions = computed(() =>
  codeAgents.value.filter((profile) => profile.enabled && profile.archivedAt === null)
);

function formatTaskCoreError(error: unknown): string {
  return error instanceof Error ? error.message : "任务系统操作失败。";
}

async function refreshProjects(): Promise<void> {
  const payload = await window.personalClaw.project.list();
  projects.value = payload.projects;

  if (!selectedProjectId.value || !payload.projects.some((project) => project.id === selectedProjectId.value)) {
    selectedProjectId.value = payload.activeProjectId;
  }

  if (!newTaskProjectId.value || !payload.projects.some((project) => project.id === newTaskProjectId.value)) {
    newTaskProjectId.value = selectedProjectId.value ?? payload.activeProjectId ?? "";
  }
}

async function refreshCodeAgents(): Promise<void> {
  const payload = await window.personalClaw.codeAgent.list();
  codeAgents.value = payload.profiles;
}

async function refreshSelectedTask(): Promise<void> {
  const taskId = selectedTaskId.value;
  const requestToken = ++selectedTaskViewRequestToken;

  if (!taskId) {
    selectedTaskView.value = null;
    return;
  }

  if (selectedTaskView.value?.task.id !== taskId) {
    selectedTaskView.value = null;
  }

  const view = await window.personalClaw.task.get({ id: taskId });
  if (requestToken !== selectedTaskViewRequestToken || selectedTaskId.value !== taskId) {
    return;
  }
  selectedTaskView.value = view;
}

async function refreshTasks(): Promise<void> {
  const requestToken = ++taskListRequestToken;
  if (!projects.value.length) {
    selectedTaskViewRequestToken += 1;
    taskList.value = [];
    selectedTaskId.value = null;
    selectedTaskView.value = null;
    return;
  }

  const taskPayloads = await Promise.all(
    projects.value.map((project) => window.personalClaw.task.list({ projectId: project.id }))
  );
  if (requestToken !== taskListRequestToken) {
    return;
  }
  const tasks = taskPayloads
    .flatMap((payload) => payload.tasks)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  taskList.value = tasks;
  selectedTaskId.value = pickTaskId(tasks, selectedTaskId.value);
  await refreshSelectedTask();
}

async function initializeTaskCore(): Promise<void> {
  isTaskCoreLoading.value = true;
  taskCoreError.value = null;

  try {
    await Promise.all([refreshProjects(), refreshCodeAgents()]);
    await refreshTasks();
  } catch (error: unknown) {
    taskCoreError.value = formatTaskCoreError(error);
  } finally {
    isTaskCoreLoading.value = false;
  }
}

async function handleProjectConfigChanged(): Promise<void> {
  taskCoreError.value = null;

  try {
    await refreshProjects();
    await refreshTasks();
  } catch (error: unknown) {
    taskCoreError.value = formatTaskCoreError(error);
  }
}

function openCreateTaskDialog(): void {
  newTaskProjectId.value = selectedProjectId.value ?? projects.value[0]?.id ?? "";
  isCreateTaskDialogOpen.value = true;
}

function closeCreateTaskDialog(): void {
  isCreateTaskDialogOpen.value = false;
}

async function createTaskFromPane(): Promise<void> {
  const projectId = newTaskProjectId.value;
  const title = newTaskTitle.value.trim();
  const goal = newTaskGoal.value.trim();

  if (!projectId || !title || !goal) {
    return;
  }

  taskCoreError.value = null;

  try {
    const task = await window.personalClaw.task.create({
      projectId,
      title,
      goal,
      source: {
        kind: "manual",
        label: "手动创建"
      },
      priority: newTaskPriority.value,
      codeAgentId: newTaskCodeAgentId.value || null
    });

    newTaskTitle.value = "";
    newTaskGoal.value = "";
    closeCreateTaskDialog();
    selectedTaskId.value = task.id;
    await refreshTasks();
    activeNavigationKey.value = "task-center";
  } catch (error: unknown) {
    taskCoreError.value = formatTaskCoreError(error);
  }
}

async function runTaskMutation(action: () => Promise<unknown>): Promise<void> {
  taskCoreError.value = null;
  isTaskMutationSaving.value = true;

  try {
    await action();
    await refreshTasks();
  } catch (error: unknown) {
    taskCoreError.value = formatTaskCoreError(error);
  } finally {
    isTaskMutationSaving.value = false;
  }
}

async function deleteSelectedTask(taskId = selectedTask.value?.id): Promise<void> {
  if (
    !taskId ||
    selectedTaskId.value !== taskId ||
    selectedTaskView.value?.task.id !== taskId
  ) {
    return;
  }

  await runTaskMutation(() => window.personalClaw.task.delete({ id: taskId }));
}

async function saveTaskAnalysis(payload: { taskId: string; analysis: TaskAnalysisInput }): Promise<void> {
  const currentView = selectedTaskView.value;
  const expectedTaskVersion =
    selectedTaskId.value === payload.taskId && currentView?.task.id === payload.taskId
      ? currentView.task.version
      : undefined;

  if (!expectedTaskVersion) {
    taskCoreError.value = "无法确认任务版本，请刷新任务详情后重试。";
    return;
  }

  await runTaskMutation(() =>
    window.personalClaw.task.saveAnalysis({
      ...payload,
      expectedTaskVersion
    })
  );
}

async function saveTaskPlan(payload: {
  taskId: string;
  summary: string;
  steps: PlanStepInput[];
}): Promise<void> {
  const currentView = selectedTaskView.value;
  const expectedTaskVersion =
    selectedTaskId.value === payload.taskId && currentView?.task.id === payload.taskId
      ? currentView.task.version
      : undefined;

  if (!expectedTaskVersion) {
    taskCoreError.value = "无法确认任务版本，请刷新任务详情后重试。";
    return;
  }

  await runTaskMutation(() =>
    window.personalClaw.task.savePlan({
      ...payload,
      expectedTaskVersion
    })
  );
}

async function handleTaskFlowAction(action: TaskFlowAction): Promise<void> {
  const currentView = selectedTaskView.value;
  const taskId = currentView?.task.id;

  if (
    !taskId ||
    selectedTaskId.value !== taskId ||
    action.disabledReason ||
    action.kind === "phase4_wait"
  ) {
    return;
  }

  if (action.kind === "set_status") {
    await runTaskMutation(() =>
      window.personalClaw.task.setStatus({ id: taskId, status: action.status })
    );
    return;
  }

  if (!action.planId) {
    taskCoreError.value = "当前任务没有可操作的方案版本。";
    return;
  }

  const expectedTaskVersion = currentView.task.version;
  if (!expectedTaskVersion) {
    taskCoreError.value = "无法确认任务版本，请刷新任务详情后重试。";
    return;
  }

  if (action.kind === "approve_plan") {
    const approvalRequestId = currentView.plan?.approvalSnapshot?.requestId;

    if (!approvalRequestId) {
      taskCoreError.value = "当前方案缺少有效的审批请求，请重新提交审批。";
      return;
    }

    await runTaskMutation(() =>
      window.personalClaw.task.approvePlan({
        taskId,
        planId: action.planId!,
        approvalRequestId,
        expectedTaskVersion
      })
    );
    return;
  }

  await runTaskMutation(() =>
    window.personalClaw.task.requestPlanApproval({
      taskId,
      planId: action.planId!,
      expectedTaskVersion
    })
  );
}

async function assignTaskCodeAgent(payload: {
  taskId: string;
  codeAgentId: string | null;
}): Promise<void> {
  if (
    selectedTaskId.value !== payload.taskId ||
    selectedTaskView.value?.task.id !== payload.taskId
  ) {
    taskCoreError.value = "任务选择已变化，请重新选择后再保存执行器。";
    return;
  }
  await runTaskMutation(() =>
    window.personalClaw.task.assignCodeAgent({ id: payload.taskId, codeAgentId: payload.codeAgentId })
  );
}

async function organizeConversationAsTask(description: string): Promise<void> {
  const normalized = description.trim();
  const requestSessionId = activeSessionId.value;

  if (!normalized || isConversationStreaming.value || isTaskDraftRunning.value) {
    return;
  }

  taskCoreError.value = null;
  latestTaskDraft.value = null;
  isTaskDraftRunning.value = true;

  if (isTaskPaneCollapsed.value) {
    toggleTaskPane();
  }

  try {
    const accepted = await window.personalClaw.task.draftFromDescription({
      description: normalized,
      sessionId: requestSessionId,
      ...(selectedProjectId.value ? { projectId: selectedProjectId.value } : {}),
      thinkingLevel: effectiveThinkingLevel.value,
      loop: { maxIterations: 4 }
    });

    if (!isTaskDraftRunning.value || activeSessionId.value !== requestSessionId) {
      return;
    }

    pendingTaskDraftRunId.value = accepted.runId;
    composerDraft.value = "";
    const bufferedTerminalEvent = bufferedTaskDraftTerminalEvents.get(accepted.runId);
    if (bufferedTerminalEvent) {
      bufferedTaskDraftTerminalEvents.delete(accepted.runId);
      applyTaskDraftTerminalEvent(bufferedTerminalEvent);
      return;
    }
    markRunStreaming(accepted.sessionId, accepted.runId);
    watchRunProgress(accepted.sessionId, accepted.runId);
  } catch (error: unknown) {
    isTaskDraftRunning.value = false;
    pendingTaskDraftRunId.value = null;
    taskCoreError.value = formatTaskCoreError(error);
  }
}

async function confirmTaskDraft(payload: TaskCreateCommandPayload): Promise<void> {
  isTaskDraftSaving.value = true;
  taskCoreError.value = null;

  try {
    const task = await window.personalClaw.task.create(payload);
    selectedTaskId.value = task.id;
    latestTaskDraft.value = null;
    await refreshTasks();
    activeNavigationKey.value = "task-center";
  } catch (error: unknown) {
    taskCoreError.value = formatTaskCoreError(error);
  } finally {
    isTaskDraftSaving.value = false;
  }
}

function selectNavigation(key: NavigationKey): void {
  if (key === "conversation") {
    startNewConversation();
    return;
  }

  activeNavigationKey.value = key;
}

function selectTask(taskId: string): void {
  if (selectedTaskId.value === taskId) {
    return;
  }

  selectedTaskViewRequestToken += 1;
  selectedTaskView.value = null;
  selectedTaskId.value = taskId;
}

function openModelConfig(): void {
  activeNavigationKey.value = "model-config";
}

function openSettings(): void {
  activeNavigationKey.value = "settings";
}

function returnHome(): void {
  activeNavigationKey.value = "conversation";
}

function updateThinkingLevel(value: ThinkingLevel): void {
  thinkingLevel.value = activeModelSupportsThinking.value ? value : "off";
}

function removeHistorySession(sessionId: string): void {
  const nextRecords = historyRecords.value.filter((record) => record.id !== sessionId);

  if (nextRecords.length === historyRecords.value.length) {
    return;
  }

  historyRecords.value = nextRecords;
  saveConversationHistory(historyRecords.value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function redactDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 12).map(redactDiagnosticValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (/api.?key|authorization|bearer|cookie|password|secret|token/i.test(key)) {
      redacted[key] = "[redacted]";
      continue;
    }

    redacted[key] = redactDiagnosticValue(item);
  }

  return redacted;
}

function stringifyDiagnosticDetails(details: unknown): string | undefined {
  if (details === undefined) {
    return undefined;
  }

  if (typeof details === "string") {
    return details.slice(0, 1200);
  }

  try {
    return JSON.stringify(redactDiagnosticValue(details), null, 2).slice(0, 1200);
  } catch {
    return String(details).slice(0, 1200);
  }
}

function stringifyToolCallSummary(args: unknown): string {
  const prefix = "工具调用请求";

  if (args === undefined) {
    return prefix;
  }

  try {
    const details = JSON.stringify(redactDiagnosticValue(args), null, 2);

    return `${prefix} · 参数 ${details.slice(0, 180)}`;
  } catch (error: unknown) {
    return `${prefix} · 参数 ${String(error instanceof Error ? error.message : args).slice(0, 180)}`;
  }
}

function formatAgentDiagnostic(event: Extract<SystemEventEnvelope, { type: "agent.error" }>): string {
  const lines = [
    `code: ${event.payload.code}`,
    `message: ${event.payload.message}`
  ];

  if (event.payload.runtime) {
    lines.push(`provider: ${event.payload.runtime.provider}`);
    lines.push(`model: ${event.payload.runtime.model}`);
    lines.push(`mode: ${event.payload.runtime.mode}`);
  }

  const details = stringifyDiagnosticDetails(event.payload.details);

  if (details) {
    lines.push("details:");
    lines.push(details);
  }

  return lines.join("\n");
}

function deleteHistorySession(sessionId: string): void {
  removeHistorySession(sessionId);

  if (sessionId !== activeSessionId.value) {
    return;
  }

  activeSessionId.value = createConversationSessionId();
  composerDraft.value = "";
  assistantMessageByRun.clear();
  toolCalls.value = [];
  latestTaskDraft.value = null;
  isTaskDraftRunning.value = false;
  pendingTaskDraftRunId.value = null;
  latestAgentDiagnostic.value = null;
  skipNextHistoryPersist = true;
  messages.value = createDefaultConversationMessages();
  activeNavigationKey.value = "conversation";
}

function toggleHistoryActionMenu(sessionId: string, event: MouseEvent): void {
  event.stopPropagation();
  openHistoryActionSessionId.value = openHistoryActionSessionId.value === sessionId ? null : sessionId;
}

function closeHistoryActionMenu(): void {
  openHistoryActionSessionId.value = null;
}

function handleDocumentClick(event: MouseEvent): void {
  const target = event.target;

  if (!(target instanceof Node)) {
    return;
  }

  if (!(target instanceof Element)) {
    closeHistoryActionMenu();
    return;
  }

  if (target.closest(".history-action") || target.closest(".n-dropdown-menu")) {
    return;
  }

  closeHistoryActionMenu();
}

function handleHistoryAction(sessionId: string, actionKey: string | number): void {
  closeHistoryActionMenu();

  if (actionKey === "delete") {
    deleteHistorySession(sessionId);
    return;
  }

  throw new Error(`未知历史对话操作：${String(actionKey)}`);
}

function startNewConversation(): void {
  collapseTaskPane();

  if (!hasUserMessage(messages.value)) {
    removeHistorySession(activeSessionId.value);
  }

  activeSessionId.value = createConversationSessionId();
  composerDraft.value = "";
  assistantMessageByRun.clear();
  toolCalls.value = [];
  latestTaskDraft.value = null;
  isTaskDraftRunning.value = false;
  pendingTaskDraftRunId.value = null;
  latestAgentDiagnostic.value = null;
  skipNextHistoryPersist = true;
  messages.value = createDefaultConversationMessages();
  activeNavigationKey.value = "conversation";
}

function createDefaultConversationMessages(): UiMessage[] {
  return [];
}

function initializeConversationHistory(): void {
  const loadedRecords = loadConversationHistory().filter((record) => hasUserMessage(record.messages));

  historyRecords.value = loadedRecords;
  saveConversationHistory(historyRecords.value);
}

function persistActiveConversation(): void {
  if (!hasUserMessage(messages.value)) {
    return;
  }

  const record = buildConversationHistoryRecord({
    id: activeSessionId.value,
    messages: messages.value
  });

  historyRecords.value = upsertConversationHistory(record, historyRecords.value);
  saveConversationHistory(historyRecords.value);
}

function selectHistory(id: string): void {
  closeHistoryActionMenu();

  const record = historyRecords.value.find((item) => item.id === id);

  if (!record) {
    throw new Error(`未找到历史对话：${id}`);
  }

  activeSessionId.value = record.id;
  activeNavigationKey.value = "conversation";
  composerDraft.value = "";
  assistantMessageByRun.clear();
  toolCalls.value = [];
  latestTaskDraft.value = null;
  isTaskDraftRunning.value = false;
  pendingTaskDraftRunId.value = null;
  latestAgentDiagnostic.value = null;
  skipNextHistoryPersist = true;
  messages.value = record.messages.map((message) => ({ ...message }));
}

function agentRunKey(sessionId: string, runId: string): string {
  return `${sessionId}:${runId}`;
}

function markRunStreaming(sessionId: string, runId: string): void {
  const key = agentRunKey(sessionId, runId);

  if (finishedAgentRunKeys.has(key)) {
    return;
  }

  if (activeAgentRuns.value.some((run) => run.sessionId === sessionId && run.runId === runId)) {
    return;
  }

  activeAgentRuns.value = [...activeAgentRuns.value, { sessionId, runId }];
}

function finishRun(sessionId: string, runId: string): void {
  const key = agentRunKey(sessionId, runId);
  const timeoutId = agentRunTimeouts.get(key);

  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId);
    agentRunTimeouts.delete(key);
  }

  finishedAgentRunKeys.add(key);
  activeAgentRuns.value = activeAgentRuns.value.filter(
    (run) => run.sessionId !== sessionId || run.runId !== runId
  );
}

function watchRunProgress(sessionId: string, runId: string): void {
  const key = agentRunKey(sessionId, runId);

  if (agentRunTimeouts.has(key)) {
    return;
  }

  const timeoutId = window.setTimeout(() => {
    if (finishedAgentRunKeys.has(key)) {
      return;
    }

    finishRun(sessionId, runId);

    if (runId === pendingTaskDraftRunId.value) {
      isTaskDraftRunning.value = false;
      pendingTaskDraftRunId.value = null;
      taskCoreError.value = "任务草稿整理超时，请检查模型配置后重试。";
      return;
    }

    if (sessionId !== activeSessionId.value) {
      return;
    }

    const messageId = ensureAssistantMessage(runId);
    latestAgentDiagnostic.value =
      "code: renderer.agent_event_timeout\nmessage: Agent 已接受请求，但超过 60 秒没有收到模型输出或错误事件。请检查模型配置、API Key、网络，或查看右侧最近事件。";
    updateAssistantMessage(
      messageId,
      latestAgentDiagnostic.value
    );
  }, 60_000);

  agentRunTimeouts.set(key, timeoutId);
}

function ensureAssistantMessage(runId: string): string {
  const existingId = assistantMessageByRun.get(runId);

  if (existingId) {
    return existingId;
  }

  const id = `message-assistant-${runId}`;
  assistantMessageByRun.set(runId, id);
  messages.value = [
    ...messages.value,
    {
      id,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString()
    }
  ];

  return id;
}

function updateAssistantMessage(messageId: string, nextContent: string): void {
  messages.value = messages.value.map((message) =>
    message.id === messageId
      ? {
          ...message,
          content: nextContent,
          createdAt: new Date().toISOString()
        }
      : message
  );
}

function updateAssistantThinking(messageId: string, nextThinking: string): void {
  messages.value = messages.value.map((message) =>
    message.id === messageId
      ? {
          ...message,
          thinking: nextThinking,
          createdAt: new Date().toISOString()
        }
      : message
  );
}

function appendAssistantDelta(messageId: string, delta: string): void {
  if (!delta) {
    return;
  }

  messages.value = messages.value.map((message) =>
    message.id === messageId
      ? {
          ...message,
          content: `${message.content}${delta}`,
          createdAt: new Date().toISOString()
        }
      : message
  );
}

function appendThinkingDelta(messageId: string, delta: string): void {
  if (!delta) {
    return;
  }

  messages.value = messages.value.map((message) =>
    message.id === messageId
      ? {
          ...message,
          thinking: `${message.thinking ?? ""}${delta}`,
          createdAt: new Date().toISOString()
        }
      : message
  );
}

function isCurrentTaskDraftRuntimeEvent(sessionId: string, runId: string): boolean {
  return (
    isTaskDraftRunning.value &&
    sessionId === activeSessionId.value &&
    pendingTaskDraftRunId.value === runId
  );
}

function isTaskDraftAcceptancePending(sessionId: string): boolean {
  return (
    isTaskDraftRunning.value &&
    sessionId === activeSessionId.value &&
    pendingTaskDraftRunId.value === null
  );
}

function bufferTaskDraftTerminalEvent(event: BufferedTaskDraftTerminalEvent): void {
  bufferedTaskDraftTerminalEvents.set(event.payload.runId, event);
  if (bufferedTaskDraftTerminalEvents.size > 8) {
    const [oldestRunId] = bufferedTaskDraftTerminalEvents.keys();
    if (oldestRunId) {
      bufferedTaskDraftTerminalEvents.delete(oldestRunId);
    }
  }
}

function applyTaskDraftTerminalEvent(event: BufferedTaskDraftTerminalEvent): void {
  if (!isCurrentTaskDraftRuntimeEvent(event.payload.sessionId, event.payload.runId)) {
    return;
  }

  isTaskDraftRunning.value = false;
  pendingTaskDraftRunId.value = null;

  if (event.type === "task.draft_created") {
    latestTaskDraft.value = event.payload.draft;
    latestAgentDiagnostic.value = null;
    if (isTaskPaneCollapsed.value) {
      toggleTaskPane();
    }
    return;
  }

  taskCoreError.value = formatAgentDiagnostic(event);
}

function handleAgentEvent(event: SystemEventEnvelope): void {
  if (handledEventIds.has(event.id)) {
    return;
  }

  handledEventIds.add(event.id);
  if (handledEventIds.size > 200) {
    const [oldestEventId] = handledEventIds;
    if (oldestEventId) {
      handledEventIds.delete(oldestEventId);
    }
  }

  if (event.type === "project.created") {
    void initializeTaskCore();
    return;
  }

  if (event.type === "codeAgent.updated") {
    void refreshCodeAgents();
    return;
  }

  if (
    event.type === "task.created" ||
    event.type === "task.updated" ||
    event.type === "task.status_changed" ||
    event.type === "task.progress_changed" ||
    event.type === "task.archived" ||
    event.type === "task.analysis_saved" ||
    event.type === "plan.version_created" ||
    event.type === "plan.approval_requested" ||
    event.type === "plan.approved" ||
    event.type === "plan.rejected"
  ) {
    void refreshTasks();
    return;
  }

  if (event.type === "agent.message_delta") {
    if (
      isCurrentTaskDraftRuntimeEvent(event.payload.sessionId, event.payload.runId) ||
      isTaskDraftAcceptancePending(event.payload.sessionId)
    ) {
      return;
    }

    markRunStreaming(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    latestAgentDiagnostic.value = null;

    const messageId = ensureAssistantMessage(event.payload.runId);
    appendAssistantDelta(messageId, event.payload.delta);
    return;
  }

  if (event.type === "agent.thinking_delta") {
    if (
      isCurrentTaskDraftRuntimeEvent(event.payload.sessionId, event.payload.runId) ||
      isTaskDraftAcceptancePending(event.payload.sessionId)
    ) {
      return;
    }

    markRunStreaming(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    latestAgentDiagnostic.value = null;

    const messageId = ensureAssistantMessage(event.payload.runId);
    appendThinkingDelta(messageId, event.payload.delta);
    return;
  }

  if (event.type === "agent.message_completed") {
    const isTaskDraftMessage =
      isCurrentTaskDraftRuntimeEvent(event.payload.sessionId, event.payload.runId) ||
      isTaskDraftAcceptancePending(event.payload.sessionId);
    if (isTaskDraftMessage) {
      // A planning model completion is only an intermediate signal. Keep the
      // watchdog alive until task.draft_created or agent.error is received.
      return;
    }

    finishRun(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    latestAgentDiagnostic.value = null;
    const messageId = ensureAssistantMessage(event.payload.runId);
    if (event.payload.thinking?.trim()) {
      updateAssistantThinking(messageId, event.payload.thinking);
    }
    if (event.payload.content.trim()) {
      updateAssistantMessage(messageId, event.payload.content);
    }
    return;
  }

  if (event.type === "tool.call_requested") {
    if (isTaskDraftAcceptancePending(event.payload.sessionId)) {
      return;
    }

    if (isCurrentTaskDraftRuntimeEvent(event.payload.sessionId, event.payload.runId)) {
      taskCoreError.value = "规划草稿运行不应请求工具；本次草稿已停止展示。";
      isTaskDraftRunning.value = false;
      pendingTaskDraftRunId.value = null;
      return;
    }

    markRunStreaming(event.payload.sessionId, event.payload.runId);

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    toolCalls.value = [
      {
        id: event.payload.toolCallId,
        name: event.payload.toolName,
        status: "requested" as const,
        summary: stringifyToolCallSummary(event.payload.args)
      },
      ...toolCalls.value
    ].slice(0, 6);
    return;
  }

  if (event.type === "task.draft_created") {
    finishRun(event.payload.sessionId, event.payload.runId);
    if (
      isTaskDraftRunning.value &&
      event.payload.sessionId === activeSessionId.value &&
      pendingTaskDraftRunId.value === null
    ) {
      bufferTaskDraftTerminalEvent(event);
      return;
    }
    applyTaskDraftTerminalEvent(event);
    return;
  }

  if (event.type === "agent.error") {
    finishRun(event.payload.sessionId, event.payload.runId);

    if (
      isTaskDraftRunning.value &&
      event.payload.sessionId === activeSessionId.value &&
      pendingTaskDraftRunId.value === null
    ) {
      bufferTaskDraftTerminalEvent(event);
      return;
    }

    if (isCurrentTaskDraftRuntimeEvent(event.payload.sessionId, event.payload.runId)) {
      applyTaskDraftTerminalEvent(event);
      return;
    }

    if (event.payload.sessionId !== activeSessionId.value) {
      return;
    }

    const messageId = ensureAssistantMessage(event.payload.runId);
    const diagnostic = formatAgentDiagnostic(event);
    latestAgentDiagnostic.value = diagnostic;
    updateAssistantMessage(messageId, `Agent 运行失败\n\n${diagnostic}`);
  }
}

async function sendConversationMessage(content: string): Promise<void> {
  const now = new Date().toISOString();
  const nextIndex = messages.value.length + 1;

  messages.value = [
    ...messages.value,
    {
      id: `message-user-${nextIndex}`,
      role: "user",
      content,
      createdAt: now
    }
  ];
  composerDraft.value = "";
  latestAgentDiagnostic.value = null;

  try {
    const accepted = await window.personalClaw.session.prompt({
      sessionId: activeSessionId.value,
      message: content,
      thinkingLevel: effectiveThinkingLevel.value,
      ...(selectedProjectId.value ? { projectId: selectedProjectId.value } : {}),
      ...(selectedTaskId.value ? { taskId: selectedTaskId.value } : {})
    });
    markRunStreaming(accepted.sessionId, accepted.runId);
    watchRunProgress(accepted.sessionId, accepted.runId);
    ensureAssistantMessage(accepted.runId);
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : "Agent 命令提交失败。";
    latestAgentDiagnostic.value = diagnostic;
    messages.value = [
      ...messages.value,
      {
        id: `message-assistant-error-${Date.now()}`,
        role: "assistant",
        content: diagnostic,
        createdAt: new Date().toISOString()
      }
    ];
  }
}

onMounted(() => {
  document.addEventListener("click", handleDocumentClick);
  initializeConversationHistory();
  system.subscribe(handleAgentEvent);
  void system.refreshHealth();
  void modelConfig.refresh();
  void initializeTaskCore();
});

watch(messages, () => {
  if (skipNextHistoryPersist) {
    skipNextHistoryPersist = false;
    return;
  }

  persistActiveConversation();
}, { deep: true });

watch(
  activeModelSupportsThinking,
  (canUseThinking) => {
    if (!canUseThinking) {
      thinkingLevel.value = "off";
      return;
    }

    if (thinkingLevel.value === "off") {
      thinkingLevel.value = defaultThinkingLevelForModel(modelConfig.defaultSummary);
    }
  },
  { immediate: true }
);

watch(selectedProjectId, (projectId) => {
  if (!newTaskProjectId.value && projectId) {
    newTaskProjectId.value = projectId;
  }
});

watch(selectedTaskId, (taskId, previousTaskId) => {
  if (taskId && taskId !== previousTaskId) {
    void refreshSelectedTask().catch((error: unknown) => {
      taskCoreError.value = formatTaskCoreError(error);
    });
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick);
  for (const timeoutId of agentRunTimeouts.values()) {
    window.clearTimeout(timeoutId);
  }
  agentRunTimeouts.clear();
  system.teardown();
});
</script>

<template>
  <NConfigProvider>
    <main
      class="desktop-shell"
      :class="{
        'is-sidebar-collapsed': isSidebarCollapsed,
        'is-task-pane-collapsed': isTaskPaneCollapsed,
        'is-settings-active': activeNavigationKey === 'settings',
        'is-task-center-active': activeNavigationKey === 'task-center'
      }"
    >
      <aside class="left-rail" :class="{ 'is-collapsed': isSidebarCollapsed }" aria-label="工作区导航">
        <div class="sidebar-chrome">
          <div class="sidebar-toolbar">
            <button
              type="button"
              class="sidebar-pane-toggle"
              :class="{ 'is-collapsed': isSidebarCollapsed }"
              :aria-expanded="!isSidebarCollapsed"
              aria-controls="sidebar-content"
              :aria-label="sidebarToggleLabel"
              :title="sidebarToggleLabel"
              @click="toggleSidebar"
            >
              <span class="task-pane-toggle-icon sidebar-pane-toggle-icon" aria-hidden="true"></span>
            </button>
          </div>
        </div>

        <nav id="sidebar-content" class="sidebar-nav" aria-label="功能入口">
          <button
            v-for="item in navigationItems"
            :key="item.key"
            type="button"
            class="nav-item sidebar-nav-item"
            :class="{ 'is-active': activeNavigationKey === item.key }"
            :aria-current="activeNavigationKey === item.key ? 'page' : undefined"
            :data-nav-key="item.key"
            @click="selectNavigation(item.key)"
          >
            <span class="sidebar-nav-icon" aria-hidden="true">
              <svg v-if="item.key === 'conversation'" viewBox="0 0 24 24">
                <path d="M4 6l16-2-6 16-3-7-7-3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M11 13l4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <svg v-else-if="item.key === 'task-center'" viewBox="0 0 24 24">
                <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M8 9h8M8 13h5M8 17h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <svg v-else-if="item.key === 'model-config'" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M19.8 7.5L17.2 9M6.8 15l-2.6 1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <svg v-else-if="item.key === 'project-config'" viewBox="0 0 24 24">
                <path d="M3.5 7.5h6l2 2H20.5v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              </svg>
              <svg v-else-if="item.key === 'task-sources'" viewBox="0 0 24 24">
                <rect x="5" y="5" width="14" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M9 3v4M15 3v4M8 11h8M8 15h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <svg v-else viewBox="0 0 24 24">
                <rect x="4" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <rect x="13" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <rect x="4" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M16.5 14.5v4M14.5 16.5h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
            </span>
            <span class="sidebar-nav-label">{{ item.label }}</span>
            <span v-if="navigationShortcutByKey[item.key]" class="sidebar-shortcut">
              {{ navigationShortcutByKey[item.key] }}
            </span>
          </button>
        </nav>

        <section class="history-section" :class="{ 'is-collapsed': isHistoryCollapsed }" aria-label="历史对话">
          <div class="history-section-header">
            <div class="history-section-header-start">
              <span class="section-label">历史对话</span>
              <button
                type="button"
                class="history-collapse-toggle"
                :class="{ 'is-collapsed': isHistoryCollapsed }"
                :aria-expanded="!isHistoryCollapsed"
                aria-controls="history-list"
                :aria-label="historyToggleLabel"
                :title="historyToggleLabel"
                @click="toggleHistory"
              >
                <span class="history-collapse-chevron" aria-hidden="true"></span>
              </button>
            </div>
            <button
              type="button"
              class="history-new-conversation"
              title="新建对话"
              aria-label="新建对话"
              @click="startNewConversation"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <div v-if="!isHistoryCollapsed" id="history-list" class="history-list">
            <div
              v-for="item in historyItems"
              :key="item.id"
              class="history-row"
              :class="{ 'is-active': item.isActive }"
            >
              <button
                type="button"
                class="history-item"
                :title="item.detail"
                @click="selectHistory(item.id)"
              >
                <span class="history-dot" aria-hidden="true"></span>
                <span class="history-title">{{ item.title }}</span>
              </button>
              <NDropdown
                trigger="manual"
                placement="bottom-end"
                :show="openHistoryActionSessionId === item.id"
                :options="historyActionOptions"
                @update:show="(show) => { if (!show) closeHistoryActionMenu(); }"
                @clickoutside="closeHistoryActionMenu"
                @select="(key) => handleHistoryAction(item.id, key)"
              >
                <button
                  type="button"
                  class="history-action"
                  :aria-label="`历史对话操作：${item.title}`"
                  title="更多操作"
                  @click="toggleHistoryActionMenu(item.id, $event)"
                >
                  <span aria-hidden="true"></span>
                </button>
              </NDropdown>
            </div>
            <p v-if="!historyItems.length" class="history-empty">
              <span class="history-dot is-muted" aria-hidden="true"></span>
              暂无历史对话
            </p>
          </div>
        </section>

        <div class="sidebar-footer">
          <div class="sidebar-account">
            <img class="sidebar-account-mark" src="/icon-128.png" width="30" height="30" alt="" />
            <div class="sidebar-account-copy">
              <strong>PersonalClaw</strong>
              <span>{{ modeLabel }}</span>
            </div>
            <button
              type="button"
              class="sidebar-footer-icon"
              :class="{ 'is-active': activeNavigationKey === 'settings' }"
              title="设置"
              aria-label="进入设置"
              @click="openSettings"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M12 3.5v2.2M12 18.3v2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M3.5 12h2.2M18.3 12h2.2M5.8 18.2l1.6-1.6M16.6 7.4l1.6-1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <section class="center-pane" :class="{ 'is-full-bleed': isFullBleedView }" aria-label="主工作区">
        <header v-if="!isFullBleedView" class="pane-header">
          <div>
            <p class="eyebrow">{{ activeNavigation.eyebrow }}</p>
            <h1>{{ activeNavigation.title }}</h1>
          </div>
        </header>

        <AgentConversation
          v-if="activeNavigationKey === 'conversation'"
          v-model:draft="composerDraft"
          :messages="messages"
          :tool-calls="toolCalls"
          :is-streaming="isConversationStreaming"
          :model-label="modelLabel"
          :diagnostic-message="latestAgentDiagnostic"
          :thinking-level="thinkingLevel"
          :can-use-thinking="activeModelSupportsThinking"
          @update:thinking-level="updateThinkingLevel"
          @send="sendConversationMessage"
          @organize-task="organizeConversationAsTask"
          @open-model-config="openModelConfig"
        />

        <TaskCenter
          v-else-if="activeNavigationKey === 'task-center'"
          :tasks="taskList"
          :selected-task-id="selectedTaskId"
          :view="selectedTaskView"
          :projects="projects"
          :code-agents="codeAgents"
          :loading="isTaskCoreLoading"
          :saving="isTaskMutationSaving"
          :error="taskCoreError"
          @create="openCreateTaskDialog"
          @select-task="selectTask"
          @save-analysis="saveTaskAnalysis"
          @save-plan="saveTaskPlan"
          @flow-action="handleTaskFlowAction"
          @assign-code-agent="assignTaskCodeAgent"
          @delete-task="deleteSelectedTask"
        />

        <ModelConfig v-else-if="activeNavigationKey === 'model-config'" />

        <ProjectConfig
          v-else-if="activeNavigationKey === 'project-config'"
          :projects="projects"
          :active-project-id="selectedProjectId"
          :error="taskCoreError"
          :loading="isTaskCoreLoading"
          @changed="handleProjectConfigChanged"
        />

        <section v-else-if="activeNavigationKey === 'settings'" class="settings-page" aria-label="设置">
          <aside class="settings-sidebar" aria-label="设置导航">
            <header class="settings-sidebar-header">
              <button
                type="button"
                class="settings-back-button"
                title="返回主页"
                aria-label="返回主页"
                @click="returnHome"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <div>
                <p class="eyebrow">应用设置</p>
                <h1>设置</h1>
              </div>
            </header>

            <nav class="settings-section-list" aria-label="设置列表">
              <button
                v-for="section in settingsSections"
                :key="section.id"
                type="button"
                class="settings-section-button"
                :class="{ 'is-active': activeSettingsSectionId === section.id }"
                :aria-current="activeSettingsSectionId === section.id ? 'page' : undefined"
                @click="activeSettingsSectionId = section.id"
              >
                <span>{{ section.label }}</span>
                <small>{{ section.detail }}</small>
              </button>
            </nav>
          </aside>

          <section class="settings-editor-panel" aria-label="系统提示词">
            <div class="settings-editor-heading">
              <div>
                <p class="eyebrow">系统提示词</p>
              </div>
            </div>
            <textarea
              v-model="systemPromptDraft"
              class="settings-prompt-textarea"
              aria-label="系统提示词文本"
              spellcheck="false"
            ></textarea>
          </section>
        </section>

        <section v-else class="config-workspace" :aria-label="activeNavigation.title">
          <div class="config-summary">
            <p>{{ activeNavigation.summary }}</p>
            <div class="module-list">
              <span v-for="module in activeNavigation.modules" :key="module">{{ module }}</span>
            </div>
          </div>

          <div v-if="activeNavigationKey === 'task-sources'" class="settings-list">
            <div v-for="row in sourceRows" :key="row.id" class="settings-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>

          <div v-else class="settings-list">
            <div v-for="row in codeAgentRows" :key="row.id" class="settings-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>

      <aside class="right-pane" :class="{ 'is-collapsed': isTaskPaneCollapsed }" aria-label="任务信息">
        <button
          type="button"
          class="task-pane-toggle"
          :class="{ 'is-collapsed': isTaskPaneCollapsed }"
          :aria-expanded="!isTaskPaneCollapsed"
          aria-controls="task-information-content"
          :aria-label="taskPaneToggleLabel"
          :title="taskPaneToggleLabel"
          @click="toggleTaskPane"
        >
          <span class="task-pane-toggle-icon" aria-hidden="true"></span>
        </button>

        <div v-if="!isTaskPaneCollapsed" id="task-information-content" class="right-pane-content">
          <TaskDraftReview
            v-if="latestTaskDraft"
            :draft="latestTaskDraft"
            :projects="projects"
            :selected-project-id="selectedProjectId"
            :session-id="activeSessionId"
            :saving="isTaskDraftSaving"
            :error="taskCoreError"
            @confirm="confirmTaskDraft"
            @dismiss="latestTaskDraft = null"
          />

          <section v-else-if="isTaskDraftRunning" class="task-panel task-draft-loading">
            <p class="eyebrow">Planning only · zero tools</p>
            <h2>正在整理任务草稿</h2>
            <p>Agent 已异步接受请求。完成后会在这里显示结构化分析和 DAG 方案，期间不会写入 Core。</p>
          </section>

          <section v-else class="task-panel task-panel-primary task-center-shortcut">
            <p class="eyebrow">Structured Tasks</p>
            <h2>任务中心</h2>
            <p>任务已迁移到独立五段式页面。右侧仅保留对话生成的草稿审阅。</p>
            <dl v-if="selectedTask" class="task-meta">
              <div><dt>当前任务</dt><dd>{{ selectedTask.title }}</dd></div>
              <div><dt>状态</dt><dd>{{ taskStatusLabel(selectedTask.status) }}</dd></div>
              <div><dt>项目</dt><dd>{{ projectNameById.get(selectedTask.projectId) ?? "未知项目" }}</dd></div>
            </dl>
            <div class="task-center-shortcut-actions">
              <button type="button" class="task-primary-button" @click="activeNavigationKey = 'task-center'">打开任务中心</button>
              <button type="button" @click="openCreateTaskDialog">新建任务</button>
            </div>
            <p v-if="taskCoreError" class="error-line">{{ taskCoreError }}</p>
          </section>
        </div>
      </aside>

      <div
        v-if="isCreateTaskDialogOpen"
        class="task-dialog-backdrop"
        role="presentation"
        @click.self="closeCreateTaskDialog"
      >
        <section class="task-dialog" role="dialog" aria-modal="true" aria-label="新建任务">
          <div class="task-dialog-header">
            <div>
              <p class="eyebrow">Manual Task</p>
              <h2>新建任务</h2>
            </div>
            <button type="button" class="task-dialog-close" aria-label="关闭" @click="closeCreateTaskDialog">
              ×
            </button>
          </div>
          <form class="task-create-form" @submit.prevent="createTaskFromPane">
            <label>
              <span>所属项目</span>
              <select v-model="newTaskProjectId" :disabled="!projects.length">
                <option v-for="project in projects" :key="project.id" :value="project.id">
                  {{ project.name }}
                </option>
              </select>
            </label>
            <label>
              <span>任务标题</span>
              <input v-model="newTaskTitle" type="text" placeholder="任务标题" />
            </label>
            <label>
              <span>任务目标</span>
              <textarea v-model="newTaskGoal" rows="5" placeholder="任务目标和完成标准"></textarea>
            </label>
            <div class="task-form-grid">
              <label>
                <span>优先级</span>
                <select v-model="newTaskPriority">
                  <option v-for="priority in taskPriorityOptions" :key="priority" :value="priority">
                    {{ priority }}
                  </option>
                </select>
              </label>
              <label>
                <span>执行器</span>
                <select v-model="newTaskCodeAgentId">
                  <option value="">未分配</option>
                  <option v-for="profile in codeAgentOptions" :key="profile.id" :value="profile.id">
                    {{ profile.label }}
                  </option>
                </select>
              </label>
            </div>
            <p class="task-dialog-note">手动创建会先生成草稿任务；可在任务中心继续补充分析和方案。</p>
            <div class="task-dialog-actions">
              <button type="button" @click="closeCreateTaskDialog">取消</button>
              <button type="submit" :disabled="!newTaskProjectId || !newTaskTitle.trim() || !newTaskGoal.trim()">
                创建
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  </NConfigProvider>
</template>
