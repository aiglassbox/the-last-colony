// src/app/api/submissions/route.ts
import { after, type NextRequest } from "next/server";

import { applyVerdict, insertSubmission } from "@/lib/community/client";
import { moderate } from "@/lib/community/pipeline";
import { MAX_BODY_BYTES, validateSubmission } from "@/lib/community/schema";
import { geoFrom } from "@/lib/events/geo";
import { checkRate, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
/** The verdict runs in `after()`, past the response; this is its room. 60 is allowed on every Vercel plan. */
export const maxDuration = 60;

/**
 * The submission trust boundary.
 *
 * Low ceiling on purpose: this endpoint spends model tokens per call, so it
 * gets neither the beacon's allowance nor the chat routes' shared budget.
 * Three per five-minute window is a person filling in a form, not a loop.
 *
 * The verdict is never in the response. GREEN and RED both answer 201
 * "submitted for review" — a spammer who can read the verdict can tune
 * against it, and a RED submitter is owed nothing more specific.
 */
const MAX_SUBMITS = 3;

export async function POST(request: NextRequest) {
  const rate = checkRate(`submit:${clientKey(request)}`, Date.now(), MAX_SUBMITS);
  if (!rate.ok) {
    return Response.json(
      { error: "rate_limited", retryAfter: rate.retryAfter },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  // Before the body is read: the one legitimately large member is the photo,
  // and its cap is known. Anything bigger is not a form submission.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ errors: ["body too large"] }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["body must be JSON"] }, { status: 400 });
  }

  const checked = validateSubmission(body);
  if (!checked.ok) return Response.json({ errors: checked.errors }, { status: 400 });

  const id = await insertSubmission({
    mode: checked.mode,
    submission: checked.value,
    // Spread, not `extracted: undefined` — the driver would store a null.
    ...(checked.extracted && { extracted: checked.extracted }),
    geo: geoFrom(request.headers),
  });
  if (!id) return Response.json({ error: "unavailable" }, { status: 503 });

  /* `after`, not `await`: the reader waits on nothing, and a verdict that
     outlives the platform timeout can no longer become a failed response the
     form retries as a duplicate. A lost verdict leaves the doc pending for a
     /pantry re-run (Phase 3). `moderate` and `applyVerdict` never throw. */
  after(async () => {
    const verdict = await moderate(checked.value);
    if (verdict) await applyVerdict(id, verdict);
  });

  return Response.json({ ok: true }, { status: 201 });
}
