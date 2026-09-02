// src/app/api/submissions/extract/route.ts
import type { NextRequest } from "next/server";

import { extractRecipe } from "@/lib/community/extract";
import { MAX_BODY_BYTES, validatePhoto } from "@/lib/community/schema";
import { checkRate, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
/** One full-quality vision call; give it room. 60 is allowed on every Vercel plan. */
export const maxDuration = 60;

/**
 * Reads a photo, returns fields. Stores nothing — the form prefills, the
 * submitter corrects, and `POST /api/submissions` is where their words land.
 *
 * The dearest call in the app (a photo in, a recipe out, on the full model),
 * so it has its own limiter key and the same three-per-window ceiling as
 * submitting: a person retrying a blurry card, not a loop.
 */
const MAX_EXTRACTS = 3;

export async function POST(request: NextRequest) {
  const rate = checkRate(`extract:${clientKey(request)}`, Date.now(), MAX_EXTRACTS);
  if (!rate.ok) {
    return Response.json(
      { error: "rate_limited", retryAfter: rate.retryAfter },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ errors: ["body too large"] }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["body must be JSON"] }, { status: 400 });
  }

  const photo = validatePhoto((body as { photo?: unknown } | null)?.photo);
  if (!photo.ok) return Response.json({ errors: [photo.error] }, { status: 400 });

  const result = await extractRecipe(photo.value);
  if (!result) return Response.json({ error: "unavailable" }, { status: 503 });
  if (!result.ok) return Response.json({ error: result.reason }, { status: 422 });
  return Response.json({ ok: true, extracted: result.value });
}
