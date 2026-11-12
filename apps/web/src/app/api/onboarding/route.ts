import { NextRequest, NextResponse } from "next/server";

const ORCHESTRATOR_URL =
  process.env.AGENT_ORCHESTRATOR_URL || "http://127.0.0.1:8000";

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/artisans`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Backend returned ${res.status}: ${text}` },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Backend orchestrator unreachable on port 8000",
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const body = await request.json();
    const endpoint =
      body.role === "artisan" ? "/onboarding/artisan" : "/onboarding/client";

    const res = await fetch(`${ORCHESTRATOR_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Backend onboarding error (${res.status}): ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Backend orchestrator unreachable on port 8000",
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
