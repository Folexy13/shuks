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
      `${ORCHESTRATOR_URL}/jobs/${encodeURIComponent(artisanId)}/state`,
      {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load job state from backend.",
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
      `${ORCHESTRATOR_URL}/jobs/${encodeURIComponent(artisanId)}/sync-escrow`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to sync job state.",
      },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ artisanId: string }> }
) {
  const { artisanId } = await context.params;
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/jobs/${encodeURIComponent(artisanId)}/reset`,
      {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reset job state.",
      },
      { status: 502 }
    );
  }
}
