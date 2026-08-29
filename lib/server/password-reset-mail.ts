import "server-only";

import { Resend } from "resend";
import { adminAuth } from "@/firebase-admin";

const PUBLIC_APP_ORIGIN = "https://prem.thinktimeless.co.uk";
const DEFAULT_FROM = "PL Predictions <noreply@prem.thinktimeless.co.uk>";

function headerOrigin(request: Request) {
  const origin = request.headers.get("origin")?.trim();
  if (origin) return origin.replace(/\/+$/, "");
  const host = (
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    ""
  ).split(",")[0]?.trim();
  if (!host) return "";
  const proto = (
    request.headers.get("x-forwarded-proto") || "https"
  )
    .split(",")[0]
    ?.trim();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function mailOrigin(request: Request) {
  const fromHeader = headerOrigin(request);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(fromHeader)) {
    return fromHeader;
  }
  return process.env.PUBLIC_APP_ORIGIN?.trim() || PUBLIC_APP_ORIGIN;
}

function firebaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  if ("code" in error) return String(error.code || "");
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/\(auth\/[^)]+\)/);
  return match ? match[0].slice(1, -1) : "";
}

function appResetUrl(origin: string, generatedLink: string) {
  const generated = new URL(generatedLink);
  const oobCode = generated.searchParams.get("oobCode")?.trim() || "";
  const mode = generated.searchParams.get("mode")?.trim() || "resetPassword";
  if (!oobCode) {
    throw new Error("Password reset link was missing a code.");
  }
  const reset = new URL("/reset", `${origin}/`);
  reset.searchParams.set("mode", mode);
  reset.searchParams.set("oobCode", oobCode);
  return reset.toString();
}

function resetEmailHtml(resetUrl: string) {
  return `
    <p>Reset your PL Predictions password with this link:</p>
    <p><a href="${resetUrl}">Choose a new password</a></p>
    <p>If you didn't ask for this, you can ignore the email.</p>
  `;
}

export async function sendPasswordResetMail(request: Request, email: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;
  if (!apiKey) {
    throw new Error("Password reset email is not configured.");
  }

  const origin = mailOrigin(request);

  let generatedLink: string;
  try {
    generatedLink = await adminAuth.generatePasswordResetLink(email, {
      url: `${origin}/reset`,
    });
  } catch (error) {
    const code = firebaseErrorCode(error);
    if (code === "auth/user-not-found" || code === "auth/invalid-email") {
      return;
    }
    if (code === "auth/too-many-requests") {
      const limited = new Error("Too many attempts. Wait a minute and try again.");
      limited.name = "RateLimited";
      throw limited;
    }
    throw error;
  }

  const resetUrl = appResetUrl(origin, generatedLink);
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to: email,
    subject: "Reset your PL Predictions password",
    html: resetEmailHtml(resetUrl),
    text: `Reset your PL Predictions password: ${resetUrl}\n\nIf you didn't ask for this, you can ignore the email.`,
  });
  if (result.error) {
    throw new Error(result.error.message || "Could not send a reset email.");
  }
}
