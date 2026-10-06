import type { NeonQueryFunction } from "@neondatabase/serverless";

import { ZONE } from "../range";
import type { Counted, CountedDevices, Delta, FunnelStage, RecipeFunnelPanel, RecipeReachPanel, StepRow } from "../types";
import { tolerant } from "./events";

/**
 * The recipe box's numbers.
 *
 * The funnel is read from the two beacons the Add Recipe form fires
 * (`recipe_entry_pressed`, `recipe_step`). Their props are client-written —
 * `/api/track` clamps their size and nothing else — so every label drawn here
 * comes from a fixed map, and a step, outcome or reason the form never sends
 * is dropped rather than drawn. The `ms` on an accepted submit is clamped
 * again in SQL for the same reason: the browser's clamp does not bind a forged
 * beacon.
 *
 * Every query tolerates the events table being absent, as the kitchen's do.
 */

export type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

const int = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const optional = (value: unknown): string | null => (typeof value === "string" ? value : null);

export const MINUTE = 60_000;

// --- pure: shared with the check script ------------------------------------

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Whole percent, or no figure when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export interface Edge {
  label: string;
  below: number;
}

/**
 * Counts per bucket in the buckets' own order, zeros included, so the bars
 * read as a distribution rather than a ranking. The last bucket takes
 * everything at or past the final edge. No values, no bars.
 */
export function bucketise(values: number[], edges: Edge[], last: string): Counted[] {
  if (!values.length) return [];
  const out = [...edges.map((e) => ({ label: e.label, n: 0 })), { label: last, n: 0 }];
  for (const value of values) {
    const index = edges.findIndex((e) => value < e.below);
    out[index === -1 ? edges.length : index].n += 1;
  }
  return out;
}

export const FINISH_EDGES: Edge[] = [
  { label: "Under 2 minutes", below: 2 * MINUTE },
  { label: "2–5 minutes", below: 5 * MINUTE },
  { label: "5–10 minutes", below: 10 * MINUTE },
  { label: "10–30 minutes", below: 30 * MINUTE },
];
export const FINISH_LAST = "30 minutes or more";

/** Steps a refusal can happen on. Anything else is not a step the form sends. */
const REFUSAL_STEP = new Map([
  ["photo_read", "Photo"],
  ["code_send", "Send code"],
  ["code_resend", "Resend"],
  ["verify", "Verify"],
  ["submit", "Submit"],
]);

/** Every reason `app/add-recipe/track.ts` can send. Anything else is dropped. */
const REASON = new Map([
  ["rate_limited", "rate limited"],
  ["too_large", "too large"],
  ["invalid_photo", "not a usable image"],
  ["compress_failed", "could not be shrunk"],
  ["unavailable", "unavailable"],
  ["network", "no connection"],
  ["daily_cap", "daily cap for this network"],
  ["cooldown", "resend cooldown"],
  ["cap", "send cap"],
  ["bad_email", "not an email address"],
  ["wrong_code", "wrong code"],
  ["expired", "code expired"],
  ["locked", "code locked"],
  ["invalid", "invalid"],
  ["lapsed", "verification lapsed"],
]);

const PHOTO_OUTCOMES: [string, string][] = [
  ["ok", "Read — fields filled"],
  ["unreadable", "Unreadable"],
  ["not_recipe", "Not a recipe"],
  ["refused", "Refused"],
];

export function stepPanels(rows: StepRow[]): Pick<RecipeFunnelPanel, "photo" | "refusals" | "secondary"> {
  const total = (step: string) => rows.find((r) => r.rollup && r.step === step);
  const detail = rows.filter((r) => !r.rollup);

  const attached = total("photo_attached")?.n ?? 0;
  const reads = PHOTO_OUTCOMES.map(([outcome, label]) => ({
    label,
    n: detail
      .filter((r) => r.step === "photo_read" && r.outcome === outcome)
      .reduce((sum, r) => sum + r.n, 0),
  }));
  const photo = attached || reads.some((r) => r.n) ? [{ label: "Attached", n: attached }, ...reads] : [];

  // Keyed by label: two forged spellings of one refusal must not become two
  // bars with the same React key.
  const refused = new Map<string, number>();
  for (const r of detail) {
    const step = REFUSAL_STEP.get(r.step);
    const reason = r.reason === null ? undefined : REASON.get(r.reason);
    if (!step || !reason || (r.outcome !== "refused" && r.outcome !== "failed")) continue;
    const label = `${step} · ${reason}`;
    refused.set(label, (refused.get(label) ?? 0) + r.n);
  }
  const refusals = [...refused]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));

  const blocked = detail.find((r) => r.step === "next" && r.outcome === "invalid" && r.reason === null);
  const secondary: CountedDevices[] = (
    [
      ["Back to screen one", total("back")],
      ["Pressed Resend", total("code_resend")],
      ["Changed email", total("change_email")],
      ["Next blocked by an empty field", blocked],
    ] as const
  ).map(([label, r]) => ({ label, n: r?.n ?? 0, devices: r?.devices ?? 0 }));

  return { photo, refusals, secondary };
}

// --- queries -----------------------------------------------------------------

interface EntryTotals {
  presses: number;
  pressDevices: number;
  opens: number;
  openDevices: number;
  acceptedDevices: number;
}

const NO_ENTRY: EntryTotals = { presses: 0, pressDevices: 0, opens: 0, openDevices: 0, acceptedDevices: 0 };

/** One window's headline counts. Run once per window, as `usageTotals` is. */
function entryTotals(sql: Sql, since: string | null, until: string | null): Promise<EntryTotals> {
  return tolerant(
    async () => {
      const [row] = (await sql`
        select count(*) filter (where event = 'recipe_entry_pressed')::int                  as presses,
               count(distinct device_id) filter (where event = 'recipe_entry_pressed')::int as press_devices,
               count(*) filter (
                 where event = 'recipe_step' and props->>'step' = 'opened')::int            as opens,
               count(distinct device_id) filter (
                 where event = 'recipe_step' and props->>'step' = 'opened')::int            as open_devices,
               count(distinct device_id) filter (
                 where event = 'recipe_step'
                   and props->>'step' = 'submit'
                   and props->>'outcome' = 'accepted')::int                                 as accepted_devices
          from analytics_events
         where event in ('recipe_entry_pressed', 'recipe_step')
           and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
           and (${until}::timestamptz is null or occurred_at <  ${until}::timestamptz)
      `) as Row[];
      return {
        presses: int(row?.presses),
        pressDevices: int(row?.press_devices),
        opens: int(row?.opens),
        openDevices: int(row?.open_devices),
        acceptedDevices: int(row?.accepted_devices),
      };
    },
    NO_ENTRY,
    "recipe entryTotals",
  );
}

function entryDaily(sql: Sql, since: string | null): Promise<RecipeFunnelPanel["daily"]> {
  return tolerant(
    async () => {
      const rows = (await sql`
        select to_char(occurred_at at time zone ${ZONE}, 'YYYY-MM-DD')                     as day,
               count(*) filter (where event = 'recipe_entry_pressed')::int                as presses,
               count(*) filter (where event = 'recipe_step' and props->>'step' = 'opened')::int as opens
          from analytics_events
         where event in ('recipe_entry_pressed', 'recipe_step')
           and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
         group by 1
         order by 1
      `) as Row[];
      return rows.map((r) => ({ day: str(r.day), presses: int(r.presses), opens: int(r.opens) }));
    },
    [],
    "recipe entryDaily",
  );
}

/**
 * Devices at each stage. Not nested by construction — a device whose storage
 * was off mid-flow can appear late without appearing early — but at this
 * volume the shape is the point, as with the kitchen's funnel.
 */
function funnelStages(sql: Sql, since: string | null): Promise<FunnelStage[]> {
  return tolerant(
    async () => {
      const [row] = (await sql`
        select count(distinct device_id) filter (where props->>'step' = 'opened')::int as opened,
               count(distinct device_id) filter (
                 where props->>'step' = 'next' and props->>'outcome' = 'ok')::int      as next,
               count(distinct device_id) filter (
                 where props->>'step' in ('code_send', 'code_resend')
                   and props->>'outcome' = 'ok')::int                                  as sent,
               count(distinct device_id) filter (
                 where props->>'step' = 'verify' and props->>'outcome' = 'ok')::int    as verified,
               count(distinct device_id) filter (where props->>'step' = 'submit')::int as submitted,
               count(distinct device_id) filter (
                 where props->>'step' = 'submit' and props->>'outcome' = 'accepted')::int as accepted
          from analytics_events
         where event = 'recipe_step'
           and device_id is not null
           and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
      `) as Row[];
      return [
        { label: "Opened the form", n: int(row?.opened), note: "landed on /add-recipe" },
        { label: "Finished screen one", n: int(row?.next), note: "pressed Next with every required field filled" },
        { label: "Got a code", n: int(row?.sent), note: "a code was sent, first time or resend" },
        { label: "Verified the email", n: int(row?.verified), note: "entered the right code" },
        { label: "Pressed Submit", n: int(row?.submitted), note: "any answer, accepted or not" },
        { label: "Accepted", n: int(row?.accepted), note: "the server stored it; moderation comes after" },
      ];
    },
    [],
    "recipe funnelStages",
  );
}

/** Every step's groups, plus each step's own total (`grouping sets`), in one scan. */
function stepRows(sql: Sql, since: string | null): Promise<StepRow[]> {
  return tolerant(
    async () => {
      const rows = (await sql`
        select props->>'step'                                        as step,
               props->>'outcome'                                     as outcome,
               props->>'reason'                                      as reason,
               grouping(props->>'outcome', props->>'reason') <> 0    as rollup,
               count(*)::int                                         as n,
               count(distinct device_id)::int                        as devices
          from analytics_events
         where event = 'recipe_step'
           and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
         group by grouping sets (
           (props->>'step', props->>'outcome', props->>'reason'),
           (props->>'step')
         )
      `) as Row[];
      return rows.map((r) => ({
        step: str(r.step),
        outcome: optional(r.outcome),
        reason: optional(r.reason),
        rollup: r.rollup === true,
        n: int(r.n),
        devices: int(r.devices),
      }));
    },
    [],
    "recipe stepRows",
  );
}

/**
 * Accepted-submit durations since `floor`, flagged by which window they fall
 * in. Clamped to a day here as well as in the browser: the same ceiling as
 * `MAX_FINISH_MS` in `app/add-recipe/track.ts`, restated because a forged
 * beacon never ran that code.
 *
 * ponytail: the durations come back as rows and are bucketed in JS, so the
 * bucket edges live in one place. Accepted submits are capped by
 * SUBMISSION_DAILY_MAX, so this is tens of thousands of numbers at worst;
 * move the bucketing into SQL if it ever is not.
 */
function finishTimes(
  sql: Sql,
  since: string | null,
  floor: string | null,
): Promise<{ current: boolean; ms: number }[]> {
  return tolerant(
    async () => {
      const rows = (await sql`
        select (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz) as current,
               least(greatest((props->>'ms')::float8, 0), 86400000)                    as ms
          from analytics_events
         where event = 'recipe_step'
           and props->>'step' = 'submit'
           and props->>'outcome' = 'accepted'
           and jsonb_typeof(props->'ms') = 'number'
           and (${floor}::timestamptz is null or occurred_at >= ${floor}::timestamptz)
      `) as Row[];
      return rows.map((r) => ({ current: r.current === true, ms: Number(r.ms) }));
    },
    [],
    "recipe finishTimes",
  );
}

export async function recipeFunnel(
  sql: Sql,
  since: string | null,
  previousSince: string | null,
): Promise<RecipeFunnelPanel> {
  const [now, before, daily, stages, steps, finish] = await Promise.all([
    entryTotals(sql, since, null),
    // All-time has no window before it; every delta then reads against zero,
    // which StatTile renders as "nothing before this to compare against".
    since ? entryTotals(sql, previousSince, since) : Promise.resolve(NO_ENTRY),
    entryDaily(sql, since),
    funnelStages(sql, since),
    stepRows(sql, since),
    finishTimes(sql, since, previousSince ?? since),
  ]);

  const pair = (key: keyof EntryTotals): Delta => ({ now: now[key], before: before[key] });
  const minutes = (values: number[]) => {
    const m = median(values);
    return m === null ? null : Math.round((m / MINUTE) * 10) / 10;
  };
  const finishNow = finish.filter((f) => f.current).map((f) => f.ms);
  const finishBefore = finish.filter((f) => !f.current).map((f) => f.ms);

  return {
    presses: pair("presses"),
    pressDevices: pair("pressDevices"),
    opens: pair("opens"),
    openDevices: pair("openDevices"),
    acceptedDevices: pair("acceptedDevices"),
    rate: {
      now: percent(now.acceptedDevices, now.openDevices),
      before: since ? percent(before.acceptedDevices, before.openDevices) : null,
    },
    medianMinutes: { now: minutes(finishNow), before: since ? minutes(finishBefore) : null },
    daily,
    stages,
    ...stepPanels(steps),
    finish: bucketise(finishNow, FINISH_EDGES, FINISH_LAST),
  };
}

const RULES: [string, string][] = [
  ["state", "Reader's state"],
  ["language", "Reader's language"],
  ["recency", "Most recent"],
];

/** `pickCommunity`'s three rules, in its own order; a rule chat never logs is dropped. */
export function ruleMix(rows: Counted[]): Counted[] {
  return RULES.map(([key, label]) => ({ label, n: rows.find((r) => r.label === key)?.n ?? 0 }));
}

interface ReachTotals {
  serves: number;
  readers: number;
  dishes: number;
  misses: number;
}

const NO_REACH: ReachTotals = { serves: 0, readers: 0, dishes: 0, misses: 0 };

/**
 * One window's reach. `misses` is the denominator for gap fill: dish asks the
 * corpus did not answer, refused off-topic turns left out. Every community
 * serve is also one of those asks — chat fires `dish_queried` with
 * `hit: false` before it serves — so the rate cannot pass 100%.
 */
function reachTotals(sql: Sql, since: string | null, until: string | null): Promise<ReachTotals> {
  return tolerant(
    async () => {
      const [row] = (await sql`
        select count(*) filter (where event = 'community_served')::int                      as serves,
               count(distinct device_id) filter (where event = 'community_served')::int     as readers,
               count(distinct props->>'dish_tag') filter (where event = 'community_served')::int as dishes,
               count(*) filter (
                 where event = 'dish_queried'
                   and props->>'hit' = 'false'
                   and coalesce(props->>'off_topic', 'false') = 'false')::int               as misses
          from analytics_events
         where event in ('community_served', 'dish_queried')
           and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
           and (${until}::timestamptz is null or occurred_at <  ${until}::timestamptz)
      `) as Row[];
      return {
        serves: int(row?.serves),
        readers: int(row?.readers),
        dishes: int(row?.dishes),
        misses: int(row?.misses),
      };
    },
    NO_REACH,
    "recipe reachTotals",
  );
}

export async function recipeReach(
  sql: Sql,
  since: string | null,
  previousSince: string | null,
): Promise<RecipeReachPanel> {
  const served = (column: "dish_tag" | "served_state" | "rule") =>
    tolerant(
      async () => {
        const rows = (await sql`
          select props->>${column} as label, count(*)::int as n
            from analytics_events
           where event = 'community_served'
             and props->>${column} is not null
             and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
           group by 1
           order by n desc, 1
           limit 12
        `) as Row[];
        return rows.map((r) => ({ label: str(r.label), n: int(r.n) }));
      },
      [] as Counted[],
      `recipe served ${column}`,
    );

  const [now, before, daily, dishes, states, rules, translated, regions] = await Promise.all([
    reachTotals(sql, since, null),
    since ? reachTotals(sql, previousSince, since) : Promise.resolve(NO_REACH),
    tolerant(
      async () => {
        const rows = (await sql`
          select to_char(occurred_at at time zone ${ZONE}, 'YYYY-MM-DD') as day,
                 count(*)::int                                          as serves,
                 count(distinct device_id)::int                         as readers
            from analytics_events
           where event = 'community_served'
             and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
           group by 1
           order by 1
        `) as Row[];
        return rows.map((r) => ({ day: str(r.day), serves: int(r.serves), readers: int(r.readers) }));
      },
      [] as RecipeReachPanel["daily"],
      "recipe reach daily",
    ),
    served("dish_tag"),
    served("served_state"),
    served("rule"),
    tolerant(
      async () => {
        const [row] = (await sql`
          select count(*)::int as n
            from analytics_events
           where event = 'community_served'
             and props->>'translated' = 'true'
             and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
        `) as Row[];
        return int(row?.n);
      },
      0,
      "recipe reach translated",
    ),
    tolerant(
      async () => {
        const rows = (await sql`
          select region || coalesce(', ' || country, '') as label,
                 count(distinct device_id)::int         as n
            from analytics_events
           where event = 'community_served'
             and region is not null
             and device_id is not null
             and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
           group by 1
           order by n desc, 1
           limit 12
        `) as Row[];
        return rows.map((r) => ({ label: str(r.label), n: int(r.n) }));
      },
      [] as Counted[],
      "recipe reach regions",
    ),
  ]);

  return {
    serves: { now: now.serves, before: before.serves },
    readers: { now: now.readers, before: before.readers },
    dishes: { now: now.dishes, before: before.dishes },
    gapFill: {
      now: percent(now.serves, now.misses),
      before: since ? percent(before.serves, before.misses) : null,
    },
    daily,
    rules: ruleMix(rules),
    translated,
    topDishes: dishes,
    servedStates: states,
    regions,
  };
}
