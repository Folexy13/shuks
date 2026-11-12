import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";

const LiveKitTokenRequestSchema = z.object({
  roomName: z.string().min(1),
  participantIdentity: z.string().min(1),
  participantName: z.string().min(1),
  role: z.enum(["buyer", "artisan", "agent"]),
});

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const parsed = LiveKitTokenRequestSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid LiveKit token request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const apiKey = process.env.LIVEKIT_API_KEY || "devkey";
    const apiSecret = process.env.LIVEKIT_API_SECRET || "secret";
    const livekitUrl =
      process.env.NEXT_PUBLIC_LIVEKIT_URL || "ws://localhost:7880";

    const at = new AccessToken(apiKey, apiSecret, {
      identity: parsed.data.participantIdentity,
      name: parsed.data.participantName,
      metadata: JSON.stringify({ role: parsed.data.role }),
    });

    at.addGrant({
      roomJoin: true,
      room: parsed.data.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return NextResponse.json({
      token,
      roomName: parsed.data.roomName,
      serverUrl: livekitUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate LiveKit room token",
      },
      { status: 500 }
    );
  }
}
