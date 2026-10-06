import type { SubmissionRow } from "@/lib/community/client";
import { BELONGS_TO } from "@/lib/community/schema";
import { isSupported, LANG_NAMES } from "@/lib/lang/types";

import { ZONE } from "../range";
import type { Counted, StatusDay, SubmissionStats } from "../types";
import { bucketise, median, type Edge } from "./recipes";

/**
 * What lands in the store, counted. Pure: the rows come from
 * `submissionRows` (the store's one projection) and every number here is a
 * function of them, so `scripts/check-recipe-box.ts` pins it offline.
 *
 * Status is the document's status now, not the one it had on the day it was
 * submitted — a recipe published yesterday shows as published on the day it
 * came in.
 */

export type StatusBucket = "pending" | "green" | "red" | "published";

export const HOUR = 3_600_000;

export const PUBLISH_EDGES: Edge[] = [
  { label: "Under 1 hour", below: HOUR },
  { label: "1–6 hours", below: 6 * HOUR },
  { label: "6–24 hours", below: 24 * HOUR },
  { label: "1–3 days", below: 72 * HOUR },
];
export const PUBLISH_LAST = "3 days or more";

/** Published is a view over green, as it is for serving: `published_at` on a red row is not a publish. */
export function bucketOf(row: Pick<SubmissionRow, "status" | "published_at">): StatusBucket {
  return row.status === "green" && row.published_at ? "published" : row.status;
}

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const RELATION = new Map(BELONGS_TO.map((b) => [b.value, b.label.replace("…", "")]));

function ranked(values: string[], limit = 15): Counted[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function tally(rows: SubmissionRow[]) {
  const t = { submitted: rows.length, pending: 0, green: 0, red: 0, published: 0 };
  for (const row of rows) t[bucketOf(row)] += 1;
  return t;
}

export function summariseSubmissions(
  rows: SubmissionRow[],
  since: Date | null,
  previousSince: Date | null,
): SubmissionStats {
  const current = since ? rows.filter((r) => r.created_at >= since) : rows;
  const previous =
    since && previousSince ? rows.filter((r) => r.created_at >= previousSince && r.created_at < since) : [];

  const now = tally(current);
  const before = tally(previous);
  const pair = (key: keyof typeof now) => ({ now: now[key], before: before[key] });

  const days = new Map<string, StatusDay>();
  for (const row of current) {
    const day = dayFormat.format(row.created_at);
    const entry = days.get(day) ?? { day, pending: 0, green: 0, red: 0, published: 0 };
    entry[bucketOf(row)] += 1;
    days.set(day, entry);
  }

  const publishMs = current
    .filter((r) => bucketOf(r) === "published" && r.published_at)
    .map((r) => (r.published_at as Date).getTime() - r.created_at.getTime());
  const medianMs = median(publishMs);

  // Two maps, two questions: how many versions a dish has, and from how many
  // distinct states. One state can send three versions of one dish.
  const byTag = new Map<string, Set<string>>();
  const tagRows = new Map<string, number>();
  for (const row of current) {
    if (!row.tag) continue;
    byTag.set(row.tag, (byTag.get(row.tag) ?? new Set<string>()).add(row.state));
    tagRows.set(row.tag, (tagRows.get(row.tag) ?? 0) + 1);
  }
  const versions = [...tagRows]
    .filter(([, n]) => n > 1)
    .map(([tag, n]) => ({ tag, versions: n, states: [...(byTag.get(tag) ?? [])].sort() }))
    .sort((a, b) => b.versions - a.versions || a.tag.localeCompare(b.tag))
    .slice(0, 10);

  return {
    submitted: pair("submitted"),
    pending: pair("pending"),
    green: pair("green"),
    red: pair("red"),
    published: pair("published"),
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    overrides: current.filter((r) => r.overridden).length,
    publishMedianHours: medianMs === null ? null : Math.round((medianMs / HOUR) * 10) / 10,
    publishTimes: bucketise(publishMs, PUBLISH_EDGES, PUBLISH_LAST),
    states: ranked(current.map((r) => r.state), 40),
    withCity: current.filter((r) => r.has_city).length,
    modes: {
      image: current.filter((r) => r.mode === "image").length,
      manual: current.filter((r) => r.mode === "manual").length,
    },
    relations: ranked(current.map((r) => RELATION.get(r.belongs_to) ?? r.belongs_to)),
    languages: ranked(
      current.map((r) => (isSupported(r.language) ? LANG_NAMES[r.language] : r.language || "Not detected")),
    ),
    dishes: ranked(current.map((r) => r.tag || "Untagged")),
    versions,
  };
}
