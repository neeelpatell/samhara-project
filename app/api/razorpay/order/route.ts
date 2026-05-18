import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { z } from "zod";

import {
  getSelectablePackageOptions,
  resolvePaymentAmountInr,
  zMobile10Digits,
} from "@/lib/samharaForm";
import { connectToDb } from "@/lib/mongoose";
import type { RazorpayPaymentLogDocument } from "@/models/RazorpayPaymentLog";
import { RazorpayPaymentLog } from "@/models/RazorpayPaymentLog";
import { SamharaSubmission } from "@/models/SamharaSubmission";

const reqSchema = z.object({
  packageOption: z
    .string()
    .trim()
    .refine((v) => getSelectablePackageOptions().includes(v), {
      message: "Select a valid package option",
    }),
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  contact: zMobile10Digits,
});

type LogCreate = Partial<
  Omit<RazorpayPaymentLogDocument, "createdAt" | "updatedAt">
> &
  Pick<RazorpayPaymentLogDocument, "status">;

/** Readable message for logs + JSON `message` (Network tab); avoids `[object Object]` from SDK throws. */
function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    const nested = o.error;
    if (nested && typeof nested === "object") {
      const e = nested as Record<string, unknown>;
      if (typeof e.description === "string" && e.description.trim()) {
        return e.description;
      }
      if (typeof e.reason === "string" && e.reason.trim()) return e.reason;
    }
    if (typeof o.description === "string" && o.description.trim()) {
      return o.description;
    }
    try {
      return JSON.stringify(o);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

async function safeLog(entry: LogCreate) {
  try {
    await connectToDb();
    await RazorpayPaymentLog.create(entry);
  } catch {
    /* avoid failing the payment API if logging fails */
  }
}

function orderFailureBody(message: string): { error: string; hint?: string } {
  const lower = message.toLowerCase();
  const isMongoOrNetwork =
    lower.includes("server selection timed out") ||
    lower.includes("mongoserverselection") ||
    (lower.includes("mongo") && lower.includes("timeout")) ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo") ||
    lower.includes("querySrv");
  const looksLikeRazorpay =
    lower.includes("razorpay") ||
    (lower.includes("authentication") && lower.includes("failed"));

  let userMessage = message;
  let devHint: string | undefined;

  if (isMongoOrNetwork) {
    userMessage =
      "Database is unreachable right now. Please try again in a moment.";
    if (process.env.NODE_ENV === "development") {
      devHint =
        "Check MONGO_URL / MONGODB_URI, that MongoDB is running, and Atlas IP access (Network Access → allow your IP or 0.0.0.0/0 for dev).";
    }
  } else if (looksLikeRazorpay) {
    if (process.env.NODE_ENV === "development") {
      devHint =
        "Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env, then restart the dev server.";
    }
  } else if (process.env.NODE_ENV === "development") {
    devHint =
      "Payment errors: Razorpay keys. Timeouts to DB: MONGO_URL / Atlas network access.";
  }

  return { error: userMessage, ...(devHint ? { hint: devHint } : {}) };
}

export async function POST(req: Request) {
  let parsedBody: z.infer<typeof reqSchema> | null = null;

  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      await safeLog({
        status: "order_create_failed",
        serverErrorMessage: "Razorpay keys not configured",
      });
      return NextResponse.json(
        { ok: false, error: "Razorpay keys not configured" },
        { status: 500 }
      );
    }
    if (keySecret.startsWith("rzp_")) {
      await safeLog({
        status: "order_create_failed",
        serverErrorMessage:
          "RAZORPAY_KEY_SECRET looks incorrect (should not start with rzp_).",
      });
      return NextResponse.json(
        {
          ok: false,
          error:
            "RAZORPAY_KEY_SECRET looks incorrect (it should NOT start with rzp_).",
        },
        { status: 500 }
      );
    }

    const json = (await req.json()) as unknown;
    const parsed = reqSchema.safeParse(json);
    if (!parsed.success) {
      await safeLog({
        status: "order_create_failed",
        serverErrorMessage: "request_validation_failed",
      });
      const validation = parsed.error.flatten();
      const firstIssue = parsed.error.issues[0]?.message ?? "Invalid request";
      return NextResponse.json(
        {
          ok: false,
          /** Short summary for Network / clients */
          error: firstIssue,
          /** Zod field errors (API field names: name, contact, …) */
          validation,
        },
        { status: 400 }
      );
    }

    parsedBody = parsed.data;

    await connectToDb();
    const alreadyRegistered = await SamharaSubmission.exists({
      mobileNumber: parsedBody.contact,
    });
    if (alreadyRegistered) {
      await safeLog({
        status: "order_create_failed",
        packageOption: parsedBody.packageOption,
        customerName: parsedBody.name,
        customerEmail: parsedBody.email,
        customerContact: parsedBody.contact,
        serverErrorMessage: "mobile_already_registered",
      });
      return NextResponse.json(
        {
          ok: false,
          error:
            "This mobile number has already been used for a registration. One phone number allows only one submission.",
        },
        { status: 409 }
      );
    }

    const amountInr = resolvePaymentAmountInr(parsedBody.packageOption);
    const amountPaise = Math.round(amountInr * 100);

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `samhara_${Date.now()}`,
      notes: {
        packageOption: parsedBody.packageOption,
        name: parsedBody.name,
        email: parsedBody.email,
        contact: parsedBody.contact,
      },
    });

    await safeLog({
      status: "order_created",
      razorpayOrderId: order.id,
      amountInr,
      currency: order.currency ?? "INR",
      packageOption: parsedBody.packageOption,
      customerName: parsedBody.name,
      customerEmail: parsedBody.email,
      customerContact: parsedBody.contact,
    });

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      amountInr,
      currency: order.currency,
      keyId,
      prefill: {
        name: parsedBody.name,
        email: parsedBody.email,
        contact: parsedBody.contact,
      },
    });
  } catch (err) {
    console.error("FULL ERROR (razorpay/order):", err);

    const message = errorToMessage(err);
    const stack = err instanceof Error ? err.stack : undefined;

    const amountInr =
      parsedBody != null
        ? resolvePaymentAmountInr(parsedBody.packageOption)
        : undefined;
    await safeLog({
      status: "order_create_failed",
      packageOption: parsedBody?.packageOption,
      customerName: parsedBody?.name,
      customerEmail: parsedBody?.email,
      customerContact: parsedBody?.contact,
      amountInr,
      serverErrorMessage: message,
    });

    const body = orderFailureBody(message);
    return NextResponse.json(
      {
        ok: false,
        ...body,
        /** Raw underlying message — always present so Network tab shows a concrete error. */
        message,
        ...(process.env.NODE_ENV === "development" && stack
          ? { stack }
          : {}),
      },
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
}
