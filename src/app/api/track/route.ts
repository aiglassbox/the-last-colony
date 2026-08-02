import type { NextRequest } from "next/server";

import { track, type AnalyticsEvent, type EventProps } from "@/lib/analytics";

/** Sink for client-side events (source drawer opens, shares, QR entries). */
export const dynamic = "force-dynamic";

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

export async function POST(request: NextRequest) {
  try {
    const { event, props } = (await request.json()) as {
      event: AnalyticsEvent;
      props?: EventProps;
    };
    if (!ALLOWED.includes(event)) {
      return Response.json({ error: "unknown event" }, { status: 400 });
    }
    track(event, props ?? {});
  } catch {
    // A malformed beacon is not worth a 500.
  }
  return new Response(null, { status: 204 });
}
