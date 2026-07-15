import type { CommandType, UtilityWorkerName } from "@personal-claw/contracts";
import { describe, expect, it } from "vitest";
import { isUtilityCoreCommandAllowed } from "../../apps/desktop/src/main/core-command-policy";

const agentTaskToolCommands = [
  "task.create",
  "task.list",
  "task.get",
  "task.update",
  "task.updateProgress"
] as const satisfies readonly CommandType[];

const forbiddenAgentCommands = [
  "task.draftFromDescription",
  "task.delete",
  "task.setStatus",
  "task.assignCodeAgent",
  "task.saveAnalysis",
  "task.savePlan",
  "task.requestPlanApproval",
  "task.approvePlan",
  "project.create",
  "codeAgent.upsert",
  "modelConfig.upsert",
  "system.health"
] as const satisfies readonly CommandType[];

describe("utility Core command policy", () => {
  it("allows Agent to proxy exactly its five Phase 2A task tools", () => {
    for (const commandType of agentTaskToolCommands) {
      expect(isUtilityCoreCommandAllowed("agent", commandType), commandType).toBe(true);
    }

    for (const commandType of forbiddenAgentCommands) {
      expect(isUtilityCoreCommandAllowed("agent", commandType), commandType).toBe(false);
    }
  });

  it.each(["task.requestPlanApproval", "task.approvePlan"] as const)(
    "forbids Agent and Tool from routing approval command %s",
    (commandType) => {
      expect(isUtilityCoreCommandAllowed("agent", commandType)).toBe(false);
      expect(isUtilityCoreCommandAllowed("tool", commandType)).toBe(false);
    }
  );

  it.each(["core", "tool"] satisfies readonly UtilityWorkerName[])(
    "gives %s no Core command capability in Phase 2A",
    (sourceWorker) => {
      for (const commandType of [...agentTaskToolCommands, ...forbiddenAgentCommands]) {
        expect(isUtilityCoreCommandAllowed(sourceWorker, commandType), commandType).toBe(false);
      }
    }
  );
});
