import AWS from "aws-sdk";

import type { SamharaSubmissionInput } from "@/lib/samharaForm";

const sesConfig = {
  region:
    process.env.AWS_REGION ||
    process.env.GENERAL_AWS_AWS_REGION ||
    "ap-south-1",
  accessKeyId: process.env.GENERAL_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.GENERAL_AWS_SECRET_ACCESS_KEY,
};

function getSes(): AWS.SES | null {
  if (!sesConfig.accessKeyId || !sesConfig.secretAccessKey) {
    return null;
  }
  return new AWS.SES(sesConfig);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCell(value: string): string {
  return escapeHtml(value);
}

function row(label: string, value: string | number | boolean | undefined): string {
  if (value === undefined || value === null) return "";
  const text =
    typeof value === "boolean" ? (value ? "Yes" : "No") : String(value).trim();
  if (!text) return "";
  return `<tr>
    <td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;width:220px;">${formatCell(label)}</td>
    <td style="padding:10px 12px;border:1px solid #e5e7eb;">${formatCell(text)}</td>
  </tr>`;
}

function buildSubmissionEmailHtml(
  data: SamharaSubmissionInput,
  submissionId: string
): string {
  const tshirtDisplay =
    data.tshirtSize === "Other" && data.tshirtOther?.trim()
      ? `${data.tshirtSize} — ${data.tshirtOther.trim()}`
      : data.tshirtSize;

  const payment = data.payment;
  const paymentBlock = payment
    ? [
        row("Razorpay order ID", payment.orderId),
        row("Razorpay payment ID", payment.paymentId),
        row("Amount paid (INR)", payment.amountInr),
      ].join("")
    : "";

  const rows = [
    row("Submission ID", submissionId),
    row("Full name", data.fullName),
    row("Email", data.email),
    row("Mobile number", data.mobileNumber),
    row("Zone", data.zone),
    row("City", data.city),
    row("T-shirt size", tshirtDisplay),
    row("Package option", data.packageOption),
    paymentBlock,
    row("Point of contact — name", data.pocName),
    row("Point of contact — mobile", data.pocMobile),
    row("Point of contact — email", data.pocEmail),
    row("PAN", data.panCard),
    row("GST number", data.gstNumber),
    row("Room sharing with", data.roomSharingWith),
    row("TnC — non-refundable", data.tncNonRefundable),
    row("TnC — confirmation after payment", data.tncConfirmationAfterPayment),
    row("TnC — airfare/insurance excluded", data.tncAirfareInsuranceExcluded),
    row("TnC — payment to agency account", data.tncPaymentAgencyAccount),
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html>
  <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;line-height:1.5;">
    <h2 style="margin:0 0 16px;">New Samhara 2026 registration</h2>
    <p style="margin:0 0 20px;">A new form submission was received and saved.</p>
    <table style="border-collapse:collapse;width:100%;max-width:720px;">${rows}</table>
  </body>
</html>`;
}

function getNotificationRecipients(): string[] {
  const fromEnv = process.env.SAMHARA_NOTIFICATION_EMAIL?.trim();
  const primary = fromEnv
    ? fromEnv.split(/[,;]/).map((e) => e.trim()).filter(Boolean)
    : ["info@samhara.in"];
  return [...new Set([...primary, "vanshita@prepseed.com"])];
}

/** Notify ops when a Samhara form is submitted (AWS SES, same credentials as next-boilerplate). */
export async function sendSamharaSubmissionNotificationEmail(
  data: SamharaSubmissionInput,
  submissionId: string
): Promise<void> {
  const ses = getSes();
  const toAddresses = getNotificationRecipients();
  const from =
    process.env.SES_FROM_EMAIL?.trim() || "help@prepseed.com";

  if (!ses) {
    console.warn(
      "[ses] GENERAL_AWS_ACCESS_KEY_ID / GENERAL_AWS_SECRET_ACCESS_KEY not set; skipping notification email"
    );
    return;
  }

  const subject = `Samhara 2026 registration — ${data.fullName}`;
  const html = buildSubmissionEmailHtml(data, submissionId);

  await ses
    .sendEmail({
      Source: from,
      Destination: { ToAddresses: toAddresses },
      ReplyToAddresses: data.email?.trim() ? [data.email.trim()] : undefined,
      Message: {
        Subject: { Charset: "UTF-8", Data: subject },
        Body: { Html: { Charset: "UTF-8", Data: html } },
      },
    })
    .promise();
}
