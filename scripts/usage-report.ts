/**
 * What the thread mirror can tell us about usage.
 *
 *   npm run report:usage
 *
 * Read-only. Every statement here is a SELECT, so this is safe to point at
 * production, which is the only place the data lives.
 *
 * Why this table and not the logs: `track()` writes to stdout, and a
 * deployment's stdout is a live tail rather than a store — whatever scrolled
 * past is gone. `conversations` is the one thing the product has been keeping
 * since the mirror shipped, and it carries `created_at`, `device_id` and the
 * reader's own words in `title`.
 *
 * What it is NOT: a visitor count. A reader who lands, reads the hero and
 * leaves writes no row, so every number below counts people who typed
 * something. Treat it as a floor on traffic and an exact count of use.
 */
import "dotenv/config";

import { neon } from "@neondatabase/serverless";

function bar(n: number, max: number, width = 28): string {
  if (max <= 0) return "";
  return "█".repeat(Math.max(1, Math.round((n / max) * width)));
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.Last_Colony_DATABASE_URL;
  if (!url) {
    console.error(
      "No DATABASE_URL.\n" +
        "  npx vercel login && npx vercel link && npx vercel env pull .env.local\n" +
        "then run this again.",
    );
    process.exit(1);
  }

  const sql = neon(url);

  const [totals] = await sql`
    select
      count(*)::int                        as conversations,
      count(distinct device_id)::int       as devices,
      coalesce(sum(message_count), 0)::int as messages,
      min(created_at)                      as first_seen,
      max(updated_at)                      as last_seen
    from conversations
  `;

  console.log("\n  THE KRANTI COOKBOOK — usage from the thread mirror\n");
  if (totals.conversations === 0) {
    console.log("  No conversations stored yet.\n");
    return;
  }

  const days =
    Math.max(
      1,
      Math.round(
        (new Date(totals.last_seen).getTime() - new Date(totals.first_seen).getTime()) / 86_400_000,
      ),
    ) + 1;

  console.log(`  Devices .............. ${totals.devices}`);
  console.log(`  Conversations ........ ${totals.conversations}`);
  console.log(`  Messages ............. ${totals.messages}`);
  console.log(
    `  Per conversation ..... ${(totals.messages / totals.conversations).toFixed(1)} messages`,
  );
  console.log(
    `  Per device ........... ${(totals.conversations / totals.devices).toFixed(1)} conversations`,
  );
  console.log(`  Covering ............. ${days} day${days === 1 ? "" : "s"}`);
  console.log(
    `  First ................ ${new Date(totals.first_seen).toISOString().slice(0, 16).replace("T", " ")}`,
  );
  console.log(
    `  Latest ............... ${new Date(totals.last_seen).toISOString().slice(0, 16).replace("T", " ")}\n`,
  );

  // A device that came back is the number worth watching: one conversation is
  // a click on an ad, two is the product having worked.
  const [repeat] = await sql`
    select count(*)::int as returning from (
      select device_id from conversations group by device_id having count(*) > 1
    ) t
  `;
  console.log(
    `  Devices that started more than one thread: ${repeat.returning} of ${totals.devices}\n`,
  );

  const daily = await sql`
    select to_char(created_at, 'YYYY-MM-DD') as day,
           count(*)::int as threads,
           count(distinct device_id)::int as devices
    from conversations
    where created_at > now() - interval '30 days'
    group by 1 order by 1
  `;
  if (daily.length) {
    const peak = Math.max(...daily.map((d) => Number(d.threads)));
    console.log("  BY DAY (last 30)\n");
    for (const d of daily) {
      console.log(
        `    ${d.day}  ${String(d.threads).padStart(4)} threads  ${String(d.devices).padStart(3)} devices  ${bar(d.threads, peak)}`,
      );
    }
    console.log();
  }

  // The titles are derived from the reader's first message, so this is the
  // dish list in their own words — the closest thing to a search log.
  const asked = await sql`
    select title, count(*)::int as n
    from conversations
    where message_count > 0
    group by title order by n desc, title asc limit 25
  `;
  if (asked.length) {
    console.log("  MOST ASKED\n");
    for (const a of asked) {
      console.log(`    ${String(a.n).padStart(4)} x  ${a.title}`);
    }
    console.log();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
