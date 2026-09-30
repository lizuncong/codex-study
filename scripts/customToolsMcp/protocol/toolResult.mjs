// MCP tools/call 的标准结果同时提供模型可读文本和调用方可消费的结构化数据。
export function textResult(text, structuredContent) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent,
  };
}
