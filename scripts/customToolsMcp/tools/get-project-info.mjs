import { readFile } from "node:fs/promises";
import path from "node:path";

import { textResult } from "../protocol/toolResult.mjs";

export const getProjectInfoTool = {
  name: "get_project_info",
  description: "获取当前 Next.js 项目的基础信息。",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },

  async execute(_args, context) {
    const packageRaw = await readFile(
      path.join(context.projectRoot, "package.json"),
      "utf8",
    );
    const packageJson = JSON.parse(packageRaw);

    return textResult("已读取项目基础信息。", {
      projectRoot: context.projectRoot,
      projectName: packageJson.name ?? "unknown",
      projectVersion: packageJson.version ?? "unknown",
      nodeVersion: process.version,
      mcpTransport: "stdio",
    });
  },
};
