import { db } from "@/lib/db/client";

import { recipeFunnel } from "./queries/recipes";
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

  const funnel = await recipeFunnel(sql, since, previousSince);

  return {
    generatedAt: now.toISOString(),
    rangeLabel: range.label,
    comparable: range.since !== null,
    funnel,
  };
}
