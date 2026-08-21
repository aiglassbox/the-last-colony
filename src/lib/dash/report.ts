import { db } from "@/lib/db/client";

import { commandUse, corpusGaps, foreignAsks, mostAsked, provenanceMix, topRecords } from "./queries/demand";
import { emailPanel } from "./queries/email";
import { attribution, deviceFunnel, eventTotals, eventsPresent, geography } from "./queries/events";
import {
  activityHeat,
  cohorts,
  dailyUsage,
  errorCount,
  newVersusReturning,
  threadDepth,
  turnKinds,
  usageTotals,
} from "./queries/usage";
import { bound, resolveRange, type RangeKey } from "./range";
import type { Report } from "./types";

/**
 * One page, one round trip's worth of work.
 *
 * Every panel is issued at once rather than in sequence. They are independent
 * reads against the same snapshot-ish moment, and serialising twenty of them
 * over an HTTP-based Postgres driver would put the page's time-to-first-byte
 * in the seconds. The one query that is not windowed — cohorts — is the one
 * whose answer would be meaningless if it were, and its comment says why.
 */

export class NoDatabaseError extends Error {
  constructor() {
    super("No database is configured on this deployment.");
    this.name = "NoDatabaseError";
  }
}

export async function buildReport(key: RangeKey, now: Date = new Date()): Promise<Report> {
  const sql = db();
  if (!sql) throw new NoDatabaseError();

  const range = resolveRange(key, now);
  const since = bound(range.since);
  const previousSince = bound(range.previousSince);

  const [
    totals,
    daily,
    newReturning,
    heat,
    depth,
    kinds,
    errors,
    cohortRows,
    asked,
    gaps,
    foreign,
    topSlugs,
    provenance,
    commands,
    events,
    attributionRows,
    funnel,
    hasEvents,
    geo,
    email,
  ] = await Promise.all([
    usageTotals(sql, since, previousSince),
    dailyUsage(sql, since),
    newVersusReturning(sql, since),
    activityHeat(sql, since),
    threadDepth(sql, since),
    turnKinds(sql, since),
    errorCount(sql, since),
    cohorts(sql),
    mostAsked(sql, since),
    corpusGaps(sql, since),
    foreignAsks(sql, since),
    topRecords(sql, since),
    provenanceMix(sql, since),
    commandUse(sql, since),
    eventTotals(sql, since),
    attribution(sql, since),
    deviceFunnel(sql, since),
    eventsPresent(sql, since),
    geography(sql, since),
    emailPanel(sql, since),
  ]);

  return {
    generatedAt: now.toISOString(),
    rangeLabel: range.label,
    comparable: range.since !== null,
    hasEvents,
    totals,
    daily,
    newReturning,
    heat,
    depth,
    kinds,
    provenance,
    topSlugs,
    asked,
    gaps,
    foreign,
    commands,
    errors,
    cohorts: cohortRows,
    events,
    attribution: attributionRows,
    funnel,
    geo,
    email,
  };
}
