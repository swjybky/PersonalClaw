# Phase 1 Pi Core Integration Slice

本切片将“新建对话”接入 pi-ai 与 pi-agent-core，但不完成整个 Phase 1。Project、SQLite migration、持久化 Session 和模型设置 UI 仍是后续任务。

## 已落地

- `packages/pi-runtime-adapter` 固定依赖 `@earendil-works/pi-ai@0.80.3` 与 `@earendil-works/pi-agent-core@0.80.3`。
- Agent Utility 支持 `session.prompt`，并通过 pi-agent-core 产生 `agent.message_delta` 与 `agent.message_completed`。
- Renderer 只通过 preload 调用 `window.personalClaw.session.prompt()`，不导入 pi SDK、Node、SQLite 或密钥模块。
- 中间对话区使用 `@earendil-works/pi-web-ui@0.75.3` 的 `MessageList` 与 `MessageEditor` 组件，组件注册与消息转换集中在 `packages/chat-ui-adapter`。
- 左侧历史对话使用 Renderer `localStorage` 历史存储恢复和更新；这仍是 UI 级历史缓存，后续 Core Session persistence 接管业务持久化。
- Main 仅负责 IPC schema 校验、Utility command 转发和事件广播。
- 默认使用 pi-ai faux provider，保证无 API key 时也能验证完整链路。
- 工具调用会被 `beforeToolCall` 阻断，等待 Phase 3 的 Policy Engine 和 Approval Center。
- `@earendil-works/pi-web-ui@0.75.3` 的 `xlsx` URL tarball 传递依赖通过 workspace `overrides` 固定到 registry `xlsx@0.18.5`，保留当前供应链策略。

## 运行

默认本地 faux provider：

```bash
pnpm dev
```

配置真实 provider 时，在启动 Agent Utility 前提供：

```bash
PERSONAL_CLAW_PI_PROVIDER=openai PERSONAL_CLAW_PI_MODEL=<model-id> OPENAI_API_KEY=<key> pnpm dev
```

当前 adapter 支持的 provider id：`anthropic`、`deepseek`、`kimi-coding`、`moonshotai-cn`、`openai`、`xiaomi-token-plan-cn`、`zai-coding-cn`。真实 provider 必须显式设置 `PERSONAL_CLAW_PI_MODEL`。

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm smoke
pnpm smoke:renderer
```

## 已知风险

- 当前 Session 尚未由 Core/SQLite 持久化；Renderer 历史只能覆盖当前 UI 历史恢复，不能作为 Task/Plan/Run 的业务状态来源。
- API key 暂以 provider 环境变量方式进入 Agent Utility；后续需要接入系统安全存储和 Core settings command。
- Core 仍未作为 Session/Run 状态单写入者落库；本切片没有改变 Task/Plan/Run 持久化状态。

## 下一步

- 建立 Project 与 Session schema、SQLite migration 和 Core Query/Command handler。
- 将 `session.prompt` 从 Main 直转 Agent Utility 迁移为 Main -> Core -> Agent Utility，并由 Core 统一落库事件。
- 增加模型设置 UI 和 secretRef 存储，不让真实 API key 依赖开发环境变量。
- 将 Renderer 历史迁移为 Core Session persistence，并把历史列表改为 Core Query 读取。
