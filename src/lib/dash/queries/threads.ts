import type { NeonQueryFunction } from "@neondatabase/serverless";

import type { Conversation } from "@/lib/chat/store";

import type { ThreadSummary } from "../types";

/**
 * The transcript reader.
 *
 * Aggregates say the corpus hit rate is 71%; they cannot say that the miss was
 * a reader asking about their grandmother's version of a dish we hold, in words
 * the retriever did not match. Only reading the thread says that, and that
 * class of failure is the one worth finding.
 *
 * Two limits are deliberate. Device ids are truncated to eight characters
 * before they leave the server: enough to tell one reader's threads from
 * another's on the page, not enough to carry away and use as a key against the
 * mirror, which serves anyone holding a full id. And the list is paged rather
 * than fetched whole — a conversation row carries entire corpus records in its
 * `data`, so two hundred of them is megabytes for a page that shows titles.
 */

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

const int = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

export const PAGE_SIZE = 30;

export interface ThreadQuery {
  since: string | null;
  /** Matched against the title and the reader's own words. Empty means everything. */
  search: string;
  page: number;
}

export async function listThreads(
  sql: Sql,
  { since, search, page }: ThreadQuery,
): Promise<{ rows: ThreadSummary[]; total: number }> {
  const term = search.trim();
  // `%` and `_` in a reader's search term would otherwise be wildcards, and a
  // search for "100%" would silently match everything.
  const pattern = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const offset = Math.max(0, page) * PAGE_SIZE;

  const [count] = (await sql`
    select count(*)::int as n
      from conversations
     where (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
       and (${pattern}::text is null
            or title ilike ${pattern}
            or data::text ilike ${pattern})
  `) as Row[];

  const rows = (await sql`
    select id,
           left(device_id, 8)                                as device,
           title,
           message_count::int                                as messages,
           to_char(created_at at time zone 'Asia/Kolkata',
                   'YYYY-MM-DD HH24:MI')                     as created_at,
           (
             select coalesce(jsonb_agg(distinct m->>'kind'), '[]'::jsonb)
               from jsonb_array_elements(data->'messages') m
              where m->>'kind' is not null
           )                                                 as kinds
      from conversations
     where (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
       and (${pattern}::text is null
            or title ilike ${pattern}
            or data::text ilike ${pattern})
     order by created_at desc
     limit ${PAGE_SIZE} offset ${offset}
  `) as Row[];

  return {
    total: int(count?.n),
    rows: rows.map((r) => ({
      id: str(r.id),
      device: str(r.device),
      title: str(r.title),
      messages: int(r.messages),
      createdAt: str(r.created_at),
      kinds: Array.isArray(r.kinds) ? (r.kinds as string[]) : [],
    })),
  };
}

/**
 * One thread, whole.
 *
 * Returns the stored `data` as-is rather than a projection of it. The reader
 * component wants the same shape the app renders — role, text, kind, the
 * records behind the card — and re-deriving a second message type here is a
 * second place for the two to drift.
 */
export async function readThread(sql: Sql, id: string): Promise<Conversation | null> {
  const rows = (await sql`select data from conversations where id = ${id} limit 1`) as Row[];
  return rows.length ? (rows[0].data as Conversation) : null;
}
