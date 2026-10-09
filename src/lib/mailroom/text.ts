import type { Row, TemplateValues } from "@/lib/mail-templates/fill";
import { TEMPLATES, type TemplateId } from "@/lib/mail-templates/registry";

/**
 * The plain-text part of a recipe email, from the same values as its HTML:
 * for mail apps that show no HTML, and because a message with both parts
 * reads as less like spam. Nothing here is escaped, because nothing here is
 * markup. Run after `fillTemplate`, which has already refused missing blanks
 * and bad links.
 */
export function plainText(id: TemplateId, values: TemplateValues): string {
  const spec = TEMPLATES[id];
  const has = (tag: string) => spec.tags.includes(tag);
  const s = (key: string) => {
    const v = values[key];
    return typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
  };
  const rows = (key: string): readonly Row[] => {
    const v = values[key];
    return Array.isArray(v) ? v : [];
  };
  const item = (row: Row) => (typeof row === "string" ? row : (row.item ?? ""));

  const out: string[] = [s("heading"), s("message")];

  if (has("recipe_name") && has("display_name")) {
    out.push(`${s("recipe_name")} · ${s("display_name")}${has("state") ? `, ${s("state")}` : ""}`);
  }
  if (has("count")) out.push(`${s("count")} readers have asked for ${s("recipe_name")}.`);
  if (has("quoted_line")) out.push(`You wrote: ${s("quoted_line")}\nCould read: ${s("suggested_line")}`);
  if (has("date_label")) out.push(s("date_label"));

  for (const name of Object.keys(spec.lists)) {
    const list = rows(name);
    if (name === "missing") out.push(`Missing: ${list.map(item).join(", ")}`);
    else if (name === "recipes") {
      for (const row of list) {
        const r = row as Readonly<Record<string, string>>;
        out.push(`${r.recipe_name}, from ${r.display_name}, ${r.state}\nAsk Kranti: "${r.question}"\n${r.try_url}`);
      }
    } else out.push(list.map((row, i) => `${i + 1}. ${item(row)}`).join("\n"));
  }

  if (has("question")) out.push(`Ask Kranti: "${s("question")}"\n${s("try_url")}`);
  if (has("add_recipe_url")) {
    out.push(`${id.startsWith("needs-changes/") ? "Update your recipe" : "Add a recipe"}: ${s("add_recipe_url")}`);
  }
  if (id === "keep-sharing/anniversary") out.push(`Visit Kranti: ${s("site_url")}`);

  const footer = [
    "—",
    `Kranti Cookbook · ${s("site_url")}`,
    spec.audience === "list"
      ? "You're getting this because you're on the Kranti Cookbook list."
      : "You're getting this because you shared a recipe with Kranti Cookbook.",
  ];
  if (has("unsubscribe_url")) footer.push(`Unsubscribe: ${s("unsubscribe_url")}`);
  out.push(footer.join("\n"));

  return `${out.filter(Boolean).join("\n\n")}\n`;
}
