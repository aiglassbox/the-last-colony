/**
 * The window every panel is computed over, and the one before it.
 *
 * Two decisions are baked in here rather than left to each query.
 *
 * The first is the time zone. Every bucket is cut in `Asia/Kolkata`, not UTC,
 * because the readers and the readership are both in India and a UTC day
 * boundary falls at half past five in the morning IST — which splits an Indian
 * evening across two bars and makes the busiest hours of the product look like
 * two quiet ones. The constant is named rather than inlined so that the day it
 * is wrong, it is wrong in one place.
 *
 * The second is that a range always carries its predecessor. A number with no
 * comparison is decoration: 137 devices is neither good nor bad until you know
 * it was 43 the week before. Every headline figure on the dashboard is a pair.
 */

export const ZONE = "Asia/Kolkata";

export type RangeKey = "7d" | "30d" | "90d" | "all";

export interface Range {
  key: RangeKey;
  label: string;
  /** Inclusive lower bound. Null only for `all`, where there is no bound. */
  since: Date | null;
  /** The same span again, immediately before `since`. Null when `since` is. */
  previousSince: Date | null;
  /** Days in the window, for per-day averages. Null for `all`. */
  days: number | null;
}

const DAYS: Record<Exclude<RangeKey, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

const LABELS: Record<RangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

export const RANGE_KEYS: RangeKey[] = ["7d", "30d", "90d", "all"];

export function parseRange(value: string | undefined): RangeKey {
  return RANGE_KEYS.includes(value as RangeKey) ? (value as RangeKey) : "30d";
}

/**
 * `now` is a parameter so this is testable without freezing the clock, and so
 * every query in one render measures against the same instant — a report whose
 * panels each called `new Date()` would disagree with itself by milliseconds at
 * best and across a midnight boundary at worst.
 */
export function resolveRange(key: RangeKey, now: Date = new Date()): Range {
  if (key === "all") {
    return { key, label: LABELS.all, since: null, previousSince: null, days: null };
  }
  const days = DAYS[key];
  const span = days * 86_400_000;
  return {
    key,
    label: LABELS[key],
    since: new Date(now.getTime() - span),
    previousSince: new Date(now.getTime() - span * 2),
    days,
  };
}

/** Postgres wants a timestamp or nothing; `null` means "no lower bound". */
export function bound(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}
