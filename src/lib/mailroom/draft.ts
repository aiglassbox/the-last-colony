import type { Row } from "@/lib/mail-templates/fill";
import { COMMON_TAGS, TEMPLATE_IDS, TEMPLATES, type TemplateId } from "@/lib/mail-templates/registry";

import { addRecipeUrl } from "./links";
import { QUESTION_MAX, tryQuestion, tryUrl } from "./question";

/**
 * The Write form, as posted, and the template values it becomes.
 *
 * The form carries words and choices only: which submission, which published
 * recipes, which addresses. It never carries a link (every `_url` is built
 * here or by the sender, from `siteUrl()`), and never an address for a
 * submitter email (the sender reads that from the store by id). Anything the
 * template does not declare is dropped.
 */

/** Something the operator can fix: answered 400 with this message. */
export class DraftError extends Error {}

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value);
}

export interface Draft {
  template: TemplateId;
  /** subject, preheader, heading, message, and the template's own word blanks. */
  fields: Record<string, string>;
  /** The template's plain lists, one item per entry: changes, missing, prompts. */
  lists: Record<string, string[]>;
  /** Submitter emails: whose submission. */
  submissionId?: string;
  /** tell-everyone-the-story: which published recipes, each with its question ("" for the default). */
  recipes?: { id: string; question: string }[];
  /** List emails: the pasted addresses, raw. */
  recipients?: string;
}

/** A published recipe as a tell-everyone row needs it. */
export interface RecipeFacts {
  id: string;
  recipe_name: string;
  display_name: string;
  state: string;
  belongs_to: string;
  tag: string;
  aliases: string[];
}

/** A submission as the Write tab's pickers list it. Dates as ISO strings, because it crosses into a client component. */
export interface MailPick extends RecipeFacts {
  contact: string | null;
  verified: boolean;
  status: "pending" | "green" | "red";
  published: boolean;
  created_at: string;
}

export const FIELD_MAX = 2_000;
export const MESSAGE_MAX = 6_000;
export const LIST_MAX = 20;
export const ITEM_MAX = 300;
export const RECIPES_MAX = 12;
export const RECIPIENTS_TEXT_MAX = 50_000;

const HEX_ID = /^[0-9a-f]{24}$/i;

function stringRecord(value: unknown, name: string): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DraftError(`${name} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") throw new DraftError(`${name}: ${k} must be text`);
    out[k] = v;
  }
  return out;
}

/** The posted JSON, checked for shape only. Lengths and template rules are `valuesFromDraft`'s. */
export function parseDraft(raw: unknown): Draft {
  if (typeof raw !== "object" || raw === null) throw new DraftError("draft must be an object");
  const r = raw as Record<string, unknown>;
  if (!isTemplateId(r.template)) throw new DraftError("template is not one of the nine");

  const lists: Record<string, string[]> = {};
  if (r.lists !== undefined) {
    if (typeof r.lists !== "object" || r.lists === null || Array.isArray(r.lists)) throw new DraftError("lists must be an object");
    for (const [k, v] of Object.entries(r.lists)) {
      if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) throw new DraftError(`lists: ${k} must be a list of text`);
      lists[k] = v as string[];
    }
  }

  const draft: Draft = { template: r.template, fields: stringRecord(r.fields, "fields"), lists };

  if (r.submissionId !== undefined) {
    if (typeof r.submissionId !== "string" || !HEX_ID.test(r.submissionId)) throw new DraftError("submissionId is not a submission id");
    draft.submissionId = r.submissionId;
  }
  if (r.recipes !== undefined) {
    if (!Array.isArray(r.recipes)) throw new DraftError("recipes must be a list");
    draft.recipes = r.recipes.map((x) => {
      const row = x as { id?: unknown; question?: unknown };
      if (typeof row.id !== "string" || !HEX_ID.test(row.id)) throw new DraftError("recipes: an id is not a submission id");
      if (row.question !== undefined && typeof row.question !== "string") throw new DraftError("recipes: a question must be text");
      return { id: row.id, question: row.question ?? "" };
    });
  }
  if (r.recipients !== undefined) {
    if (typeof r.recipients !== "string") throw new DraftError("recipients must be text");
    if (r.recipients.length > RECIPIENTS_TEXT_MAX) throw new DraftError("recipients: too much text pasted");
    draft.recipients = r.recipients;
  }
  return draft;
}

/**
 * The values `fillTemplate` gets, minus `unsubscribe_url`, which is per
 * person and added by the sender. Links are built from `site`; recipe rows
 * come from `recipes` (the published store), never from the form, so a
 * tell-everyone email can only ever show a recipe that is live and credit
 * the person who sent it.
 */
export function valuesFromDraft(
  draft: Draft,
  site: string,
  recipes: ReadonlyMap<string, RecipeFacts>,
): Record<string, string | Row[]> {
  const spec = TEMPLATES[draft.template];
  const values: Record<string, string | Row[]> = { site_url: site };

  for (const tag of [...COMMON_TAGS, ...spec.tags]) {
    if (tag.endsWith("_url")) continue;
    const raw = draft.fields[tag];
    if (raw === undefined) continue;
    const max = tag === "message" ? MESSAGE_MAX : tag === "question" ? QUESTION_MAX : FIELD_MAX;
    if (raw.length > max) throw new DraftError(`${tag}: over ${max} characters`);
    values[tag] = raw;
  }
  if (spec.tags.includes("add_recipe_url")) values.add_recipe_url = addRecipeUrl(site);
  if (spec.tags.includes("try_url") && typeof values.question === "string") {
    values.try_url = tryUrl(site, values.question.trim());
  }

  for (const name of Object.keys(spec.lists)) {
    if (name === "recipes") {
      const picked = draft.recipes ?? [];
      if (picked.length > RECIPES_MAX) throw new DraftError(`recipes: at most ${RECIPES_MAX}`);
      values.recipes = picked.map(({ id, question }) => {
        const recipe = recipes.get(id);
        if (!recipe) throw new DraftError(`recipes: ${id} is not a published recipe`);
        const q = question.trim() || tryQuestion(recipe.display_name, recipe.recipe_name);
        if (q.length > QUESTION_MAX) throw new DraftError(`recipes: a question is over ${QUESTION_MAX} characters`);
        return {
          recipe_name: recipe.recipe_name,
          display_name: recipe.display_name,
          state: recipe.state,
          question: q,
          try_url: tryUrl(site, q),
        };
      });
      continue;
    }
    const items = (draft.lists[name] ?? []).map((s) => s.trim()).filter(Boolean);
    if (items.length > LIST_MAX) throw new DraftError(`${name}: at most ${LIST_MAX} items`);
    if (items.some((s) => s.length > ITEM_MAX)) throw new DraftError(`${name}: an item is over ${ITEM_MAX} characters`);
    values[name] = items;
  }
  return values;
}
