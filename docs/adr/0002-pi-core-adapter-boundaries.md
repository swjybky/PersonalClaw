# ADR 0002: Pi core integration boundaries

## 状态

Accepted

## 背景

Phase 1 需要把个人任务管理智能体接入 Pi 的底层能力，但架构基线要求 Renderer 不接触 pi SDK，Main 不承载业务逻辑，pi-web-ui 只能通过 adapter 隔离使用。

安装验证时，`@earendil-works/pi-ai@0.80.3` 与 `@earendil-works/pi-agent-core@0.80.3` 可以固定进入 `packages/pi-runtime-adapter`。`@earendil-works/pi-web-ui@0.75.3` 的传递依赖 `xlsx` 指向 URL tarball，触发当前 pnpm `blockExoticSubdeps` 供应链策略；本仓库通过 workspace `overrides` 将其固定为 registry `xlsx@0.18.5` 后再接入。

## 决策

- `@earendil-works/pi-ai@0.80.3` 与 `@earendil-works/pi-agent-core@0.80.3` 只放入 `packages/pi-runtime-adapter`。
- Agent Utility 通过 `PiAgentRuntimeAdapter` 创建 pi-agent-core `Agent`，默认使用 pi-ai faux provider 产出可测试的本地任务草稿。
- 真实 provider 通过 `PERSONAL_CLAW_PI_PROVIDER` 与 `PERSONAL_CLAW_PI_MODEL` 在 Agent Utility 中选择，API key 由 provider 自身在受控进程内从环境变量读取，Renderer 不接触密钥。
- `session.prompt` 使用 contracts 中的 schema 化 command；Agent 输出转成 `agent.message_delta`、`agent.message_completed`、`tool.call_requested` 和 `agent.error` 事件。
- Main 只做 schema 校验、命令转发和事件广播，不生成任务内容，不写业务状态。
- Tool call 默认由 pi-agent-core 的 `beforeToolCall` 阻断，直到 Phase 3 Policy Engine/Approval 链路接管。
- `@earendil-works/pi-web-ui@0.75.3` 只放入 `packages/chat-ui-adapter`，Renderer 通过该 adapter 注册 `MessageList` 与 `MessageEditor`，不使用会在 Renderer 创建 Agent 的完整 `ChatPanel`。
- pi-web-ui 当前没有公开导出组件子路径；adapter 使用包内 dist 组件路径加载 `MessageList`/`MessageEditor`，避免导入包入口时把 ChatPanel、provider discovery 和 pi runtime 相关代码带入 Renderer bundle。后续升级 pi-web-ui 时必须用 smoke 与 bundle 检查验证该私有路径仍可用。
- `xlsx` 通过 workspace `overrides` 固定为 `0.18.5`，不放开全局 exotic subdependency 策略。
- `@google/genai` 与 `protobufjs` 是 pi-ai 的固定传递依赖，允许其 build scripts，以保证 `pnpm install` 可重复通过。
- 左侧历史对话暂使用 Renderer `localStorage` 缓存 UI 历史；它不是 Task/Plan/Run 的业务持久化来源，后续迁移到 Core Session persistence。

## 后果

- 当前对话入口已经从 Phase 0 壳推进到 Phase 1 的基础 Agent 切片。
- 本地无密钥时仍可通过 faux provider 验证 IPC、Utility、pi-agent-core 事件流和 Renderer 更新。
- 尚未完成 Project、Core Session persistence、SQLite migration、模型设置 UI 和业务级重启恢复；这些仍属于 Phase 1 后续工作。
- pi-web-ui 已进入运行时 UI，但仍通过 `packages/chat-ui-adapter` 隔离，Renderer 不直接持有 pi-agent-core `Agent` 或 provider 配置。
