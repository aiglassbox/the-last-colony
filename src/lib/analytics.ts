/**
 * Analytics.
 *
 * Deliberately a thin, swappable shim — every event goes through `track()`, so
 * pointing this at a real sink is one function body. The one thing it does do
 * properly is `no_original_found`: that log line is the roadmap for corpus
 * expansion from ten thousand records to lakhs, so unmatched queries are
 * written out in a shape that can be grepped and counted rather than buried in
 * a generic event blob.
 *
 * Client events now have two sinks, and they answer different questions. The
 * beacon to `/api/track` is the first-party record: it is complete, it is ours,
 * and it survives an ad blocker. The Meta Pixel is the ad platform's copy,
 * which is what makes a campaign measurable and an audience buildable, and
 * which a third of browsers will refuse to load. Neither can replace the other,
 * so `trackClient` writes to both from one call.
 */

// Both of these import only types back from here, so the cycle is erased at
// compile time and there is no runtime import loop.
import { getAttribution } from "@/lib/attribution";
import { trackPixel } from "@/lib/meta-pixel";

export type AnalyticsEvent =
  | "visit"
  | "dish_queried"
  | "dish_restored"
  | "no_original_found"
  | "turn_resolved"
  | "swap_requested"
  | "source_drawer_opened"
  | "card_shared"
  | "qr_entry";

export type EventProps = Record<string, string | number | boolean | null>;

export function track(event: AnalyticsEvent, props: EventProps = {}): void {
  const payload = { event, ...props };

  if (event === "no_original_found") {
    // The unmatched-query list is the corpus roadmap. Give it its own prefix so
    // it can be pulled straight out of the logs.
    console.info(`[corpus-gap] ${JSON.stringify(payload)}`);
    return;
  }

  console.info(`[analytics] ${JSON.stringify(payload)}`);
}

/**
 * Client-side fire-and-forget. Never blocks an interaction.
 *
 * Every event leaves carrying the session's campaign markers, so a drawer open
 * or a share can be traced back to the placement that paid for the visit. The
 * event's own props are spread last and win on a key collision — an event that
 * genuinely has its own `landing` means something different by it.
 */
export function trackClient(event: AnalyticsEvent, props: EventProps = {}): void {
  if (typeof window === "undefined") return;

  const enriched: EventProps = { ...getAttribution(), ...props };

  trackPixel(event, enriched);

  void fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, props: enriched }),
    keepalive: true,
  }).catch(() => {
    // Analytics must never surface as a user-visible failure.
  });
}
