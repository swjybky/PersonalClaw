import { contextBridge, ipcRenderer } from "electron";
import {
  CommandResultSchema,
  IPC_COMMAND_CHANNEL,
  IPC_EVENT_CHANNEL,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  createEnvelope,
  type CommandType,
  type PersonalClawApi,
  type SystemEventEnvelope,
  type SystemHealthPayload
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
