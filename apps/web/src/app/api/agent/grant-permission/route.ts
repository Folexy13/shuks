import { NextRequest, NextResponse } from "next/server";

const ORCHESTRATOR_URL =
  process.env.AGENT_ORCHESTRATOR_URL || "http://127.0.0.1:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${ORCHESTRATOR_URL}/grant-permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to grant permission on backend.",
      },
      { status: 502 }
    );
  }
}
