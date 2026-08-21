import { NextResponse, type NextRequest } from "next/server";

import { COOKIE_NAME, issueToken, kitchenPassword, passwordMatches } from "@/lib/dash/auth";
import { checkRate, clientKey } from "@/lib/rate-limit";

/**
 * The kitchen door.
 *
 * POST   { password }  — issue a session
 * DELETE               — end it
 *
 * A shared password with no account behind it has exactly one weakness worth
 * engineering against, and it is not a clever attack: it is somebody pointing a
 * loop at this URL and working through a word list. So the attempt budget is
 * small and its own — ten tries per five minutes, separate from the model
 * routes' allowance, because a reader hitting the chat limiter must never be
 * able to lock out the dashboard and an attacker hammering this must never be
 * able to spend the quota that answers a reader's question.
 *
 * Unset `KITCHEN_PASSWORD` returns the same 404 as a wrong password, so probing
 * cannot even establish that a dashboard exists here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Low, because nobody types this ten times by accident. */
const MAX_ATTEMPTS = 10;

function notFound(): NextResponse {
  return NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } },
  );
}

export async function POST(request: NextRequest) {
  const expected = kitchenPassword();
  if (!expected) return notFound();

  const rate = checkRate(`kitchen:${clientKey(request)}`, Date.now(), MAX_ATTEMPTS);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rate.retryAfter} seconds.` },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  let supplied: unknown;
  try {
    ({ password: supplied } = (await request.json()) as { password?: unknown });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!passwordMatches(supplied, expected)) {
    // Deliberately vague. "Wrong password" and "no such page" should be the
    // same answer to anyone who is not already supposed to be here.
    return NextResponse.json({ error: "That is not the password." }, { status: 401 });
  }

  const token = issueToken(expected);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: token.value,
    httpOnly: true,
    sameSite: "lax",
    // Secure everywhere but a local run, where there is no https to be secure on.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: token.maxAge,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: COOKIE_NAME, value: "", path: "/", maxAge: 0 });
  return response;
}
