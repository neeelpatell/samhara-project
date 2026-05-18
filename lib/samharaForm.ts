import { z } from "zod";

import { roomSharingOptions } from "./roomSharingOptions.generated";

export const zones = [
  "Mumbai",
  "Gujarat",
  "ROM",
  "KKG",
  "TNAPTS",
  "Rajasthan",
  "North",
  "East",
  "MPCG",
  "International",
] as const;

export const tshirtSizes = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
  "4XL",
  "5XL",
  "Other",
] as const;

export const packageOptions = [
  "Single Occupancy – Company Payment – (Rs. 1,20,000 + GST) = ₹1,42,740 (Includes 2.5% Convenience Fee and 2% TDS Deduction)",
  "Single Occupancy – Personal Payment – (Rs. 1,20,000 + GST) = ₹1,35,300 (Includes 2.5% Convenience Fee)",
  "Double Occupancy – Company Payment (Per Person) – (Rs. 65,000 + GST) = ₹77,317.5 (Includes 2.5% Convenience Fee and 2% TDS Deduction)",
  "Double Occupancy – Personal Payment (Per Person) – (Rs. 65,000 + GST) = ₹73,287 (Includes 2.5% Convenience Fee)",
] as const;

/** Razorpay minimum order amount for INR (100 paise). */
export const RAZORPAY_MIN_ORDER_INR = 1;

/** Shown in the package dropdown when test mode is enabled (see `isTestPackageOptionEnabled`). */
export const testPackageOption =
  "Test payment – ₹1 (email & payment testing only)" as const;

export const TEST_PACKAGE_AMOUNT_INR = RAZORPAY_MIN_ORDER_INR;

export function clampToRazorpayMinimumInr(amountInr: number): number {
  return Math.max(amountInr, RAZORPAY_MIN_ORDER_INR);
}

export function isTestPackageOption(
  packageOption: string | undefined | null
): boolean {
  return packageOption?.trim() === testPackageOption;
}

export function isTestPackageOptionEnabled(): boolean {
  if (process.env.SAMHARA_ENABLE_TEST_PACKAGE === "true") return true;
  if (process.env.NEXT_PUBLIC_SAMHARA_ENABLE_TEST_PACKAGE === "true") {
    return true;
  }
  return getTestPaymentAmountInr() != null;
}

export function getSelectablePackageOptions(): string[] {
  const options: string[] = [...packageOptions];
  if (isTestPackageOptionEnabled()) {
    options.push(testPackageOption);
  }
  return options;
}

/** Roommate list applies only for double-occupancy packages. */
export function isDoubleOccupancyPackage(
  packageOption: string | undefined | null
): boolean {
  const p = packageOption?.trim() ?? "";
  return p.startsWith("Double Occupancy");
}

export function isSingleOccupancyPackage(
  packageOption: string | undefined | null
): boolean {
  const p = packageOption?.trim() ?? "";
  return p.startsWith("Single Occupancy");
}

export function isCompanyPaymentPackage(
  packageOption: string | undefined | null
): boolean {
  const p = packageOption?.trim().toLowerCase() ?? "";
  return p.includes("company payment");
}

export function isPersonalPaymentPackage(
  packageOption: string | undefined | null
): boolean {
  const p = packageOption?.trim().toLowerCase() ?? "";
  return p.includes("personal payment");
}

/** From `List.xlsx` → `data/room-sharing-list.csv` + generated module; run `npm run import-room-list`. */
export { roomSharingOptions };

const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const tncMustAccept = z
  .boolean()
  .refine((v) => v === true, { message: "Please tick to accept" });

const packageAmountInr: Record<(typeof packageOptions)[number], number> = {
  "Single Occupancy – Company Payment – (Rs. 1,20,000 + GST) = ₹1,42,740 (Includes 2.5% Convenience Fee and 2% TDS Deduction)":
    142740,
  "Single Occupancy – Personal Payment – (Rs. 1,20,000 + GST) = ₹1,35,300 (Includes 2.5% Convenience Fee)":
    135300,
  "Double Occupancy – Company Payment (Per Person) – (Rs. 65,000 + GST) = ₹77,317.5 (Includes 2.5% Convenience Fee and 2% TDS Deduction)":
    77317.5,
  "Double Occupancy – Personal Payment (Per Person) – (Rs. 65,000 + GST) = ₹73,287 (Includes 2.5% Convenience Fee)":
    73287,
};

export function getAmountForPackageOptionInr(opt: string): number {
  if (isTestPackageOption(opt)) return TEST_PACKAGE_AMOUNT_INR;
  if (opt in packageAmountInr) {
    return packageAmountInr[opt as (typeof packageOptions)[number]];
  }
  throw new Error(`Unknown package option: ${opt}`);
}

/** When `SAMHARA_TEST_PAYMENT_INR` (or `NEXT_PUBLIC_*`) is set, all charges use that amount (min ₹1). */
export function getTestPaymentAmountInr(): number | null {
  const raw =
    process.env.SAMHARA_TEST_PAYMENT_INR ??
    process.env.NEXT_PUBLIC_SAMHARA_TEST_PAYMENT_INR;
  if (raw == null || !String(raw).trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampToRazorpayMinimumInr(n);
}

export function resolvePaymentAmountInr(opt: string): number {
  if (isTestPackageOption(opt)) return TEST_PACKAGE_AMOUNT_INR;
  const testOverride = getTestPaymentAmountInr();
  if (testOverride != null) return testOverride;
  return getAmountForPackageOptionInr(opt);
}

export function minPaymentAmountInr(): number {
  const test = getTestPaymentAmountInr();
  return test ?? RAZORPAY_MIN_ORDER_INR;
}

const mobile10Message =
  "Enter exactly 10 digits only (no spaces, +, or country code)";

export const zMobile10Digits = z
  .string()
  .trim()
  .min(1, "Mobile number is required")
  .regex(/^\d{10}$/, mobile10Message);

export const samharaSubmissionSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email"),
    fullName: z.string().trim().min(1, "Full name is required"),
    mobileNumber: zMobile10Digits,
    zone: z.enum(zones, { message: "Select a zone" }),
    city: z.string().trim().min(1, "City is required"),
    tshirtSize: z.enum(tshirtSizes, { message: "Select a T-shirt size" }),
    tshirtOther: z.string().trim().optional(),
    packageOption: z
      .string()
      .trim()
      .min(1, "Please confirm your package option"),
    payment: z
      .object({
        orderId: z.string().trim().min(1, "Missing orderId"),
        paymentId: z.string().trim().min(1, "Missing paymentId"),
        signature: z.string().trim().min(1, "Missing signature"),
        amountInr: z.number().positive(),
      })
      .optional(),
    pocName: z.string().trim().optional(),
    pocMobile: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || /^\d{10}$/.test(v), {
        message: mobile10Message,
      }),
    pocEmail: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
        message: "Enter a valid email",
      }),
    panCard: z.string().trim().optional(),
    gstNumber: z.string().trim().optional(),
    /** Required only for double occupancy; optional otherwise (see superRefine). */
    roomSharingWith: z.string().trim().optional(),
    tncNonRefundable: tncMustAccept,
    tncConfirmationAfterPayment: tncMustAccept,
    tncAirfareInsuranceExcluded: tncMustAccept,
    tncPaymentAgencyAccount: tncMustAccept,
  })
  .superRefine((val, ctx) => {
    if (val.tshirtSize === "Other" && !val.tshirtOther) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tshirtOther"],
        message: "Please specify your T-shirt size",
      });
    }
  })
  .superRefine((val, ctx) => {
    if (!isDoubleOccupancyPackage(val.packageOption)) return;
    const s = (val.roomSharingWith ?? "").trim();
    if (!s) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roomSharingWith"],
        message: "Select who you will share the room with",
      });
      return;
    }
    if (!(roomSharingOptions as readonly string[]).includes(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roomSharingWith"],
        message: "Please choose a valid option",
      });
    }
  })
  .superRefine((val, ctx) => {
    const allowed = getSelectablePackageOptions();
    if (!allowed.includes(val.packageOption.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["packageOption"],
        message: "Select a valid package option",
      });
    }
  })
  .superRefine((val, ctx) => {
    if (isTestPackageOption(val.packageOption)) return;

    const pan = (val.panCard ?? "").trim().toUpperCase();
    const gst = (val.gstNumber ?? "").trim().toUpperCase();

    if (isCompanyPaymentPackage(val.packageOption)) {
      if (!gst) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gstNumber"],
          message: "GST number is required for company payment",
        });
        return;
      }
      if (!gstRegex.test(gst)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gstNumber"],
          message: "Enter a valid GST number (e.g. 27ABCDE1234F1Z5)",
        });
      }
      return;
    }

    if (isPersonalPaymentPackage(val.packageOption)) {
      if (!pan) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["panCard"],
          message: "PAN is required for personal payment",
        });
        return;
      }
      if (!panRegex.test(pan)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["panCard"],
          message: "Enter a valid 10-character PAN (e.g. ABCDE1234F)",
        });
      }
    }
  })
  .superRefine((val, ctx) => {
    const p = val.payment;
    const paid =
      !!p &&
      (p.orderId?.trim().length ?? 0) > 0 &&
      (p.paymentId?.trim().length ?? 0) > 0 &&
      (p.signature?.trim().length ?? 0) > 0 &&
      typeof p.amountInr === "number" &&
      Number.isFinite(p.amountInr) &&
      p.amountInr >= minPaymentAmountInr();
    if (!paid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payment"],
        message: "Complete Razorpay payment (Pay Now) before you can submit.",
      });
    }
  });

export type SamharaSubmissionInput = z.infer<typeof samharaSubmissionSchema>;

