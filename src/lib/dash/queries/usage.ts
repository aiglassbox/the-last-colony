import type { NeonQueryFunction } from "@neondatabase/serverless";

import { ZONE } from "../range";
import type {
  CohortRow,
  DailyRow,
  Delta,
  DepthRow,
  HeatCell,
  KindRow,
  NewReturningRow,
  UsageTotals,
} from "../types";

/**
 * Everything the thread mirror can be asked.
 *
 * `conversations` is the oldest durable thing the product has and, until the
 * event log shipped, the only one. Its limit is worth restating wherever these
 * numbers are read: a reader who lands, reads the hero and leaves writes no row
 * here, so every figure below counts people who *typed*, and is a floor on
 * traffic rather than a measure of it. The events panel is the half that
 * answers the other question.
 *
 * One further caveat, and it is the sharper one. The mirror is replace-by-
 * device: a client sends the whole set it holds, and anything missing from that
 * set is deleted. The client keeps thirty threads. So a device that has been
 * busy for months holds thirty and the rows beyond that are gone, which makes a
 * long all-time window an undercount that grows with engagement. Short windows
 * are exact; the all-time view says so on the page.
 */

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

const int = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

/**
 * One window's headline counts.
 *
 * Run twice — once for the range, once for the range before it — rather than as
 * a single grouped query, because the two windows are disjoint and a
 * `filter (where ...)` over their union would scan the whole table to answer a
 * question about two slices of it.
 */
async function totalsFor(sql: Sql, since: string | null, until: string | null) {
  const [row] = (await sql`
    select count(*)::int                        as conversations,
           count(distinct device_id)::int       as devices,
           coalesce(sum(message_count), 0)::int as messages
      from conversations
     where (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
       and (${until}::timestamptz is null or created_at <  ${until}::timestamptz)
  `) as Row[];

  const [repeat] = (await sql`
    select count(*)::int as n from (
      select device_id
        from conversations
       where (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
         and (${until}::timestamptz is null or created_at <  ${until}::timestamptz)
       group by device_id
      having count(*) > 1
    ) t
  `) as Row[];

  /* A second thread in the same sitting is curiosity; a second thread on a
     second day is the product having been remembered. Those are different
     claims, and the dashboard makes both rather than letting the weaker one
     stand in for the stronger. */
  const [multiDay] = (await sql`
    select count(*)::int as n from (
      select device_id
        from conversations
       where (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
         and (${until}::timestamptz is null or created_at <  ${until}::timestamptz)
       group by device_id
      having count(distinct (created_at at time zone ${ZONE})::date) > 1
    ) t
  `) as Row[];

  return {
    conversations: int(row?.conversations),
    devices: int(row?.devices),
    messages: int(row?.messages),
    returningDevices: int(repeat?.n),
    multiDayDevices: int(multiDay?.n),
  };
}

export async function usageTotals(
  sql: Sql,
  since: string | null,
  previousSince: string | null,
): Promise<UsageTotals> {
  const [now, before] = await Promise.all([
    totalsFor(sql, since, null),
    // With no lower bound there is no "period before", so the comparison is
    // against nothing and every delta would read as new. That is the honest
    // answer for an all-time view, not a bug to paper over with a baseline.
    since ? totalsFor(sql, previousSince, since) : Promise.resolve(null),
  ]);

  const pair = (key: keyof typeof now): Delta => ({
    now: now[key],
    before: before ? before[key] : 0,
  });

  return {
    conversations: pair("conversations"),
    devices: pair("devices"),
    messages: pair("messages"),
    returningDevices: pair("returningDevices"),
    multiDayDevices: pair("multiDayDevices"),
  };
}

export async function dailyUsage(sql: Sql, since: string | null): Promise<DailyRow[]> {
  const rows = (await sql`
    select to_char(created_at at time zone ${ZONE}, 'YYYY-MM-DD') as day,
           count(*)::int                                          as threads,
           count(distinct device_id)::int                         as devices
      from conversations
     where (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
     group by 1
     order by 1
  `) as Row[];
  return rows.map((r) => ({ day: str(r.day), threads: int(r.threads), devices: int(r.devices) }));
}

/**
 * New devices against returning ones, per day.
 *
 * "New" is measured against the whole table, not against the window: a device
 * that first appeared in June and came back today is returning, and a window
 * that starts last week has no business calling it new. That is why `firsts`
 * carries no date predicate while `active` does.
 */
export async function newVersusReturning(
  sql: Sql,
  since: string | null,
): Promise<NewReturningRow[]> {
  const rows = (await sql`
    with firsts as (
      select device_id, min(created_at) as first_at
        from conversations
       group by device_id
    ),
    active as (
      select distinct device_id, (created_at at time zone ${ZONE})::date as day
        from conversations
       where (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
    )
    select to_char(a.day, 'YYYY-MM-DD') as day,
           count(*) filter (where (f.first_at at time zone ${ZONE})::date = a.day)::int as fresh,
           count(*) filter (where (f.first_at at time zone ${ZONE})::date < a.day)::int as returning
      from active a
      join firsts f using (device_id)
     group by a.day
     order by a.day
  `) as Row[];
  return rows.map((r) => ({ day: str(r.day), fresh: int(r.fresh), returning: int(r.returning) }));
}

/** Weekday against hour, in IST. Sunday is 0, matching Postgres `dow`. */
export async function activityHeat(sql: Sql, since: string | null): Promise<HeatCell[]> {
  const rows = (await sql`
    select extract(dow  from created_at at time zone ${ZONE})::int as dow,
           extract(hour from created_at at time zone ${ZONE})::int as hour,
           count(*)::int                                           as n
      from conversations
     where (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
     group by 1, 2
  `) as Row[];
  return rows.map((r) => ({ dow: int(r.dow), hour: int(r.hour), n: int(r.n) }));
}

/**
 * How deep a thread went.
 *
 * The most important distribution here. A turn is a user message and a reply,
 * so two messages is one question and out, and four is somebody who asked a
 * second thing. The share of threads sitting at two is the share of readers the
 * product answered once and did not hold.
 */
export async function threadDepth(sql: Sql, since: string | null): Promise<DepthRow[]> {
  const rows = (await sql`
    select message_count::int as messages, count(*)::int as threads
      from conversations
     where (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
     group by 1
     order by 1
  `) as Row[];
  return rows.map((r) => ({ messages: int(r.messages), threads: int(r.threads) }));
}

/**
 * What each reply actually was.
 *
 * The `case` reproduces `kindOf` in `lib/chat/turn.ts`, with one correction it
 * cannot make for itself: `kindOf` is only ever called on turns that render a
 * card, so its fallthrough treats a message with no `empty` flag as a record —
 * right for a restoration, wrong for a plain conversational reply. Those are
 * caught first here, by mode, before the flag translation runs. Getting it
 * backwards would have counted every follow-up reply as a successful
 * restoration and inflated the hit rate accordingly.
 */
export async function turnKinds(sql: Sql, since: string | null): Promise<KindRow[]> {
  const rows = (await sql`
    select case
             when m->>'kind' is not null      then m->>'kind'
             when m->>'mode' = 'conversation' then 'conversation'
             when m->>'mode' = 'indianize'    then 'foreign'
             when coalesce((m->>'empty')::boolean, false) = false then 'record'
             when coalesce((m->>'modern')::boolean, false)        then 'modern'
             else 'gap'
           end           as kind,
           count(*)::int as n
      from conversations c,
           lateral jsonb_array_elements(c.data->'messages') m
     where m->>'role' = 'assistant'
       and (${since}::timestamptz is null or c.created_at >= ${since}::timestamptz)
     group by 1
     order by n desc
  `) as Row[];
  return rows.map((r) => ({ kind: str(r.kind), n: int(r.n) }));
}

/** Replies that ended in an apology instead of an answer. */
export async function errorCount(sql: Sql, since: string | null): Promise<number> {
  const [row] = (await sql`
    select count(*)::int as n
      from conversations c,
           lateral jsonb_array_elements(c.data->'messages') m
     where m->>'role' = 'assistant'
       and m->>'error' is not null
       and (${since}::timestamptz is null or c.created_at >= ${since}::timestamptz)
  `) as Row[];
  return int(row?.n);
}

/**
 * Weekly cohorts, and whether each came back.
 *
 * Daily cohorts at this volume are single-digit rows where one person moves the
 * rate twenty points, so the grain is a week. Column N reads "devices from this
 * cohort that started a thread in week N after their first", which is the only
 * retention question a product with no accounts can honestly answer.
 *
 * Deliberately not windowed. A cohort table filtered to the last seven days
 * would show every cohort as fully retained, because the only devices left in
 * it are the ones that came back.
 */
export async function cohorts(sql: Sql): Promise<CohortRow[]> {
  const rows = (await sql`
    with firsts as (
      select device_id,
             date_trunc('week', min(created_at) at time zone ${ZONE})::date as cohort
        from conversations
       group by device_id
    ),
    activity as (
      select f.cohort,
             c.device_id,
             (date_trunc('week', c.created_at at time zone ${ZONE})::date - f.cohort) / 7 as week
        from conversations c
        join firsts f using (device_id)
    )
    select to_char(cohort, 'YYYY-MM-DD')  as cohort,
           week::int                      as week,
           count(distinct device_id)::int as devices
      from activity
     where week >= 0 and week <= 6
     group by 1, 2
     order by 1, 2
  `) as Row[];

  const byCohort = new Map<string, CohortRow>();
  for (const r of rows) {
    const key = str(r.cohort);
    const week = int(r.week);
    const entry = byCohort.get(key) ?? { cohort: key, size: 0, retained: [] };
    entry.retained[week] = int(r.devices);
    if (week === 0) entry.size = int(r.devices);
    byCohort.set(key, entry);
  }

  return [...byCohort.values()]
    .map((c) => ({ ...c, retained: Array.from({ length: 7 }, (_, i) => c.retained[i] ?? 0) }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort));
}
