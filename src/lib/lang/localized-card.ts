import type { CorpusRecord } from "@/lib/corpus/types";

import type { SupportedLang } from "./types";

/**
 * The restoration card, translated into the reader's language.
 *
 * A record's translation is deterministic — the idli record in Hindi is always
 * the same bytes — so it is a build-time data artifact (see the localize
 * script), not a per-request model call. This file is the shape that artifact
 * takes and the pure validation that lets the card fall back to English on any
 * gap.
 *
 * The split mirrors the card: `labels` are the fixed UI strings for a language
 * (same for every record), `record` is the per-record content. Nothing here
 * touches the verified/unverified gate or the citation logic — the locus of an
 * unverified record is withheld from this the same way it is withheld from the
 * model, because we only ever localize what the card already renders.
 */

/** The six comparative axes the schema allows — never a health claim. */
export type NutritionAxis =
  | "protein"
  | "fibre"
  | "glycaemic_load"
  | "iron"
  | "calcium"
  | "fat_quality";

/** The fixed UI strings the restoration card prints, per language. */
export interface LocalizedLabels {
  verdict: string;
  then: string;
  whatChanged: string;
  cookToday: string;
  ingredient: string;
  quantity: string;
  whyItWasThere: string;
  theMethod: string;
  source: string;
  open: string;
  citationUnverified: string;
  byAxis: string;
  deltaCaption: string;
  axes: Record<NutritionAxis, string>;
}

export interface LocalizedIngredient {
  name: string;
  /** Localized display quantity, or null where the record has none. */
  quantity: string | null;
  /** The "why it was there" text. */
  function: string;
}

export interface LocalizedSource {
  text: string;
  author: string | null;
  century: string;
  /** Only ever populated for a verified record; withheld otherwise. */
  edition: string | null;
  locus: string | null;
}

export interface LocalizedRecord {
  /** Localized `share_verdict` — the fallback verdict line. */
  verdict: string | null;
  /** Parallel to `record.ingredients` by index. */
  ingredients: LocalizedIngredient[];
  /** Parallel to `record.method_reconstructed`. */
  method: string[];
  source: LocalizedSource;
  contested_points: string[];
  restore_today: { ingredients: string[]; steps: string[] } | null;
  make_today_notes: {
    keep: Array<{ keep: string; not: string }>;
    techniques: Array<{ archaic: string; modern: string; keep?: string }>;
  } | null;
  /** Localized display label per axis key present on the record. */
  axes: Partial<Record<NutritionAxis, string>>;
}

export interface LocalizedCard {
  lang: SupportedLang;
  labels: LocalizedLabels;
  record: LocalizedRecord;
}

/**
 * The English defaults — the single source of truth for the card's UI strings,
 * so the card renders these when no localization is present and the localize
 * script has one list to translate.
 */
export const EN_LABELS: LocalizedLabels = {
  verdict: "The verdict",
  then: "Then",
  whatChanged: "What changed",
  cookToday: "Cook it today",
  ingredient: "Ingredient",
  quantity: "Quantity",
  whyItWasThere: "Why it was there",
  theMethod: "The method",
  source: "Source",
  open: "Open",
  citationUnverified: "Citation not yet verified, so no verse or page is shown",
  byAxis: "Then → now, by axis",
  deltaCaption:
    "A comparison between two versions of one dish. Not a health claim, and not advice. For " +
    "anything personal, talk to a doctor or a dietitian.",
  axes: {
    protein: "protein",
    fibre: "fibre",
    glycaemic_load: "glycaemic load",
    iron: "iron",
    calcium: "calcium",
    fat_quality: "fat quality",
  },
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function strArray(v: unknown, expectedLength: number): string[] | null {
  if (!Array.isArray(v) || v.length !== expectedLength) return null;
  const out = v.map((x) => (typeof x === "string" ? x : null));
  return out.every((x): x is string => x !== null) ? out : null;
}

function coerceLabels(v: unknown): LocalizedLabels | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const axes = o.axes;
  if (!axes || typeof axes !== "object") return null;
  const a = axes as Record<string, unknown>;
  const keys: Array<keyof LocalizedLabels> = [
    "verdict", "then", "whatChanged", "cookToday", "ingredient", "quantity",
    "whyItWasThere", "theMethod", "source", "open", "citationUnverified",
    "byAxis", "deltaCaption",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const s = str(o[k]);
    if (!s) return null;
    out[k] = s;
  }
  const axisKeys: NutritionAxis[] = [
    "protein", "fibre", "glycaemic_load", "iron", "calcium", "fat_quality",
  ];
  const axesOut: Partial<Record<NutritionAxis, string>> = {};
  for (const k of axisKeys) {
    const s = str(a[k]);
    if (!s) return null;
    axesOut[k] = s;
  }
  out.axes = axesOut as Record<NutritionAxis, string>;
  return out as unknown as LocalizedLabels;
}

/**
 * Turn a raw localization (parsed JSON, from the script or the store) into a
 * typed `LocalizedCard`, or null on any structural mismatch — a localized
 * ingredient or method array whose length differs from the record's would
 * silently misalign the table, so the whole card falls back to English instead.
 * Pure and synchronous, so it is fully testable without a model or the network.
 */
export function validateLocalizedCard(
  record: CorpusRecord,
  lang: SupportedLang,
  raw: unknown,
): LocalizedCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const labels = coerceLabels(o.labels);
  if (!labels) return null;

  const rec = o.record;
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Record<string, unknown>;

  // The two load-bearing invariants: same number of ingredients, same number of
  // method steps. A mismatch means the model dropped or invented a row, and a
  // localized table that does not line up with the record is worse than English.
  if (!Array.isArray(r.ingredients) || r.ingredients.length !== record.ingredients.length) return null;
  const method = strArray(r.method, record.method_reconstructed.length);
  if (!method) return null;

  const ingredients: LocalizedIngredient[] = [];
  for (const item of r.ingredients as unknown[]) {
    if (!item || typeof item !== "object") return null;
    const it = item as Record<string, unknown>;
    const name = str(it.name);
    const fn = typeof it.function === "string" ? it.function : null;
    if (name === null || fn === null) return null;
    ingredients.push({ name, quantity: str(it.quantity), function: fn });
  }

  const src = r.source;
  if (!src || typeof src !== "object") return null;
  const s = src as Record<string, unknown>;
  const text = str(s.text);
  const century = str(s.century);
  if (!text || !century) return null;

  const axes: Partial<Record<NutritionAxis, string>> = {};
  if (r.axes && typeof r.axes === "object") {
    for (const [k, v] of Object.entries(r.axes as Record<string, unknown>)) {
      const val = str(v);
      if (val) axes[k as NutritionAxis] = val;
    }
  }

  // Optional blocks: kept only when well-formed, dropped (not fatal) otherwise —
  // the card falls back to the record's English for a block that did not survive.
  let restore: LocalizedRecord["restore_today"] = null;
  if (record.restore_today && r.restore_today && typeof r.restore_today === "object") {
    const rt = r.restore_today as Record<string, unknown>;
    const ing = strArray(rt.ingredients, record.restore_today.ingredients.length);
    const steps = strArray(rt.steps, record.restore_today.steps.length);
    if (ing && steps) restore = { ingredients: ing, steps };
  }

  return {
    lang,
    labels,
    record: {
      verdict: str(r.verdict),
      ingredients,
      method,
      source: {
        text,
        author: str(s.author),
        century,
        edition: str(s.edition),
        locus: str(s.locus),
      },
      contested_points: Array.isArray(r.contested_points)
        ? (r.contested_points as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      restore_today: restore,
      make_today_notes: null,
      axes,
    },
  };
}
