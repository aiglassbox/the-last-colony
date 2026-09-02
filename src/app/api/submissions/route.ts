// src/app/api/submissions/route.ts
import type { NextRequest } from "next/server";

import { communityDb, SUBMISSIONS } from "@/lib/community/client";
import { moderate } from "@/lib/community/pipeline";
import { validateSubmission } from "@/lib/community/schema";
import { geoFrom } from "@/lib/events/geo";
import { checkRate, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["body must be JSON"] }, { status: 400 });
  }

  const checked = validateSubmission(body);
  if (!checked.ok) return Response.json({ errors: checked.errors }, { status: 400 });

  const db = await communityDb();
  if (!db) return Response.json({ error: "unavailable" }, { status: 503 });

  const now = new Date();
  const doc = {
    status: "pending" as const,
    created_at: now,
    updated_at: now,
    mode: "manual" as const,
    submission: checked.value,
    // Audit only. The record's location IS the form's state; on any clash
    // the form wins. Edge geo's live job is query-side, in Phase 4.
    geo: geoFrom(request.headers),
  };

  let id;
  try {
    const inserted = await db.collection(SUBMISSIONS).insertOne(doc);
    id = inserted.insertedId;
  } catch (error) {
    console.error("[community] insert failed:", error);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }

  // Inline verdict; a failure leaves the doc pending for a /pantry re-run.
  const verdict = await moderate(checked.value);
  if (verdict) {
    try {
      await db.collection(SUBMISSIONS).updateOne(
        { _id: id },
        {
          $set: {
            status: verdict.card === "GREEN" ? "green" : "red",
            updated_at: new Date(),
            verdict: {
              card: verdict.card,
              reasons: verdict.reasons,
              model: verdict.model,
              at: new Date(),
            },
            dish: { tag: verdict.dish_tag, aliases: verdict.aliases },
          },
        },
      );
    } catch (error) {
      console.error("[community] verdict update failed (doc stays pending):", error);
    }
  }

  return Response.json({ ok: true }, { status: 201 });
}
