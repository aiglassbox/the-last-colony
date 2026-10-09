import { fillTemplate, type TemplateValues } from "@/lib/mail-templates/fill";
import { TEMPLATES, type TemplateId } from "@/lib/mail-templates/registry";

import { DraftError } from "./draft";
import { plainText } from "./text";

/** One email, ready for Resend. `headers` is empty except on list emails. */
export interface Composed {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** Long enough for any honest subject; a header line, so no line breaks at all. */
export const SUBJECT_MAX = 150;
/** Gmail clips a message at about 102KB and hides the rest behind a link. */
export const HTML_MAX = 100_000;

/**
 * Fills a part-1 template and builds what goes beside it. Pure: the template
 * text is passed in (`templates.ts` reads it), so the check runs offline.
 *
 * A list email must be given its person's one-click URL. It becomes the
 * `List-Unsubscribe` header Gmail and Yahoo turn into their own button, and
 * a list email without one is refused rather than sent without an exit.
 */
export function composeEmail(id: TemplateId, template: string, values: TemplateValues, oneClick?: string): Composed {
  const subject = typeof values.subject === "string" ? values.subject.trim() : "";
  if (/[\r\n]/.test(subject)) throw new DraftError("subject: no line breaks");
  if (subject.length > SUBJECT_MAX) throw new DraftError(`subject: over ${SUBJECT_MAX} characters`);

  let html: string;
  try {
    html = fillTemplate(template, values);
  } catch (error) {
    throw new DraftError(error instanceof Error ? error.message : String(error));
  }
  if (Buffer.byteLength(html) >= HTML_MAX) throw new DraftError("the email is over 100KB: shorten the message or the list");

  const headers: Record<string, string> = {};
  if (TEMPLATES[id].audience === "list") {
    if (!oneClick) throw new DraftError("a list email needs its one-click unsubscribe link");
    headers["List-Unsubscribe"] = `<${oneClick}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return { subject, html, text: plainText(id, values), headers };
}
