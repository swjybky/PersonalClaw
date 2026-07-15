import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2];

if (mode === "smoke") {
  process.env.PERSONAL_CLAW_SMOKE = "1";
} else if (mode === "renderer-smoke") {
  process.env.PERSONAL_CLAW_RENDERER_SMOKE = "1";
} else {
  console.error(`Unsupported preview mode: ${mode ?? "missing"}`);
  process.exit(1);
}

const smokeUserDataPath = mkdtempSync(join(tmpdir(), "personal-claw-smoke-"));
process.env.PERSONAL_CLAW_SMOKE_USER_DATA_DIR = smokeUserDataPath;

function cleanupSmokeUserData() {
  rmSync(smokeUserDataPath, { recursive: true, force: true });
}

const isWindows = process.platform === "win32";
const command = isWindows ? "electron-vite preview" : "electron-vite";
const args = isWindows ? [] : ["preview"];
const child = spawn(command, args, {
  env: process.env,
  shell: isWindows,
  stdio: "inherit"
});

child.on("error", (error) => {
  cleanupSmokeUserData();
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  cleanupSmokeUserData();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
