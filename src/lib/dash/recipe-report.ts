import { submissionRows } from "@/lib/community/client";
import { db } from "@/lib/db/client";

import { recipeFunnel } from "./queries/recipes";
import { summariseSubmissions } from "./queries/submissions";
import { bound, resolveRange, type RangeKey } from "./range";
import { NoDatabaseError } from "./report";
import type { RecipeReport } from "./types";

/**
 * The recipe box's page in one call, as `buildReport` is the kitchen's. Kept
 * apart from the queries so the pure maths in `queries/` never imports a
 * store, and so the tabs' sources meet in one place.
 */
export async function buildRecipeReport(key: RangeKey, now: Date = new Date()): Promise<RecipeReport> {
  const sql = db();
  if (!sql) throw new NoDatabaseError();

  const range = resolveRange(key, now);
  const since = bound(range.since);
  const previousSince = bound(range.previousSince);

  // The store is a separate vendor and can be down while Neon is up; it
  // costs the Submissions tab, never the page.
  const [funnel, rows] = await Promise.all([
    recipeFunnel(sql, since, previousSince),
    submissionRows(range.previousSince ?? range.since),
  ]);

  return {
    generatedAt: now.toISOString(),
    rangeLabel: range.label,
    comparable: range.since !== null,
    funnel,
    submissions: rows ? summariseSubmissions(rows, range.since, range.previousSince) : null,
  };
}
