import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const rendererRoot = join(root, "apps/desktop/src/renderer");

const forbiddenPatterns = [
  { label: "electron import", pattern: /\bfrom\s+["']electron["']/ },
  { label: "node protocol import", pattern: /\bfrom\s+["']node:/ },
  { label: "fs import", pattern: /\bfrom\s+["']fs(?:\/promises)?["']/ },
  { label: "child_process import", pattern: /\bfrom\s+["']child_process["']/ },
  { label: "runtime require", pattern: /\brequire\s*\(/ },
  { label: "process.env access", pattern: /\bprocess\.env\b/ },
  { label: "raw ipcRenderer", pattern: /\bipcRenderer\b/ },
  { label: "SQLite access", pattern: /\b(better-sqlite3|drizzle-orm)\b/ },
  { label: "pi runtime access", pattern: /@earendil-works\/pi|@personal-claw\/pi-runtime-adapter/ },
  { label: "sqlite infrastructure access", pattern: /@personal-claw\/infrastructure-sqlite/ },
  { label: "secret API access", pattern: /\bsafeStorage\b/ }
];

function walk(dir) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...walk(path));
    } else if (/\.(ts|vue|tsx|js)$/.test(entry)) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];

for (const file of walk(rendererRoot)) {
  const source = readFileSync(file, "utf8");

  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(source)) {
      violations.push(`${relative(root, file)}: ${label}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Renderer boundary violations:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
