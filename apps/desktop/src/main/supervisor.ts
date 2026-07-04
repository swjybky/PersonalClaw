import { utilityProcess, type UtilityProcess } from "electron";
import { join } from "node:path";
import {
  CommandResultSchema,
  SystemEventEnvelopeSchema,
  type CommandEnvelope,
  type CommandResult,
  type SystemEventEnvelope,
  type UtilityHealthPayload,
  type UtilityWorkerName
} from "@personal-claw/contracts";
import { createId, createLogger, nowIso } from "@personal-claw/shared";

type WorkerStatus = UtilityHealthPayload["status"];

interface PendingHealth {
  resolve(value: UtilityHealthPayload): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface PendingShutdown {
  resolve(): void;
  timer: NodeJS.Timeout;
}

interface PendingCommand {
  resolve(value: CommandResult): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface UtilitySupervisorOptions {
  onUnexpectedExit(worker: UtilityWorkerName, reason: string): void;
  onUtilityEvent(event: SystemEventEnvelope): void;
}

const logger = createLogger({ process: "main", workerId: "utility-supervisor" });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" ? value[key] : undefined;
}

class UtilityWorkerProcess {
  private child: UtilityProcess | undefined;
  private status: WorkerStatus = "stopped";
  private pid: number | undefined;
  private startedAt: string | undefined;
  private lastHeartbeatAt: string | undefined;
  private isStopping = false;
  private readonly pendingHealth = new Map<string, PendingHealth>();
  private readonly pendingShutdown = new Map<string, PendingShutdown>();
  private readonly pendingCommands = new Map<string, PendingCommand>();

  constructor(
    private readonly worker: UtilityWorkerName,
    private readonly entryPath: string,
    private readonly onUnexpectedExit: (worker: UtilityWorkerName, reason: string) => void,
    private readonly onUtilityEvent: (event: SystemEventEnvelope) => void,
    private readonly env: NodeJS.ProcessEnv = {}
  ) {}

  start(): void {
    if (this.child) {
      return;
    }

    this.isStopping = false;
    this.status = "starting";
    this.child = utilityProcess.fork(this.entryPath, [], {
      env: { ...process.env, ...this.env }
    });
    this.pid = this.child.pid;

    this.child.on("message", (message: unknown) => {
      this.handleMessage(message);
    });

    this.child.once("exit", (code) => {
      const reason = `exit:${code ?? "unknown"}`;
      this.child = undefined;
      this.status = "stopped";
      this.rejectPendingHealth(new Error(`${this.worker} utility exited: ${reason}`));
      this.rejectPendingCommands(new Error(`${this.worker} utility exited: ${reason}`));
      this.resolvePendingShutdown();

      if (!this.isStopping) {
        this.onUnexpectedExit(this.worker, reason);
      }
    });

    logger.info({ worker: this.worker, entryPath: this.entryPath, pid: this.pid }, "utility process started");
  }

  async requestHealth(timeoutMs = 1500): Promise<UtilityHealthPayload> {
    if (!this.child) {
      return this.snapshot();
    }

    const requestId = createId(`health_${this.worker}`);
    const health = new Promise<UtilityHealthPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingHealth.delete(requestId);
        reject(new Error(`${this.worker} utility health check timed out.`));
      }, timeoutMs);

      this.pendingHealth.set(requestId, {
        resolve,
        reject,
        timer
      });
    });

    this.child.postMessage({
      kind: "utility.health.request",
      requestId
    });

    try {
      return await health;
    } catch (error) {
      logger.warn({ worker: this.worker, error }, "utility health check failed");
      return {
        ...this.snapshot(),
        status: this.status === "starting" ? "starting" : "degraded"
      };
    }
  }

  snapshot(): UtilityHealthPayload {
    return {
      name: this.worker,
      status: this.status,
      ...(this.pid ? { pid: this.pid } : {}),
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      ...(this.lastHeartbeatAt ? { lastHeartbeatAt: this.lastHeartbeatAt } : {}),
      details: {
        entry: this.entryPath
      }
    };
  }

  shutdown(timeoutMs = 1500): Promise<void> {
    this.isStopping = true;

    if (!this.child) {
      this.status = "stopped";
      return Promise.resolve();
    }

    const requestId = createId(`shutdown_${this.worker}`);
    const child = this.child;

    const shutdown = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingShutdown.delete(requestId);
        child.kill();
        resolve();
      }, timeoutMs);

      this.pendingShutdown.set(requestId, {
        resolve,
        timer
      });
    });

    child.postMessage({
      kind: "utility.shutdown",
      requestId
    });

    return shutdown;
  }

  requestCommand(command: CommandEnvelope, timeoutMs = 60_000): Promise<CommandResult> {
    if (!this.child) {
      return Promise.resolve({
        status: "rejected",
        requestId: command.id,
        error: {
          code: "utility.not_running",
          message: `${this.worker} utility is not running.`
        }
      });
    }

    const requestId = command.id;
    const child = this.child;
    const result = new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`${this.worker} utility command timed out: ${command.type}`));
      }, timeoutMs);

      this.pendingCommands.set(requestId, {
        resolve,
        reject,
        timer
      });
    });

    child.postMessage({
      kind: "utility.command.request",
      requestId,
      command
    });

    return result;
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message)) {
      return;
    }

    const kind = readString(message, "kind");
    const worker = readString(message, "worker");

    if (worker !== this.worker) {
      return;
    }

    if (kind === "utility.ready") {
      this.status = "ok";
      this.pid = readNumber(message, "pid") ?? this.pid;
      this.startedAt = readString(message, "startedAt") ?? this.startedAt;
      this.lastHeartbeatAt = nowIso();
      return;
    }

    if (kind === "utility.heartbeat") {
      this.status = "ok";
      this.lastHeartbeatAt = readString(message, "timestamp") ?? nowIso();
      return;
    }

    if (kind === "utility.health") {
      const requestId = readString(message, "requestId");
      const pending = requestId ? this.pendingHealth.get(requestId) : undefined;
      const payload = isRecord(message.payload) ? message.payload : undefined;

      if (requestId && pending && payload) {
        clearTimeout(pending.timer);
        this.pendingHealth.delete(requestId);
        this.status = "ok";
        this.lastHeartbeatAt = nowIso();
        pending.resolve(payload as UtilityHealthPayload);
      }
      return;
    }

    if (kind === "utility.shutdown_ack") {
      const requestId = readString(message, "requestId");
      const pending = requestId ? this.pendingShutdown.get(requestId) : undefined;

      if (requestId && pending) {
        clearTimeout(pending.timer);
        this.pendingShutdown.delete(requestId);
        pending.resolve();
      }
      return;
    }

    if (kind === "utility.command.result") {
      const requestId = readString(message, "requestId");
      const pending = requestId ? this.pendingCommands.get(requestId) : undefined;
      const parsed = CommandResultSchema.safeParse(message.result);

      if (requestId && pending && parsed.success) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(requestId);
        pending.resolve(parsed.data);
      }
      return;
    }

    if (kind === "utility.command.event") {
      const parsed = SystemEventEnvelopeSchema.safeParse(message.event);

      if (parsed.success) {
        this.onUtilityEvent(parsed.data as SystemEventEnvelope);
      } else {
        logger.warn({ worker: this.worker, message }, "utility emitted invalid event");
      }
      return;
    }

    if (kind === "utility.error") {
      logger.error({ worker: this.worker, message }, "utility reported error");
    }
  }

  private rejectPendingHealth(error: Error): void {
    for (const [requestId, pending] of this.pendingHealth.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingHealth.delete(requestId);
    }
  }

  private rejectPendingCommands(error: Error): void {
    for (const [requestId, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingCommands.delete(requestId);
    }
  }

  private resolvePendingShutdown(): void {
    for (const [requestId, pending] of this.pendingShutdown.entries()) {
      clearTimeout(pending.timer);
      pending.resolve();
      this.pendingShutdown.delete(requestId);
    }
  }
}

export class UtilitySupervisor {
  private readonly workers: Map<UtilityWorkerName, UtilityWorkerProcess>;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: UtilitySupervisorOptions, env: NodeJS.ProcessEnv = {}) {
    this.env = env;
    const createWorker = (worker: UtilityWorkerName): UtilityWorkerProcess =>
      new UtilityWorkerProcess(
        worker,
        join(__dirname, "utilities", `${worker}-entry.js`),
        options.onUnexpectedExit,
        options.onUtilityEvent,
        this.env
      );

    this.workers = new Map([
      ["core", createWorker("core")],
      ["agent", createWorker("agent")],
      ["tool", createWorker("tool")]
    ]);
  }

  setEnvironment(env: NodeJS.ProcessEnv): void {
    Object.assign(this.env, env);
  }

  startAll(): void {
    for (const worker of this.workers.values()) {
      worker.start();
    }
  }

  async collectHealth(): Promise<{
    status: "starting" | "ok" | "degraded";
    checkedAt: string;
    workers: UtilityHealthPayload[];
  }> {
    const workers = await Promise.all([...this.workers.values()].map((worker) => worker.requestHealth()));
    const status = workers.every((worker) => worker.status === "ok")
      ? "ok"
      : workers.some((worker) => worker.status === "starting")
        ? "starting"
        : "degraded";

    return {
      status,
      checkedAt: nowIso(),
      workers
    };
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.workers.values()].map((worker) => worker.shutdown()));
  }

  requestCommand(worker: UtilityWorkerName, command: CommandEnvelope, timeoutMs?: number): Promise<CommandResult> {
    const target = this.workers.get(worker);

    if (!target) {
      return Promise.resolve({
        status: "rejected",
        requestId: command.id,
        error: {
          code: "utility.unknown_worker",
          message: `Unknown utility worker: ${worker}`
        }
      });
    }

    return target.requestCommand(command, timeoutMs);
  }
}
