/**
 * Fills a recipe email's blanks. Pure: the template and the values in, the
 * HTML out, or an error that names what was wrong.
 *
 * - `{{name}}` takes a string, HTML-escaped. Braces are escaped too, so a
 *   value can never open another blank: a submitter named "{{unsubscribe_url}}"
 *   is printed, not expanded.
 * - Every blank and list is required. An empty or whitespace-only value, or a
 *   list with no rows, counts as missing: `received` goes out with no one
 *   reading it first, and an email with a hole in it is worse than none.
 * - A blank ending `_url` must parse as an https link with a host, or be
 *   exactly http://localhost[:port] for a preview, so a form field cannot turn
 *   a button into a `javascript:` link.
 *   `{{site_url}}` loses a trailing slash, because templates write `{{site_url}}/…`.
 * - `{{message}}` is the operator's free text: paragraphs split on blank lines,
 *   single line breaks kept, CRLF from a textarea read as LF. The template
 *   styles the cell around it; the `<p>`s carry only their spacing.
 * - `{{#list}}…{{/list}}` repeats once per row. A row is a string (read as
 *   `{{item}}`) or named fields; `{{n}}` is its 1-based position. A row sees
 *   only its own fields and `n`, never a top-level value, so a row missing its
 *   `display_name` is reported rather than credited to whoever the email is to.
 *
 * Every missing blank and every bad link is named in one error, so the send
 * page can show the whole problem at once instead of one field per attempt.
 */

export type Row = string | Readonly<Record<string, string>>;
export type TemplateValues = Readonly<Record<string, string | readonly Row[]>>;

const SECTION = /\{\{#([a-z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const TAG = /\{\{([a-z_]+)\}\}/g;
// An apostrophe is legal in a URL and `encodeURIComponent` leaves it alone, so a
// question like "Asha's bisi bele bath" keeps one; `esc` makes it `&#39;`.
const URL_OK = /^(?:https:\/\/|http:\/\/localhost(?::\d+)?(?:\/|$))[^\s"<>]*$/;

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");

function paragraphs(text: string): string {
  const paras = text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((p) => esc(p.trim()).replace(/\n/g, "<br>"));
  return paras
    .map((p, i) => `<p style="margin:${i === paras.length - 1 ? "0" : "0 0 14px"};">${p}</p>`)
    .join("");
}

// The pattern keeps the characters attribute-safe; the parse catches what a
// pattern cannot, such as "https://" with no host. URL_OK has already pinned
// any http link to localhost.
function linkOk(url: string): boolean {
  if (!URL_OK.test(url)) return false;
  try {
    // A login part ("https://kranticookbook.com@evil.example") reads as our
    // address and goes to another; no link these emails send carries one.
    const { protocol, hostname, username, password } = new URL(url);
    if (username || password) return false;
    return protocol === "https:" ? hostname !== "" : hostname === "localhost";
  } catch {
    return false;
  }
}

function scalar(name: string, value: string, invalid: Set<string>): string {
  if (name === "message") return paragraphs(value);
  if (name.endsWith("_url")) {
    const url = name === "site_url" ? value.replace(/\/+$/, "") : value;
    if (!linkOk(url)) {
      invalid.add(name);
      return "";
    }
    return esc(url);
  }
  return esc(value);
}

function scalars(
  html: string,
  values: Readonly<Record<string, unknown>>,
  missing: Set<string>,
  invalid: Set<string>,
): string {
  return html.replace(TAG, (_, name: string) => {
    const value = values[name];
    if (typeof value !== "string" || value.trim() === "") {
      missing.add(name);
      return "";
    }
    return scalar(name, value, invalid);
  });
}

export function fillTemplate(html: string, values: TemplateValues): string {
  const missing = new Set<string>();
  const invalid = new Set<string>();
  const listed = html.replace(SECTION, (_, name: string, body: string) => {
    const rows = values[name];
    if (!Array.isArray(rows) || rows.length === 0) {
      missing.add(name);
      return "";
    }
    return (rows as readonly Row[])
      .map((row, i) => {
        const fields = typeof row === "string" ? { item: row } : row;
        return scalars(body, { ...fields, n: String(i + 1) }, missing, invalid);
      })
      .join("");
  });
  const out = scalars(listed, values, missing, invalid);
  const problems = [
    missing.size ? `missing: ${[...missing].sort().join(", ")}` : "",
    invalid.size ? `not https: ${[...invalid].sort().join(", ")}` : "",
  ].filter(Boolean);
  if (problems.length) throw new Error(problems.join("; "));
  if (out.includes("{{")) throw new Error("a blank was left unfilled (a list opened and never closed?)");
  return out;
}
