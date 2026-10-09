# Codex App Server 压测链路实现

## 背景

`codex exec` 每次请求 spawn 一个独立进程，适合低并发单次任务。当压测并发量提高时，进程冷启动和内存开销成为瓶颈。

本变更新增了 `codex app-server` 长驻进程链路：所有请求复用同一个 `codex app-server` 进程，每个请求创建一个 ephemeral thread，通过 JSON-RPC 风格协议通信。

## 开关

压测抽屉中新增 "启用 Codex App Server" 复选框，默认不勾选。

- 不勾选：走 `codex exec` 路径（旧行为）。
- 勾选：走 `codex app-server` 路径（新行为）。

## 架构

```text
Next.js HTTP requests
        |
        v
  streamCodexReply (路由层)
        |
   appServerEnabled?
   /           \
  否            是
  |             |
  v             v
codex exec   codex app-server (单例长驻进程)
(每次spawn)     |
             JSON-RPC over stdio
                |
             thread/start → turn/start → 通知流
```

## 协议实现

`lib/agent-sdk/codex-app-server.ts` 实现了最小 JSON-RPC 客户端：

1. **spawn**：启动 `codex app-server`，config 覆盖通过 `-c key=value` 传递
2. **initialize**：发送 `initialize` 请求完成版本和能力握手
3. **thread/start**：为每个请求创建 ephemeral thread（压测不需要跨请求复用）
4. **turn/start**：发送用户消息，等待 turn/completed 通知
5. **通知路由**：按 threadId 过滤，只转发当前请求的事件

### 事件映射

| app-server 通知 | ChatStreamEvent | 说明 |
|---|---|---|
| `thread/started` | `{type: "thread"}` | 提取 threadId |
| `item/agentMessage/delta` | `{type: "delta"}` | 流式文本增量 |
| `item/started` / `item/completed` | `{type: "tool"}` / `{type: "agent"}` | 工具和多 Agent 事件 |
| `turn/completed` | `{type: "done"}` | 回合结束 |
| `error` | `{type: "error"}` | 错误 |

### item 类型映射

app-server 的 `ThreadItem.type` 用 camelCase（`agentMessage`、`mcpToolCall`、`collabAgentToolCall`），
SDK exec 模式用 snake_case（`agent_message`、`mcp_tool_call`、`collab_tool_call`）。
客户端在事件处理中做了一层窄化映射。

## 进程生命周期

- 单例连接使用 `globalThis` 缓存，避免 Next.js 热重载导致 spawn 泄漏。
- 进程退出时自动 reject 所有 pending 请求，下次请求会重新 spawn。
- `dispose()` 方法可以手动终止进程（目前仅在热重载时自动调用）。
- `thread/start` 会自动把 app-server 连接绑定为 thread listener。即使 Node 侧取消 notification handler，Rust 侧仍会认为 thread 有订阅者。
- 因此每个请求结束、失败或取消后，客户端会显式发送 `thread/unsubscribe`。
- app-server 配置 `thread_unload_delay_secs = 0`，thread 变为 idle 且无订阅者后立即卸载；MCP runtime shutdown 时会终止本轮启动的 stdio MCP 子进程。
- 该行为不只服务压测。真实业务中的工具调用也按“一次请求一个 ephemeral thread”运行，请求结束后同样释放本轮工具子进程。

## 与 Codex Desktop 的对照

本机 ChatGPT.app 内嵌的 Codex CLI 是 `0.159.2`。解包 `app.asar` 可以看到 desktop 的 ephemeral generation 也使用：

1. `thread/start` 创建 `ephemeral: true` thread；
2. `turn/start` 执行单次任务；
3. `finally` 里调用 `thread/unsubscribe` 释放 thread。

也就是说，“长驻 app-server + ephemeral thread + 显式 unsubscribe”和 desktop 的核心思路一致。

差异是 desktop 没有把 `thread_unload_delay_secs` 设置为 0，而是依赖 app-server 默认的 60 秒空闲卸载。这是因为它还要保留普通会话线程，给用户 resumed/后继操作留出窗口。本项目当前的 app-server 路径只承载单请求 ephemeral thread，请求结束后不打算复用该 thread，因此 0 秒卸载是更合适的策略。如果后续引入可复用 thread 池或普通会话，应把该项改回桌面端风格，并按“活跃持有/空闲释放”管理。

## 进程监控

`lib/monitor/process-metrics.ts` 的 `codexExecPattern` 已扩展为同时匹配 `codex exec` 和 `codex app-server`，压测进程面板可以正常显示两种模式下的进程树。

## 后续优化

- Thread 池：复用 thread 而不是每次创建 ephemeral thread，减少 thread/start 开销。
- 多进程池：当单进程成为瓶颈时，spawn 多个 app-server 进程做 round-robin。
- 常规聊天支持：当前仅在压测链路启用，聊天 API 可以通过同样的开关复用。
