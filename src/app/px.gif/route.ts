import { after, type NextRequest } from "next/server";

import { logEvent } from "@/lib/email/track";

/**
 * GET /px.gif?t=<tid>
 *
 * The open pixel. Worth saying plainly what this number is worth: image
 * proxies at Gmail and Outlook fetch it once on delivery whether or not anybody
 * reads the mail, and clients that block images never fetch it at all. Opens
 * are a soft signal here and the bot flag is what keeps them from being read as
 * a hard one. Clicks are the number the campaign is measured on.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A 1x1 fully transparent GIF89a, 43 bytes.
 *
 * This is the long-standing tracking-pixel encoding: a two-entry colour table,
 * a graphic control extension whose transparent-colour index points at the one
 * pixel the image contains, and nothing else. The shorter 42-byte variant that
 * circulates renders identically in a modern client but omits the delay field
 * that some older Outlook renderers expect, and the brief asks for 43.
 *
 * Held as a module constant so the decode happens once per process, not once
 * per open.
 */
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIABAAAAAP///yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  "base64",
);

export async function GET(request: NextRequest) {
  const tid = request.nextUrl.searchParams.get("t");

  after(async () => {
    await logEvent({ kind: "open", tid, code: null, headers: request.headers });
  });

  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.byteLength),
      // Without this an intermediary caches the pixel and every open after the
      // first is invisible. `no-store` is the one that stops a CDN; the rest
      // are there for the older proxies that only honour their own dialect.
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, private",
      Pragma: "no-cache",
      Expires: "0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
