import type { TaskStatusDto, TaskStatusView, TaskSummary } from "@personal-claw/contracts";

export type TaskBoardTab = "all" | "todo" | "done" | "blocked";

export type TaskTagTone = "success" | "warning" | "error" | "default" | "info";

export type TaskFlowAction =
  | {
      kind: "set_status";
      label: string;
      status: "analyzing" | "design_ready" | "cancelled";
      disabledReason: string | null;
    }
  | {
      kind: "request_plan_approval";
      label: string;
      planId: string | null;
      disabledReason: string | null;
    }
  | {
      kind: "approve_plan";
      label: string;
      planId: string | null;
      disabledReason: string | null;
    }
  | {
      kind: "phase4_wait";
      label: string;
      disabledReason: string;
    };

export interface TaskBoardCounts {
  total: number;
  active: number;
  done: number;
  blocked: number;
}

export interface TaskReviewSelection {
  analysisVersion: number | null;
  planVersion: number | null;
  codeAgentId: string | null;
}

const activeStatuses: ReadonlySet<TaskStatusDto> = new Set([
  "draft",
  "analyzing",
  "design_ready",
  "awaiting_approval",
  "queued",
  "running",
  "paused",
  "verifying"
]);

export function summarizeTaskBoard(tasks: readonly TaskSummary[]): TaskBoardCounts {
  return {
    total: tasks.length,
    active: tasks.filter((task) => activeStatuses.has(task.status)).length,
    done: tasks.filter((task) => task.status === "succeeded").length,
    blocked: tasks.filter((task) => task.status === "blocked" || task.status === "failed").length
  };
}

export function pickTaskId(tasks: readonly TaskSummary[], currentTaskId: string | null): string | null {
  if (currentTaskId && tasks.some((task) => task.id === currentTaskId)) {
    return currentTaskId;
  }

  return tasks[0]?.id ?? null;
}

export function filterTaskBoardTasks(
  tasks: readonly TaskSummary[],
  tab: TaskBoardTab
): readonly TaskSummary[] {
  switch (tab) {
    case "todo":
      return tasks.filter((task) => activeStatuses.has(task.status));
    case "done":
      return tasks.filter((task) => task.status === "succeeded");
    case "blocked":
      return tasks.filter((task) => task.status === "blocked" || task.status === "failed");
    case "all":
      return tasks;
  }
}

export function taskStatusLabel(status: TaskStatusDto): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "analyzing":
      return "分析中";
    case "design_ready":
      return "方案就绪";
    case "awaiting_approval":
      return "等待审批";
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "paused":
      return "已暂停";
    case "blocked":
      return "阻塞";
    case "verifying":
      return "验证中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "archived":
      return "已归档";
  }
}

export function taskStatusTone(status: TaskStatusDto): TaskTagTone {
  if (status === "succeeded") {
    return "success";
  }

  if (status === "blocked" || status === "failed" || status === "cancelled") {
    return "error";
  }

  if (
    status === "running" ||
    status === "verifying" ||
    status === "queued" ||
    status === "awaiting_approval"
  ) {
    return "warning";
  }

  return status === "design_ready" ? "info" : "default";
}

export function resolveTaskFlowAction(view: TaskStatusView | null): TaskFlowAction | null {
  if (!view) {
    return null;
  }

  switch (view.task.status) {
    case "draft":
      return {
        kind: "set_status",
        label: "开始分析",
        status: "analyzing",
        disabledReason: view.availableTransitions.includes("analyzing")
          ? null
          : "Core 当前不允许任务进入分析状态。"
      };
    case "analyzing": {
      const disabledReason = !view.availableTransitions.includes("design_ready")
        ? "Core 当前不允许任务进入方案就绪状态。"
        : !view.analysis
        ? "请先保存任务分析。"
        : !view.plan
          ? "请先保存执行方案。"
          : null;
      return {
        kind: "set_status",
        label: "完成分析与方案",
        status: "design_ready",
        disabledReason
      };
    }
    case "design_ready":
      return {
        kind: "request_plan_approval",
        label: "提交方案审批",
        planId: view.plan?.id ?? null,
        disabledReason: !view.availableTransitions.includes("awaiting_approval")
          ? "Core 当前不允许提交方案审批。"
          : !view.analysis
          ? "任务分析尚未保存。"
          : !view.plan
            ? "执行方案尚未保存。"
            : view.plan.approvalState !== "not_requested" && view.plan.approvalState !== "rejected"
              ? "当前方案已经提交审批。"
              : null
      };
    case "awaiting_approval":
      return {
        kind: "approve_plan",
        label: "批准方案并进入队列",
        planId: view.plan?.id ?? null,
        disabledReason: !view.availableTransitions.includes("queued")
          ? "Core 当前不允许已批准方案进入队列。"
          : view.plan?.approvalState === "pending"
            ? null
            : "只有等待审批的最新方案可以批准。"
      };
    case "queued":
      return {
        kind: "phase4_wait",
        label: "等待执行编排",
        disabledReason: "方案已批准；真实 codeAgent 执行将在 Phase 4 接入。"
      };
    default:
      return null;
  }
}

export function guardTaskFlowActionForReviewSelection(
  action: TaskFlowAction | null,
  view: TaskStatusView | null,
  selection: TaskReviewSelection
): TaskFlowAction | null {
  if (
    !action ||
    !view ||
    (action.kind !== "request_plan_approval" && action.kind !== "approve_plan") ||
    action.disabledReason
  ) {
    return action;
  }

  if (selection.analysisVersion !== (view.analysis?.version ?? null)) {
    return {
      ...action,
      disabledReason: "当前正在查看历史分析版本，请切回最新分析后再审批。"
    };
  }

  if (selection.planVersion !== (view.plan?.version ?? null)) {
    return {
      ...action,
      disabledReason: "当前正在查看历史方案版本，请切回最新方案后再审批。"
    };
  }

  if (selection.codeAgentId !== view.task.codeAgentId) {
    return {
      ...action,
      disabledReason: "执行器选择尚未保存，请先保存分配或恢复当前值。"
    };
  }

  return action;
}

export function splitTaskEditorLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))];
}

export function splitTaskDependencyKeys(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/u).map((item) => item.trim()).filter(Boolean))];
}

export function joinTaskEditorLines(values: readonly string[]): string {
  return values.join("\n");
}
