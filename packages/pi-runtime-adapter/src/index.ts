export interface UserMessage {
  role: "user";
  content: string;
}

export interface AgentRunInput {
  runId: string;
  taskId?: string;
  prompt: string;
}

export interface AgentRuntimeEvent {
  type: "agent.delta" | "agent.completed" | "agent.tool_requested" | "agent.error";
  runId: string;
  payload: unknown;
}

export interface AgentCheckpoint {
  runId: string;
  createdAt: string;
  state: unknown;
}

export interface AgentRuntime {
  start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
  steer(runId: string, message: UserMessage): Promise<void>;
  abort(runId: string): Promise<void>;
  checkpoint(runId: string): Promise<AgentCheckpoint>;
}

export class Phase0AgentRuntimeAdapter implements AgentRuntime {
  async *start(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    yield {
      type: "agent.completed",
      runId: input.runId,
      payload: {
        mode: "phase0-placeholder"
      }
    };
  }

  steer(): Promise<void> {
    return Promise.resolve();
  }

  abort(): Promise<void> {
    return Promise.resolve();
  }

  checkpoint(runId: string): Promise<AgentCheckpoint> {
    return Promise.resolve({
      runId,
      createdAt: new Date().toISOString(),
      state: {
        mode: "phase0-placeholder"
      }
    });
  }
}
