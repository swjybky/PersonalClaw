import type { UtilityHealthPayload, UtilityWorkerName } from "@personal-claw/contracts";
import { createLogger, nowIso } from "@personal-claw/shared";

type UtilityInboundMessage =
  | {
      kind: "utility.health.request";
      requestId: string;
    }
  | {
      kind: "utility.shutdown";
      requestId: string;
    };

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

  return undefined;
}

export function bootUtility(worker: UtilityWorkerName): void {
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
