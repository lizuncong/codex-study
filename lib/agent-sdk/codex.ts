import { Codex, type AgentMessageItem, type ThreadEvent } from "@openai/codex-sdk";
import { beginCodexRequest } from "@/lib/monitor/request-metrics";
import type { CodexStreamOptions } from "@/types/codex";

const threadOptions = {
  // 不请求人工审批：Codex 可以直接执行当前回合内允许的操作。
  approvalPolicy: "never",

  // 只读沙箱：Codex 只能读取工作目录，不能写入文件或修改系统状态。
  sandboxMode: "read-only",
} as const;

function isAgentMessageEvent(event: ThreadEvent): event is
  | { type: "item.started"; item: AgentMessageItem }
  | { type: "item.updated"; item: AgentMessageItem }
  | { type: "item.completed"; item: AgentMessageItem } {
  return (
    (event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed") &&
    event.item.type === "agent_message"
  );
}

export async function streamCodexReply(
  options: CodexStreamOptions,
): Promise<void> {
  const requestTracker = beginCodexRequest();

  try {
    const codex = new Codex({});
    const thread = options.threadId
      ? codex.resumeThread(options.threadId, threadOptions)
      : codex.startThread(threadOptions);
    const { events } = await thread.runStreamed(options.message, {
      signal: options.signal,
    });
    const messageTexts = new Map<string, string>();

    for await (const event of events) {
      if (event.type === "thread.started") {
        options.onEvent({ type: "thread", threadId: event.thread_id });
        continue;
      }

      if (isAgentMessageEvent(event)) {
        const previousText = messageTexts.get(event.item.id) ?? "";

        if (event.item.text !== previousText) {
          if (event.item.text.startsWith(previousText)) {
            options.onEvent({
              type: "delta",
              text: event.item.text.slice(previousText.length),
            });
          } else {
            options.onEvent({ type: "message", text: event.item.text });
          }

          messageTexts.set(event.item.id, event.item.text);
        }

        continue;
      }

      if (event.type === "turn.completed") {
        options.onEvent({ type: "done" });
        continue;
      }

      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }

      if (event.type === "error") {
        throw new Error(event.message);
      }
    }

    requestTracker.succeed();
  } catch (error) {
    requestTracker.fail(error);
    throw error;
  }
}
