import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(currentDir, "../..");

describe("package dependency boundaries", () => {
  it("keeps domain application and main dependencies in the Phase 0 lanes", () => {
    expect(() => {
      execFileSync(process.execPath, ["tools/check-package-boundaries.mjs"], {
        cwd: root,
        stdio: "pipe"
      });
    }).not.toThrow();
  });
});
