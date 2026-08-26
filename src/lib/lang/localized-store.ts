import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { CorpusRecord } from "@/lib/corpus/types";

import { buildLocalizeInput } from "./localize";
import { validateLocalizedCard, type LocalizedCard } from "./localized-card";
import type { SupportedLang } from "./types";

/**
 * The file-backed store for precomputed localized cards.
 *
 * `corpus/localized/<lang>/<slug>.json` — committed, reviewable, loaded at
 * request time with no model call. Every file carries a `sourceHash` over the
 * record's translatable fields so the build script can skip unchanged records
 * and a stale translation (record edited after localization) can be caught and
 * dropped to the English fallback.
 */

const DIR = resolve(process.cwd(), "corpus", "localized");

export function localizedPath(slug: string, lang: SupportedLang): string {
  return join(DIR, lang, `${slug}.json`);
}

/** Hash of exactly what gets translated, so only real changes re-trigger a call. */
export function sourceHash(record: CorpusRecord): string {
  return createHash("sha1").update(JSON.stringify(buildLocalizeInput(record))).digest("hex").slice(0, 16);
}

interface StoredCard extends LocalizedCard {
  sourceHash: string;
}

/** Write a localized card to disk (build script only). */
export function writeLocalized(record: CorpusRecord, card: LocalizedCard): void {
  const dir = join(DIR, card.lang);
  mkdirSync(dir, { recursive: true });
  const stored: StoredCard = { sourceHash: sourceHash(record), ...card };
  writeFileSync(localizedPath(record.slug, card.lang), JSON.stringify(stored, null, 2) + "\n");
}

/** The hash stored for a (slug, lang), or null if none is on disk. */
export function storedHash(slug: string, lang: SupportedLang): string | null {
  try {
    const parsed = JSON.parse(readFileSync(localizedPath(slug, lang), "utf8")) as { sourceHash?: unknown };
    return typeof parsed.sourceHash === "string" ? parsed.sourceHash : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, LocalizedCard | null>();

/**
 * The localized card for a record, or null (English fallback) when there is no
 * file, it is malformed, or it is stale — a `sourceHash` that no longer matches
 * the record means the corpus moved on, so the file is ignored until the script
 * is re-run. English is never a failure here, only the untranslated version.
 */
export function loadLocalized(record: CorpusRecord, lang: SupportedLang): LocalizedCard | null {
  const key = `${lang}:${record.slug}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let card: LocalizedCard | null = null;
  try {
    const parsed = JSON.parse(readFileSync(localizedPath(record.slug, lang), "utf8")) as {
      sourceHash?: unknown;
    };
    if (parsed.sourceHash === sourceHash(record)) {
      card = validateLocalizedCard(record, lang, parsed);
    }
  } catch {
    card = null;
  }

  cache.set(key, card);
  return card;
}
