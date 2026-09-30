// 注册中心把“工具定义”和“工具执行”绑定在一起，防止 tools/list 声明的工具无法被 tools/call 执行。
export function createToolRegistry() {
  const tools = new Map();

  return {
    registerTool(tool) {
      if (!tool?.name || typeof tool.execute !== "function") {
        throw new Error("自定义工具必须包含 name 和 execute 函数。");
      }

      if (tools.has(tool.name)) {
        throw new Error(`自定义工具重复注册：${tool.name}`);
      }

      tools.set(tool.name, tool);
    },

    // listTools 只返回 MCP 声明所需的元数据，不能把 execute 函数暴露给客户端。
    listTools() {
      return [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },

    async callTool(name, args, context) {
      const tool = tools.get(name);

      if (!tool) {
        throw new Error(`未知工具：${name}`);
      }

      return tool.execute(args, context);
    },
  };
}
