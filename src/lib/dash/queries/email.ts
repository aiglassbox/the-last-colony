import type { NeonQueryFunction } from "@neondatabase/serverless";

import { CAMPAIGN, isMissingTable } from "@/lib/email/schema";

import { ZONE } from "../range";
import type { EmailPanel } from "../types";

/**
 * The launch email, as the dashboard shows it.
 *
 * `lib/email/report.ts` already computes these for the CLI and the token
 * route, and this does not replace it — that report answers "how did the send
 * do", once, in a fixed shape, and is the thing whoever ran the campaign
 * quotes. This one is windowed and has a daily series, because a dashboard
 * asks a different question: not how the send did, but what it is still doing
 * three weeks later.
 *
 * The bot split is kept rather than silently filtered. Mail security
 * appliances open and click every link within seconds of delivery, and a click
 * rate that quietly includes them is fiction — but a dashboard that hides the
 * filtered rows leaves nobody able to check the filter is working.
 */

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

const int = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

const EMPTY: EmailPanel = {
  clicks: 0,
  opens: 0,
  uniqueClickers: 0,
  uniqueOpeners: 0,
  automated: 0,
  suppressed: 0,
  perCode: [],
  daily: [],
};

export async function emailPanel(sql: Sql, since: string | null): Promise<EmailPanel> {
  try {
    const [totals] = (await sql`
      select
        count(*) filter (where kind = 'click' and is_automated = false)::int as clicks,
        count(*) filter (where kind = 'open'  and is_automated = false)::int as opens,
        count(distinct tid) filter (
          where kind = 'click' and is_automated = false and tid is not null)::int as unique_clickers,
        count(distinct tid) filter (
          where kind = 'open'  and is_automated = false and tid is not null)::int as unique_openers,
        count(*) filter (where is_automated)::int as automated
      from email_events
     where campaign = ${CAMPAIGN}
       and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
    `) as Row[];

    /* Suppressions are never windowed. An unsubscribe is a standing
       instruction, not an event that ages out, and the number that matters is
       how many people are on the list — not how many joined it last week. */
    const [suppressed] = (await sql`
      select count(*)::int as n from email_suppressions where campaign = ${CAMPAIGN}
    `) as Row[];

    const perCode = (await sql`
      select coalesce(code, '(none)')  as label,
             count(distinct tid)::int  as n
        from email_events
       where campaign = ${CAMPAIGN}
         and kind = 'click'
         and is_automated = false
         and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
       group by 1
       order by n desc
       limit 10
    `) as Row[];

    const daily = (await sql`
      select to_char(occurred_at at time zone ${ZONE}, 'YYYY-MM-DD')         as day,
             count(*) filter (where kind = 'click')::int                    as clicks,
             count(*) filter (where kind = 'open')::int                     as opens
        from email_events
       where campaign = ${CAMPAIGN}
         and is_automated = false
         and (${since}::timestamptz is null or occurred_at >= ${since}::timestamptz)
       group by 1
       order by 1
    `) as Row[];

    return {
      clicks: int(totals?.clicks),
      opens: int(totals?.opens),
      uniqueClickers: int(totals?.unique_clickers),
      uniqueOpeners: int(totals?.unique_openers),
      automated: int(totals?.automated),
      suppressed: int(suppressed?.n),
      perCode: perCode.map((r) => ({ label: str(r.label), n: int(r.n) })),
      daily: daily.map((r) => ({ day: str(r.day), clicks: int(r.clicks), opens: int(r.opens) })),
    };
  } catch (error) {
    if (isMissingTable(error)) return EMPTY;
    console.error("[kitchen] emailPanel failed:", error);
    return EMPTY;
  }
}
