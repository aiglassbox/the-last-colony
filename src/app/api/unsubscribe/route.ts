import type { NextRequest } from "next/server";

import { optOutByToken } from "@/lib/mailroom/store";
import { checkRate, clientKey } from "@/lib/rate-limit";

/**
 * POST /api/unsubscribe?u=<token>: the one-click unsubscribe Gmail and Yahoo
 * call from their own button (RFC 8058), named by the `List-Unsubscribe`
 * header every mailroom list email carries. The body is
 * `List-Unsubscribe=One-Click` and is not needed: the token names the person.
 *
 * Always answers 200 with no detail, so it cannot be used to learn whether a
 * token exists. Rate-limited like the unsubscribe page, because it is an
 * unauthenticated write.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UNSUBSCRIBES = 20;

export async function POST(request: NextRequest) {
  const rate = checkRate(`unsubscribe:${clientKey(request)}`, Date.now(), MAX_UNSUBSCRIBES);
  if (rate.ok) {
    const token = request.nextUrl.searchParams.get("u") ?? "";
    try {
      await optOutByToken(token, "one-click");
    } catch (error) {
      console.error("[unsubscribe] one-click failed:", error instanceof Error ? error.message : error);
    }
  }
  return new Response(null, { status: 200, headers: { "X-Robots-Tag": "noindex, nofollow" } });
}
