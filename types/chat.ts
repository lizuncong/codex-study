export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ChatToolCall[];
  agents?: ChatAgentCall[];
};

export type ChatToolCallStatus = "in_progress" | "completed" | "failed";

export type ChatToolCall = {
  id: string;
  server: string;
  tool: string;
  status: ChatToolCallStatus;
  summary?: string;
};

// 多 Agent 工具调用的状态与普通工具一致，但展示逻辑不同，
// 需要携带 agent 数量和各 agent 的实时状态。
export type ChatAgentCall = {
  id: string;
  tool: string;
  status: ChatToolCallStatus;
  agentCount: number;
  summary?: string;
};

export type ChatRequest = {
  message: string;
  threadId?: string | null;
};

export type ChatStreamEvent =
  | {
      type: "thread";
      threadId: string;
    }
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "message";
      text: string;
    }
  | {
      type: "tool";
      toolId: string;
      server: string;
      tool: string;
      status: ChatToolCallStatus;
      summary?: string;
    }
  | {
      type: "agent";
      toolId: string;
      tool: string;
      status: ChatToolCallStatus;
      agentCount: number;
      summary?: string;
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      message: string;
    };
