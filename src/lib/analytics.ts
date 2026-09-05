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
import { deviceId } from "@/lib/device-id";
import { trackPixel } from "@/lib/meta-pixel";

export type AnalyticsEvent =
  | "visit"
  | "dish_queried"
  | "dish_restored"
  | "no_original_found"
  | "turn_resolved"
  | "community_served"
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
  } else {
    console.info(`[analytics] ${JSON.stringify(payload)}`);
  }

  persist(event, props);
}

/**
 * The durable half, added without touching a single call site.
 *
 * The log line above stays because it is what a `vercel logs` tail shows and
 * what the corpus-gap grep reads. What it never was is a store, so the same
 * payload now also goes to a table — see `lib/events/schema.ts` for why that
 * gap mattered more than it looked.
 *
 * Imported dynamically rather than at the top of the file for one reason: this
 * module is in the client graph (`trackClient` is called from components), and
 * a static import would pull the database driver into every browser bundle to
 * be executed never. The import is also inside the server guard, so it is not
 * merely tree-shaken in the browser — it is unreachable.
 *
 * Not awaited. `track()` is called from inside a streaming response, and the
 * turn must not wait on a log write. The cost is stated in `recordEvent`.
 */
function persist(event: AnalyticsEvent, props: EventProps): void {
  if (typeof window !== "undefined") return;
  void import("@/lib/events/record")
    .then(({ recordEvent }) => recordEvent(event, props))
    .catch((error: unknown) => {
      console.error("[analytics] could not load the event recorder:", error);
    });
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

  /* The device id rides along on every beacon, and it is what makes a funnel
     possible at all: a `visit` row and the `conversations` row it led to are
     otherwise two unrelated facts, and the rate between them — the single
     number that says whether the landing page works — cannot be computed from
     either table alone. It is the same id the thread mirror files under, so
     the join is exact rather than probabilistic. Null when storage is off,
     which is a device that will not be counted twice either. */
  const device = deviceId();
  const enriched: EventProps = {
    ...getAttribution(),
    ...(device ? { device_id: device } : {}),
    ...props,
  };

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
