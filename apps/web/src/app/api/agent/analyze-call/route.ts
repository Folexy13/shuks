import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UtteranceSchema = z.object({
  id: z.string(),
  speaker: z.enum(["buyer", "artisan", "agent"]),
  speakerName: z.string(),
  text: z.string(),
  timestampIso: z.string(),
});

const AnalyzeCallRequestSchema = z.object({
  artisanId: z.string().min(1),
  scenarioMode: z.enum(["agreed_on_call", "needs_post_call_permission"]),
  meetingPlatform: z.string().default("in_app"),
  meetingUrl: z.string().nullable().optional(),
  recordingFile: z.string().nullable().optional(),
  utteranceCount: z.number().int().nonnegative(),
  transcript: z.array(UtteranceSchema),
  audioBase64: z.string().nullable().optional(),
  audioMimeType: z.string().nullable().optional(),
});

const ORCHESTRATOR_URL =
  process.env.AGENT_ORCHESTRATOR_URL || "http://127.0.0.1:8000";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = AnalyzeCallRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid call analysis request payload",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const upstreamRes = await fetch(`${ORCHESTRATOR_URL}/analyze-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(30000),
    });

    const upstreamData = await upstreamRes.json().catch(() => ({}));

    if (!upstreamRes.ok) {
      return NextResponse.json(
        {
          error:
            upstreamData.detail ||
            upstreamData.error ||
            `Agent Orchestrator returned ${upstreamRes.status}`,
        },
        { status: upstreamRes.status }
      );
    }

    return NextResponse.json(upstreamData);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to reach Agent Orchestrator on port 8000",
      },
      { status: 502 }
    );
  }
}
