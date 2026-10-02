import type { ChatStreamEvent } from "@/types/chat";

export type CodexStreamOptions = {
  message: string;
  threadId?: string | null;
  signal?: AbortSignal;
  customToolsEnabled?: boolean;
  // 仅用于验证 stdio MCP 进程模型：1 表示常规单进程，3 表示一次请求注册 3 个 server。
  projectToolsServerCount?: number;
  onEvent: (event: ChatStreamEvent) => void;
};
