import type { ChatStreamEvent } from "@/types/chat";

export type CodexStreamOptions = {
  message: string;
  threadId?: string | null;
  signal?: AbortSignal;
  customToolsEnabled?: boolean;
  onEvent: (event: ChatStreamEvent) => void;
};
