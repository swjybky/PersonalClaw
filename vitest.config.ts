import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(__dirname);

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    globals: false
  },
  resolve: {
    alias: {
      "@personal-claw/contracts": resolve(root, "packages/contracts/src/index.ts"),
      "@personal-claw/shared": resolve(root, "packages/shared/src/index.ts"),
      "@personal-claw/domain": resolve(root, "packages/domain/src/index.ts"),
      "@personal-claw/application": resolve(root, "packages/application/src/index.ts"),
      "@personal-claw/infrastructure-sqlite": resolve(root, "packages/infrastructure-sqlite/src/index.ts"),
      "@personal-claw/pi-runtime-adapter": resolve(root, "packages/pi-runtime-adapter/src/index.ts"),
      "@personal-claw/chat-ui-adapter": resolve(root, "packages/chat-ui-adapter/src/index.ts"),
      "@personal-claw/tool-sdk": resolve(root, "packages/tool-sdk/src/index.ts"),
      "@personal-claw/scheduler": resolve(root, "packages/scheduler/src/index.ts")
    }
  }
});
