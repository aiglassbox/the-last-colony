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

/**
 * Whether this response may mark the session cookie `secure`.
 *
 * It used to be `NODE_ENV === "production"`, which is a statement about how
 * the build was made rather than about the connection the cookie is travelling
 * on: a self-hosted `next start` with the variable unset handed the operator's
 * session over plain HTTP. The connection is the thing that matters, so ask
 * about the connection. Only a plain-HTTP loopback run — where there is no
 * https to be secure on and a `secure` cookie would simply never come back —
 * gets the flag dropped.
 */
function isSecureEnough(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const url = new URL(request.url);
  if (proto) return proto === "https";
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return url.protocol === "https:" || !loopback;
}

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
      secure: isSecureEnough(request),
      // Not "/": the door's page and its endpoints are the only things that
      // read this, and they all live under here. See `Gate.path`.
      path: gate.path,
      maxAge: token.maxAge,
    });
    return response;
  }

  async function DELETE(): Promise<NextResponse> {
    const response = NextResponse.json({ ok: true });
    response.cookies.set({ name: gate.cookie, value: "", path: gate.path, maxAge: 0 });
    // Transitional: sessions issued before the cookie was scoped sit at "/",
    // and a browser sends those to this path too — so a logout that cleared
    // only the scoped one would leave the operator still signed in. A cookie
    // is cleared per path, so this clears the old path as well. Safe to drop
    // once every session issued at "/" has expired (twelve hours).
    response.cookies.set({ name: gate.cookie, value: "", path: "/", maxAge: 0 });
    return response;
  }

  return { POST, DELETE };
}
