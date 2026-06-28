import pino, { type Logger } from "pino";

export type ProcessName = "main" | "core" | "agent" | "tool" | "renderer" | "test";

export interface LoggerContext {
  process: ProcessName;
  workerId?: string;
  correlationId?: string;
}

const redactPaths = [
  "apiKey",
  "token",
  "authorization",
  "Authorization",
  "cookie",
  "password",
  "secret",
  "*.apiKey",
  "*.token",
  "*.authorization",
  "*.Authorization",
  "*.cookie",
  "*.password",
  "*.secret"
];

export function createLogger(context: LoggerContext): Logger {
  return pino({
    name: "personal-claw",
    level: process.env.PERSONAL_CLAW_LOG_LEVEL ?? "info",
    base: context,
    redact: {
      paths: redactPaths,
      censor: "[redacted]"
    }
  });
}
