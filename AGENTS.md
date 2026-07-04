# PersonalClaw Agent Rules

本仓库以 `个人智能体桌面客户端技术架构与实施规范_v1.0.md` 为强约束基线。当前阶段为 Phase 0：工程骨架与进程通信。

1. 开工前完整阅读架构文档，先确认当前 Phase，不得擅自改变进程边界。
2. 一次只实现一个 Phase；每个 Phase 完成后提交运行说明、测试结果、已知风险和下一阶段建议。
3. Renderer 禁止访问 Node、SQLite、pi SDK、文件系统和密钥。
4. Main 禁止承载领域业务和直接写业务数据库。
5. 只有 Core 可以改变 Task/Plan/Run 的持久化状态。
6. 所有跨进程 payload 必须有 schema、protocolVersion 和 correlationId。
7. 不允许使用 `any` 绕过核心协议类型；不允许吞掉异常。
8. 所有外部依赖固定版本，升级 pi 或 Electron 时先建立兼容测试和 ADR。
9. 每完成一个垂直功能，必须补充单元测试、契约测试和最小 E2E。
10. 不实现架构文档“首版非目标”中的功能，除非用户明确新增需求。
11. 发现架构冲突时，先记录 ADR 和影响面，再提出修改，不可静默偏离。
