export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ChatToolCall[];
};

export type ChatToolCallStatus = "in_progress" | "completed" | "failed";

export type ChatToolCall = {
  id: string;
  server: string;
  tool: string;
  status: ChatToolCallStatus;
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
      type: "done";
    }
  | {
      type: "error";
      message: string;
    };
