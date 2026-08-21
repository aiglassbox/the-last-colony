import type { NeonQueryFunction } from "@neondatabase/serverless";

import { isMissingTable } from "@/lib/email/schema";

import type { AttributionRow, EventTotals, FunnelStage, GeoPanel } from "../types";

/**
 * The half of the picture the thread mirror cannot see.
 *
 * Everything in `usage.ts` starts at the first keystroke. These start at the
 * arrival, which is where the two questions that actually decide a campaign
 * live: how many people came, and which placement sent the ones who stayed.
 *
 * Every function here tolerates the table not existing. A deployment that has
 * not run `npm run db:migrate` yet should show a dashboard with an empty
 * events panel and a note saying so — not a 500 on a page whose other twenty
 * panels are fine.
 */

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

const int = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

async function tolerant<T>(work: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTable(error)) return fallback;
    console.error(`[kitchen] ${label} failed:`, error);
    return fallback;
  }
}

/** Whether there is anything in the log yet, which decides how the panel reads. */
export function eventsPresent(sql: Sql, since: string | null): Promise<boolean> {
  return tolerant(
    async () => {
      const [row] = (await sql`
        select count(*)::int as n
          from analytics_events
         where (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
         limit 1
      `) as Row[];
      return int(row?.n) > 0;
    },
    false,
    "eventsPresent",
  );
}

export function eventTotals(sql: Sql, since: string | null): Promise<EventTotals[]> {
  return tolerant(
    async () => {
      const rows = (await sql`
        select event,
               count(*)::int                   as n,
               count(distinct device_id)::int  as devices
          from analytics_events
         where (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
         group by event
         order by n desc
      `) as Row[];
      return rows.map((r) => ({ event: str(r.event), n: int(r.n), devices: int(r.devices) }));
    },
    [],
    "eventTotals",
  );
}

/**
 * Which placement paid for which visit, and what came of it.
 *
 * `converted` is the column worth reading, and it is the reason this joins to
 * `conversations` rather than counting a second event: a source that sends a
 * thousand visits and no threads is a source that is buying the wrong people,
 * and no event in the log says that as plainly as its absence from the mirror
 * does. The join is on the device id, which both sides now carry.
 *
 * `(direct)` is a real row, not a null to be filtered out. A campaign that
 * cannot see how much of its traffic arrived unlabelled is reading a fraction
 * and calling it the whole.
 */
export function attribution(sql: Sql, since: string | null): Promise<AttributionRow[]> {
  return tolerant(
    async () => {
      const rows = (await sql`
        select coalesce(nullif(e.utm_source, ''),   '(direct)') as source,
               coalesce(nullif(e.utm_medium, ''),   '—')        as medium,
               coalesce(nullif(e.utm_campaign, ''), '—')        as campaign,
               count(*)::int                                    as visits,
               count(distinct e.device_id)::int                 as devices,
               count(distinct e.device_id) filter (
                 where exists (
                   select 1 from conversations c where c.device_id = e.device_id
                 )
               )::int                                           as converted
          from analytics_events e
         where e.event = 'visit'
           and (${since}::timestamptz is null or e.occurred_at >= ${since}::timestamptz)
         group by 1, 2, 3
         order by visits desc
         limit 25
      `) as Row[];
      return rows.map((r) => ({
        source: str(r.source),
        medium: str(r.medium),
        campaign: str(r.campaign),
        visits: int(r.visits),
        devices: int(r.devices),
        converted: int(r.converted),
      }));
    },
    [],
    "attribution",
  );
}

/**
 * Arrival to answer to advocacy, counted in devices rather than in events.
 *
 * Devices because that is what a conversion rate means. Counting events would
 * let one enthusiastic reader who opened nine source drawers outrank ten
 * readers who each opened one, and the stage would then measure enthusiasm
 * instead of reach.
 *
 * The stages narrow strictly, which is what makes the shape readable, but they
 * are not nested subsets by construction — a device with storage disabled can
 * appear at a later stage without a `visit` row. At this volume the effect is
 * small; the note under each bar says what it counts so nobody has to guess.
 */
export function deviceFunnel(sql: Sql, since: string | null): Promise<FunnelStage[]> {
  return tolerant(
    async () => {
      const [row] = (await sql`
        select
          count(distinct device_id) filter (where event = 'visit')::int          as arrived,
          count(distinct device_id) filter (where event = 'dish_queried')::int   as asked,
          count(distinct device_id) filter (where event = 'dish_restored')::int  as restored,
          count(distinct device_id) filter (
            where event = 'source_drawer_opened')::int                           as checked,
          count(distinct device_id) filter (where event = 'card_shared')::int    as shared
        from analytics_events
       where device_id is not null
         and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
      `) as Row[];

      return [
        { label: "Arrived", n: int(row?.arrived), note: "opened the page" },
        { label: "Named a dish", n: int(row?.asked), note: "typed something" },
        { label: "Got a restoration", n: int(row?.restored), note: "a card built from a record" },
        { label: "Checked the sources", n: int(row?.checked), note: "opened the source drawer" },
        { label: "Shared a card", n: int(row?.shared), note: "tapped share" },
      ];
    },
    [],
    "deviceFunnel",
  );
}

/**
 * Where the readers actually are.
 *
 * Counted in devices rather than in events, for the reason the funnel is: one
 * person asking nine questions from Pune is not nine people in Pune.
 *
 * The zone count at the bottom is the one that earns its place. Every bucket on
 * this dashboard — every daily bar, the whole weekday-by-hour heatmap — is cut
 * in IST, and that is an assumption nothing until now could check. If a
 * meaningful share of readers turn out to be in the Gulf or North America, the
 * evening peak the heatmap shows is two different evenings averaged together,
 * and the honest fix is to say so rather than to keep drawing one curve.
 *
 * Geography starts at the deploy that added it and nothing before it can be
 * filled in: there is no stored address anywhere to derive a country from after
 * the fact. That is the cost of never having stored addresses, and it is the
 * right cost to have paid.
 */
export function geography(sql: Sql, since: string | null): Promise<GeoPanel> {
  const empty: GeoPanel = { countries: [], cities: [], inIndia: 0, located: 0 };
  return tolerant(
    async () => {
      const countries = (await sql`
        select country                        as label,
               count(distinct device_id)::int as n
          from analytics_events
         where country is not null
           and device_id is not null
           and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
         group by country
         order by n desc, country
         limit 15
      `) as Row[];

      const cities = (await sql`
        select city || coalesce(', ' || country, '') as label,
               count(distinct device_id)::int        as n
          from analytics_events
         where city is not null
           and device_id is not null
           and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
         group by 1
         order by n desc, 1
         limit 12
      `) as Row[];

      const [zones] = (await sql`
        select count(distinct device_id) filter (
                 where timezone = 'Asia/Kolkata')::int as in_india,
               count(distinct device_id)::int          as located
          from analytics_events
         where timezone is not null
           and device_id is not null
           and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
      `) as Row[];

      return {
        countries: countries.map((r) => ({ label: str(r.label), n: int(r.n) })),
        cities: cities.map((r) => ({ label: str(r.label), n: int(r.n) })),
        inIndia: int(zones?.in_india),
        located: int(zones?.located),
      };
    },
    empty,
    "geography",
  );
}
