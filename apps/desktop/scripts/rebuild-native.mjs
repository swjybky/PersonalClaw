import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const mode = process.argv[2];
const require = createRequire(import.meta.url);
const appRoot = join(dirname(new URL(import.meta.url).pathname), "..");
const markerPath = join(appRoot, "node_modules", ".personal-claw-native-abi");
const packageJsonPath = join(appRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const electronVersion = packageJson.devDependencies?.electron ?? "unknown";

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readMarker() {
  if (!existsSync(markerPath)) {
    return "";
  }

  return readFileSync(markerPath, "utf8").trim();
}

function writeMarker(value) {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${value}\n`, "utf8");
}

if (mode === "electron") {
  const desired = `electron-${electronVersion}-${process.arch}`;

  if (readMarker() === desired) {
    process.exit(0);
  }

  run("pnpm", ["exec", "electron-builder", "install-app-deps"], appRoot);
  writeMarker(desired);
  process.exit(0);
}

if (mode === "node") {
  const desired = `node-${process.versions.modules}-${process.arch}`;

  if (readMarker() === desired) {
    process.exit(0);
  }

  const betterSqlitePackagePath = require.resolve("better-sqlite3/package.json");
  run("npm", ["rebuild"], dirname(betterSqlitePackagePath));
  writeMarker(desired);
  process.exit(0);
}

console.error(`Unsupported native rebuild mode: ${mode ?? "missing"}`);
process.exit(1);
