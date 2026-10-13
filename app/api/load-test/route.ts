import { after } from "next/server";

import {
  getLoadTestSummary,
  runLoadTest,
  startLoadTest,
} from "@/lib/monitor/load-test";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  let requestBody: {
    concurrency?: unknown;
    message?: unknown;
    customToolsEnabled?: unknown;
    customSystemPromptEnabled?: unknown;
    mcpMultiprocessEnabled?: unknown;
    standaloneMcpEnabled?: unknown;
    appServerEnabled?: unknown;
  };

  try {
    requestBody = (await request.json()) as typeof requestBody;
  } catch {
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }

  const concurrency = Number(requestBody.concurrency);
  const message =
    typeof requestBody.message === "string" ? requestBody.message.trim() : "";
  // 复选框未提交时保持旧行为：压测默认注册 Codex stdio 自定义工具。
  const customToolsEnabled =
    requestBody.customToolsEnabled === undefined
      ? true
      : requestBody.customToolsEnabled === true;
  // 不传或传 false 都使用 Codex 内置模板；这是新开关的显式启用语义。
  const customSystemPromptEnabled =
    requestBody.customSystemPromptEnabled === true;
  // 复选框关闭或旧客户端未传值时，仍保持单 project_tools server。
  const mcpMultiprocessEnabled = requestBody.mcpMultiprocessEnabled === true;
  // 独立 HTTP MCP 需要先通过 pnpm mcp:http 启动；开关只控制 Codex 配置选择。
  const standaloneMcpEnabled = requestBody.standaloneMcpEnabled === true;
  // 默认不勾选 = 保持 codex exec 行为；勾选后切换到 app-server 协议。
  const appServerEnabled = requestBody.appServerEnabled === true;

  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 1000
  ) {
    return Response.json(
      { error: "并发数量必须是 1-1000 的整数。" },
      { status: 400 },
    );
  }

  if (!message) {
    return Response.json({ error: "请输入要发送的内容。" }, { status: 400 });
  }

  const loadTest = startLoadTest({
    concurrency,
    message,
    customToolsEnabled,
    customSystemPromptEnabled,
    mcpMultiprocessEnabled,
    standaloneMcpEnabled,
    appServerEnabled,
  });

  after(() => runLoadTest(loadTest.loadTestId));

  return Response.json(
    loadTest,
    { status: 202 },
  );
}

export async function GET(request: Request) {
  const loadTestId = new URL(request.url).searchParams.get("loadTestId");

  if (!loadTestId) {
    return Response.json({ error: "缺少压测任务 ID。" }, { status: 400 });
  }

  const loadTest = getLoadTestSummary(loadTestId);

  if (!loadTest) {
    return Response.json({ error: "压测任务不存在。" }, { status: 404 });
  }

  return Response.json(
    loadTest,
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
