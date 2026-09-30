# Agent SDK 事件处理

Codex SDK 的流式回合适用一个 `ThreadEvent` 事件流表示多种变化，例如线程创建、模型消息、工具调用和回合结束。`lib/agent-sdk/codex-events.ts` 专门负责判断和处理这些事件中的 item 类型，`lib/agent-sdk/codex.ts` 则继续负责建立 Codex 会话、消费事件流、更新请求指标，以及把 SDK 事件映射成前端可消费的聊天事件。

## 模块职责

- `isAgentMessageEvent`：判断事件是否为 `agent_message` 的 `started`、`updated` 或 `completed` 事件。
- `isMcpToolCallEvent`：判断事件是否为 `mcp_tool_call` 的 `started`、`updated` 或 `completed` 事件。
- `getToolCallSummary`：把 MCP 工具的失败信息或返回文本压缩成用户可读的摘要。

这三个辅助函数保留在独立模块中的原因是，事件类型守卫和结果摘要属于稳定的事件处理逻辑。这样后续增加新的 item 类型时，可以在同一处复用同一套生命周期判断模式，而不会让 Codex 会话编排代码持续膨胀。
