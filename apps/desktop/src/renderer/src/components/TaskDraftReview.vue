<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  ProjectSummary,
  TaskCreateCommandPayload,
  TaskDraftPreview,
  TaskPriority
} from "@personal-claw/contracts";
import {
  buildTaskCreatePayloadFromDraft,
  buildTaskProgressItems,
  summarizeTaskDraft,
  taskProgressPercent
} from "../taskDraftPreview";

const props = defineProps<{
  draft: TaskDraftPreview;
  projects: readonly ProjectSummary[];
  selectedProjectId: string | null;
  sessionId: string;
  saving: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  confirm: [payload: TaskCreateCommandPayload];
  dismiss: [];
}>();

const projectId = ref("");
const title = ref("");
const goal = ref("");
const priority = ref<TaskPriority>("normal");

const summary = computed(() => summarizeTaskDraft(props.draft));
const progressItems = computed(() => buildTaskProgressItems(props.draft, false));
const progress = computed(() => taskProgressPercent(progressItems.value));
const canConfirm = computed(
  () => Boolean(projectId.value && title.value.trim() && goal.value.trim()) && !props.saving
);

function syncDraft(): void {
  projectId.value =
    props.selectedProjectId && props.projects.some((project) => project.id === props.selectedProjectId)
      ? props.selectedProjectId
      : props.projects[0]?.id ?? "";
  title.value = props.draft.title;
  goal.value = props.draft.objective;
  priority.value = "normal";
}

function confirmDraft(): void {
  if (!canConfirm.value) {
    return;
  }

  emit(
    "confirm",
    buildTaskCreatePayloadFromDraft(props.draft, {
      projectId: projectId.value,
      sessionId: props.sessionId,
      title: title.value,
      goal: goal.value,
      priority: priority.value
    })
  );
}

watch(() => props.draft.draftId, syncDraft, { immediate: true });
watch(
  () => [props.selectedProjectId, ...props.projects.map((project) => project.id)],
  () => {
    if (!props.projects.some((project) => project.id === projectId.value)) {
      projectId.value =
        props.selectedProjectId && props.projects.some((project) => project.id === props.selectedProjectId)
          ? props.selectedProjectId
          : props.projects[0]?.id ?? "";
    }
  }
);
</script>

<template>
  <section class="task-draft-review" aria-label="任务草稿审阅">
    <header class="task-draft-review-header">
      <div>
        <p class="eyebrow">AI Task Draft</p>
        <h2>任务草稿</h2>
      </div>
      <button type="button" class="task-draft-dismiss" aria-label="关闭任务草稿" @click="emit('dismiss')">×</button>
    </header>

    <p class="task-draft-review-note">草稿尚未写入 Core。确认后会一次性保存任务、分析 v1 与方案 v1。</p>

    <div class="progress-block">
      <div><span>整理进度</span><strong>{{ progress }}%</strong></div>
      <div class="progress-track"><span :style="{ width: `${progress}%` }"></span></div>
    </div>
    <ol class="progress-list">
      <li v-for="item in progressItems" :key="item.id" :class="`is-${item.status}`"><span></span>{{ item.label }}</li>
    </ol>

    <div class="task-draft-review-form">
      <label>
        <span>所属项目</span>
        <select v-model="projectId">
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
      </label>
      <label><span>任务标题</span><input v-model="title" type="text" /></label>
      <label><span>任务目标</span><textarea v-model="goal" rows="4"></textarea></label>
      <label>
        <span>优先级</span>
        <select v-model="priority">
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
      </label>
    </div>

    <dl class="task-draft-facts">
      <div><dt>自动化建议</dt><dd>{{ summary.automationLevel }}</dd></div>
      <div><dt>缺失信息</dt><dd>{{ summary.missingInformation }}</dd></div>
      <div><dt>预计产物</dt><dd>{{ draft.expectedArtifacts.join("、") }}</dd></div>
    </dl>

    <div class="task-draft-analysis-preview">
      <strong>分析预览</strong>
      <ul>
        <li v-for="item in draft.constraints" :key="item">约束：{{ item }}</li>
        <li v-for="item in draft.missingInformation" :key="item">待确认：{{ item }}</li>
      </ul>
    </div>

    <ol class="task-draft-step-list">
      <li v-for="step in draft.steps" :key="step.id">
        <span>{{ step.sequence }}</span>
        <div>
          <strong>{{ step.title }}</strong>
          <p>{{ step.goal }}</p>
          <small>key: step_{{ step.sequence }} · 依赖 {{ step.dependsOn.length }} 项</small>
        </div>
      </li>
    </ol>

    <p v-if="error" class="error-line" role="alert">{{ error }}</p>
    <button type="button" class="task-draft-confirm" :disabled="!canConfirm" @click="confirmDraft">
      {{ saving ? "正在保存…" : "确认并保存到任务中心" }}
    </button>
  </section>
</template>
