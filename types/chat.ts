export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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
      type: "done";
    }
  | {
      type: "error";
      message: string;
    };
