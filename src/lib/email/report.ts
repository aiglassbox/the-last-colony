import type { NeonQueryFunction } from "@neondatabase/serverless";

import { CAMPAIGN } from "./schema";

/**
 * The campaign's numbers, and the one place they are computed.
 *
 * Two surfaces read this — the CLI script for whoever holds a connection
 * string, and the token-guarded route for whoever does not. They must agree,
 * and the only way to guarantee that is for them to share both the queries and
 * the formatter rather than each keeping their own copy.
 */

export interface EmailReport {
  perCode: { code: string | null; uniqueClickers: number; totalClicks: number }[];
  clickers: number;
  opens: number;
  suppressed: number;
  split: { kind: string; isAutomated: boolean; n: number }[];
  tokens: { tid: string; links: string; clicks: number }[] | null;
}

export async function readReport(
  sql: NeonQueryFunction<false, false>,
  { includeTokens = false }: { includeTokens?: boolean } = {},
): Promise<EmailReport> {
  const perCode = await sql`
    select code,
           count(distinct tid)::int as unique_clickers,
           count(*)::int            as total_clicks
      from email_events
     where campaign = ${CAMPAIGN} and kind = 'click'
       and is_automated = false and tid is not null
     group by code
     order by unique_clickers desc
  `;

  const [clickers] = await sql`
    select count(distinct tid)::int as people
      from email_events
     where campaign = ${CAMPAIGN} and kind = 'click'
       and is_automated = false and tid is not null
  `;

  const split = await sql`
    select kind, is_automated, count(*)::int as n
      from email_events
     where campaign = ${CAMPAIGN}
     group by kind, is_automated
     order by kind, is_automated
  `;

  const [opens] = await sql`
    select count(distinct tid)::int as people
      from email_events
     where campaign = ${CAMPAIGN} and kind = 'open'
       and is_automated = false and tid is not null
  `;

  const [suppressed] = await sql`
    select count(*)::int as n from email_suppressions where campaign = ${CAMPAIGN}
  `;

  const tokens = includeTokens
    ? await sql`
        select tid,
               string_agg(distinct code, ', ' order by code) as links,
               count(*)::int                                 as clicks
          from email_events
         where campaign = ${CAMPAIGN} and kind = 'click'
           and is_automated = false and tid is not null
         group by tid
         order by count(distinct code) desc, min(occurred_at)
      `
    : null;

  return {
    perCode: perCode.map((r) => ({
      code: r.code as string | null,
      uniqueClickers: r.unique_clickers as number,
      totalClicks: r.total_clicks as number,
    })),
    clickers: clickers.people as number,
    opens: opens.people as number,
    suppressed: suppressed.n as number,
    split: split.map((r) => ({
      kind: r.kind as string,
      isAutomated: r.is_automated as boolean,
      n: r.n as number,
    })),
    tokens: tokens
      ? tokens.map((r) => ({
          tid: r.tid as string,
          links: r.links as string,
          clicks: r.clicks as number,
        }))
      : null,
  };
}

const pad = (v: string | number, w: number) => String(v).padEnd(w);
const heading = (t: string) => `\n${t}\n${"-".repeat(t.length)}`;

/** Plain text, so it reads the same in a terminal and in a browser tab. */
export function formatReport(report: EmailReport, sent: number): string {
  const out: string[] = ["The Kranti Cookbook — launch email"];

  out.push(heading("Clicks per link (humans only)"));
  if (report.perCode.length === 0) {
    out.push("no human clicks recorded yet");
  } else {
    out.push(`${pad("link", 12)}${pad("people", 10)}clicks`);
    for (const r of report.perCode) {
      out.push(`${pad(r.code ?? "(none)", 12)}${pad(r.uniqueClickers, 10)}${r.totalClicks}`);
    }
  }

  out.push(heading("Click-through rate"));
  const rate = sent > 0 ? ((report.clickers * 100) / sent).toFixed(2) : "0.00";
  out.push(`${report.clickers} of ${sent} sent clicked something — ${rate}%`);

  out.push(heading("Automated versus human"));
  if (report.split.length === 0) {
    out.push("no events recorded yet");
  } else {
    out.push(`${pad("kind", 10)}${pad("source", 12)}events`);
    for (const r of report.split) {
      out.push(`${pad(r.kind, 10)}${pad(r.isAutomated ? "automated" : "human", 12)}${r.n}`);
    }
    const bots = report.split.filter((r) => r.isAutomated).reduce((a, r) => a + r.n, 0);
    const all = report.split.reduce((a, r) => a + r.n, 0);
    out.push(`\n${all > 0 ? ((bots * 100) / all).toFixed(1) : "0.0"}% of all traffic was automated.`);
    if (all > 0 && bots / all > 0.7) {
      out.push("That is high enough that the filter should be checked before");
      out.push("these numbers are reported anywhere.");
    }
  }

  out.push(heading("Opens"));
  out.push(`${report.opens} token${report.opens === 1 ? "" : "s"} registered a human-looking open.`);
  out.push("Treat as a floor, not a count: image blocking hides opens and");
  out.push("proxies manufacture them. Clicks are the number to report.");

  out.push(heading("Unsubscribes"));
  out.push(`${report.suppressed} token${report.suppressed === 1 ? "" : "s"} suppressed.`);

  if (report.tokens) {
    out.push(heading("Per token (VLOOKUP against the TID column in the contact sheet)"));
    if (report.tokens.length === 0) {
      out.push("no human clicks recorded yet");
    } else {
      out.push(`${pad("tid", 20)}${pad("clicks", 8)}links`);
      for (const r of report.tokens) {
        out.push(`${pad(r.tid, 20)}${pad(r.clicks, 8)}${r.links}`);
      }
      const hot = report.tokens.filter((r) => r.links.includes(","));
      out.push(`\n${hot.length} clicked more than one thing — the follow-up list.`);
    }
  }

  return `${out.join("\n")}\n`;
}
