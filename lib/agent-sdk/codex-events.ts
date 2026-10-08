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
 * 多 Agent 协作工具调用（spawn_agent、send_input、wait、close_agent 等）
 * 在 exec JSONL 输出中体现为 type: "collab_tool_call" 的 ThreadItem。
 * SDK 的 TypeScript 类型还没有收录这个类型，但底层 JSON 会透传，
 * 所以这里用运行时类型检查而不是泛型类型守卫。
 */
export type CollabToolCallRawItem = {
  id: string;
  type: "collab_tool_call";
  tool: string;
  status: string;
  sender_thread_id: string;
  receiver_thread_ids: string[];
  prompt?: string;
  agents_states: Record<string, { status: string; message?: string }>;
};

export function isCollabToolCallEvent(event: ThreadEvent): boolean {
  return (
    (event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed") &&
    (event.item as Record<string, unknown>).type === "collab_tool_call"
  );
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

/**
 * 把 collab tool call 的原始 item 转成用户可读的摘要。
 * 优先展示 agent 数量和各 agent 状态，避免用户只看到抽象的 "spawn_agent"。
 */
export function getAgentCallSummary(item: CollabToolCallRawItem): string {
  const states = Object.values(item.agents_states ?? {});

  if (states.length === 0) {
    return item.status === "in_progress" ? "正在创建子 Agent…" : "操作完成。";
  }

  const running = states.filter((state) => state.status === "running").length;
  const completed = states.filter((state) => state.status === "completed").length;

  if (running > 0) {
    return `${running} 个子 Agent 运行中，${completed} 个已完成。`;
  }

  return `${completed} 个子 Agent 全部完成。`;
}
