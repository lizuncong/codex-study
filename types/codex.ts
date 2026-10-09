import type { ChatStreamEvent } from "@/types/chat";

export type CodexStreamOptions = {
  message: string;
  threadId?: string | null;
  signal?: AbortSignal;
  customToolsEnabled?: boolean;
  // 只有显式传 true 才用本地文件完全覆盖 Codex 内置系统提示词。
  customSystemPromptEnabled?: boolean;
  // 仅用于验证 stdio MCP 进程模型：1 表示常规单进程，3 表示一次请求注册 3 个 server。
  projectToolsServerCount?: number;
  // 开启后走 codex app-server 长驻进程协议，而不是每次 spawn codex exec。
  appServerEnabled?: boolean;
  onEvent: (event: ChatStreamEvent) => void;
};
