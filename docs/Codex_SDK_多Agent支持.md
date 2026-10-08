# Codex SDK 多 Agent 支持

## 原理

Codex 的多 Agent 由模型在回合中调用内置协作工具（`spawn_agent`、`send_input`、`wait`、`close_agent`）自动派生子线程。SDK 侧只需在 config 中启用 `agents` 并在事件流中处理 `collab_tool_call` 类型的 item。

工具是否注册取决于所选模型的 `multi_agent_version` 能力（V2 模型如 `gpt-6-astra` 默认获得 V2 工具集）。SDK 侧显式设置 `agents.enabled = true` 确保多 Agent 管线不会因默认值变化而被意外关闭。

## 项目集成点

| 文件 | 职责 |
|---|---|
| `lib/agent-sdk/codex.ts` | 在 Codex 构造函数中注入 `agents: { enabled: true }` 配置；在事件循环中拦截 `collab_tool_call` item 并转发为 `agent` 类型的聊天事件。 |
| `lib/agent-sdk/codex-events.ts` | 提供 `isCollabToolCallEvent` 运行时类型守卫和 `getAgentCallSummary` 摘要函数。SDK 类型尚未收录 `collab_tool_call`，所以用运行时检查而非泛型类型守卫。 |
| `types/chat.ts` | 定义 `ChatAgentCall` 类型和 `agent` 事件，前端据此渲染子 Agent 状态卡片。 |
| `app/page.tsx` | 消费 `agent` 事件，在助手消息中以 indigo 色卡片展示多 Agent 工具调用状态和 agent 数量。 |

## exec JSONL 事件格式

`codex exec --experimental-json` 输出的多 Agent 工具调用 item 结构：

```json
{
  "type": "item.started",
  "item": {
    "id": "call-xxx",
    "type": "collab_tool_call",
    "tool": "spawn_agent",
    "sender_thread_id": "parent-thread-id",
    "receiver_thread_ids": ["child-thread-id"],
    "prompt": "子 agent 的任务描述",
    "agents_states": {
      "child-thread-id": {
        "status": "running",
        "message": null
      }
    },
    "status": "in_progress"
  }
}
```

`item.completed` 事件中 `agents_states` 会更新为 `completed`，`status` 也变为 `completed`。

## 配置项

在 `new Codex({ config: { ... } })` 中可以传入以下多 Agent 相关配置：

```typescript
config: {
  agents: {
    enabled: true,
    max_concurrent_threads_per_session: 8,
    default_subagent_model: "gpt-6-astra",
    researcher: {
      description: "搜索和整理信息的角色。",
    },
  },
}
```

角色名（如 `researcher`）直接写在 `agents` 下（TOML flatten），Codex 会将其注册为 `spawn_agent` 工具的 `agent_type` 候选值。角色也可以放在 `~/.codex/agents/*.toml` 目录下自动发现。
