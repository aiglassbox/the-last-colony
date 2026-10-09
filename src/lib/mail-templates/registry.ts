/**
 * The nine recipe emails in `email-templates/`, and the blanks each may hold.
 *
 * One list for two readers: `scripts/check-email-templates.ts`, which fails
 * when a file and its entry disagree in either direction, and the send page
 * (part 2), which builds its form from it. A blank the file has and this list
 * lacks is a hole in the email; one this list has and the file lacks is a form
 * field that does nothing.
 */

/** Every template has these. */
export const COMMON_TAGS = ["subject", "preheader", "heading", "message", "site_url"] as const;

export const TEMPLATE_DIR = "email-templates";

export const TEMPLATE_IDS = [
  "thank-you/received",
  "thank-you/published",
  "thank-you/milestone",
  "needs-changes/general-edits",
  "needs-changes/health-claim",
  "needs-changes/missing-details",
  "keep-sharing/add-your-recipe",
  "keep-sharing/tell-everyone-the-story",
  "keep-sharing/anniversary",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateSpec {
  /** One submitter, or a pasted list. A list email carries an unsubscribe link. */
  audience: "submitter" | "list";
  /** Blanks beyond `COMMON_TAGS`. */
  tags: readonly string[];
  /** List name → the blanks one row uses. `{{n}}`, the row's position, is always allowed. */
  lists: Readonly<Record<string, readonly string[]>>;
}

export const TEMPLATES: Readonly<Record<TemplateId, TemplateSpec>> = {
  "thank-you/received": { audience: "submitter", tags: ["display_name", "recipe_name"], lists: {} },
  "thank-you/published": {
    audience: "submitter",
    tags: ["display_name", "recipe_name", "state", "belongs_to", "question", "try_url"],
    lists: {},
  },
  "thank-you/milestone": { audience: "submitter", tags: ["display_name", "recipe_name", "count"], lists: {} },
  "needs-changes/general-edits": {
    audience: "submitter",
    tags: ["display_name", "recipe_name", "add_recipe_url"],
    lists: { changes: ["item"] },
  },
  "needs-changes/health-claim": {
    audience: "submitter",
    tags: ["display_name", "recipe_name", "quoted_line", "suggested_line", "add_recipe_url"],
    lists: {},
  },
  "needs-changes/missing-details": {
    audience: "submitter",
    tags: ["display_name", "recipe_name", "add_recipe_url"],
    lists: { missing: ["item"] },
  },
  "keep-sharing/add-your-recipe": {
    audience: "list",
    tags: ["add_recipe_url", "unsubscribe_url"],
    lists: { prompts: ["item"] },
  },
  "keep-sharing/tell-everyone-the-story": {
    audience: "list",
    tags: ["unsubscribe_url"],
    lists: { recipes: ["recipe_name", "display_name", "state", "question", "try_url"] },
  },
  "keep-sharing/anniversary": { audience: "list", tags: ["date_label", "unsubscribe_url"], lists: {} },
};
