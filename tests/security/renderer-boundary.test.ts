import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(currentDir, "../..");

describe("renderer security boundary", () => {
  it("does not import privileged APIs", () => {
    expect(() => {
      execFileSync(process.execPath, ["tools/check-renderer-boundary.mjs"], {
        cwd: root,
        stdio: "pipe"
      });
    }).not.toThrow();
  });
});
