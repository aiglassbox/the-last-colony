// src/app/api/otp/verify/route.ts
import type { NextRequest } from "next/server";

import { verifyCode } from "@/lib/community/otp";
import { normalizeEmail } from "@/lib/community/schema";
import { checkRate, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Fifteen guesses per IP per window, on its own key. Each code already locks
 * after three wrong tries; this is what stops one address cycling many
 * emails to keep guessing.
 */
const MAX_VERIFIES = 15;
const MAX_BODY_BYTES = 1024;

export async function POST(request: NextRequest) {
  const rate = checkRate(`otp-verify:${clientKey(request)}`, Date.now(), MAX_VERIFIES);
  if (!rate.ok) {
    return Response.json(
      { error: "rate_limited", retryAfter: rate.retryAfter },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
    return Response.json({ errors: ["body too large"] }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["body must be JSON"] }, { status: 400 });
  }

  const raw = body as { email?: unknown; code?: unknown } | null;
  const email = normalizeEmail(raw?.email);
  const code = typeof raw?.code === "string" ? raw.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) {
    return Response.json({ errors: ["email must be an email address and code must be 6 digits"] }, { status: 400 });
  }

  const result = await verifyCode(email, code);
  if (!result.ok) {
    if (result.status === 400) return Response.json({ error: "wrong_code", attemptsLeft: result.attemptsLeft }, { status: 400 });
    if (result.status === 410) return Response.json({ error: result.reason }, { status: 410 });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  return Response.json({ ok: true, proof: result.proof, holdMinutes: result.holdMinutes });
}
