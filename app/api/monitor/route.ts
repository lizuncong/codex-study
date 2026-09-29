import { getMonitorSnapshot } from "@/lib/monitor/process-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  const snapshot = await getMonitorSnapshot();
  console.log('API Monitor 耗时。。。。', Date.now() - start, 'ms', snapshot.codex.processes.length, snapshot.service.processes.length);
  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
