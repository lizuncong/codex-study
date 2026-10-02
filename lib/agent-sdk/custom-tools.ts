import path from "node:path";

// Next.js 的 API Route 运行在 Node.js 服务端，可以安全地用 process.execPath 启动 MCP 子进程。
export function buildCustomToolsConfig(serverCount = 1) {
  const serverScriptPath = path.join(
    process.cwd(),
    "scripts",
    "customToolsMcp",
    "index.mjs",
  );

  // 每个 server name 都是一个独立 MCP 配置；stdio 模式下会各自启动一个子进程。
  // 默认保持 1 个实例，避免影响普通聊天和压测。
  const normalizedServerCount =
    Number.isInteger(serverCount) && serverCount > 0 ? serverCount : 1;
  const serverNames = Array.from({ length: normalizedServerCount }, (_, index) =>
    index === 0 ? "project_tools" : `project_tools_${index + 1}`,
  );

  return {
    // 这里通过新版 Codex 的结构化配置声明一个本地 stdio MCP server；
    // command + args 表示 Codex 会把子进程的 stdin/stdout 作为 JSON-RPC 通道。
    mcp_servers: Object.fromEntries(
      serverNames.map((serverName) => [
        serverName,
        {
          command: process.execPath,
          args: [serverScriptPath],
          env: {
            // 把 Next.js 服务端启动目录传给 MCP 子进程，保证所有工具都限定在当前项目内。
            CUSTOM_TOOLS_ROOT: process.cwd(),
          },
          // 这两个工具只是读取当前项目信息，显式声明免审批，避免 approvalPolicy = never 时被拦截。
          default_tools_approval_mode: "approve",
          // 两个工具都是独立只读操作，允许模型并行发起调用；server 端也按 JSON-RPC id 并发处理。
          supports_parallel_tool_calls: true,
          startup_timeout_sec: 10,
          tool_timeout_sec: 10,
        },
      ]),
    ),
  };
}
