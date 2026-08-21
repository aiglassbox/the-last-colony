import type { NeonQueryFunction } from "@neondatabase/serverless";

import type { AskedRow, Counted, ProvenanceRow, SlugRow } from "../types";

/**
 * What people came here wanting.
 *
 * This is the half of the dashboard that is not a vanity metric. The corpus is
 * 199 records against a cuisine of lakhs of dishes, and the only principled way
 * to choose the next two hundred is to read what was asked for and not found.
 * Three lists come out of here and they are answers to three different
 * questions:
 *
 *   asked   — what people typed, whether or not it landed. Demand.
 *   gaps    — Indian dishes the model judged worth restoring and we hold no
 *             record for. The corpus roadmap, in priority order.
 *   foreign — dishes that are not Indian in origin, so there is nothing to
 *             restore. Not a gap; a signal about what the Indianise mode is
 *             being asked to do.
 *
 * Conflating the second and the third is the mistake this file exists to avoid.
 * Adding a pizza record would not close a gap, because there was never an
 * ancient original to record.
 */

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

const int = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

/**
 * Fold the spellings of one dish together.
 *
 * Only exact plural pairs are merged — a key that is another key plus "s" or
 * "es", and nothing cleverer. A stemmer would fold "rice" and "rich", and a
 * hand-maintained synonym list would be stale within a week of launch. The
 * variants that were merged are carried on the row so the page can show them,
 * because a reader who sees "idli · 13" is entitled to know that two of those
 * were typed "idlis".
 */
function foldPlurals(rows: { label: string; n: number }[]): AskedRow[] {
  const counts = new Map<string, number>(rows.map((r) => [r.label, r.n]));
  const merged = new Map<string, AskedRow>();

  for (const { label, n } of rows) {
    const singular = ["s", "es"]
      .map((suffix) => (label.endsWith(suffix) ? label.slice(0, -suffix.length) : null))
      .find((candidate) => candidate && counts.has(candidate));

    const key = singular ?? label;
    const entry = merged.get(key) ?? { label: key, n: 0, variants: [] };
    entry.n += n;
    if (label !== key) entry.variants.push(label);
    merged.set(key, entry);
  }

  return [...merged.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

/**
 * The first thing typed in each thread, cleaned up.
 *
 * The first user message rather than `title`, because `deriveTitle` title-cases
 * the dish and appends the slash command — presentation the reader did not
 * type. The slash command is stripped here for the same reason: `/recipe-card
 * kheer` and `kheer` are the same demand, expressed through different doors.
 */
export async function mostAsked(sql: Sql, since: string | null, limit = 15): Promise<AskedRow[]> {
  const rows = (await sql`
    select label, count(*)::int as n from (
      select btrim(
               regexp_replace(
                 regexp_replace(
                   lower(btrim((c.data->'messages'->0)->>'text')),
                   '^/[a-z-]+\\s*', ''           -- the command, not the dish
                 ),
                 '\\s+', ' ', 'g'                -- collapse runs of whitespace
               ),
               ' .,!?'
             ) as label
        from conversations c
       where (c.data->'messages'->0)->>'role' = 'user'
         and (${since}::timestamptz is null or c.created_at >= ${since}::timestamptz)
    ) t
     where label <> ''
       and length(label) <= 60
     group by label
     order by n desc, label
     limit ${limit * 3}
  `) as Row[];

  return foldPlurals(rows.map((r) => ({ label: str(r.label), n: int(r.n) }))).slice(0, limit);
}

/**
 * Queries by the verdict they got.
 *
 * `query` is written onto the reply by the chat route and is what the reader
 * asked for, carried forward — which is why it is read here rather than the
 * user message beside it. On a follow-up turn the two differ, and it is the
 * dish the turn was about that belongs in a demand list.
 */
async function askedByKind(
  sql: Sql,
  since: string | null,
  kind: string,
  limit: number,
): Promise<AskedRow[]> {
  const rows = (await sql`
    select btrim(lower(m->>'query')) as label, count(*)::int as n
      from conversations c,
           lateral jsonb_array_elements(c.data->'messages') m
     where m->>'role' = 'assistant'
       and m->>'kind' = ${kind}
       and m->>'query' is not null
       and btrim(m->>'query') <> ''
       and (${since}::timestamptz is null or c.created_at >= ${since}::timestamptz)
     group by 1
     order by n desc, 1
     limit ${limit * 3}
  `) as Row[];

  return foldPlurals(rows.map((r) => ({ label: str(r.label), n: int(r.n) }))).slice(0, limit);
}

/** Indian dishes with no record behind them. The corpus roadmap. */
export function corpusGaps(sql: Sql, since: string | null, limit = 15): Promise<AskedRow[]> {
  return askedByKind(sql, since, "gap", limit);
}

/** Dishes that are not Indian in origin. Demand on the Indianise mode. */
export function foreignAsks(sql: Sql, since: string | null, limit = 15): Promise<AskedRow[]> {
  return askedByKind(sql, since, "foreign", limit);
}

/** Which records actually get served, and how strong their evidence is. */
export async function topRecords(sql: Sql, since: string | null, limit = 15): Promise<SlugRow[]> {
  const rows = (await sql`
    select r->>'slug'             as slug,
           r->>'provenance_class' as provenance,
           count(*)::int          as n
      from conversations c,
           lateral jsonb_array_elements(c.data->'messages') m,
           lateral jsonb_array_elements(m->'records') r
     where r->>'slug' is not null
       and (${since}::timestamptz is null or c.created_at >= ${since}::timestamptz)
     group by 1, 2
     order by n desc, 1
     limit ${limit}
  `) as Row[];
  return rows.map((r) => ({
    slug: str(r.slug),
    provenance: str(r.provenance) || "UNKNOWN",
    n: int(r.n),
  }));
}

/**
 * The evidentiary mix of everything served.
 *
 * Worth watching for one reason above the others: the campaign's whole claim is
 * that these dishes are documented, and a mix drifting toward RECONSTRUCTED is
 * the claim getting thinner without anyone deciding that it should.
 */
export async function provenanceMix(sql: Sql, since: string | null): Promise<ProvenanceRow[]> {
  const rows = (await sql`
    select r->>'provenance_class' as provenance, count(*)::int as n
      from conversations c,
           lateral jsonb_array_elements(c.data->'messages') m,
           lateral jsonb_array_elements(m->'records') r
     where r->>'provenance_class' is not null
       and (${since}::timestamptz is null or c.created_at >= ${since}::timestamptz)
     group by 1
     order by n desc
  `) as Row[];
  return rows.map((r) => ({ provenance: str(r.provenance), n: int(r.n) }));
}

/**
 * Slash-command use, read off the title suffix `deriveTitle` appends.
 *
 * A weak measure and labelled as one on the page: it sees the command only when
 * it opened the thread. It is still the only evidence there is about whether
 * anybody found these at all.
 */
export async function commandUse(sql: Sql, since: string | null): Promise<Counted[]> {
  const rows = (await sql`
    select btrim(split_part(title, ' · ', 2)) as label, count(*)::int as n
      from conversations
     where title like '% · %'
       and (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
     group by 1
     order by n desc
     limit 12
  `) as Row[];
  return rows.map((r) => ({ label: str(r.label), n: int(r.n) }));
}
