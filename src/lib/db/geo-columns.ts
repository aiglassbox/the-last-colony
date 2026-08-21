import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * The geography columns, and the one place they are defined.
 *
 * Both logs carry them and both must carry the identical set, so a second copy
 * is a second thing to forget. It lives here rather than in either schema file
 * for two reasons: neither log owns the concept, and `email/schema.ts` is
 * deliberately free of `@/` imports because the migration script reaches it
 * directly — a relative import from a neutral module is what keeps that true.
 *
 * `add column if not exists` rather than a migration framework. `db-migrate.ts`
 * says that the day one of these tables needed altering rather than creating
 * was the moment to reach for one, and for four nullable text columns the
 * answer is still no: this statement is idempotent and self-healing, which is
 * the whole of what a framework would buy. A change that needs ordering, a
 * backfill, or the ability to be undone is a different problem and should get
 * a real tool.
 *
 * Nullable with no default, on purpose. Every row written before this ran has
 * no geography and never will — nothing anywhere keeps an address to derive one
 * from after the fact, which is the price of not having stored addresses and a
 * price worth paying. A default would paper a guess over rows that genuinely do
 * not know.
 *
 * See `lib/events/geo.ts` for why a country is stored and an address is not.
 */

/**
 * A union rather than a string, because the table name is interpolated as an
 * identifier and Postgres has no placeholder for one. The type is what keeps
 * this from being the injection it otherwise looks like.
 */
export type GeoTable = "analytics_events" | "email_events";

export async function addGeoColumns(
  sql: NeonQueryFunction<false, false>,
  table: GeoTable,
): Promise<void> {
  if (table === "analytics_events") {
    await sql`alter table analytics_events add column if not exists country  text`;
    await sql`alter table analytics_events add column if not exists region   text`;
    await sql`alter table analytics_events add column if not exists city     text`;
    await sql`alter table analytics_events add column if not exists timezone text`;
    return;
  }
  await sql`alter table email_events add column if not exists country  text`;
  await sql`alter table email_events add column if not exists region   text`;
  await sql`alter table email_events add column if not exists city     text`;
  await sql`alter table email_events add column if not exists timezone text`;
}
