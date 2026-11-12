import { NextRequest, NextResponse } from "next/server";

const ORCHESTRATOR_URL =
  process.env.AGENT_ORCHESTRATOR_URL || "http://127.0.0.1:8000";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ artisanId: string }> }
) {
  const { artisanId } = await context.params;
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/jobs/${encodeURIComponent(artisanId)}/bot/status`,
      {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to fetch bot status.",
      },
      { status: 502 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ artisanId: string }> }
) {
  const { artisanId } = await context.params;
  try {
    const body = await request.json();
    const res = await fetch(
      `${ORCHESTRATOR_URL}/jobs/${encodeURIComponent(artisanId)}/bot/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail || "Could not dispatch meeting bot." },
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
            : "Unable to dispatch meeting bot.",
      },
      { status: 502 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ artisanId: string }> }
) {
  const { artisanId } = await context.params;
  try {
    const body = await request.json().catch(() => ({}));
    const res = await fetch(
      `${ORCHESTRATOR_URL}/jobs/${encodeURIComponent(artisanId)}/bot/leave`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      }
    );
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to stop meeting bot.",
      },
      { status: 502 }
    );
  }
}
