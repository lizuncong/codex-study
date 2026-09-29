import { getMonitorSnapshot } from "@/lib/monitor/process-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getMonitorSnapshot();
  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
