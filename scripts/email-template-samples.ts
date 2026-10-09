/**
 * Placeholder values for every blank, for the check and the preview. Each one
 * says what goes in its slot; none of it is copy to send. A blank with no
 * sample throws, so a new blank in the registry cannot slip past the check.
 */
import type { Row, TemplateValues } from "../src/lib/mail-templates/fill";
import { COMMON_TAGS, TEMPLATES, type TemplateId } from "../src/lib/mail-templates/registry";

const TEXT: Record<string, string> = {
  subject: "Subject line goes here",
  preheader: "Inbox preview line goes here",
  heading: "Heading goes here",
  message:
    "Your message goes here. Two or three short sentences read best in an inbox.\n\nA second paragraph can go here if you need one.",
  display_name: "Asha Kulkarni",
  recipe_name: "Bisi bele bath",
  state: "Karnataka",
  belongs_to: "grandmother",
  count: "1,240",
  question: "Give me Asha Kulkarni's bisi bele bath recipe",
  quoted_line: "The line from their recipe goes here.",
  suggested_line: "Your suggested wording goes here.",
  date_label: "1 year",
};

function url(tag: string, site: string, question = TEXT.question): string {
  switch (tag) {
    case "site_url":
      return site;
    case "add_recipe_url":
      return `${site}/add-recipe`;
    case "unsubscribe_url":
      return `${site}/unsubscribe`;
    case "try_url":
      return `${site}/?q=${encodeURIComponent(question)}`;
    default:
      throw new Error(`no sample for ${tag}`);
  }
}

function lists(site: string): Record<string, Row[]> {
  const recipe = (recipe_name: string, display_name: string, state: string) => {
    const question = `Give me ${display_name}'s ${recipe_name.toLowerCase()} recipe`;
    return { recipe_name, display_name, state, question, try_url: url("try_url", site, question) };
  };
  return {
    changes: ["First thing to change goes here.", "Second thing to change goes here.", "Third thing to change goes here."],
    missing: ["Quantities", "Cooking time", "Serves"],
    prompts: ["First prompt goes here.", "Second prompt goes here.", "Third prompt goes here."],
    recipes: [
      recipe("Bisi bele bath", "Asha Kulkarni", "Karnataka"),
      recipe("Sol kadhi", "Rohan Naik", "Goa"),
      recipe("Litti chokha", "Priya Sinha", "Bihar"),
    ],
  };
}

export function sampleValues(id: TemplateId, site: string): TemplateValues {
  const spec = TEMPLATES[id];
  const values: Record<string, string | Row[]> = {};
  for (const tag of [...COMMON_TAGS, ...spec.tags]) {
    if (tag.endsWith("_url")) values[tag] = url(tag, site);
    else if (TEXT[tag] !== undefined) values[tag] = TEXT[tag];
    else throw new Error(`no sample for ${tag}`);
  }
  const rows = lists(site);
  for (const name of Object.keys(spec.lists)) {
    if (!rows[name]) throw new Error(`no sample for list ${name}`);
    values[name] = rows[name];
  }
  return values;
}
