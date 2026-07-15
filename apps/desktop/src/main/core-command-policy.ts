import type { CommandType, UtilityWorkerName } from "@personal-claw/contracts";

const utilityCoreCommandAllowlist = {
  core: [],
  agent: [
    "task.create",
    "task.list",
    "task.get",
    "task.update",
    "task.updateProgress"
  ],
  tool: []
} as const satisfies Record<UtilityWorkerName, readonly CommandType[]>;

/**
 * Phase 2A only lets the Agent proxy its five task-management tools to Core.
 * Approval commands are intentionally absent: requesting or granting plan
 * approval must remain a Renderer -> Main -> Core user action. Tool has no
 * Core command capability in this phase.
 */
export function isUtilityCoreCommandAllowed(
  sourceWorker: UtilityWorkerName,
  commandType: CommandType
): boolean {
  return utilityCoreCommandAllowlist[sourceWorker].some(
    (allowedCommandType) => allowedCommandType === commandType
  );
}
