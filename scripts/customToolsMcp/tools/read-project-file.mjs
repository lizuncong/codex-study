import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { textResult } from "../protocol/toolResult.mjs";

async function normalizeRelativePath(projectRoot, relativePath) {
  const resolvedPath = path.resolve(projectRoot, relativePath);
  const realRoot = await realpath(projectRoot);
  const realPath = await realpath(resolvedPath);

  // 同时限制 .. 和符号链接，防止通过项目内链接读取宿主机上的任意文件。
  if (
    realPath !== realRoot &&
    !realPath.startsWith(`${realRoot}${path.sep}`)
  ) {
    throw new Error("路径必须位于项目根目录内。");
  }

  return realPath;
}

export const readProjectFileTool = {
  name: "read_project_file",
  description:
    "读取项目目录内指定文本文件，用于演示 MCP stdio 自定义工具调用。",
  inputSchema: {
    type: "object",
    properties: {
      relativePath: {
        type: "string",
        description:
          "项目根目录下的相对路径，例如 package.json 或 lib/agent-sdk/codex.ts。",
      },
    },
    required: ["relativePath"],
    additionalProperties: false,
  },

  async execute(args, context) {
    if (typeof args?.relativePath !== "string" || !args.relativePath.trim()) {
      throw new Error("relativePath 必须是非空字符串。");
    }

    const filePath = await normalizeRelativePath(
      context.projectRoot,
      args.relativePath,
    );
    const content = await readFile(filePath, "utf8");
    const relativePath = path.relative(context.projectRoot, filePath);

    return textResult(
      `已读取文件 ${relativePath}，共 ${Buffer.byteLength(content)} 字节。`,
      {
        relativePath,
        bytes: Buffer.byteLength(content),
        content,
      },
    );
  },
};
