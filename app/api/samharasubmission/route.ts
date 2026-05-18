import { NextResponse } from "next/server";

import { connectToDb } from "@/lib/mongoose";
import { samharaSubmissionSchema } from "@/lib/samharaForm";
import { sendSamharaSubmissionNotificationEmail } from "@/lib/ses";
import { RazorpayPaymentLog } from "@/models/RazorpayPaymentLog";
import { SamharaSubmission } from "@/models/SamharaSubmission";

export async function POST(req: Request) {
  try {
    const json = (await req.json()) as unknown;
    const parsed = samharaSubmissionSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (!parsed.data.payment) {
      return NextResponse.json(
        { ok: false, error: "Payment required" },
        { status: 400 }
      );
    }

    await connectToDb();
    const doc = await SamharaSubmission.create(parsed.data);

    const p = parsed.data.payment;
    if (p?.orderId?.trim()) {
      // Attach the saved submission id to any existing payment-log rows for this order.
      // (Order is created + checkout events happen before the form is finally submitted.)
      await RazorpayPaymentLog.updateMany(
        { razorpayOrderId: p.orderId.trim() },
        {
          $set: {
            samharaSubmissionId: doc._id,
            ...(p.paymentId?.trim() ? { razorpayPaymentId: p.paymentId.trim() } : {}),
            ...(p.signature?.trim() ? { razorpaySignature: p.signature.trim() } : {}),
          },
        }
      );
    }

    try {
      await sendSamharaSubmissionNotificationEmail(
        parsed.data,
        String(doc._id)
      );
    } catch (emailErr) {
      console.error("[samharasubmission] SES notification failed:", emailErr);
    }

    return NextResponse.json({ ok: true, id: String(doc._id) });
  } catch (err) {
    const anyErr = err as {
      code?: number;
      keyValue?: Record<string, unknown>;
      keyPattern?: Record<string, number>;
    };
    const dupMobile =
      anyErr?.code === 11000 &&
      (anyErr?.keyValue?.mobileNumber != null ||
        anyErr?.keyPattern?.mobileNumber === 1);
    if (dupMobile) {
      return NextResponse.json(
        {
          ok: false,
          error: "This mobile number has already submitted the form.",
        },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

