#!/usr/bin/env node

import http from "node:http";
import process from "node:process";

import { createToolRegistry } from "../scripts/customToolsMcp/tools/toolRegistry.mjs";
import { getProjectInfoTool } from "../scripts/customToolsMcp/tools/get-project-info.mjs";
import { readProjectFileTool } from "../scripts/customToolsMcp/tools/read-project-file.mjs";
import { textResult } from "../scripts/customToolsMcp/protocol/toolResult.mjs";

// 独立服务默认只绑定 loopback；跨机访问时必须显式配置 host 并自行加鉴权。
const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
const port = Number(process.env.MCP_HTTP_PORT ?? 8787);

// 复用现有工具注册中心，保证 stdio 与 HTTP 两种传输的工具行为一致。
const registry = createToolRegistry();
registry.registerTool(getProjectInfoTool);
registry.registerTool(readProjectFileTool);

const toolContext = {
  projectRoot: process.env.CUSTOM_TOOLS_ROOT ?? process.cwd(),
  transport: "streamable-http",
};

const serverInfo = {
  name: "codex-study-custom-tools-http",
  version: "1.0.0",
};

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

// Streamable HTTP 采用无会话模式：每个 POST 都独立处理，状态由工具和外部资源管理。
async function handleJsonRpcMessage(message) {
  const { id, method, params } = message;

  if (id === undefined || id === null) {
    return null;
  }

  try {
    if (method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: params?.protocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo,
      });
    }

    if (method === "ping") {
      return jsonRpcResult(id, {});
    }

    if (method === "tools/list") {
      return jsonRpcResult(id, {
        tools: registry.listTools(),
      });
    }

    if (method === "tools/call") {
      try {
        return jsonRpcResult(
          id,
          await registry.callTool(
            params?.name,
            params?.arguments,
            toolContext,
          ),
        );
      } catch (error) {
        // MCP 允许把工具执行错误作为 result 返回，便于模型继续理解失败原因。
        return jsonRpcResult(
          id,
          textResult(error?.message ?? "工具执行失败。"),
        );
      }
    }

    return jsonRpcError(id, -32601, `不支持的方法：${method}`);
  } catch (error) {
    return jsonRpcError(id, -32000, error?.message ?? "MCP 服务内部错误。");
  }
}

async function readJson(request) {
  const chunks = [];
  let totalLength = 0;

  for await (const chunk of request) {
    totalLength += chunk.length;

    // 防御异常客户端一次性发送超大 body，拖垮共享 MCP 服务。
    if (totalLength > 10 * 1024 * 1024) {
      return null;
    }

    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(
    request.url ?? "/",
    `http://${request.headers.host}`,
  ).pathname;

  if (pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ status: "ok", transport: "streamable-http" }),
    );
    return;
  }

  if (pathname !== "/mcp") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      allow: "DELETE, OPTIONS, POST",
      "access-control-allow-methods": "DELETE, OPTIONS, POST",
      "access-control-allow-headers": "content-type, mcp-session-id",
    });
    response.end();
    return;
  }

  if (request.method === "DELETE") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("allow", "DELETE, OPTIONS, POST");
    response.writeHead(405, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const body = await readJson(request);

  if (!body || typeof body !== "object") {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Invalid JSON-RPC request" }));
    return;
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses = (
    await Promise.all(
      messages.map((message) => handleJsonRpcMessage(message)),
    )
  ).filter((message) => message !== null);

  if (responses.length === 0) {
    response.writeHead(202);
    response.end();
    return;
  }

  response.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(
    JSON.stringify(Array.isArray(body) ? responses : responses[0]),
  );
});

server.listen(port, host, () => {
  process.stderr.write(`[mcp-http] listening on http://${host}:${port}/mcp\n`);
});

for (const signalName of ["SIGINT", "SIGTERM"]) {
  process.on(signalName, () => {
    server.close(() => process.exit(0));
  });
}
