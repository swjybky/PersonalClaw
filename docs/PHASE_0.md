# Phase 0 工程骨架说明

Phase 0 只交付可运行的桌面壳、进程边界、健康检查和基础协议，不实现真实 Agent、SQLite 业务表、工具执行或主动任务。

## 开发命令

- `pnpm install`：安装固定版本依赖。
- `pnpm dev`：启动 Electron + Vue 开发环境。
- `pnpm build`：构建 main、preload、renderer 和 utility entrypoints。
- `pnpm typecheck`：检查桌面端与所有 workspace 包类型。
- `pnpm lint`：检查 Renderer 禁止导入和包依赖边界。
- `pnpm test`：运行契约、领域和安全测试。
- `pnpm smoke`：使用构建后的 Electron app 执行 Utility 健康检查后自动退出。
- `pnpm verify`：执行 typecheck、lint、test。

## 已落地边界

- Electron Main 负责窗口、安全 webPreferences、Utility 监督和 IPC Router。
- Preload 只暴露 `window.personalClaw.system.health()` 与 `window.personalClaw.events.subscribe()`。
- Renderer 只展示状态，不导入 Electron、Node、SQLite、pi SDK 或密钥模块。
- Core、Agent、Tool 三个 Utility entrypoint 可以独立启动、响应健康检查和优雅关闭。
- `packages/contracts` 定义版本化 Envelope、command result、system health 和 system event schema。
- `packages/shared` 提供结构化 Pino 日志、ID 和时间工具。

## 下一阶段入口

Phase 1 应在保持这些边界的基础上接入 Project、Session、消息流、模型设置、`pi-runtime-adapter` 和 SQLite migration。
