import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { releasePayPalMilestonePayout } from "@/lib/paypal";

const ReleasePayoutSchema = z.object({
  jobId: z.string().min(1),
  milestoneId: z.string().min(1),
  recipientPayPalEmail: z.string().email(),
  amountCents: z.number().int().positive(),
  note: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = ReleasePayoutSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid PayPal payout request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await releasePayPalMilestonePayout(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to release PayPal Milestone Payout",
      },
      { status: 500 }
    );
  }
}
