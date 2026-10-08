/**
 * Pins the recipe emails in `email-templates/` against their registry, and the
 * fill rules every one of them relies on.
 *
 *   npx tsx scripts/check-email-templates.ts
 *
 * Offline: reads the templates and `public/email-assets/`, nothing else.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { fillTemplate } from "../src/lib/mail-templates/fill";
import { COMMON_TAGS, TEMPLATE_DIR, TEMPLATE_IDS, TEMPLATES } from "../src/lib/mail-templates/registry";
import { SOCIALS } from "../src/lib/social";
import { sampleValues } from "./email-template-samples";

let failed = 0;
function check(name: string, pass: boolean): void {
  if (!pass) {
    failed += 1;
    console.error(`  FAIL ${name}`);
  } else {
    console.log(`  ok   ${name}`);
  }
}

function throws(fn: () => unknown, text: string): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return String(error).includes(text);
  }
}

// --- fill ---------------------------------------------------------------------
check(
  "fill: escapes values",
  fillTemplate("<b>{{a}}</b>", { a: `<i>"x"&'` }) === "<b>&lt;i&gt;&quot;x&quot;&amp;&#39;</b>",
);
check(
  "fill: a value cannot open another blank",
  fillTemplate("{{a}}{{b}}", { a: "{{b}}", b: "x" }) === "&#123;&#123;b&#125;&#125;x",
);
check(
  "fill: message splits into paragraphs on blank lines, keeps single breaks",
  fillTemplate("{{message}}", { message: "one\n\ntwo\nthree" }) ===
    '<p style="margin:0 0 14px;">one</p><p style="margin:0;">two<br>three</p>',
);
check(
  "fill: a javascript: link is refused",
  throws(() => fillTemplate('<a href="{{try_url}}">', { try_url: "javascript:alert(1)" }), "try_url"),
);
check(
  "fill: a plain http link is refused",
  throws(() => fillTemplate('<a href="{{try_url}}">', { try_url: "http://example.com/" }), "try_url"),
);
check(
  "fill: localhost lookalikes are refused",
  throws(() => fillTemplate('<a href="{{try_url}}">', { try_url: "http://localhost.evil.com/" }), "try_url"),
);
check(
  "fill: an https link is kept, escaped",
  fillTemplate('<a href="{{try_url}}">', { try_url: "https://kranticookbook.com/?q=a&b" }) ===
    '<a href="https://kranticookbook.com/?q=a&amp;b">',
);
check(
  "fill: an apostrophe in a link is kept, escaped",
  fillTemplate('<a href="{{try_url}}">', { try_url: "https://kranticookbook.com/?q=Asha's%20dal" }) ===
    '<a href="https://kranticookbook.com/?q=Asha&#39;s%20dal">',
);
check(
  "fill: localhost is allowed for previews",
  fillTemplate("{{add_recipe_url}}", { add_recipe_url: "http://localhost:3100/add-recipe" }) ===
    "http://localhost:3100/add-recipe",
);
check(
  "fill: site_url loses a trailing slash",
  fillTemplate("{{site_url}}/x", { site_url: "https://kranticookbook.com/" }) === "https://kranticookbook.com/x",
);
check(
  "fill: a list of strings repeats with item and n",
  fillTemplate("{{#l}}<li>{{n}}. {{item}}</li>{{/l}}", { l: ["a", "b"] }) === "<li>1. a</li><li>2. b</li>",
);
check(
  "fill: a list of rows reads its named fields",
  fillTemplate("{{#r}}{{name}}@{{place}};{{/r}}", { r: [{ name: "x", place: "Goa" }, { name: "y", place: "Pune" }] }) ===
    "x@Goa;y@Pune;",
);
check(
  "fill: a row does not inherit a top-level value",
  throws(() => fillTemplate("{{#r}}{{name}}@{{place}};{{/r}}", { place: "Goa", r: [{ name: "x" }] }), "missing: place"),
);
check("fill: an empty list is missing", throws(() => fillTemplate("[{{#l}}x{{/l}}]", { l: [] }), "missing: l"));
check("fill: an empty string is missing", throws(() => fillTemplate("{{a}}", { a: "" }), "missing: a"));
check(
  "fill: a whitespace-only message is missing",
  throws(() => fillTemplate("{{message}}", { message: " \n\n\t " }), "missing: message"),
);
check(
  "fill: https:// with no host is refused",
  throws(() => fillTemplate('<a href="{{try_url}}">', { try_url: "https://" }), "not https: try_url"),
);
check(
  "fill: a link with a login part is refused",
  throws(
    () => fillTemplate('<a href="{{try_url}}">', { try_url: "https://kranticookbook.com@evil.example/" }),
    "not https: try_url",
  ),
);
check(
  "fill: message reads CRLF line breaks as LF",
  fillTemplate("{{message}}", { message: "one\r\n\r\ntwo\r\nthree" }) ===
    fillTemplate("{{message}}", { message: "one\n\ntwo\nthree" }),
);
check(
  "fill: every missing blank is named at once",
  throws(() => fillTemplate("{{a}}{{b}}{{#c}}x{{/c}}", {}), "missing: a, b, c"),
);
check(
  "fill: missing blanks and bad links are reported together",
  throws(
    () => fillTemplate("{{a_url}}{{b_url}}{{c}}", { a_url: "javascript:alert(1)", b_url: "http://example.com/" }),
    "missing: c; not https: a_url, b_url",
  ),
);
check("fill: a list left open is refused", throws(() => fillTemplate("{{#a}}x", { a: [] }), "unfilled"));

// --- the templates --------------------------------------------------------------
const TAG = /\{\{([a-z_]+)\}\}/g;
const SECTION = /\{\{#([a-z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const ASSET = "{{site_url}}/email-assets/";
const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1];

async function templates(): Promise<void> {
  check("registry: nine templates", TEMPLATE_IDS.length === 9);

  for (const id of TEMPLATE_IDS) {
    const spec = TEMPLATES[id];
    const file = join(TEMPLATE_DIR, `${id}.html`);
    if (!existsSync(file)) {
      check(`${id}: file exists`, false);
      continue;
    }
    const html = readFileSync(file, "utf8");
    check(`${id}: under 100,000 bytes`, statSync(file).size < 100_000);
    check(`${id}: subject is the title`, html.includes("<title>{{subject}}</title>"));
    check(`${id}: preheader is hidden`, /display:none[^"]*">\{\{preheader\}\}</.test(html));

    // Blanks, both ways: declared ones are all used, used ones are all declared.
    const declared = new Set<string>([...COMMON_TAGS, ...spec.tags]);
    const used = new Set([...html.matchAll(TAG)].map((m) => m[1]));
    const outside = html.replace(SECTION, "");
    const outsideTags = [...outside.matchAll(TAG)].map((m) => m[1]);
    check(`${id}: every blank outside a list is declared`, outsideTags.every((t) => declared.has(t)));
    check(`${id}: every declared blank is used`, [...declared].every((t) => used.has(t)));
    check(`${id}: no list left open`, !/\{\{[#/]/.test(outside));

    const sections = [...html.matchAll(SECTION)];
    const names = sections.map((m) => m[1]).sort();
    check(`${id}: lists are exactly the declared ones`, names.join() === Object.keys(spec.lists).sort().join());
    for (const [, name, body] of sections) {
      const fields = spec.lists[name] ?? [];
      const inner = new Set([...body.matchAll(TAG)].map((m) => m[1]));
      check(
        `${id}: list ${name} uses only its fields`,
        [...inner].every((t) => fields.includes(t) || t === "n"),
      );
      check(`${id}: list ${name} uses all its fields`, fields.every((f) => inner.has(f)));
    }

    // Safety and links.
    check(`${id}: no script, handler or javascript: link`, !/<script|\son[a-z]+\s*=|javascript:/i.test(html));
    // The link rule below reads only `href="…"`, so anything spelled another way
    // (single quotes, spaces round `=`) fails here instead of slipping past it.
    check(
      `${id}: every href and src is double-quoted`,
      (html.match(/\s(?:href|src)\s*=/gi)?.length ?? 0) === (html.match(/\s(?:href|src)="/gi)?.length ?? 0),
    );
    const links = [...html.matchAll(/\s(?:href|src)="([^"]*)"/gi)].map((m) => m[1]);
    check(
      `${id}: every link is a url blank or https`,
      links.every((l) => (l.includes("{{") ? /^\{\{[a-z_]+_url\}\}(?:\/[^{"]*)?$/.test(l) : l.startsWith("https://"))),
    );
    // `background=` is Outlook's background-image attribute: a link the rules
    // above never read.
    check(`${id}: no CSS url(), srcset or background=`, !/url\(|srcset\s*=|\sbackground\s*=/i.test(html));

    // Footer.
    check(`${id}: footer links every social`, SOCIALS.every((s) => html.includes(`href="${s.href}"`)));
    check(
      `${id}: unsubscribe link exactly on list emails`,
      (spec.audience === "list") === html.includes('href="{{unsubscribe_url}}"'),
    );

    // Images.
    for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
      const src = attr(tag, "src") ?? "";
      const alt = attr(tag, "alt");
      const width = Number(attr(tag, "width"));
      const height = Number(attr(tag, "height"));
      const name = src.split("/").pop() ?? src;
      const path = src.startsWith(ASSET) ? join("public", "email-assets", src.slice(ASSET.length)) : null;
      check(`${id}: ${name} has width and height`, width > 0 && height > 0);
      check(`${id}: ${name} has alt (empty only on art-*)`, alt !== undefined && (alt !== "" || name.startsWith("art-")));
      check(`${id}: ${name} is a file in public/email-assets`, path !== null && existsSync(path));
      if (path && existsSync(path)) {
        const meta = await sharp(path).metadata();
        check(`${id}: ${name} is at least twice its display width`, (meta.width ?? 0) >= width * 2);
        check(`${id}: ${name} is under 100KB`, statSync(path).size < 100_000);
      }
    }

    // Filled with the samples, nothing is left over.
    let filled = "";
    try {
      filled = fillTemplate(html, sampleValues(id, "https://kranticookbook.com"));
    } catch (error) {
      console.error(`  ${id}: ${String(error)}`);
    }
    check(`${id}: fills from the samples with nothing left over`, filled !== "" && !filled.includes("{{"));
  }
}

templates().then(() => {
  if (failed > 0) {
    console.error(`\ncheck-email-templates: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\ncheck-email-templates: all email template checks pass");
  process.exit(0);
});
