import type { NextRequest } from "next/server";

import { track, type AnalyticsEvent, type EventProps } from "@/lib/analytics";
import { checkRate, clientKey } from "@/lib/rate-limit";

/** Sink for client-side events (source drawer opens, shares, QR entries). */
export const dynamic = "force-dynamic";

/**
 * A beacon is cheap, so this is not the model-spending budget.
 *
 * It was unlimited, which is not the same as cheap: sixty beacons landed in
 * under half a second and each one is a line in the log a campaign is being
 * read from. The ceiling is high enough that a reader opening drawers and
 * sharing cards never meets it, and low enough that a loop stops being free.
 *
 * Its own key namespace, and deliberately so. Sharing the model routes' budget
 * would mean a reader opening source drawers and sharing a card could spend
 * the allowance that answers their next question, which is the product
 * breaking itself to protect a log file.
 */
const MAX_BEACONS = 120;
const MAX_PROPS = 12;
const MAX_PROP_CHARS = 200;
const MAX_KEY_CHARS = 40;

const ALLOWED: AnalyticsEvent[] = [
  "dish_queried",
  "dish_restored",
  "no_original_found",
  "turn_resolved",
  "swap_requested",
  "source_drawer_opened",
  "card_shared",
  "qr_entry",
];

/**
 * What of a beacon's payload is safe to write down.
 *
 * `JSON.stringify` already makes a forged log line impossible — a newline in a
 * value is escaped inside the string rather than starting a record of its own,
 * which was worth checking rather than assuming. What it does not bound is
 * size, so a single prop could be fifty thousand characters of one log line.
 */
function clampProps(props: unknown): EventProps {
  if (typeof props !== "object" || props === null) return {};
  const out: EventProps = {};
  for (const [key, value] of Object.entries(props).slice(0, MAX_PROPS)) {
    const k = key.slice(0, MAX_KEY_CHARS);
    if (typeof value === "string") out[k] = value.slice(0, MAX_PROP_CHARS);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[k] = value;
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  const rate = checkRate(`beacon:${clientKey(request)}`, Date.now(), MAX_BEACONS);
  // A refused beacon is still a 204. Nothing on the client waits on this, and
  // an error here would surface as a console error on a page that is fine.
  if (!rate.ok) return new Response(null, { status: 204 });

  try {
    const { event, props } = (await request.json()) as {
      event: AnalyticsEvent;
      props?: unknown;
    };
    if (!ALLOWED.includes(event)) {
      return Response.json({ error: "unknown event" }, { status: 400 });
    }
    track(event, clampProps(props));
  } catch {
    // A malformed beacon is not worth a 500.
  }
  return new Response(null, { status: 204 });
}
