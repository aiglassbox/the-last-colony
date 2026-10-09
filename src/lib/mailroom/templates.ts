import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TEMPLATE_DIR, type TemplateId } from "@/lib/mail-templates/registry";

import { isTemplateId } from "./draft";

/**
 * The nine part-1 templates, read from `email-templates/` by id only.
 *
 * Resolved against `process.cwd()`, as the corpus is (`lib/corpus/load.ts`),
 * because that is where Next's output file tracing puts what a route reads;
 * `next.config.ts` names the folder in `outputFileTracingIncludes` for the
 * routes that send. The id is checked against the registry before it becomes
 * a path, so nothing a request says can read any other file.
 */
const cache = new Map<TemplateId, string>();

export function loadTemplate(id: TemplateId): string {
  if (!isTemplateId(id)) throw new Error(`unknown template: ${String(id)}`);
  let html = cache.get(id);
  if (html === undefined) {
    html = readFileSync(resolve(process.cwd(), TEMPLATE_DIR, `${id}.html`), "utf8");
    cache.set(id, html);
  }
  return html;
}
