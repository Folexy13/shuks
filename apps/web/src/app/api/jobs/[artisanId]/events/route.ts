import { NextRequest } from "next/server";

const ORCHESTRATOR_URL =
  process.env.AGENT_ORCHESTRATOR_URL || "http://127.0.0.1:8000";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ artisanId: string }> }
) {
  const { artisanId } = await context.params;
  const upstreamRes = await fetch(
    `${ORCHESTRATOR_URL}/jobs/${encodeURIComponent(artisanId)}/events`,
    {
      cache: "no-store",
    }
  );

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
