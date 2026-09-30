# Codex stdio 自定义工具调用

更完整的协议链路和“LLM 如何知道工具”的原理说明，见 [MCP stdio 工作原理](./mcp-stdio-working-principle.md)。

## 功能说明

项目通过 `@openai/codex-sdk` 向 Codex 注册了一个名为 `project_tools` 的本地 MCP server。它使用 **stdio transport**：Codex 启动独立 Node 子进程，把该子进程的 `stdin` / `stdout` 作为 JSON-RPC 通道，实现工具发现与调用。

当前提供两个自定义工具：

- `get_project_info`：返回项目路径、名称、版本、Node 版本和 transport 类型。
- `read_project_file`：读取项目根目录内的文本文件；路径会被规范化并限制在项目内。

## 核心文件

- `scripts/customToolsMcp/`：零依赖的 MCP stdio server，实现 `initialize`、`tools/list`、`tools/call`。
- `lib/agent-sdk/custom-tools.ts`：把 server 的 `command`、`args`、环境变量和超时写入 Codex 配置。
- `lib/agent-sdk/codex.ts`：启动 Codex 回合并把 SDK 的 `mcp_tool_call` 事件转发给前端。
- `types/chat.ts`：定义聊天流中的自定义工具调用事件。
- `app/page.tsx`：按工具调用 ID 展示执行中、成功和失败状态。

## 关键配置

`mcp_servers.project_tools` 使用 stdio 模式：

```ts
{
  command: process.execPath,
  args: [`${process.cwd()}/scripts/customToolsMcp/index.mjs`],
  env: {
    CUSTOM_TOOLS_ROOT: process.cwd(),
  },
  default_tools_approval_mode: "approve",
  startup_timeout_sec: 10,
  tool_timeout_sec: 10,
}
```

`command` / `args` 表示 Codex 会启动本地子进程；`CUSTOM_TOOLS_ROOT` 明确工具边界，避免依赖子进程的默认工作目录。

`supports_parallel_tool_calls: true` 会向 Codex 声明当前 server 的工具可以并行调用。server 内部不维护请求队列，多个请求由 Node 的异步 I/O 并发处理，JSON-RPC 响应通过 `id` 与请求配对。

## 安全边界

1. 所有诊断输出走 `stderr`，避免污染 `stdout` 上的 JSON-RPC 消息。
2. `read_project_file` 会解析相对路径并校验最终 realpath 是否仍位于项目根目录内，同时拦截 `..` 和符号链接越界。
3. 工具内部错误通过 `tools/call` 的 `isError: true` 返回，模型可以继续解释失败原因。
4. `default_tools_approval_mode: "approve"` 明确允许免审批调用；如果后续加入写入类工具，应改回提示审批，并重新评估 `supports_parallel_tool_calls` 是否仍为 `true`。
5. 不同请求可并发执行；JSON-RPC 响应顺序不必与请求顺序一致，客户端必须按 `id` 配对。

## 模块化结构

```text
scripts/customToolsMcp/
├── index.mjs                         入口：装配协议、传输、工具注册
├── protocol/
│   ├── handler.mjs                   MCP 方法分发：initialize、tools/list、tools/call
│   ├── jsonRpc.mjs                   JSON-RPC 消息封装和错误响应
│   └── toolResult.mjs                MCP 工具结果格式
├── transport/
│   └── stdio.mjs                     stdin/stdout JSON-RPC 分帧与并发处理
└── tools/
    ├── toolRegistry.mjs              工具注册中心，绑定 tools/list 和 tools/call
    ├── get-project-info.mjs          单独定义 get_project_info
    └── read-project-file.mjs         单独定义 read_project_file
```

新增工具时只需要：

1. 在 `tools/` 下新建一个工具文件，导出 `name`、`description`、`inputSchema` 和 `execute`。
2. 在 `index.mjs` 导入该文件并调用 `registry.registerTool()`。
3. 不需要修改 MCP 协议分发和 stdio 传输代码。

## 手动验证

启动项目后，输入：

```text
请调用 get_project_info 工具，告诉我项目名和项目路径。
```

界面应先出现 `project_tools / get_project_info` 的调用状态，随后返回真实项目信息。

也可以输入：

```text
请调用 read_project_file 工具读取 package.json。
```

## 协议自测

可以直接用脚本请求 MCP server：

```bash
node - <<'NODE'
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['scripts/customToolsMcp/index.mjs'], {
  env: { ...process.env, CUSTOM_TOOLS_ROOT: process.cwd() },
});

child.stdout.on('data', (chunk) => {
  console.log(chunk.toString());
});

child.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18' },
}) + '\n');
child.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'get_project_info', arguments: {} },
}) + '\n');
child.stdin.end();
NODE
```

`initialize` 和 `tools/call` 都应返回 JSON-RPC result。
