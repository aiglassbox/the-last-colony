/**
 * What a submission is, and what of one the API will accept.
 *
 * The `submission` block is stored verbatim and never mutated — the pipeline
 * accretes verdicts and tags BESIDE it, never over it. Validation therefore
 * only trims edges and rejects; it does not normalise, translate, or "fix".
 * Trust-boundary rule: the form's required/optional split is convenience,
 * this file is the enforcement.
 */

import { isSupported } from "../lang/types";

export const STATES: string[] = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
  "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry",
];

export const BELONGS_TO = [
  { value: "grandmother", label: "Grandmother" },
  { value: "grandfather", label: "Grandfather" },
  { value: "mother", label: "Mother" },
  { value: "father", label: "Father" },
  { value: "other relative", label: "Other relative" },
  { value: "family friend", label: "Family friend" },
  { value: "my own", label: "My own" },
  { value: "other", label: "Other…" },
];

export const PHOTO_MAX_BYTES = 500 * 1024;

/**
 * Request-body ceiling, checked on `content-length` before a body is read.
 * The one legitimately large member is the photo (its cap, as base64, is
 * ~683 KB); every text cap together is under 17K characters, which is under
 * 60 KB even in a three-byte script; Phase 2's `extracted` doubles the text.
 * One megabyte leaves room for all of it and none for a flood.
 */
export const MAX_BODY_BYTES = 1_000_000;
const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"];

/** Decoded size of a base64 string, without allocating the decode. */
function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export interface Photo {
  data: string;
  mime: string;
  bytes: number;
}

/**
 * What the extraction read from the photo — the model's transcription, kept
 * beside the submitter's confirmed words so /pantry can show both and a
 * reviewer can see how much was corrected. Same caps as the fields they
 * prefill; empty strings are the normal case for a card with no story.
 */
export interface Extracted {
  recipe_name: string;
  story: string;
  ingredients: string;
  method: string;
  /** ISO 639-1 the model read the card in; "" when unsure or unsupported. */
  language: string;
}

export interface SubmissionInput {
  display_name: string;
  state: string;
  city?: string;
  belongs_to: string;
  belongs_to_other?: string;
  recipe_name: string;
  story: string;
  ingredients: string;
  method: string;
  language: string;
  consent: { right_to_share: boolean; public_display: boolean };
  /** PII. Admin-route only, never in any served payload. */
  contact: string;
  photo?: Photo;
}

type Field = {
  key: keyof SubmissionInput & string;
  max: number;
  required: boolean;
};

const FIELDS = [
  { key: "display_name", max: 80, required: true },
  { key: "state", max: 60, required: true },
  { key: "city", max: 80, required: false },
  { key: "belongs_to", max: 40, required: true },
  { key: "belongs_to_other", max: 80, required: false },
  { key: "recipe_name", max: 120, required: true },
  { key: "story", max: 4000, required: true },
  { key: "ingredients", max: 4000, required: true },
  { key: "method", max: 8000, required: true },
  { key: "language", max: 30, required: true },
  { key: "contact", max: 120, required: true },
] as const satisfies readonly Field[];

type FieldKey = (typeof FIELDS)[number]["key"];
const EXTRACTED_KEYS = ["recipe_name", "story", "ingredients", "method", "language"] as const satisfies readonly FieldKey[];

// Keyed by the field list itself, so a key that drifts out of FIELDS is a compile error, not a silently uncapped field.
const CAP = Object.fromEntries(FIELDS.map((f) => [f.key, f.max])) as Record<FieldKey, number>;

/** The photo block, when one is present. The client's own size claim is not trusted. */
export function validatePhoto(raw: unknown): { ok: true; value: Photo } | { ok: false; error: string } {
  const photo = (typeof raw === "object" && raw !== null ? raw : {}) as { data?: unknown; mime?: unknown };
  const data = typeof photo.data === "string" ? photo.data : "";
  // Raw base64 only: a data: URL or stray characters would poison the decode
  // downstream, and the size estimate is exact only for real base64.
  const wellFormed = /^[A-Za-z0-9+/]+={0,2}$/.test(data) && data.length % 4 === 0;
  const bytes = wellFormed ? base64Bytes(data) : 0;
  if (!wellFormed || typeof photo.mime !== "string" || !PHOTO_MIMES.includes(photo.mime) || bytes <= 0 || bytes > PHOTO_MAX_BYTES) {
    return { ok: false, error: `photo must be jpeg/png/webp under ${PHOTO_MAX_BYTES / 1024}KB` };
  }
  return { ok: true, value: { data, mime: photo.mime, bytes } };
}

/** The model's reading. Every field optional, every field capped like the one it prefills. */
export function validateExtracted(raw: unknown): { ok: true; value: Extracted } | { ok: false; errors: string[] } {
  if (typeof raw !== "object" || raw === null) return { ok: false, errors: ["extracted must be an object"] };
  const input = raw as Record<string, unknown>;
  const errors: string[] = [];
  const out: Extracted = { recipe_name: "", story: "", ingredients: "", method: "", language: "" };
  for (const key of EXTRACTED_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      errors.push(`extracted.${key} must be a string`);
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > CAP[key]) {
      errors.push(`extracted.${key} is over ${CAP[key]} characters`);
      continue;
    }
    out[key] = trimmed;
  }
  // The doc promise on `Extracted.language` ("" when unsure or unsupported)
  // is kept here, at the boundary, not only in the model's parser.
  if (out.language && !isSupported(out.language)) out.language = "";
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: out };
}

export function validateSubmission(
  input: unknown,
):
  | { ok: true; value: SubmissionInput; mode: "manual" | "image"; extracted?: Extracted }
  | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["submission must be an object"] };
  }
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  const out: Record<string, unknown> = {};

  for (const { key, max, required } of FIELDS) {
    const value = raw[key];
    if (value === undefined || value === null) {
      if (required) errors.push(`${key} is required`);
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`${key} must be a string`);
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      if (required) errors.push(`${key} is required`);
      continue;
    }
    if (trimmed.length > max) {
      errors.push(`${key} is over ${max} characters`);
      continue;
    }
    out[key] = trimmed;
  }

  // The form offers lists; the server holds them. Free text here would be a
  // silent never-match for Phase 4's geo pick and reply language.
  if (typeof out.state === "string" && !STATES.includes(out.state)) {
    errors.push("state must be one of the listed states");
  }
  if (typeof out.belongs_to === "string" && !BELONGS_TO.some((b) => b.value === out.belongs_to)) {
    errors.push("belongs_to must be one of the listed options");
  }
  if (out.belongs_to === "other" && typeof out.belongs_to_other !== "string") {
    errors.push("belongs_to_other is required when belongs_to is other");
  }
  if (typeof out.language === "string" && !isSupported(out.language)) {
    errors.push("language must be one of the supported codes");
  }

  const consent = raw.consent as { right_to_share?: unknown; public_display?: unknown } | undefined;
  if (consent?.right_to_share !== true || consent?.public_display !== true) {
    errors.push("both consent boxes are required");
  } else {
    out.consent = { right_to_share: true, public_display: true };
  }

  if (raw.photo !== undefined && raw.photo !== null) {
    const photo = validatePhoto(raw.photo);
    if (photo.ok) out.photo = photo.value;
    else errors.push(photo.error);
  }

  // Image mode is an envelope around the same submission: what the model read
  // travels beside what the submitter confirmed, and the photo it was read
  // from is required. The submission block itself is identical in both modes.
  const modeRaw = raw.mode ?? "manual";
  const mode: "manual" | "image" = modeRaw === "image" ? "image" : "manual";
  let extracted: Extracted | undefined;
  if (modeRaw !== "manual" && modeRaw !== "image") {
    errors.push("mode must be manual or image");
  } else if (mode === "image") {
    const ex = validateExtracted(raw.extracted);
    if (ex.ok) extracted = ex.value;
    else errors.push(...ex.errors);
    if (raw.photo === undefined || raw.photo === null) errors.push("image mode needs the photo it was read from");
  } else if (raw.extracted !== undefined && raw.extracted !== null) {
    errors.push("extracted only applies to image mode");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: out as unknown as SubmissionInput, mode, extracted };
}
