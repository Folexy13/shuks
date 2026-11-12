import { NextResponse } from "next/server";

const ORCHESTRATOR_URL =
  process.env.AGENT_ORCHESTRATOR_URL || "http://127.0.0.1:8000";

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/agent/status`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ agentAvailable: false }, { status: 200 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ agentAvailable: false }, { status: 200 });
  } finally {
    clearTimeout(timeoutId);
  }
}
