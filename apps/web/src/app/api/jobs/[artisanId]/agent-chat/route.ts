import { NextRequest, NextResponse } from "next/server";

const ORCHESTRATOR_URL =
  process.env.AGENT_ORCHESTRATOR_URL || "http://127.0.0.1:8000";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ artisanId: string }> }
) {
  const { artisanId } = await context.params;
  try {
    const body = await request.json();
    const res = await fetch(
      `${ORCHESTRATOR_URL}/jobs/${encodeURIComponent(artisanId)}/agent-chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || "Shuks AI chat error" },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reach Shuks AI orchestrator.",
      },
      { status: 502 }
    );
  }
}
