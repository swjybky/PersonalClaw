<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { ProjectSummary } from "@personal-claw/contracts";

const props = defineProps<{
  projects: readonly ProjectSummary[];
  activeProjectId: string | null;
  error: string | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  changed: [];
}>();

type DialogMode = "create" | "edit";

const isDialogOpen = ref(false);
const dialogMode = ref<DialogMode>("create");
const formError = ref<string | null>(null);
const isSaving = ref(false);
const isDeleteDialogOpen = ref(false);
const pendingDeleteProject = ref<ProjectSummary | null>(null);
const deleteError = ref<string | null>(null);
const isDeleting = ref(false);

const form = reactive({
  id: "",
  name: "",
  rootPath: "",
  description: ""
});

const sortedProjects = computed(() =>
  [...props.projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
);

const dialogTitle = computed(() => (dialogMode.value === "create" ? "新建项目" : "编辑项目"));

function resetForm(): void {
  form.id = "";
  form.name = "";
  form.rootPath = "";
  form.description = "";
  formError.value = null;
}

function openCreateDialog(): void {
  resetForm();
  dialogMode.value = "create";
  isDialogOpen.value = true;
}

function openEditDialog(project: ProjectSummary): void {
  resetForm();
  dialogMode.value = "edit";
  form.id = project.id;
  form.name = project.name;
  form.rootPath = project.rootPath ?? "";
  form.description = project.description ?? "";
  isDialogOpen.value = true;
}

function closeDialog(): void {
  isDialogOpen.value = false;
  resetForm();
}

function openDeleteDialog(project: ProjectSummary): void {
  pendingDeleteProject.value = project;
  deleteError.value = null;
  isDeleteDialogOpen.value = true;
}

function closeDeleteDialog(): void {
  isDeleteDialogOpen.value = false;
  pendingDeleteProject.value = null;
  deleteError.value = null;
}

async function confirmDeleteProject(): Promise<void> {
  const project = pendingDeleteProject.value;
  if (!project) {
    return;
  }

  isDeleting.value = true;
  deleteError.value = null;

  try {
    await window.personalClaw.project.archive({ id: project.id });
    closeDeleteDialog();
    emit("changed");
  } catch (error: unknown) {
    deleteError.value = formatTaskCoreError(error);
  } finally {
    isDeleting.value = false;
  }
}

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function summarizeDescription(description: string | null): string {
  const text = description?.trim();
  if (!text) {
    return "暂无介绍";
  }
  return text.length > 96 ? `${text.slice(0, 96)}…` : text;
}

function summarizePath(rootPath: string | null): string {
  const text = rootPath?.trim();
  return text || "未设置工作目录";
}

function formatTaskCoreError(error: unknown): string {
  return error instanceof Error ? error.message : "项目操作失败。";
}

async function submitForm(): Promise<void> {
  const name = form.name.trim();
  if (!name) {
    formError.value = "请填写项目名称。";
    return;
  }

  isSaving.value = true;
  formError.value = null;

  try {
    if (dialogMode.value === "create") {
      await window.personalClaw.project.create({
        name,
        rootPath: form.rootPath.trim() || undefined,
        description: form.description.trim() || undefined
      });
    } else {
      await window.personalClaw.project.update({
        id: form.id,
        name,
        rootPath: form.rootPath.trim() || null,
        description: form.description.trim() || null
      });
    }

    closeDialog();
    emit("changed");
  } catch (error: unknown) {
    formError.value = formatTaskCoreError(error);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <section class="project-config-page" aria-label="项目配置">
    <header class="project-config-header">
      <div>
        <h1>项目配置</h1>
        <p class="project-config-subtitle">管理本地项目目录与背景信息，任务会汇总到右侧任务列表。</p>
      </div>
      <div class="project-config-header-actions">
        <button type="button" class="project-config-primary" @click="openCreateDialog">
          + 新建项目
        </button>
      </div>
    </header>

    <p v-if="error" class="project-config-error" role="alert">{{ error }}</p>

    <section class="project-config-list" aria-label="项目列表">
      <p v-if="!sortedProjects.length && !loading" class="project-config-empty">
        还没有项目，点击「新建项目」创建第一个工作目录。
      </p>
      <p v-else-if="loading && !sortedProjects.length" class="project-config-empty">加载项目中…</p>

      <article
        v-for="project in sortedProjects"
        :key="project.id"
        class="project-config-card"
        :class="{ 'is-active': project.id === activeProjectId }"
      >
        <div class="project-config-card-head">
          <div class="project-config-card-title">
            <strong>{{ project.name }}</strong>
            <span v-if="project.id === activeProjectId" class="project-config-badge">当前</span>
          </div>
          <div class="project-config-card-actions">
            <button type="button" class="project-config-chip" @click="openEditDialog(project)">编辑</button>
            <button
              type="button"
              class="project-config-chip is-danger"
              @click="openDeleteDialog(project)"
            >
              删除
            </button>
          </div>
        </div>

        <div class="project-config-card-body">
          <span class="project-config-path">{{ summarizePath(project.rootPath) }}</span>
          <span class="project-config-description">{{ summarizeDescription(project.description) }}</span>
        </div>

        <div class="project-config-card-foot">
          <small>更新于 {{ formatUpdatedAt(project.updatedAt) }}</small>
        </div>
      </article>
    </section>

    <div
      v-if="isDialogOpen"
      class="task-dialog-backdrop"
      role="presentation"
      @click.self="closeDialog"
    >
      <section class="task-dialog project-config-dialog" role="dialog" aria-modal="true" :aria-label="dialogTitle">
        <div class="task-dialog-header">
          <div>
            <h2>{{ dialogTitle }}</h2>
          </div>
          <button type="button" class="task-dialog-close" aria-label="关闭" @click="closeDialog">×</button>
        </div>

        <p v-if="formError" class="project-config-error" role="alert">{{ formError }}</p>

        <form class="project-config-form" @submit.prevent="submitForm">
          <label class="project-config-field">
            <span>项目名称</span>
            <input v-model="form.name" type="text" placeholder="例如：PersonalClaw" />
          </label>

          <label class="project-config-field">
            <span>项目路径</span>
            <input v-model="form.rootPath" type="text" placeholder="项目根目录路径（可选）" />
          </label>

          <label class="project-config-field">
            <span>项目介绍</span>
            <textarea
              v-model="form.description"
              rows="5"
              placeholder="项目用途、边界和重要背景（可选）"
            ></textarea>
          </label>

          <div class="task-dialog-actions">
            <button type="button" @click="closeDialog">取消</button>
            <button type="submit" :disabled="isSaving || !form.name.trim()">
              {{ isSaving ? "保存中…" : dialogMode === "create" ? "创建" : "保存" }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <div
      v-if="isDeleteDialogOpen && pendingDeleteProject"
      class="task-dialog-backdrop"
      role="presentation"
      @click.self="closeDeleteDialog"
    >
      <section
        class="task-dialog project-config-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
        aria-describedby="delete-project-description"
      >
        <div class="task-dialog-header">
          <div>
            <h2 id="delete-project-title">删除项目</h2>
          </div>
          <button type="button" class="task-dialog-close" aria-label="关闭" @click="closeDeleteDialog">×</button>
        </div>

        <p id="delete-project-description" class="project-config-delete-copy">
          确定删除项目「{{ pendingDeleteProject.name }}」吗？删除后该项目将不再显示，其任务也会从列表中隐藏。
        </p>
        <p v-if="deleteError" class="project-config-error" role="alert">{{ deleteError }}</p>

        <div class="task-dialog-actions">
          <button type="button" :disabled="isDeleting" @click="closeDeleteDialog">取消</button>
          <button
            type="button"
            class="project-config-danger-button"
            :disabled="isDeleting"
            @click="confirmDeleteProject"
          >
            {{ isDeleting ? "删除中…" : "确认删除" }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
