import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { capturePayPalEscrowOrder } from "@/lib/paypal";

const CaptureOrderSchema = z.object({
  orderId: z.string().min(1),
  jobId: z.string().optional(),
  amountCents: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = CaptureOrderSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid PayPal capture request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await capturePayPalEscrowOrder(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to capture PayPal Escrow Order",
      },
      { status: 500 }
    );
  }
}
