import { NextResponse, type NextRequest } from "next/server";

import { checkRate, clientKey } from "@/lib/rate-limit";

import { passwordMatches, type Gate } from "./gate";

/**
 * The door itself: POST { password } issues a session, DELETE ends it.
 *
 * One factory, two routes. A shared password with no account behind it has
 * exactly one weakness worth engineering against, and it is not a clever
 * attack: it is somebody pointing a loop at this URL and working through a
 * word list. So the attempt budget is small and its own — ten tries per five
 * minutes, per door, separate from the model routes' allowance — because a
 * reader hitting the chat limiter must never be able to lock out an admin, and
 * an attacker hammering this must never be able to spend the quota that
 * answers a reader's question.
 *
 * Unset password returns the same 404 as a wrong one, so probing cannot even
 * establish that a door exists here.
 */

/** Low, because nobody types this ten times by accident. */
const MAX_ATTEMPTS = 10;

function notFound(): NextResponse {
  return NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } },
  );
}

export function authHandlers(gate: Gate, rateKey: string) {
  async function POST(request: NextRequest): Promise<NextResponse> {
    const expected = gate.password();
    if (!expected) return notFound();

    const rate = checkRate(`${rateKey}:${clientKey(request)}`, Date.now(), MAX_ATTEMPTS);
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

    const token = gate.issueToken(expected);
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: gate.cookie,
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

  async function DELETE(): Promise<NextResponse> {
    const response = NextResponse.json({ ok: true });
    response.cookies.set({ name: gate.cookie, value: "", path: "/", maxAge: 0 });
    return response;
  }

  return { POST, DELETE };
}
