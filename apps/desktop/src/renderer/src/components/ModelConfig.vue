<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type {
  ModelApi,
  ModelConfigEntryInput,
  ModelConfigSummary,
  ModelProvider
} from "@personal-claw/contracts";
import { useModelConfigStore } from "../stores/modelConfig";

interface ProviderOption {
  value: ModelProvider;
  label: string;
  hint: string;
}

const providerOptions: readonly ProviderOption[] = [
  { value: "faux", label: "本地 Faux", hint: "无需 API Key，离线验证链路" },
  { value: "anthropic", label: "Anthropic", hint: "Claude 系列模型" },
  { value: "deepseek", label: "DeepSeek", hint: "DeepSeek 官方模型" },
  { value: "kimi-coding", label: "Kimi Coding", hint: "Moonshot Kimi 编程模型" },
  { value: "moonshotai-cn", label: "Moonshot CN", hint: "Moonshot 国内模型" },
  { value: "openai", label: "OpenAI", hint: "GPT 系列模型" },
  { value: "xiaomi-token-plan-cn", label: "Xiaomi Token Plan CN", hint: "小米 token 套餐模型" },
  { value: "zai-coding-cn", label: "Z.AI Coding CN", hint: "智谱 GLM 编程模型" }
];

const apiOptions: readonly { value: ModelApi | ""; label: string }[] = [
  { value: "", label: "默认（由 provider 决定）" },
  { value: "openai-completions", label: "openai-completions" },
  { value: "openai-responses", label: "openai-responses" },
  { value: "anthropic-messages", label: "anthropic-messages" },
  { value: "google-generative-ai", label: "google-generative-ai" }
];

interface EditorForm {
  id: string | null;
  label: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl: string;
  api: ModelApi | "";
  reasoning: boolean;
  apiKey: string;
}

const store = useModelConfigStore();
const isEditorOpen = ref(false);
const isEditing = ref(false);
const formError = ref<string | null>(null);
const form = reactive<EditorForm>(createBlankForm());

const defaultSummary = computed(() => store.defaultSummary);
const sortedSummaries = computed(() => [...store.summaries].sort(sortByDefaultFirst));

function createBlankForm(): EditorForm {
  return {
    id: null,
    label: "",
    provider: "openai",
    modelId: "",
    baseUrl: "",
    api: "",
    reasoning: false,
    apiKey: ""
  };
}

function sortByDefaultFirst(left: ModelConfigSummary, right: ModelConfigSummary): number {
  if (left.id === store.defaultModelId) {
    return -1;
  }
  if (right.id === store.defaultModelId) {
    return 1;
  }
  return left.label.localeCompare(right.label, "zh-Hans-CN");
}

function providerLabel(provider: ModelProvider): string {
  return providerOptions.find((option) => option.value === provider)?.label ?? provider;
}

function apiKeyPlaceholder(summary?: ModelConfigSummary): string {
  if (summary?.provider === "faux") {
    return "本地 Faux 无需 API Key";
  }
  return summary?.hasSecret ? "已配置，留空保持不变" : "请输入对应 provider 的 API Key";
}

function resetForm(): void {
  Object.assign(form, createBlankForm());
  formError.value = null;
}

function openCreate(): void {
  resetForm();
  isEditing.value = false;
  isEditorOpen.value = true;
}

function openEdit(summary: ModelConfigSummary): void {
  resetForm();
  form.id = summary.id;
  form.label = summary.label;
  form.provider = summary.provider;
  form.modelId = summary.modelId;
  form.baseUrl = summary.baseUrl ?? "";
  form.api = summary.api ?? "";
  form.reasoning = Boolean(summary.reasoning);
  isEditing.value = true;
  isEditorOpen.value = true;
}

function closeEditor(): void {
  isEditorOpen.value = false;
  resetForm();
}

function generateId(label: string, provider: ModelProvider, modelId: string): string {
  const base = `${provider}-${modelId}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const slug = base || "model";
  const existing = new Set(store.summaries.map((summary) => summary.id));
  if (!existing.has(slug)) {
    return slug;
  }
  let suffix = 2;
  while (existing.has(`${slug}-${suffix}`)) {
    suffix += 1;
  }
  return `${slug}-${suffix}`;
}

async function submitForm(): Promise<void> {
  formError.value = null;

  if (!form.label.trim()) {
    formError.value = "请填写显示名称。";
    return;
  }
  if (!form.modelId.trim()) {
    formError.value = "请填写模型名称。";
    return;
  }
  if (form.provider !== "faux" && !isEditing.value && !form.apiKey.trim()) {
    formError.value = "非本地 provider 需要填写 API Key。";
    return;
  }

  const id = form.id ?? generateId(form.label, form.provider, form.modelId);
  const entry: ModelConfigEntryInput = {
    id,
    label: form.label.trim(),
    provider: form.provider,
    modelId: form.modelId.trim()
  };

  if (form.baseUrl.trim()) {
    entry.baseUrl = form.baseUrl.trim();
  }
  if (form.api) {
    entry.api = form.api;
  }
  entry.reasoning = form.reasoning;
  if (form.apiKey.trim()) {
    entry.apiKey = form.apiKey.trim();
  }

  try {
    await store.upsert(entry);
    closeEditor();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "保存失败。";
  }
}

async function makeDefault(summary: ModelConfigSummary): Promise<void> {
  if (summary.id === store.defaultModelId) {
    return;
  }
  try {
    await store.setDefault(summary.id);
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "设置默认失败。";
  }
}

async function removeEntry(summary: ModelConfigSummary): Promise<void> {
  if (summary.provider === "faux") {
    formError.value = "内置本地 Faux 模型不可删除。";
    return;
  }
  try {
    await store.remove(summary.id);
    if (form.id === summary.id) {
      closeEditor();
    }
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "删除失败。";
  }
}

function isTesting(summary: ModelConfigSummary): boolean {
  return store.testingIds.includes(summary.id);
}

function testResultClass(summary: ModelConfigSummary): string {
  const result = store.testResults[summary.id];

  if (!result) {
    return "";
  }

  return result.status === "ok" ? "is-configured" : "is-missing";
}

async function testEntry(summary: ModelConfigSummary): Promise<void> {
  formError.value = null;

  try {
    await store.test(summary.id);
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "测试失败。";
  }
}

onMounted(() => {
  void store.refresh();
});
</script>

<template>
  <section class="model-config-page" aria-label="模型配置">
    <header class="model-config-header">
      <div>
        <p class="eyebrow">pi-ai 模型与密钥</p>
        <h1>模型配置</h1>
        <p class="model-config-subtitle">
          为 pi-ai 配置默认模型与 API Key。密钥仅写入主进程，Renderer 只持有 secretRef。
        </p>
      </div>
      <div class="model-config-header-actions">
        <button
          type="button"
          class="model-config-chip"
          :disabled="store.isLoading"
          @click="store.refresh()"
        >
          {{ store.isLoading ? "刷新中…" : "刷新" }}
        </button>
        <button type="button" class="model-config-primary" @click="openCreate">
          + 添加模型
        </button>
      </div>
    </header>

    <p v-if="store.error" class="model-config-error" role="alert">{{ store.error }}</p>
    <p v-if="formError && !isEditorOpen" class="model-config-error" role="alert">{{ formError }}</p>

    <section class="model-config-default-card" aria-label="当前默认模型">
      <div>
        <span class="model-config-default-eyebrow">当前默认</span>
        <strong>{{ defaultSummary?.label ?? "未配置" }}</strong>
        <small v-if="defaultSummary">
          {{ providerLabel(defaultSummary.provider) }} · {{ defaultSummary.modelId }}
        </small>
      </div>
      <span
        class="model-config-status"
        :class="{
          'is-ready': defaultSummary && (defaultSummary.provider === 'faux' || defaultSummary.hasSecret),
          'is-pending': !defaultSummary || (defaultSummary.provider !== 'faux' && !defaultSummary.hasSecret)
        }"
      >
        {{ defaultSummary && (defaultSummary.provider === "faux" || defaultSummary.hasSecret) ? "可用" : "缺少 Key" }}
      </span>
    </section>

    <section class="model-config-list" aria-label="模型列表">
      <p v-if="!store.summaries.length && !store.isLoading" class="model-config-empty">
        还没有模型配置，点击「添加模型」为 pi-ai 配置第一个模型。
      </p>

      <article
        v-for="summary in sortedSummaries"
        :key="summary.id"
        class="model-config-card"
        :class="{ 'is-default': summary.id === store.defaultModelId }"
      >
        <div class="model-config-card-head">
          <label class="model-config-radio">
            <input
              type="radio"
              name="defaultModel"
              :checked="summary.id === store.defaultModelId"
              :disabled="store.isSaving"
              @change="makeDefault(summary)"
            />
            <span>默认</span>
          </label>
          <div class="model-config-card-actions">
            <button type="button" class="model-config-chip" @click="openEdit(summary)">编辑</button>
            <button
              type="button"
              class="model-config-chip"
              :disabled="isTesting(summary)"
              @click="testEntry(summary)"
            >
              {{ isTesting(summary) ? "测试中…" : "测试" }}
            </button>
            <button
              type="button"
              class="model-config-chip is-danger"
              :disabled="store.isSaving || isTesting(summary)"
              @click="removeEntry(summary)"
            >
              删除
            </button>
          </div>
        </div>

        <div class="model-config-card-body">
          <strong>{{ summary.label }}</strong>
          <span>{{ providerLabel(summary.provider) }} · {{ summary.modelId }}</span>
          <span v-if="summary.baseUrl" class="model-config-meta-line">API 地址：{{ summary.baseUrl }}</span>
          <span v-if="summary.api" class="model-config-meta-line">协议：{{ summary.api }}</span>
          <span v-if="summary.reasoning" class="model-config-meta-line">支持推理等级</span>
        </div>

        <div class="model-config-card-foot">
          <span
            class="model-config-secret"
            :class="{ 'is-configured': summary.hasSecret, 'is-missing': !summary.hasSecret }"
          >
            {{ summary.provider === "faux" ? "本地无需 Key" : summary.hasSecret ? "API Key 已配置" : "API Key 未配置" }}
          </span>
          <small class="model-config-secret-ref">secretRef：{{ summary.secretRef }}</small>
          <small
            v-if="store.testResults[summary.id]"
            class="model-config-test-result"
            :class="testResultClass(summary)"
          >
            测试{{ store.testResults[summary.id]?.status === "ok" ? "通过" : "失败" }}：{{
              store.testResults[summary.id]?.message
            }}
          </small>
        </div>
      </article>
    </section>

    <section v-if="isEditorOpen" class="model-config-editor" aria-label="模型编辑">
      <header class="model-config-editor-head">
        <h2>{{ isEditing ? "编辑模型" : "添加模型" }}</h2>
        <button type="button" class="model-config-close" aria-label="关闭编辑" @click="closeEditor">×</button>
      </header>

      <p v-if="formError" class="model-config-error" role="alert">{{ formError }}</p>

      <form class="model-config-form" @submit.prevent="submitForm">
        <div class="model-config-grid">
          <label class="model-config-field">
            <span>显示名称</span>
            <input v-model="form.label" type="text" placeholder="例如：DeepSeek Flash" />
          </label>

          <label class="model-config-field">
            <span>Provider</span>
            <select v-model="form.provider">
              <option v-for="option in providerOptions" :key="option.value" :value="option.value">
                {{ option.label }} — {{ option.hint }}
              </option>
            </select>
          </label>

          <label class="model-config-field">
            <span>模型名称 / ID</span>
            <input v-model="form.modelId" type="text" placeholder="例如：deepseek-v4-flash" />
          </label>

          <label class="model-config-field">
            <span>API 地址（可选）</span>
            <input v-model="form.baseUrl" type="text" placeholder="自定义 base_url，内置 provider 留空" />
          </label>

          <label class="model-config-field">
            <span>API 协议（可选）</span>
            <select v-model="form.api">
              <option v-for="option in apiOptions" :key="option.value || 'default'" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label class="model-config-field model-config-field-wide">
            <span>API Key</span>
            <input
              v-model="form.apiKey"
              type="password"
              :placeholder="apiKeyPlaceholder(isEditing ? store.summaries.find((item) => item.id === form.id) : undefined)"
              autocomplete="off"
            />
          </label>
        </div>

        <label class="model-config-check">
          <input v-model="form.reasoning" type="checkbox" />
          <span>支持推理 / thinking 等级选择</span>
        </label>

        <div class="model-config-form-actions">
          <button type="button" class="model-config-chip" @click="closeEditor">取消</button>
          <button type="submit" class="model-config-primary" :disabled="store.isSaving">
            {{ store.isSaving ? "保存中…" : "保存模型" }}
          </button>
        </div>
      </form>
    </section>
  </section>
</template>
