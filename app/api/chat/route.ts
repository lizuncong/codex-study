import { streamCodexReply } from "@/lib/agent-sdk";
import type { ChatRequest, ChatStreamEvent } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let chatRequest: ChatRequest;

  try {
    chatRequest = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }

  const message = chatRequest.message.trim();

  if (!message) {
    return Response.json({ error: "请输入要发送的内容。" }, { status: 400 });
  }

  if (
    chatRequest.threadId !== undefined &&
    chatRequest.threadId !== null &&
    !chatRequest.threadId
  ) {
    return Response.json({ error: "会话 ID 无效。" }, { status: 400 });
  }

  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let isClosed = false;

      const sendEvent = (event: ChatStreamEvent) => {
        if (isClosed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          isClosed = true;
        }
      };

      const sendError = (message: string) => {
        sendEvent({ type: "error", message });
      };

      try {
        await streamCodexReply({
          message,
          threadId: chatRequest.threadId,
          signal: abortController.signal,
          onEvent: sendEvent,
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          sendError("回复已取消。");
        } else {
          sendError(error instanceof Error ? error.message : "Codex 回复失败。");
        }
      } finally {
        isClosed = true;
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
