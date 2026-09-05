/**
 * The Meta Pixel, as a typed call rather than a global.
 *
 * `fbq` is installed on `window` by the loader in `components/MetaPixel.tsx`,
 * and may never arrive: the pixel is off without an ID configured, and an ad
 * blocker removes it on roughly a third of real traffic. Every function here
 * therefore treats its absence as ordinary, not as an error.
 *
 * This module is deliberately not a client component. It is imported by
 * `analytics.ts`, which route handlers also import, so it has to be safe to
 * evaluate on the server — hence the `typeof window` guard rather than a
 * "use client" directive.
 */

import type { AnalyticsEvent, EventProps } from "@/lib/analytics";

type Fbq = (command: string, event: string, props?: EventProps) => void;

declare global {
  interface Window {
    fbq?: Fbq;
  }
}

/**
 * Meta's standard events are a fixed vocabulary, and only they feed the
 * optimisation models — a custom event can be reported on but cannot be
 * optimised towards. Two of this app's events map onto that vocabulary
 * honestly: asking for a dish is a search, and getting a restoration back is
 * viewing content. Forcing the rest into `Purchase` or `Lead` to unlock
 * optimisation would be lying to the ad platform about what happened.
 */
const STANDARD_EVENTS: Partial<Record<AnalyticsEvent, string>> = {
  dish_queried: "Search",
  dish_restored: "ViewContent",
};

/**
 * Everything else goes across as a custom event. The names are spelled out
 * rather than derived from the union, because a custom event name is a contract
 * with whoever is building audiences in Ads Manager: renaming the internal
 * event should not silently break their saved conversion.
 */
const CUSTOM_EVENTS: Record<AnalyticsEvent, string> = {
  visit: "Visit",
  dish_queried: "DishQueried",
  dish_restored: "DishRestored",
  no_original_found: "CorpusGap",
  turn_resolved: "TurnResolved",
  swap_requested: "SwapRequested",
  source_drawer_opened: "SourceDrawerOpened",
  card_shared: "CardShared",
  qr_entry: "QrEntry",
  // Fired only from `track()` on the server (`serveCommunity` in
  // `src/app/api/chat/route.ts`), never from `trackClient`, so this pixel
  // name is never actually sent — required only because `CUSTOM_EVENTS` is
  // exhaustive over `AnalyticsEvent`.
  community_served: "CommunityServed",
};

/** Fire-and-forget. Absent pixel, blocked pixel and thrown pixel are all no-ops. */
export function trackPixel(event: AnalyticsEvent, props: EventProps = {}): void {
  if (typeof window === "undefined") return;

  const fbq = window.fbq;
  if (typeof fbq !== "function") return;

  try {
    const standard = STANDARD_EVENTS[event];
    if (standard) fbq("track", standard, props);
    else fbq("trackCustom", CUSTOM_EVENTS[event], props);
  } catch {
    // A tracking pixel must never be the reason an interaction fails.
  }
}

/** A route change in an app the pixel's own loader only saw once. */
export function trackPixelPageView(): void {
  if (typeof window === "undefined") return;
  try {
    window.fbq?.("track", "PageView");
  } catch {
    // As above.
  }
}
