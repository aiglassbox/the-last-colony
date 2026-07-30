/**
 * Analytics.
 *
 * Deliberately a thin, swappable shim — every event goes through `track()`, so
 * pointing this at a real sink is one function body. The one thing it does do
 * properly is `no_original_found`: that log line is the roadmap for corpus
 * expansion from ten thousand records to lakhs, so unmatched queries are
 * written out in a shape that can be grepped and counted rather than buried in
 * a generic event blob.
 */

export type AnalyticsEvent =
  | "dish_queried"
  | "dish_restored"
  | "no_original_found"
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

/** Client-side fire-and-forget. Never blocks an interaction. */
export function trackClient(event: AnalyticsEvent, props: EventProps = {}): void {
  if (typeof window === "undefined") return;
  void fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, props }),
    keepalive: true,
  }).catch(() => {
    // Analytics must never surface as a user-visible failure.
  });
}
