import { defineStore } from "pinia";
import type {
  ModelConfigEntryInput,
  ModelConfigSummary,
  ModelConfigSummaryListPayload,
  ModelConfigTestResultPayload
} from "@personal-claw/contracts";

type ModelConfigTestState = Record<string, ModelConfigTestResultPayload | undefined>;

interface ModelConfigState {
  summaries: ModelConfigSummary[];
  defaultModelId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  testingIds: string[];
  testResults: ModelConfigTestState;
  error: string | null;
  loadedAt: string | null;
}

function resolveModelConfigApi(): NonNullable<Window["personalClaw"]>["modelConfig"] {
  const api = typeof window !== "undefined" ? window.personalClaw : undefined;

  if (!api?.modelConfig) {
    throw new Error(
      "模型配置接口未就绪：preload 未暴露 modelConfig，请重启 Electron / pnpm dev 以重新加载 preload。"
    );
  }

  return api.modelConfig;
}

export const useModelConfigStore = defineStore("modelConfig", {
  state: (): ModelConfigState => ({
    summaries: [],
    defaultModelId: null,
    isLoading: false,
    isSaving: false,
    testingIds: [],
    testResults: {},
    error: null,
    loadedAt: null
  }),
  getters: {
    defaultSummary: (state): ModelConfigSummary | undefined =>
      state.summaries.find((summary) => summary.id === state.defaultModelId) ?? state.summaries[0],
    hasRealProvider(): boolean {
      return this.summaries.some(
        (summary) => summary.id === this.defaultModelId && summary.provider !== "faux" && summary.hasSecret
      );
    }
  },
  actions: {
    applyPayload(payload: ModelConfigSummaryListPayload): void {
      this.summaries = payload.summaries;
      this.defaultModelId = payload.defaultModelId;
      this.loadedAt = new Date().toISOString();
    },
    async refresh(): Promise<void> {
      this.isLoading = true;
      this.error = null;

      try {
        this.applyPayload(await resolveModelConfigApi().list());
      } catch (error) {
        this.error = error instanceof Error ? error.message : "加载模型配置失败。";
      } finally {
        this.isLoading = false;
      }
    },
    async upsert(entry: ModelConfigEntryInput): Promise<void> {
      this.isSaving = true;
      this.error = null;

      try {
        this.applyPayload(await resolveModelConfigApi().upsert(entry));
      } catch (error) {
        this.error = error instanceof Error ? error.message : "保存模型配置失败。";
        throw error;
      } finally {
        this.isSaving = false;
      }
    },
    async remove(id: string): Promise<void> {
      this.isSaving = true;
      this.error = null;

      try {
        this.applyPayload(await resolveModelConfigApi().delete({ id }));
      } catch (error) {
        this.error = error instanceof Error ? error.message : "删除模型配置失败。";
        throw error;
      } finally {
        this.isSaving = false;
      }
    },
    async setDefault(id: string): Promise<void> {
      this.isSaving = true;
      this.error = null;

      try {
        this.applyPayload(await resolveModelConfigApi().setDefault({ id }));
      } catch (error) {
        this.error = error instanceof Error ? error.message : "设置默认模型失败。";
        throw error;
      } finally {
        this.isSaving = false;
      }
    },
    async test(id: string): Promise<ModelConfigTestResultPayload> {
      this.error = null;
      this.testingIds = [...new Set([...this.testingIds, id])];

      try {
        const result = await resolveModelConfigApi().test({ id });
        this.testResults = {
          ...this.testResults,
          [id]: result
        };
        return result;
      } catch (error) {
        this.error = error instanceof Error ? error.message : "测试模型配置失败。";
        throw error;
      } finally {
        this.testingIds = this.testingIds.filter((item) => item !== id);
      }
    }
  }
});
