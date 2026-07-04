import {
  CommandEnvelopeSchema,
  CommandResultSchema,
  type CommandEnvelope,
  type CommandResult,
  type SystemEventEnvelope,
  type UtilityHealthPayload,
  type UtilityWorkerName
} from "@personal-claw/contracts";
import { createLogger, nowIso } from "@personal-claw/shared";

type UtilityInboundMessage =
  | {
      kind: "utility.health.request";
      requestId: string;
    }
  | {
      kind: "utility.shutdown";
      requestId: string;
    }
  | {
      kind: "utility.command.request";
      requestId: string;
      command: CommandEnvelope;
    };

interface UtilityRuntimeOptions {
  commandHandler?: (
    command: CommandEnvelope,
    emitEvent: (event: SystemEventEnvelope) => void
  ) => Promise<CommandResult> | CommandResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapMessage(message: unknown): unknown {
  if (isRecord(message) && "data" in message) {
    return message.data;
  }

  return message;
}

function parseInboundMessage(message: unknown): UtilityInboundMessage | undefined {
  const raw = unwrapMessage(message);

  if (!isRecord(raw) || typeof raw.kind !== "string" || typeof raw.requestId !== "string") {
    return undefined;
  }

  if (raw.kind === "utility.health.request" || raw.kind === "utility.shutdown") {
    return {
      kind: raw.kind,
      requestId: raw.requestId
    };
  }

  if (raw.kind === "utility.command.request") {
    const parsedCommand = CommandEnvelopeSchema.safeParse(raw.command);

    if (!parsedCommand.success) {
      return undefined;
    }

    return {
      kind: raw.kind,
      requestId: raw.requestId,
      command: parsedCommand.data
    };
  }

  return undefined;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    value: error
  };
}

export function bootUtility(worker: UtilityWorkerName, options: UtilityRuntimeOptions = {}): void {
  const logger = createLogger({ process: worker, workerId: `${worker}-${process.pid}` });
  const port = process.parentPort;

  if (!port) {
    throw new Error(`${worker} utility requires Electron utilityProcess parentPort.`);
  }

  const startedAt = nowIso();
  let lastHeartbeatAt = startedAt;
  let isShuttingDown = false;

  const buildHealth = (): UtilityHealthPayload => ({
    name: worker,
    status: isShuttingDown ? "stopped" : "ok",
    pid: process.pid,
    startedAt,
    lastHeartbeatAt,
    details: {
      uptimeMs: Math.round(process.uptime() * 1000),
      mode: "phase0-health-only"
    }
  });

  const heartbeat = setInterval(() => {
    lastHeartbeatAt = nowIso();
    port.postMessage({
      kind: "utility.heartbeat",
      worker,
      pid: process.pid,
      timestamp: lastHeartbeatAt
    });
  }, 5000);
  heartbeat.unref();

  const shutdown = (requestId: string): void => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    clearInterval(heartbeat);
    logger.info({ requestId }, "utility shutting down");
    port.postMessage({
      kind: "utility.shutdown_ack",
      worker,
      requestId,
      timestamp: nowIso()
    });

    setTimeout(() => {
      process.exit(0);
    }, 25).unref();
  };

  const handleCommand = async (requestId: string, command: CommandEnvelope): Promise<void> => {
    const emitEvent = (event: SystemEventEnvelope): void => {
      port.postMessage({
        kind: "utility.command.event",
        worker,
        requestId,
        event
      });
    };

    try {
      const rawResult = options.commandHandler
        ? await options.commandHandler(command, emitEvent)
        : {
            status: "rejected" as const,
            requestId: command.id,
            error: {
              code: "utility.unsupported_command",
              message: `${worker} utility does not handle ${command.type}.`
            }
          };
      const result = CommandResultSchema.parse(rawResult);

      port.postMessage({
        kind: "utility.command.result",
        worker,
        requestId,
        result
      });
    } catch (error: unknown) {
      logger.error({ requestId, error: serializeError(error) }, "utility command failed");
      port.postMessage({
        kind: "utility.command.result",
        worker,
        requestId,
        result: {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "utility.command_failed",
            message: error instanceof Error ? error.message : "Utility command failed.",
            details: serializeError(error)
          }
        }
      });
    }
  };

  port.on("message", (message: unknown) => {
    const command = parseInboundMessage(message);

    if (!command) {
      return;
    }

    if (command.kind === "utility.health.request") {
      lastHeartbeatAt = nowIso();
      port.postMessage({
        kind: "utility.health",
        worker,
        requestId: command.requestId,
        payload: buildHealth()
      });
      return;
    }

    if (command.kind === "utility.command.request") {
      void handleCommand(command.requestId, command.command);
      return;
    }

    shutdown(command.requestId);
  });

  process.once("SIGTERM", () => {
    shutdown("signal_sigterm");
  });

  process.once("SIGINT", () => {
    shutdown("signal_sigint");
  });

  logger.info({ worker, pid: process.pid }, "utility ready");
  port.postMessage({
    kind: "utility.ready",
    worker,
    pid: process.pid,
    startedAt
  });
}
