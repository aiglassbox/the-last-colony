import type { NextRequest } from "next/server";

import { publishedPhoto } from "@/lib/community/client";
import { PHOTO_MIMES } from "@/lib/community/schema";

/**
 * GET /api/community/photo/[id] — the one route that hands over a photo.
 *
 * Published only: `publishedPhoto` (`client.ts`) serves a document's photo
 * only when it is green and carries `published_at`. A pending, red, or
 * unpublished document reads as `not_found` there too, so this route cannot
 * be used to enumerate which documents exist in which state — a missing id
 * and an unpublished one give the identical 404 body.
 *
 * The stored mime is reasserted against `PHOTO_MIMES` rather than trusted: it
 * arrived from a client at submission time (`schema.ts`'s `validatePhoto`
 * checked it then, but this route hands whatever is stored to a browser as a
 * `Content-Type` now, and a document written before that check existed, or
 * written some other way, is not this route's to trust).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX_ID = /^[0-9a-f]{24}$/i;

function notFound(): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
}

function unreachable(): Response {
  return new Response("Store unreachable\n", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/community/photo/[id]">) {
  const { id } = await ctx.params;
  // Validated before anything else — the id space is not a reader's
  // business, so a malformed id is a 404 like any other, not a 400.
  if (!HEX_ID.test(id)) return notFound();

  const result = await publishedPhoto(id);
  if (!result.ok) return result.reason === "unreachable" ? unreachable() : notFound();
  if (!PHOTO_MIMES.includes(result.mime)) return notFound();

  const bytes = Buffer.from(result.data, "base64");
  return new Response(bytes, {
    headers: {
      "Content-Type": result.mime,
      "Content-Length": String(bytes.byteLength),
      // A document's photo never changes and the id is the version, so this
      // is safe to cache forever.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
