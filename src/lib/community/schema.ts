/**
 * What a submission is, and what of one the API will accept.
 *
 * The `submission` block is stored verbatim and never mutated — the pipeline
 * accretes verdicts and tags BESIDE it, never over it. Validation therefore
 * only trims edges and rejects; it does not normalise, translate, or "fix".
 * Trust-boundary rule: the form's required/optional split is convenience,
 * this file is the enforcement.
 */

export const PHOTO_MAX_BYTES = 500 * 1024;
const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"];

/** Decoded size of a base64 string, without allocating the decode. */
function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
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
  photo?: { data: string; mime: string; bytes: number };
}

type Field = {
  key: keyof SubmissionInput & string;
  max: number;
  required: boolean;
};

const FIELDS: Field[] = [
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
];

export function validateSubmission(
  input: unknown,
): { ok: true; value: SubmissionInput } | { ok: false; errors: string[] } {
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

  const consent = raw.consent as { right_to_share?: unknown; public_display?: unknown } | undefined;
  if (consent?.right_to_share !== true || consent?.public_display !== true) {
    errors.push("both consent boxes are required");
  } else {
    out.consent = { right_to_share: true, public_display: true };
  }

  if (raw.photo !== undefined && raw.photo !== null) {
    const photo = raw.photo as { data?: unknown; mime?: unknown };
    const data = typeof photo?.data === "string" ? photo.data : "";
    // The client's own size claim is not trusted: the cap is enforced on the
    // decoded length of what was actually sent.
    const bytes = base64Bytes(data);
    if (
      !data ||
      typeof photo?.mime !== "string" ||
      !PHOTO_MIMES.includes(photo.mime) ||
      bytes <= 0 ||
      bytes > PHOTO_MAX_BYTES
    ) {
      errors.push(`photo must be jpeg/png/webp under ${PHOTO_MAX_BYTES / 1024}KB`);
    } else {
      out.photo = { data, mime: photo.mime, bytes };
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: out as unknown as SubmissionInput };
}
