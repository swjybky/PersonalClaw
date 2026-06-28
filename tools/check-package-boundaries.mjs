import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

const rules = [
  {
    name: "domain stays pure",
    dir: "packages/domain/src",
    forbidden: [
      /\bfrom\s+["']electron["']/,
      /\bfrom\s+["']vue["']/,
      /\bfrom\s+["']node:/,
      /better-sqlite3|drizzle-orm/,
      /@earendil-works\/pi/,
      /@personal-claw\/(application|infrastructure-sqlite|pi-runtime-adapter|policy-engine|scheduler|tool-sdk)/
    ]
  },
  {
    name: "application uses only domain contracts and ports",
    dir: "packages/application/src",
    forbidden: [
      /\bfrom\s+["']electron["']/,
      /\bfrom\s+["']vue["']/,
      /better-sqlite3|drizzle-orm/,
      /@earendil-works\/pi/,
      /@personal-claw\/(infrastructure-sqlite|pi-runtime-adapter|policy-engine|scheduler|tool-sdk)/
    ]
  },
  {
    name: "main stays out of business adapters",
    dir: "apps/desktop/src/main",
    forbidden: [
      /@personal-claw\/(domain|infrastructure-sqlite|pi-runtime-adapter|chat-ui-adapter|tool-sdk|policy-engine|scheduler)/,
      /better-sqlite3|drizzle-orm/,
      /@earendil-works\/pi/
    ]
  }
];

function walk(dir) {
  const absoluteDir = join(root, dir);
  const files = [];

  for (const entry of readdirSync(absoluteDir)) {
    const path = join(absoluteDir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...walk(relative(root, path)));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];

for (const rule of rules) {
  for (const file of walk(rule.dir)) {
    const source = readFileSync(file, "utf8");

    for (const pattern of rule.forbidden) {
      if (pattern.test(source)) {
        violations.push(`${relative(root, file)} violates "${rule.name}"`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Package boundary violations:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
