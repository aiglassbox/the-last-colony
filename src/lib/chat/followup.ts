import type { QueryAsks } from "@/lib/lang/types";

import type { ChatMessage } from "./store";

/**
 * One card per dish, per thread.
 *
 * A thread's first answer is a card, and so is every explicit ask for one — a
 * mailroom link, a quick-action pill, a dish page. After that, a dish that has
 * had its card is talked about in chat, and a new dish gets a card only when
 * the message asks for it: "how is this different from pongal?" mentions
 * pongal, it does not ask for it.
 *
 * "Has had its card" is checked by id — a corpus record's or a submission's —
 * so it is exact for every dish that has one. A pizza has neither, and that
 * one is left to the resolve prompt. The browser sends the ids (`cardedIds`)
 * because the thread lives on the device; the server only ever sees its text.
 */

/** Ids of what this thread has already shown on a card, newest first. */
export interface Carded {
  records: string[];
  community: string[];
}

/** The same cap the route puts on records carried onto a prompt. */
export const MAX_CARDED_RECORDS = 6;
/** Each one is an Atlas read on a follow-up, and a reader recipe can run to thousands of characters. */
export const MAX_CARDED_COMMUNITY = 3;

const SUBMISSION_ID = /^[0-9a-f]{24}$/i;

export interface TurnFacts {
  /** The thread already has an assistant turn. */
  midThread: boolean;
  /** A pill or a dish page: the reader asked for a card outright. */
  explicit: boolean;
  asks: QueryAsks;
}

/**
 * Whether this turn may draw a card. `matchedId` is the record or submission
 * the message matched, or null when it matched neither — a card is then still
 * possible, and the resolve step decides.
 */
export function drawsCard(facts: TurnFacts, matchedId: string | null, carded: string[]): boolean {
  if (!facts.midThread || facts.explicit) return true;
  if (facts.asks === "question") return false;
  return matchedId === null || !carded.includes(matchedId);
}

/**
 * What the thread has carded, read off its stored messages. A chat turn's
 * records were carried, not carded, so only card modes count. Threads saved
 * before this existed already carry `records` and `community`.
 */
export function cardedIds(messages: ChatMessage[]): Carded {
  const records: string[] = [];
  const community: string[] = [];
  for (const m of [...messages].reverse()) {
    if (m.role !== "assistant") continue;
    if (m.mode === "community" && m.community) community.push(m.community.id);
    else if (m.mode === "restoration") records.push(...(m.records ?? []).map((r) => r.id));
  }
  return {
    records: [...new Set(records)].slice(0, MAX_CARDED_RECORDS),
    community: [...new Set(community)].slice(0, MAX_CARDED_COMMUNITY),
  };
}

/**
 * The request field, distrusted: anything not shaped like an id is dropped,
 * and the caps hold whatever the client sent. The ids only choose which
 * already-public recipes go on the prompt; the store still checks published.
 */
export function readCarded(value: unknown): Carded {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof Carded, unknown>>;
  const ids = (x: unknown, ok: (s: string) => boolean, max: number) =>
    [...new Set((Array.isArray(x) ? x : []).filter((s): s is string => typeof s === "string" && ok(s)))].slice(
      0,
      max,
    );
  return {
    records: ids(v.records, (s) => s.length > 0 && s.length <= 80, MAX_CARDED_RECORDS),
    community: ids(v.community, (s) => SUBMISSION_ID.test(s), MAX_CARDED_COMMUNITY),
  };
}
