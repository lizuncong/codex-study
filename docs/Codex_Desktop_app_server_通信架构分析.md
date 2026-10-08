# Codex Desktop 的 app-server 通信架构分析

> 分析时间：2026-10-08  
> 本机桌面应用：`/Applications/ChatGPT.app`，Electron 包版本 `26.928.21956`  
> 内置 Codex CLI：`0.159.2`

## 结论

Codex Desktop 不是“每个会话启动一个 `codex exec` 进程”。它的主进程会启动并连接 Codex CLI 的 `codex app-server`，之后通过 app-server 协议创建、恢复和管理 thread/会话。

更准确地说：

- 本地桌面 UI 使用 Electron 主进程；
- Electron 主进程启动一个内置的 `codex app-server` 进程；
- 桌面 UI 与该进程之间走 JSON-RPC 风格的 app-server 协议；
- 每个会话是 app-server 内部的 `thread`，不是独立的 `codex exec` 进程；
- `codex exec` 是 CLI 的无头单次执行模式，主要用于 SDK、脚本或自动化场景，不是 Desktop 的普通会话架构；
- 只有当连接到多个执行环境时，桌面应用可能维护多个 app-server 连接；同一个 host 内的多个会话仍共享同一个 app-server。

## 运行时证据

在当前机器上观察到桌面应用主进程和 app-server 的进程关系如下：

```bash
ps -axo pid,ppid,lstart,command | rg 'CodexCLI.app/Contents/MacOS/codex|ChatGPT.app/Contents/MacOS/ChatGPT'
```

关键进程类似：

```text
65688     1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT
66227 65688 /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex \
  -c features.code_mode_host=true \
  app-server \
  --analytics-default-enabled \
  -c plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true \
  -c plugins.code-review@openai-bundled.mcp_servers.code-review.enabled=true
```

这说明：

1. `codex app-server` 的父进程是桌面应用主进程；
2. 命令没有使用 `codex exec`；
3. 默认没有指定 `--listen`，因此使用 app-server 的默认 stdio transport；
4. `lsof -p 66227` 可以看到 stdin/stdout/stderr 是管道，同时该进程持有 `~/.codex` 下的 SQLite、WAL 和 rollout 会话文件。

## 传输方式

Codex CLI 的 app-server 支持多种 transport：

- `stdio://`
- `unix://` 或 `unix://PATH`
- `ws://IP:PORT`
- `off`

本机 Desktop 当前使用的是默认的 stdio transport。

Electron 侧的打包代码也能看到两个连接路径：

1. 默认情况：resolve 内置 CLI 后直接 spawn，`stdin`、`stdout`、`stderr` 均为管道；
2. 可选的 local daemon 模式：当明确启用 `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1` 且没有本地配置 override 时，可连接 `~/.codex/app-server-control/app-server-control.sock`，URL 表达为 `ws://localhost/rpc`。

当前 Desktop 的常规启动路径不是 local daemon 模式，而是主进程直接 spawn 一个 `codex app-server`。

## 会话协议

app-server 协议是 JSON-RPC 风格，但源码注释明确说明它不是完整的 JSON-RPC 2.0：消息没有 `jsonrpc: "2.0"` 字段。

基础消息类型包括：

- `JSONRPCRequest`
- `JSONRPCNotification`
- `JSONRPCResponse`
- `JSONRPCError`

桌面侧的典型流程：

1. 客户端发送 `initialize`，完成版本和能力握手；
2. 新会话发送 `thread/start`；
3. 已有会话恢复发送 `thread/resume`；
4. 同一个 thread 中发起一轮回复发送 `turn/start`；
5. 服务端通过 `thread/started`、`thread/status/changed`、`turn/started`、`turn/completed` 等通知回推状态；
6. 列表、搜索、审批、配置、文件系统等操作也通过同一连接上的方法完成。

协议中常见方法：

| 方法 | 用途 |
| --- | --- |
| `initialize` | 初始化客户端、服务端能力和版本 |
| `thread/start` | 创建新 thread/会话 |
| `thread/resume` | 恢复已有 thread |
| `thread/list` | 列出 thread |
| `thread/read` | 读取 thread 详情 |
| `turn/start` | 在 thread 中开始一轮执行 |
| `turn/steer` | 向进行中的 turn 追加引导 |
| `turn/interrupt` | 中断当前 turn |
| `fs/readFile` | 通过 app-server 提供的文件系统能力读取文件 |
| `config/read` | 读取配置 |

## 为什么不是每个会话一个 `codex exec`

`codex exec` 的定位是单次、无头执行模式。它适合：

- SDK 事件流；
- CI 或脚本自动化；
- 一次性批处理任务。

Desktop 需要的是长生命周期的会话管理能力，包括多会话列表、恢复历史、流式事件、审批、MCP、插件、文件系统、配置、worktree、终端和后台任务。这些能力由 app-server 统一管理更合理。

因此 Desktop 的模型可以概括为：

```text
Electron Renderer / UI
        |
        v
Electron Main
        |
        | JSON-RPC-like app-server protocol / stdio pipes
        v
codex app-server
        |
        +-- thread 1
        +-- thread 2
        +-- thread 3
        +-- MCP / tools / terminals / worktree helpers
```

`thread` 是 app-server 里的会话抽象，`exec` 进程不是普通会话的承载单位。

## 桌面源码中的对应线索

从 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 解包后可以看到：

- `package.json` 中包含 `app-server-manager`、`app-server-types` 和 `protocol` 依赖；
- 主构建产物里有 `appServerConnectionRegistry`、`sendAppServerRequest`、`thread/start`、`turn/start` 等调用；
- stdio transport 代码直接调用 Node 的 `child_process.spawn`，日志方法名为 `stdio_transport_spawned`；
- 连接逻辑会先解析内置 Codex CLI，再决定连接 local daemon 还是直接 spawn stdio。

对应的 Rust 源码也在本机：

- app-server transport 定义：`/Users/lzc/Documents/学习/codex/codex-rs/app-server-transport/src/transport/mod.rs:83`
- app-server 启动入口：`/Users/lzc/Documents/学习/codex/codex-rs/app-server/src/lib.rs:489`
- CLI 分发到 app-server：`/Users/lzc/Documents/学习/codex/codex-rs/cli/src/main.rs:1377`
- JSON-RPC-like 消息定义：`/Users/lzc/Documents/学习/codex/codex-rs/app-server-protocol/src/rpc.rs:1`
- client/server 方法定义：`/Users/lzc/Documents/学习/codex/codex-rs/app-server-protocol/src/protocol/common.rs:229`
- thread/turn 方法声明：`/Users/lzc/Documents/学习/codex/codex-rs/app-server-protocol/src/protocol/common.rs:507`

## 快速验证方法

1. 查看 app-server 进程和父进程：

   ```bash
   ps -axo pid,ppid,command | rg 'CodexCLI.app/Contents/MacOS/codex.*app-server'
   ```

2. 确认 stdio 管道和持久化文件：

   ```bash
   lsof -p <app-server-pid>
   ```

3. 查看内置 CLI 版本：

   ```bash
   /Applications/ChatGPT.app/Contents/Resources/codex-cli/codex-package.json
   ```

4. 查看 CLI 的 app-server 支持的 transport：

   ```bash
   /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex app-server --help
   ```

5. 解包 Desktop 的 Electron 资源检查协议调用：

   ```bash
   npx --yes @electron/asar extract \
     /Applications/ChatGPT.app/Contents/Resources/app.asar \
     /tmp/codex-desktop-asar
   ```

