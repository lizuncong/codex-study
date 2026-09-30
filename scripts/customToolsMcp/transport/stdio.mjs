// 启动 stdio 传输后，MCP server 的 stdout 只能输出 JSON-RPC，诊断信息必须写 stderr。
export function startStdioServer({ handleMessage }) {
  let inputBuffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    inputBuffer += chunk;

    let newlineIndex = inputBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = inputBuffer.slice(0, newlineIndex).trim();
      inputBuffer = inputBuffer.slice(newlineIndex + 1);
      newlineIndex = inputBuffer.indexOf("\n");

      if (!line) {
        continue;
      }

      try {
        // JSON-RPC 客户端用 id 匹配响应，因此请求可以并发处理；响应顺序不必等于请求顺序。
        void handleMessage(JSON.parse(line)).catch((error) => {
          process.stderr.write(
            `自定义 MCP server 内部异常：${error?.stack ?? error}\n`,
          );
        });
      } catch (error) {
        process.stderr.write(
          `收到无效 JSON-RPC 消息：${error?.message ?? error}\n`,
        );
      }
    }
  });

  process.stdin.resume();
}
