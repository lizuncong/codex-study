import {
  type AgentMessageItem,
  type McpToolCallItem,
  type ThreadEvent,
  type ThreadItem,
} from "@openai/codex-sdk";

/**
 * 表示 SDK 中一个 ThreadItem 的生命周期事件。
 * 抽象成泛型后，不同 item 类型都能复用同一段事件类型收窄逻辑。
 */
export type CodexItemEvent<TItem extends ThreadItem> =
  | { type: "item.started"; item: TItem }
  | { type: "item.updated"; item: TItem }
  | { type: "item.completed"; item: TItem };

function isThreadItemEvent<TItem extends ThreadItem>(
  event: ThreadEvent,
  itemType: TItem["type"],
): event is CodexItemEvent<TItem> {
  return (
    (event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed") &&
    event.item.type === itemType
  );
}

export function isAgentMessageEvent(
  event: ThreadEvent,
): event is CodexItemEvent<AgentMessageItem> {
  return isThreadItemEvent<AgentMessageItem>(event, "agent_message");
}

export function isMcpToolCallEvent(
  event: ThreadEvent,
): event is CodexItemEvent<McpToolCallItem> {
  return isThreadItemEvent<McpToolCallItem>(event, "mcp_tool_call");
}

/**
 * 把 MCP 工具事件压缩成界面可读的摘要。
 * 优先展示失败原因或真实返回文本，避免用户只能看到抽象状态。
 */
export function getToolCallSummary(item: McpToolCallItem): string {
  if (item.status === "failed") {
    return item.error?.message ?? "工具调用失败。";
  }

  const textParts =
    item.result?.content
      ?.filter((content) => content.type === "text")
      .map((content) => (typeof content.text === "string" ? content.text : ""))
      .filter(Boolean) ?? [];

  if (textParts.length > 0) {
    return textParts.join("\n");
  }

  return item.status === "in_progress" ? "正在调用自定义工具…" : "工具调用完成。";
}
