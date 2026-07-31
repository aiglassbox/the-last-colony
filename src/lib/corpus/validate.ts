import type {
  CorpusRecord,
  ProvenanceClass,
  SwapRecord,
  Tier,
  VerificationStatus,
} from "./types";

/**
 * Hand-rolled validation. No schema library: the rules that matter here are
 * cross-field invariants (an unverified record may not claim ATTESTED; a
 * MODERN_DISH may not carry a locus), and those need code either way.
 */

export class CorpusValidationError extends Error {
  constructor(
    readonly file: string,
    readonly problems: string[],
  ) {
    super(`${file}:\n  - ${problems.join("\n  - ")}`);
    this.name = "CorpusValidationError";
  }
}

const PROVENANCE: ProvenanceClass[] = [
  "ATTESTED",
  "RECONSTRUCTED",
  "INFERRED",
  "MODERN_DISH",
];
const TIERS: Tier[] = ["ancient", "modern"];
const STATUSES: VerificationStatus[] = ["editor_verified", "unverified_seed"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateRecord(raw: unknown, file: string): CorpusRecord {
  const p: string[] = [];

  if (!isObject(raw)) throw new CorpusValidationError(file, ["not a JSON object"]);

  const req = (key: string, type: "string" | "number") => {
    if (typeof raw[key] !== type) p.push(`${key} must be a ${type}`);
  };

  req("id", "string");
  req("slug", "string");
  req("dish_name_modern", "string");

  if (typeof raw.slug === "string" && !/^[a-z0-9-]+$/.test(raw.slug)) {
    p.push("slug must be kebab-case [a-z0-9-] — it is a public URL");
  }
  if (!isStringArray(raw.aliases)) p.push("aliases must be an array of strings");
  if (!TIERS.includes(raw.tier as Tier)) p.push(`tier must be one of ${TIERS.join(", ")}`);
  if (!PROVENANCE.includes(raw.provenance_class as ProvenanceClass)) {
    p.push(`provenance_class must be one of ${PROVENANCE.join(", ")}`);
  }

  if (!isObject(raw.source)) {
    p.push("source must be an object");
  } else if (typeof raw.source.text !== "string") {
    p.push("source.text must be a string");
  }

  if (!isObject(raw.verification)) {
    p.push("verification must be an object");
  } else if (!STATUSES.includes(raw.verification.status as VerificationStatus)) {
    p.push(`verification.status must be one of ${STATUSES.join(", ")}`);
  } else if (typeof raw.verification.note !== "string") {
    p.push("verification.note must be a string");
  }

  if (!Array.isArray(raw.ingredients)) {
    p.push("ingredients must be an array");
  } else {
    raw.ingredients.forEach((ing, i) => {
      if (!isObject(ing) || typeof ing.name !== "string") {
        p.push(`ingredients[${i}].name must be a string`);
      } else if (typeof ing.function !== "string" || ing.function.length === 0) {
        p.push(`ingredients[${i}].function is required — "why it was there" is the point`);
      }
    });
  }

  if (!isStringArray(raw.method_reconstructed)) {
    p.push("method_reconstructed must be an array of strings");
  }
  if (!isStringArray(raw.contested_points)) {
    p.push("contested_points must be an array of strings (use [] if none)");
  }

  if (!isObject(raw.confidence)) {
    p.push("confidence must be an object");
  } else {
    for (const k of ["identification", "ingredients", "method"]) {
      const v = raw.confidence[k];
      if (typeof v !== "number" || v < 0 || v > 1) {
        p.push(`confidence.${k} must be a number between 0 and 1`);
      }
    }
  }

  // --- Cross-field invariants. These are the ones that protect the campaign. ---

  const status = isObject(raw.verification) ? raw.verification.status : undefined;
  const cls = raw.provenance_class as ProvenanceClass;

  if (cls === "ATTESTED" && status !== "editor_verified") {
    p.push(
      "ATTESTED requires verification.status = editor_verified. An unchecked " +
        "citation cannot be presented as attested.",
    );
  }

  // ATTESTED means an editor located the passage and rendered it. Usually that
  // is the source-language text; a published translation with a locus is the
  // same substance, and holding those records back would understate work that
  // has actually been done. What it can never mean is neither.
  if (cls === "ATTESTED" && typeof raw.original_text !== "string" && typeof raw.translation !== "string") {
    p.push(
      "ATTESTED requires original_text or translation — the class means the " +
        "passage has been located and rendered, not merely cited",
    );
  }

  if (status !== "editor_verified") {
    for (const k of ["original_text", "transliteration", "translation"] as const) {
      if (raw[k] !== null && raw[k] !== undefined) {
        p.push(
          `${k} must be null on an unverified record — source-language text ` +
            "may only be entered by an editor reading the printed edition",
        );
      }
    }
  }

  if (cls === "MODERN_DISH") {
    if (isObject(raw.source) && raw.source.locus) {
      p.push("MODERN_DISH must not carry a source locus — there is no ancient original");
    }
    if (raw.tier !== "modern") p.push("MODERN_DISH must be tier = modern");
  }

  if (raw.tier === "ancient" && cls === "MODERN_DISH") {
    p.push("tier = ancient contradicts provenance_class = MODERN_DISH");
  }

  if (p.length) throw new CorpusValidationError(file, p);
  return raw as unknown as CorpusRecord;
}

export function validateSwap(raw: unknown, file: string): SwapRecord {
  const p: string[] = [];
  if (!isObject(raw)) throw new CorpusValidationError(file, ["not a JSON object"]);

  if (typeof raw.id !== "string") p.push("id must be a string");
  if (typeof raw.modern_item !== "string") p.push("modern_item must be a string");
  if (!isStringArray(raw.aliases)) p.push("aliases must be an array of strings");
  if (typeof raw.where_it_went !== "string") p.push("where_it_went must be a string");

  if (!Array.isArray(raw.options)) {
    p.push("options must be an array");
  } else {
    if (raw.options.length === 0) p.push("options must not be empty");
    if (raw.options.length > 2) p.push("two swaps maximum per item, ranked");
    raw.options.forEach((o, i) => {
      if (!isObject(o)) {
        p.push(`options[${i}] must be an object`);
        return;
      }
      for (const k of ["swap", "ratio", "taste_and_texture", "nutritional_rationale"]) {
        if (typeof o[k] !== "string" || (o[k] as string).length === 0) {
          p.push(`options[${i}].${k} is required`);
        }
      }
    });
  }

  if (p.length) throw new CorpusValidationError(file, p);
  return raw as unknown as SwapRecord;
}

/** Checks that only make sense across the whole corpus. */
export function validateCorpusSet(records: CorpusRecord[]): string[] {
  const problems: string[] = [];
  const byId = new Map<string, CorpusRecord>();
  const slugs = new Set<string>();

  for (const r of records) {
    if (byId.has(r.id)) problems.push(`duplicate id: ${r.id}`);
    byId.set(r.id, r);
    if (slugs.has(r.slug)) problems.push(`duplicate slug: ${r.slug}`);
    slugs.add(r.slug);
  }

  for (const r of records) {
    if (r.modern_counterpart_id && !byId.has(r.modern_counterpart_id)) {
      problems.push(`${r.id}: modern_counterpart_id ${r.modern_counterpart_id} not found`);
    }
    if (r.tier === "ancient" && !r.modern_counterpart_id) {
      problems.push(`${r.id}: ancient record has no modern_counterpart_id — the diff is the product`);
    }
  }

  // Aliases must not collide across records, or keyword retrieval becomes a coin flip.
  const aliasOwner = new Map<string, string>();
  for (const r of records) {
    if (r.tier !== "ancient" && r.provenance_class !== "MODERN_DISH") continue;
    for (const a of [r.dish_name_modern, ...r.aliases]) {
      const key = a.toLowerCase().trim();
      const owner = aliasOwner.get(key);
      if (owner && owner !== r.id) {
        problems.push(`alias "${a}" claimed by both ${owner} and ${r.id}`);
      }
      aliasOwner.set(key, r.id);
    }
  }

  return problems;
}
