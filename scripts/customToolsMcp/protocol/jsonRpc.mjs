// JSON-RPC 2.0 是 MCP stdio 模式的消息封装格式；写入 stdout 前必须保证是一条完整消息。
export function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

// JSON-RPC 请求失败时必须保留请求 id，客户端才能把错误响应和原请求配对。
export function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}
