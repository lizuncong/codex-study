import { jsonRpcError, writeMessage } from "./jsonRpc.mjs";

// 这里只处理 MCP 协议方法；具体工具的执行细节由 registry 和各工具模块负责。
export async function handleMcpMessage(message, {
  registry,
  serverInfo,
  toolContext,
}) {
  const { id, method, params } = message;

  // notifications/initialized 等 JSON-RPC 通知没有 id，协议规定不能返回响应。
  if (id === undefined || id === null) {
    return;
  }

  try {
    if (method === "ping") {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {},
      });
      return;
    }

    if (method === "initialize") {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion,
          capabilities: {
            // capabilities.tools 只表示支持 Tools 能力；具体目录仍由 tools/list 返回。
            tools: {},
          },
          serverInfo,
        },
      });
      return;
    }

    if (method === "tools/list") {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          tools: registry.listTools(),
        },
      });
      return;
    }

    if (method === "tools/call") {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: await registry.callTool(
          params?.name,
          params?.arguments,
          toolContext,
        ),
      });
      return;
    }

    writeMessage(jsonRpcError(id, -32601, `不支持的方法：${method}`));
  } catch (error) {
    if (method === "tools/call") {
      // 工具内部错误作为 MCP result 返回，客户端可以把原因继续交给模型推理。
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: error?.message ?? "工具执行失败。" }],
          isError: true,
        },
      });
      return;
    }

    writeMessage(jsonRpcError(id, -32000, error?.message ?? "工具执行失败。"));
  }
}
