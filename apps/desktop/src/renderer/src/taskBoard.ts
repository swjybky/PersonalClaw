import type { TaskStatusDto, TaskSummary } from "@personal-claw/contracts";

export interface TaskBoardCounts {
  total: number;
  active: number;
  done: number;
  blocked: number;
}

const activeStatuses: ReadonlySet<TaskStatusDto> = new Set([
  "draft",
  "analyzing",
  "design_ready",
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

export function taskStatusLabel(status: TaskStatusDto): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "analyzing":
      return "分析中";
    case "design_ready":
      return "方案就绪";
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
