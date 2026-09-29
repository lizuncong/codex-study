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
  };

  try {
    requestBody = (await request.json()) as typeof requestBody;
  } catch {
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }

  const concurrency = Number(requestBody.concurrency);
  const message =
    typeof requestBody.message === "string" ? requestBody.message.trim() : "";

  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 50
  ) {
    return Response.json(
      { error: "并发数量必须是 1-50 的整数。" },
      { status: 400 },
    );
  }

  if (!message) {
    return Response.json({ error: "请输入要发送的内容。" }, { status: 400 });
  }

  const loadTest = startLoadTest({ concurrency, message });

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
