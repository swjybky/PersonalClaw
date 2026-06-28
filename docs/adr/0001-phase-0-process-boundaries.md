# ADR 0001: Phase 0 进程与包边界

## 状态

Accepted

## 决策

Electron Main 只负责桌面生命周期、窗口配置、Utility 监督和 IPC 路由。Renderer 只通过 Preload 的语义化 API 访问系统能力。Core、Agent、Tool 分别以 Electron Utility Process entrypoint 存在，Phase 0 仅实现健康检查与优雅关闭。

领域、应用、协议、策略、工具和适配层放入独立 workspace 包。真实 SQLite、pi runtime、chat UI 和工具执行在 Phase 0 中只保留接口与占位边界。

## 后果

- 可以在 Phase 1 之后逐步替换占位实现，而不改变 Renderer 和 Main 的安全边界。
- Utility 崩溃恢复、数据库单写入者和策略审批链路有明确落点。
- 首轮开发不会把业务逻辑提前塞进 Main 或 Renderer。
