#!/usr/bin/env node

import process from "node:process";

import { handleMcpMessage } from "./protocol/handler.mjs";
import { startStdioServer } from "./transport/stdio.mjs";
import { createToolRegistry } from "./tools/toolRegistry.mjs";
import { getProjectInfoTool } from "./tools/get-project-info.mjs";
import { readProjectFileTool } from "./tools/read-project-file.mjs";

// 通过环境变量固定工具访问根目录，避免依赖子进程的默认 cwd。
const projectRoot = process.env.CUSTOM_TOOLS_ROOT ?? process.cwd();
const toolContext = { projectRoot };

// 入口只负责模块装配：新增自定义工具时，在这里导入并注册，不需要修改协议和传输代码。
const registry = createToolRegistry();
registry.registerTool(getProjectInfoTool);
registry.registerTool(readProjectFileTool);

await startStdioServer({
  handleMessage: (message) =>
    handleMcpMessage(message, {
      registry,
      toolContext,
      serverInfo: {
        name: "codex-study-custom-tools",
        version: "1.0.0",
      },
    }),
});
