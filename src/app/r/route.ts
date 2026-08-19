import { after, NextResponse, type NextRequest } from "next/server";

import { destinationFor } from "@/lib/email/destinations";
import { logEvent } from "@/lib/email/track";

/**
 * GET /r?c=<code>&t=<tid>
 *
 * Records the click, then sends the reader on. Every failure path in here ends
 * in a 302 to somewhere real: an unknown code, a missing token, a database that
 * is down or was never configured. There is no branch that returns an error,
 * because the alternative to a logged click is an unlogged click, never a
 * broken one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("c");
  const tid = request.nextUrl.searchParams.get("t");

  // Resolved before anything else can go wrong, and only ever from the
  // server-side map. Nothing from the query string reaches the Location header.
  const destination = destinationFor(code);

  /**
   * `after` rather than a floating promise.
   *
   * The reference drop used `void logEvent(...)`, which is right in spirit and
   * wrong on this runtime: work still pending when the handler returns can be
   * frozen or killed the moment the response is flushed, so on a serverless
   * deploy a share of the clicks would simply never be written and the loss
   * would be invisible. `after` is the Next 16 API for exactly this — the
   * reader waits on nothing, and the write is still guaranteed a chance to run.
   */
  after(async () => {
    await logEvent({ kind: "click", tid, code, headers: request.headers });
  });

  return NextResponse.redirect(destination, {
    status: 302,
    headers: {
      // A cached redirect is a click counted once and made many times.
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      // The destination should not learn the token from our URL.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
