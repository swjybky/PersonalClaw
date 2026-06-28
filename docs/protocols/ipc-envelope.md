# IPC Envelope v1

所有跨进程消息使用版本化 Envelope：

```ts
interface Envelope<TPayload, TType extends string = string> {
  protocolVersion: 1;
  id: string;
  type: TType;
  timestamp: string;
  payload: TPayload;
  context?: {
    projectId?: string;
    taskId?: string;
    runId?: string;
    sessionId?: string;
    correlationId?: string;
  };
}
```

Phase 0 已实现：

- Command：`system.health`
- Event：`system.ready`、`system.health`、`system.error`、`system.worker_restarted`
- IPC channel：`personal-claw:command`、`personal-claw:event`

命令返回 `accepted` 或 `rejected`。长任务后续必须通过 Event 流回传，不应让单个 IPC 请求长期挂起。
