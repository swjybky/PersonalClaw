<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NTag } from "naive-ui";
import type {
  AutomationLevel,
  CodeAgentProfile,
  PlanStepInput,
  PlanStepType,
  ProjectSummary,
  TaskAnalysisInput,
  TaskAnalysisSummary,
  TaskPlanSummary,
  TaskStatusView,
  TaskSummary
} from "@personal-claw/contracts";
import {
  filterTaskBoardTasks,
  guardTaskFlowActionForReviewSelection,
  joinTaskEditorLines,
  resolveTaskFlowAction,
  splitTaskDependencyKeys,
  splitTaskEditorLines,
  summarizeTaskBoard,
  taskStatusLabel,
  taskStatusTone,
  type TaskBoardTab,
  type TaskFlowAction
} from "../taskBoard";

interface AnalysisEditorState {
  objective: string;
  knownInformation: string;
  missingInformation: string;
  constraints: string;
  risks: string;
  expectedArtifacts: string;
  completionDefinition: string;
  suggestedAutomationLevel: AutomationLevel;
}

interface PlanStepEditorState {
  localId: string;
  key: string;
  title: string;
  goal: string;
  type: PlanStepType;
  dependsOn: string;
  successCriteria: string;
}

const props = defineProps<{
  tasks: readonly TaskSummary[];
  selectedTaskId: string | null;
  view: TaskStatusView | null;
  projects: readonly ProjectSummary[];
  codeAgents: readonly CodeAgentProfile[];
  loading: boolean;
  saving: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  create: [];
  "select-task": [taskId: string];
  "save-analysis": [payload: { taskId: string; analysis: TaskAnalysisInput }];
  "save-plan": [payload: { taskId: string; summary: string; steps: PlanStepInput[] }];
  "flow-action": [action: TaskFlowAction];
  "assign-code-agent": [payload: { taskId: string; codeAgentId: string | null }];
  "delete-task": [taskId: string];
}>();

const taskTab = ref<TaskBoardTab>("all");
const selectedAnalysisVersion = ref<number | null>(null);
const selectedPlanVersion = ref<number | null>(null);
const selectedCodeAgentId = ref("");
const planSummaryDraft = ref("");
const planStepsDraft = ref<PlanStepEditorState[]>([]);
const analysisDraft = ref<AnalysisEditorState>(emptyAnalysisEditor());

const counts = computed(() => summarizeTaskBoard(props.tasks));
const filteredTasks = computed(() => filterTaskBoardTasks(props.tasks, taskTab.value));
const projectNameById = computed(() =>
  new Map(props.projects.map((project) => [project.id, project.name] as const))
);
const enabledCodeAgents = computed(() =>
  props.codeAgents.filter((profile) => profile.enabled && profile.archivedAt === null)
);
const selectedTask = computed(() => props.view?.task ?? null);
const displayedPlan = computed(() =>
  props.view?.planVersions.find((plan) => plan.version === selectedPlanVersion.value) ?? null
);
const planningLocked = computed(() =>
  selectedTask.value
    ? ["queued", "running", "verifying", "succeeded", "archived"].includes(
        selectedTask.value.status
      )
    : true
);
const assignmentLocked = computed(() =>
  selectedTask.value
    ? ["awaiting_approval", "queued", "running", "verifying"].includes(
        selectedTask.value.status
      )
    : true
);
const selectedCodeAgent = computed(() =>
  selectedTask.value?.codeAgentId
    ? props.codeAgents.find((profile) => profile.id === selectedTask.value?.codeAgentId) ?? null
    : null
);
const flowAction = computed(() =>
  guardTaskFlowActionForReviewSelection(resolveTaskFlowAction(props.view), props.view, {
    analysisVersion: selectedAnalysisVersion.value,
    planVersion: selectedPlanVersion.value,
    codeAgentId: selectedCodeAgentId.value || null
  })
);
const canSaveAnalysis = computed(
  () =>
    Boolean(selectedTask.value) &&
    Boolean(analysisDraft.value.objective.trim()) &&
    splitTaskEditorLines(analysisDraft.value.completionDefinition).length > 0 &&
    !planningLocked.value &&
    !props.saving
);
const canSavePlan = computed(() => {
  if (!selectedTask.value || !planSummaryDraft.value.trim() || planStepsDraft.value.length === 0) {
    return false;
  }

  const keys = planStepsDraft.value.map((step) => step.key.trim());
  return (
    !props.saving &&
    !planningLocked.value &&
    keys.every(Boolean) &&
    new Set(keys).size === keys.length &&
    planStepsDraft.value.every(
      (step) =>
        step.title.trim() &&
        step.goal.trim() &&
        splitTaskEditorLines(step.successCriteria).length > 0
    )
  );
});

function emptyAnalysisEditor(): AnalysisEditorState {
  return {
    objective: "",
    knownInformation: "",
    missingInformation: "",
    constraints: "",
    risks: "",
    expectedArtifacts: "",
    completionDefinition: "",
    suggestedAutomationLevel: "L0"
  };
}

function toAnalysisEditor(analysis: TaskAnalysisSummary | null, task: TaskSummary): AnalysisEditorState {
  if (!analysis) {
    return {
      ...emptyAnalysisEditor(),
      objective: task.goal,
      completionDefinition: task.goal
    };
  }

  return {
    objective: analysis.objective,
    knownInformation: joinTaskEditorLines(analysis.knownInformation),
    missingInformation: joinTaskEditorLines(analysis.missingInformation),
    constraints: joinTaskEditorLines(analysis.constraints),
    risks: joinTaskEditorLines(analysis.risks),
    expectedArtifacts: joinTaskEditorLines(analysis.expectedArtifacts),
    completionDefinition: joinTaskEditorLines(analysis.completionDefinition),
    suggestedAutomationLevel: analysis.suggestedAutomationLevel
  };
}

function toPlanStepEditor(plan: TaskPlanSummary | null): PlanStepEditorState[] {
  if (!plan) {
    return [];
  }

  return plan.steps.map((step) => ({
    localId: step.id,
    key: step.key,
    title: step.title,
    goal: step.goal,
    type: step.type,
    dependsOn: step.dependsOn.join(", "),
    successCriteria: joinTaskEditorLines(step.successCriteria)
  }));
}

function syncEditors(view: TaskStatusView | null): void {
  if (!view) {
    selectedAnalysisVersion.value = null;
    selectedPlanVersion.value = null;
    selectedCodeAgentId.value = "";
    analysisDraft.value = emptyAnalysisEditor();
    planSummaryDraft.value = "";
    planStepsDraft.value = [];
    return;
  }

  selectedAnalysisVersion.value = view.analysis?.version ?? null;
  selectedPlanVersion.value = view.plan?.version ?? null;
  selectedCodeAgentId.value = view.task.codeAgentId ?? "";
  analysisDraft.value = toAnalysisEditor(view.analysis, view.task);
  planSummaryDraft.value = view.plan?.summary ?? "";
  planStepsDraft.value = toPlanStepEditor(view.plan);
}

function selectAnalysisVersion(event: Event): void {
  if (!props.view) {
    return;
  }

  const version = Number((event.target as HTMLSelectElement).value);
  const analysis = props.view.analysisVersions.find((item) => item.version === version) ?? null;
  selectedAnalysisVersion.value = analysis?.version ?? null;
  analysisDraft.value = toAnalysisEditor(analysis, props.view.task);
}

function selectPlanVersion(event: Event): void {
  if (!props.view) {
    return;
  }

  const version = Number((event.target as HTMLSelectElement).value);
  const plan = props.view.planVersions.find((item) => item.version === version) ?? null;
  selectedPlanVersion.value = plan?.version ?? null;
  planSummaryDraft.value = plan?.summary ?? "";
  planStepsDraft.value = toPlanStepEditor(plan);
}

function saveAnalysis(): void {
  const taskId = selectedTask.value?.id;

  if (!taskId || !canSaveAnalysis.value) {
    return;
  }

  emit("save-analysis", {
    taskId,
    analysis: {
      objective: analysisDraft.value.objective.trim(),
      knownInformation: splitTaskEditorLines(analysisDraft.value.knownInformation),
      missingInformation: splitTaskEditorLines(analysisDraft.value.missingInformation),
      constraints: splitTaskEditorLines(analysisDraft.value.constraints),
      risks: splitTaskEditorLines(analysisDraft.value.risks),
      expectedArtifacts: splitTaskEditorLines(analysisDraft.value.expectedArtifacts),
      completionDefinition: splitTaskEditorLines(analysisDraft.value.completionDefinition),
      suggestedAutomationLevel: analysisDraft.value.suggestedAutomationLevel
    }
  });
}

function addPlanStep(): void {
  const nextIndex = planStepsDraft.value.length + 1;
  const previousKey = planStepsDraft.value.at(-1)?.key.trim();
  planStepsDraft.value = [
    ...planStepsDraft.value,
    {
      localId: `new_step_${Date.now()}_${nextIndex}`,
      key: `step_${nextIndex}`,
      title: "",
      goal: "",
      type: "agent",
      dependsOn: previousKey ?? "",
      successCriteria: ""
    }
  ];
}

function removePlanStep(localId: string): void {
  const removedKey = planStepsDraft.value.find((step) => step.localId === localId)?.key.trim();
  planStepsDraft.value = planStepsDraft.value
    .filter((step) => step.localId !== localId)
    .map((step) => ({
      ...step,
      dependsOn: joinTaskEditorLines(
        splitTaskDependencyKeys(step.dependsOn).filter((dependency) => dependency !== removedKey)
      )
    }));
}

function savePlan(): void {
  const taskId = selectedTask.value?.id;

  if (!taskId || !canSavePlan.value) {
    return;
  }

  emit("save-plan", {
    taskId,
    summary: planSummaryDraft.value.trim(),
    steps: planStepsDraft.value.map((step) => ({
      key: step.key.trim(),
      title: step.title.trim(),
      goal: step.goal.trim(),
      type: step.type,
      dependsOn: splitTaskDependencyKeys(step.dependsOn),
      successCriteria: splitTaskEditorLines(step.successCriteria),
      status: "pending"
    }))
  });
}

function assignCodeAgent(): void {
  const taskId = selectedTask.value?.id;

  if (!taskId) {
    return;
  }

  emit("assign-code-agent", {
    taskId,
    codeAgentId: selectedCodeAgentId.value || null
  });
}

function approvalStateLabel(state: TaskPlanSummary["approvalState"]): string {
  switch (state) {
    case "not_requested":
      return "未提交";
    case "pending":
      return "等待审批";
    case "approved":
      return "已批准";
    case "rejected":
      return "已拒绝";
  }
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    "task.created": "创建任务",
    "task.updated": "更新任务",
    "task.analysis_saved": "保存分析版本",
    "plan.version_created": "保存方案版本",
    "plan.approval_requested": "提交方案审批",
    "plan.approved": "批准方案",
    "plan.rejected": "撤回旧方案审批",
    "task.status_changed": "任务状态变更",
    "task.progress_changed": "任务进度变更",
    "task.archived": "归档任务"
  };
  return labels[eventType] ?? eventType;
}

watch(() => props.view, syncEditors, { immediate: true });
</script>

<template>
  <section class="task-center-page" aria-label="任务中心">
    <aside class="task-center-sidebar">
      <header class="task-center-sidebar-header">
        <div>
          <p class="eyebrow">Task Center</p>
          <h1>任务中心</h1>
        </div>
        <button type="button" class="task-primary-button" @click="emit('create')">新建任务</button>
      </header>

      <div class="task-tab-list" role="tablist" aria-label="任务筛选">
        <button type="button" :class="{ 'is-active': taskTab === 'all' }" @click="taskTab = 'all'">
          全部 {{ counts.total }}
        </button>
        <button type="button" :class="{ 'is-active': taskTab === 'todo' }" @click="taskTab = 'todo'">
          进行中 {{ counts.active }}
        </button>
        <button type="button" :class="{ 'is-active': taskTab === 'done' }" @click="taskTab = 'done'">
          完成 {{ counts.done }}
        </button>
        <button type="button" :class="{ 'is-active': taskTab === 'blocked' }" @click="taskTab = 'blocked'">
          阻塞 {{ counts.blocked }}
        </button>
      </div>

      <div class="task-center-list">
        <button
          v-for="task in filteredTasks"
          :key="task.id"
          type="button"
          class="task-center-list-item"
          :class="{ 'is-active': task.id === selectedTaskId }"
          @click="emit('select-task', task.id)"
        >
          <span class="task-center-list-copy">
            <strong>{{ task.title }}</strong>
            <small>{{ projectNameById.get(task.projectId) ?? "未知项目" }} · {{ task.priority }}</small>
          </span>
          <NTag :type="taskStatusTone(task.status)" size="small">{{ taskStatusLabel(task.status) }}</NTag>
        </button>
        <p v-if="loading" class="empty">正在加载任务。</p>
        <p v-else-if="!filteredTasks.length" class="empty">当前筛选下没有任务。</p>
      </div>
    </aside>

    <main class="task-center-detail">
      <div v-if="error" class="task-center-error" role="alert">{{ error }}</div>

      <template v-if="view && selectedTask">
        <header class="task-center-detail-header">
          <div>
            <p class="eyebrow">{{ projectNameById.get(selectedTask.projectId) ?? "未知项目" }}</p>
            <h1>{{ selectedTask.title }}</h1>
            <p>{{ selectedTask.goal }}</p>
          </div>
          <div class="task-center-header-actions">
            <NTag :type="taskStatusTone(selectedTask.status)">{{ taskStatusLabel(selectedTask.status) }}</NTag>
            <button
              v-if="flowAction"
              type="button"
              class="task-flow-button"
              :disabled="Boolean(flowAction.disabledReason) || saving"
              :title="flowAction.disabledReason ?? flowAction.label"
              @click="emit('flow-action', flowAction)"
            >
              {{ flowAction.label }}
            </button>
          </div>
        </header>

        <p v-if="flowAction?.disabledReason" class="task-flow-note">{{ flowAction.disabledReason }}</p>

        <div class="task-five-stage-list">
          <section class="task-stage-card" aria-labelledby="task-stage-goal">
            <header class="task-stage-heading">
              <span>01</span>
              <div>
                <p>目标</p>
                <h2 id="task-stage-goal">任务边界与完成方向</h2>
              </div>
            </header>
            <div class="task-goal-grid">
              <dl>
                <div><dt>目标</dt><dd>{{ selectedTask.goal }}</dd></div>
                <div><dt>来源</dt><dd>{{ selectedTask.source.label ?? selectedTask.source.kind }}</dd></div>
                <div><dt>优先级</dt><dd>{{ selectedTask.priority }}</dd></div>
                <div><dt>下一步</dt><dd>{{ selectedTask.nextStep ?? "待确定" }}</dd></div>
              </dl>
              <div class="task-progress-readonly">
                <span>只读进度</span>
                <strong>{{ selectedTask.progressPercent }}%</strong>
                <div class="progress-track"><span :style="{ width: `${selectedTask.progressPercent}%` }"></span></div>
              </div>
            </div>
          </section>

          <section class="task-stage-card" aria-labelledby="task-stage-analysis">
            <header class="task-stage-heading">
              <span>02</span>
              <div>
                <p>分析</p>
                <h2 id="task-stage-analysis">可编辑的结构化任务分析</h2>
              </div>
              <label v-if="view.analysisVersions.length" class="task-version-select">
                <span>查看版本</span>
                <select :value="selectedAnalysisVersion ?? ''" @change="selectAnalysisVersion">
                  <option v-for="item in view.analysisVersions" :key="item.id" :value="item.version">
                    v{{ item.version }} · {{ new Date(item.updatedAt).toLocaleString() }}
                  </option>
                </select>
              </label>
            </header>

            <div class="task-editor-grid">
              <label class="is-wide"><span>真实目标</span><textarea v-model="analysisDraft.objective" rows="3"></textarea></label>
              <label><span>已知信息（每行一项）</span><textarea v-model="analysisDraft.knownInformation" rows="4"></textarea></label>
              <label><span>缺失信息（每行一项）</span><textarea v-model="analysisDraft.missingInformation" rows="4"></textarea></label>
              <label><span>约束（每行一项）</span><textarea v-model="analysisDraft.constraints" rows="4"></textarea></label>
              <label><span>风险（每行一项）</span><textarea v-model="analysisDraft.risks" rows="4"></textarea></label>
              <label><span>预计产物（每行一项）</span><textarea v-model="analysisDraft.expectedArtifacts" rows="4"></textarea></label>
              <label><span>完成定义（每行一项）</span><textarea v-model="analysisDraft.completionDefinition" rows="4"></textarea></label>
              <label>
                <span>建议自动化等级</span>
                <select v-model="analysisDraft.suggestedAutomationLevel">
                  <option v-for="level in ['L0', 'L1', 'L2', 'L3', 'L4']" :key="level" :value="level">{{ level }}</option>
                </select>
              </label>
            </div>
            <footer class="task-stage-actions">
              <small>{{ selectedTask.status === "awaiting_approval" ? "保存新分析会撤回当前审批并回到分析状态。" : "保存会创建新的分析版本，不覆盖历史版本。" }}</small>
              <button type="button" :disabled="!canSaveAnalysis" @click="saveAnalysis">保存分析新版本</button>
            </footer>
          </section>

          <section class="task-stage-card" aria-labelledby="task-stage-plan">
            <header class="task-stage-heading">
              <span>03</span>
              <div>
                <p>方案</p>
                <h2 id="task-stage-plan">版本化 DAG 执行方案</h2>
              </div>
              <div class="task-plan-version-tools">
                <NTag v-if="displayedPlan" size="small">{{ approvalStateLabel(displayedPlan.approvalState) }}</NTag>
                <label v-if="view.planVersions.length" class="task-version-select">
                  <span>查看版本</span>
                  <select :value="selectedPlanVersion ?? ''" @change="selectPlanVersion">
                    <option v-for="item in view.planVersions" :key="item.id" :value="item.version">
                      v{{ item.version }} · {{ approvalStateLabel(item.approvalState) }}
                    </option>
                  </select>
                </label>
              </div>
            </header>

            <label class="task-plan-summary-field">
              <span>方案摘要</span>
              <textarea v-model="planSummaryDraft" rows="3" placeholder="说明方案如何达成目标"></textarea>
            </label>

            <dl v-if="displayedPlan" class="task-plan-lineage">
              <div><dt>查看方案</dt><dd>v{{ displayedPlan.version }}{{ displayedPlan.version === view.plan?.version ? "（最新）" : "（历史）" }}</dd></div>
              <div><dt>基于分析</dt><dd>{{ displayedPlan.basedOnAnalysisVersion ? `v${displayedPlan.basedOnAnalysisVersion}` : "未绑定" }}</dd></div>
              <div><dt>审批状态</dt><dd>{{ approvalStateLabel(displayedPlan.approvalState) }}</dd></div>
              <div><dt>审批请求</dt><dd>{{ displayedPlan.approvalSnapshot?.requestId ?? "尚未创建" }}</dd></div>
            </dl>

            <div class="task-dag-editor">
              <article v-for="(step, index) in planStepsDraft" :key="step.localId" class="task-dag-step-card">
                <header>
                  <strong>步骤 {{ index + 1 }}</strong>
                  <button type="button" :disabled="planStepsDraft.length <= 1" @click="removePlanStep(step.localId)">移除</button>
                </header>
                <div class="task-dag-step-grid">
                  <label><span>稳定 key</span><input v-model="step.key" type="text" /></label>
                  <label>
                    <span>类型</span>
                    <select v-model="step.type">
                      <option v-for="type in ['agent', 'tool', 'human_input', 'approval', 'verification', 'notification']" :key="type" :value="type">{{ type }}</option>
                    </select>
                  </label>
                  <label><span>标题</span><input v-model="step.title" type="text" /></label>
                  <label class="is-wide"><span>目标</span><textarea v-model="step.goal" rows="2"></textarea></label>
                  <label><span>依赖 key（逗号或换行）</span><textarea v-model="step.dependsOn" rows="2"></textarea></label>
                  <label><span>成功条件（每行一项）</span><textarea v-model="step.successCriteria" rows="2"></textarea></label>
                </div>
              </article>
              <button type="button" class="task-add-step-button" @click="addPlanStep">＋ 添加步骤</button>
            </div>

            <footer class="task-stage-actions">
              <small>{{ selectedTask.status === "awaiting_approval" ? "保存新方案会拒绝当前送审版本并返回方案就绪状态。" : "依赖使用稳定 key；Core 会拒绝重复、未知、自依赖和循环依赖。" }}</small>
              <button type="button" :disabled="!canSavePlan" @click="savePlan">保存方案新版本</button>
            </footer>
          </section>

          <section class="task-stage-card" aria-labelledby="task-stage-execution">
            <header class="task-stage-heading">
              <span>04</span>
              <div>
                <p>执行</p>
                <h2 id="task-stage-execution">执行器与运行边界</h2>
              </div>
            </header>
            <div class="task-execution-grid">
              <label>
                <span>codeAgent 执行器</span>
                <select v-model="selectedCodeAgentId" :disabled="assignmentLocked">
                  <option value="">未分配</option>
                  <option v-for="profile in enabledCodeAgents" :key="profile.id" :value="profile.id">{{ profile.label }}</option>
                </select>
              </label>
              <button type="button" :disabled="saving || assignmentLocked" @click="assignCodeAgent">保存分配</button>
              <div class="task-phase4-boundary">
                <strong>{{ selectedCodeAgent?.label ?? "尚未分配执行器" }}</strong>
                <p>Phase 2 只完成分析、方案版本与计划级审批。即使任务进入 queued，也不会启动真实 codeAgent；异步 Run Coordinator 在 Phase 4 接入。</p>
              </div>
            </div>
          </section>

          <section class="task-stage-card" aria-labelledby="task-stage-result">
            <header class="task-stage-heading">
              <span>05</span>
              <div>
                <p>结果</p>
                <h2 id="task-stage-result">结果状态与审计事件</h2>
              </div>
            </header>
            <div class="task-result-summary">
              <strong v-if="selectedTask.status === 'succeeded'">任务已完成</strong>
              <strong v-else-if="selectedTask.status === 'failed'">任务执行失败</strong>
              <strong v-else>尚无执行结果</strong>
              <p>{{ selectedTask.blockedReason ?? "执行与产物将在 Phase 4 运行后沉淀。" }}</p>
            </div>
            <ol v-if="view.recentEvents.length" class="task-center-event-list">
              <li v-for="event in view.recentEvents" :key="event.id">
                <time>#{{ event.sequence }}</time>
                <span>{{ eventLabel(event.eventType) }}</span>
                <small>{{ new Date(event.createdAt).toLocaleString() }}</small>
              </li>
            </ol>
            <p v-else class="empty">暂无任务事件。</p>
            <footer class="task-stage-actions is-danger">
              <small>活动任务需要先取消，只有 Core 允许归档的状态才会从任务列表移除。</small>
              <div>
                <button
                  v-if="view.availableTransitions.includes('cancelled')"
                  type="button"
                  @click="emit('flow-action', { kind: 'set_status', label: '取消任务', status: 'cancelled', disabledReason: null })"
                >取消任务</button>
                <button type="button" class="task-danger-button" :disabled="!view.availableTransitions.includes('archived')" @click="emit('delete-task', selectedTask.id)">归档任务</button>
              </div>
            </footer>
          </section>
        </div>
      </template>

      <div v-else class="task-center-empty">
        <h2>选择一个任务</h2>
        <p>任务详情将按“目标 / 分析 / 方案 / 执行 / 结果”五段展示。</p>
        <button type="button" class="task-primary-button" @click="emit('create')">新建任务</button>
      </div>
    </main>
  </section>
</template>
