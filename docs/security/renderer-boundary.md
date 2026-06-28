# Renderer 安全边界

Renderer 必须满足：

- `nodeIntegration=false`
- `contextIsolation=true`
- `sandbox=true`
- 不直接导入 `electron`、`fs`、`node:*`、SQLite、pi runtime 或密钥模块。
- 不访问 `process.env`、`require` 或通用 IPC channel。

当前边界由 `tools/check-renderer-boundary.mjs` 和 `tests/security/renderer-boundary.test.ts` 共同检查。
