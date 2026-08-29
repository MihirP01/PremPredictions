export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { normalizeAuthEmail } from "@/lib/authErrors";
import { sendPasswordResetMail } from "@/lib/server/password-reset-mail";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const email = normalizeAuthEmail(String(body.email || ""));
    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Enter your email first." },
        { status: 400 },
      );
    }

    await sendPasswordResetMail(request, email);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not send a reset email.";
    const status = error instanceof Error && error.name === "RateLimited" ? 429 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
