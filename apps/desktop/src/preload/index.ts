import { contextBridge, ipcRenderer } from "electron";
import {
  CommandResultSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  SessionPromptCommandPayloadSchema,
  TaskDraftAcceptedPayloadSchema,
  TaskDraftFromDescriptionCommandPayloadSchema,
  ModelConfigSummaryListPayloadSchema,
  ModelConfigDeleteCommandPayloadSchema,
  ModelConfigEntryInputSchema,
  ModelConfigSetDefaultCommandPayloadSchema,
  ModelConfigTestCommandPayloadSchema,
  ModelConfigTestResultPayloadSchema,
  createEnvelope,
  type CommandType,
  type ModelConfigDeleteCommandPayload,
  type ModelConfigEntryInput,
  type ModelConfigSetDefaultCommandPayload,
  type ModelConfigSummaryListPayload,
  type ModelConfigTestCommandPayload,
  type ModelConfigTestResultPayload,
  type PersonalClawApi,
  type SessionPromptAcceptedPayload,
  type SessionPromptCommandPayload,
  type SystemEventEnvelope,
  type SystemHealthPayload,
  type TaskDraftAcceptedPayload,
  type TaskDraftFromDescriptionCommandPayload
} from "@personal-claw/contracts";

function createBrowserId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

async function invokeCommand<TPayload>(type: CommandType, payload: unknown): Promise<TPayload> {
  const commandId = createBrowserId("cmd");
  const result = CommandResultSchema.parse(
    await ipcRenderer.invoke(
      IPC_COMMAND_CHANNEL,
      createEnvelope(type, payload, {
        id: commandId,
        context: {
          correlationId: commandId
        }
      })
    )
  );

  if (result.status === "rejected") {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }

  return result.payload as TPayload;
}

const api: PersonalClawApi = {
  system: {
    async health(): Promise<SystemHealthPayload> {
      return SystemHealthPayloadSchema.parse(await invokeCommand<SystemHealthPayload>("system.health", {}));
    }
  },
  session: {
    async prompt(payload: SessionPromptCommandPayload): Promise<SessionPromptAcceptedPayload> {
      return SessionPromptAcceptedPayloadSchema.parse(
        await invokeCommand<SessionPromptAcceptedPayload>("session.prompt", SessionPromptCommandPayloadSchema.parse(payload))
      );
    }
  },
  task: {
    async draftFromDescription(
      payload: TaskDraftFromDescriptionCommandPayload
    ): Promise<TaskDraftAcceptedPayload> {
      return TaskDraftAcceptedPayloadSchema.parse(
        await invokeCommand<TaskDraftAcceptedPayload>(
          "task.draftFromDescription",
          TaskDraftFromDescriptionCommandPayloadSchema.parse(payload)
        )
      );
    }
  },
  modelConfig: {
    async list(): Promise<ModelConfigSummaryListPayload> {
      return ModelConfigSummaryListPayloadSchema.parse(
        await invokeCommand<ModelConfigSummaryListPayload>("modelConfig.list", {})
      );
    },
    async upsert(entry: ModelConfigEntryInput): Promise<ModelConfigSummaryListPayload> {
      return ModelConfigSummaryListPayloadSchema.parse(
        await invokeCommand<ModelConfigSummaryListPayload>(
          "modelConfig.upsert",
          { entry: ModelConfigEntryInputSchema.parse(entry) }
        )
      );
    },
    async delete(payload: ModelConfigDeleteCommandPayload): Promise<ModelConfigSummaryListPayload> {
      return ModelConfigSummaryListPayloadSchema.parse(
        await invokeCommand<ModelConfigSummaryListPayload>(
          "modelConfig.delete",
          ModelConfigDeleteCommandPayloadSchema.parse(payload)
        )
      );
    },
    async setDefault(payload: ModelConfigSetDefaultCommandPayload): Promise<ModelConfigSummaryListPayload> {
      return ModelConfigSummaryListPayloadSchema.parse(
        await invokeCommand<ModelConfigSummaryListPayload>(
          "modelConfig.setDefault",
          ModelConfigSetDefaultCommandPayloadSchema.parse(payload)
        )
      );
    },
    async test(payload: ModelConfigTestCommandPayload): Promise<ModelConfigTestResultPayload> {
      return ModelConfigTestResultPayloadSchema.parse(
        await invokeCommand<ModelConfigTestResultPayload>(
          "modelConfig.test",
          ModelConfigTestCommandPayloadSchema.parse(payload)
        )
      );
    }
  },
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, rawEvent: unknown): void => {
        const parsed = SystemEventEnvelopeSchema.safeParse(rawEvent);

        if (parsed.success) {
          listener(parsed.data as SystemEventEnvelope);
        }
      };

      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);

      return () => {
        ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
      };
    }
  }
};

contextBridge.exposeInMainWorld("personalClaw", api);
