/**
 * Pins the mailroom's pure core: reading pasted addresses, the daily
 * allowance, the try-it question, turning the Write form into template values,
 * composing an email, its plain-text part, and loading the nine templates.
 *
 *   npx tsx scripts/check-mailroom.ts
 *
 * Offline: no Neon, no Atlas, no Resend. The store and the sender are thin
 * layers over these and are verified by review and the owner's live sends.
 */
import { UNTRACKED_PATH } from "../src/lib/analytics";
import { kitchen, mailroom, pantry, recipeBox } from "../src/lib/dash/auth";
import { composeEmail, HTML_MAX } from "../src/lib/mailroom/compose";
import { DraftError, parseDraft, valuesFromDraft, type RecipeFacts } from "../src/lib/mailroom/draft";
import { mailroomDailyMax, parseRecipients, planBatch, utcDayStart } from "../src/lib/mailroom/budget";
import { oneClickUrl, TOKEN_PATTERN, unsubscribeUrl } from "../src/lib/mailroom/links";
import { questionFindsRecipe, tryQuestion, tryUrl } from "../src/lib/mailroom/question";
import { loadTemplate } from "../src/lib/mailroom/templates";
import { plainText } from "../src/lib/mailroom/text";
import { newToken } from "../src/lib/mailroom/token";
import { TEMPLATE_IDS, TEMPLATES } from "../src/lib/mail-templates/registry";
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

const SITE = "https://kranticookbook.com";

// --- pasted addresses -----------------------------------------------------------
{
  const r = parseRecipients("A@x.com, b@y.org;\n c@z.in  a@x.com\nnot-an-email <d@w.co>");
  check("recipients: split on commas, semicolons, spaces and lines", r.valid.join() === "a@x.com,b@y.org,c@z.in,d@w.co");
  check("recipients: duplicates kept once, lowercased", r.valid.filter((e) => e === "a@x.com").length === 1);
  check("recipients: unreadable pieces are reported", r.invalid.join() === "not-an-email");
  check("recipients: empty input is empty", parseRecipients("  \n ").valid.length === 0);
}

// --- the daily allowance ----------------------------------------------------------
delete process.env.MAILROOM_DAILY_MAX;
check("allowance: unset means 25", mailroomDailyMax() === 25);
process.env.MAILROOM_DAILY_MAX = " 40 ";
check("allowance: trimmed number", mailroomDailyMax() === 40);
process.env.MAILROOM_DAILY_MAX = "0";
check("allowance: 0 sends nothing", mailroomDailyMax() === 0);
process.env.MAILROOM_DAILY_MAX = "lots";
check("allowance: unparseable means 25", mailroomDailyMax() === 25);
delete process.env.MAILROOM_DAILY_MAX;
check(
  "allowance: the day starts at midnight UTC",
  utcDayStart(new Date("2026-10-09T23:59:59+05:30")).toISOString() === "2026-10-09T00:00:00.000Z",
);
{
  const plan = planBatch(["a@x.com", "b@x.com", "c@x.com", "d@x.com"], new Set(["b@x.com"]), 2);
  check("plan: opted-out addresses are skipped, not counted", plan.optedOut.join() === "b@x.com");
  check("plan: sends fill today's room in order", plan.send.join() === "a@x.com,c@x.com");
  check("plan: the rest wait", plan.waiting.join() === "d@x.com");
  check("plan: no room means everyone waits", planBatch(["a@x.com"], new Set(), 0).waiting.length === 1);
  check("plan: negative room is no room", planBatch(["a@x.com"], new Set(), -3).send.length === 0);
}

// --- links and tokens -------------------------------------------------------------
{
  const tokens = new Set(Array.from({ length: 1000 }, () => newToken()));
  check("token: 24 url-safe characters", [...tokens].every((t) => TOKEN_PATTERN.test(t)));
  check("token: no repeats in 1,000", tokens.size === 1000);
  check("links: unsubscribe page", unsubscribeUrl(SITE, "t") === `${SITE}/unsubscribe?u=t`);
  check("links: one-click endpoint", oneClickUrl(SITE, "t") === `${SITE}/api/unsubscribe?u=t`);
}

// --- the try-it question ------------------------------------------------------------
{
  const q = tryQuestion("Asha Kulkarni", "Bisi Bele Bath");
  check("question: built from name and recipe", q === "Give me Asha Kulkarni's bisi bele bath recipe");
  check("question: url-encoded onto the home page", tryUrl(SITE, q) === `${SITE}/?q=${encodeURIComponent(q)}`);
  check("question: finds the recipe by its tag", questionFindsRecipe(q, "bisi-bele-bath", ["bisi bele bath"]));
  check("question: finds it by an alias", questionFindsRecipe("Show me bisibelebath please", "bisi-bele-bath", ["bisibelebath"]));
  check("question: warns once the name is gone", !questionFindsRecipe("Give me Asha's rice dish", "bisi-bele-bath", ["bisi bele bath"]));
}

// --- the Write form -> values ----------------------------------------------------
const recipes = new Map<string, RecipeFacts>([
  [
    "a".repeat(24),
    { id: "a".repeat(24), recipe_name: "Sol kadhi", display_name: "Rohan Naik", state: "Goa", belongs_to: "mother", tag: "sol-kadhi", aliases: ["sol kadhi"] },
  ],
]);
{
  const draft = parseDraft({
    template: "thank-you/published",
    fields: { subject: "S", heading: "H", message: "M", preheader: "P", display_name: "Asha", recipe_name: "Dal", state: "Goa", belongs_to: "mother", question: "Give me Asha's dal recipe", try_url: "javascript:alert(1)", site_url: "https://evil.example" },
    lists: {},
  });
  const v = valuesFromDraft(draft, SITE, recipes);
  check("draft: a link sent by the form is ignored", v.try_url === tryUrl(SITE, "Give me Asha's dal recipe"));
  check("draft: the site comes from the server", v.site_url === SITE);
  check("draft: undeclared fields are dropped", !("count" in v));
}
{
  const draft = parseDraft({
    template: "needs-changes/general-edits",
    fields: { subject: "S", heading: "H", message: "M", preheader: "P", display_name: "A", recipe_name: "R" },
    lists: { changes: ["  one  ", "", "two"], missing: ["ignored"] },
  });
  const v = valuesFromDraft(draft, SITE, recipes);
  check("draft: list items trimmed, blanks dropped", JSON.stringify(v.changes) === '["one","two"]');
  check("draft: lists the template lacks are dropped", !("missing" in v));
  check("draft: the add-recipe link is built", v.add_recipe_url === `${SITE}/add-recipe`);
}
{
  const draft = parseDraft({
    template: "keep-sharing/tell-everyone-the-story",
    fields: { subject: "S", heading: "H", message: "M", preheader: "P" },
    lists: {},
    recipes: [{ id: "a".repeat(24), question: "" }],
    recipients: "x@y.com",
  });
  const v = valuesFromDraft(draft, SITE, recipes);
  const row = (v.recipes as Record<string, string>[])[0];
  check("draft: a recipe row comes from the store", row.display_name === "Rohan Naik" && row.state === "Goa");
  check("draft: an empty question gets the default", row.question === "Give me Rohan Naik's sol kadhi recipe");
  check("draft: the row's try link is built", row.try_url === tryUrl(SITE, row.question));
  check(
    "draft: a recipe that is not published is refused",
    throws(() => valuesFromDraft({ ...draft, recipes: [{ id: "b".repeat(24), question: "" }] }, SITE, recipes), "not a published recipe"),
  );
}
check("draft: unknown template refused", throws(() => parseDraft({ template: "x/y", fields: {}, lists: {} }), "template"));
check("draft: fields must be strings", throws(() => parseDraft({ template: "thank-you/received", fields: { subject: 3 }, lists: {} }), "fields"));
check(
  "draft: an over-long message is refused",
  throws(
    () => valuesFromDraft(parseDraft({ template: "thank-you/received", fields: { message: "x".repeat(6001) }, lists: {} }), SITE, recipes),
    "message",
  ),
);
check(
  "draft: an over-long question is refused",
  throws(
    () => valuesFromDraft(parseDraft({ template: "thank-you/published", fields: { question: "q".repeat(201) }, lists: {} }), SITE, recipes),
    "question",
  ),
);
check("draft: DraftError is what it throws", (() => { try { parseDraft(null); return false; } catch (e) { return e instanceof DraftError; } })());

// --- composing --------------------------------------------------------------------------
for (const id of TEMPLATE_IDS) {
  const template = loadTemplate(id);
  const values = sampleValues(id, SITE);
  const list = TEMPLATES[id].audience === "list";
  const c = composeEmail(id, template, values, list ? oneClickUrl(SITE, "t") : undefined);
  check(`compose ${id}: html under ${HTML_MAX} bytes`, Buffer.byteLength(c.html) < HTML_MAX);
  check(
    `compose ${id}: unsubscribe headers exactly on list emails`,
    list
      ? c.headers["List-Unsubscribe"] === `<${oneClickUrl(SITE, "t")}>` && c.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click"
      : Object.keys(c.headers).length === 0,
  );
  const text = plainText(id, values);
  check(`text ${id}: carries the heading and the message`, text.includes("Heading goes here") && text.includes("Your message goes here."));
  check(`text ${id}: no html`, !/<[a-z]/i.test(text));
  check(`text ${id}: unsubscribe link exactly on list emails`, list === text.includes(`${SITE}/unsubscribe`));
}
{
  const values = sampleValues("thank-you/received", SITE);
  const tpl = loadTemplate("thank-you/received");
  check("compose: a subject with a line break is refused", throws(() => composeEmail("thank-you/received", tpl, { ...values, subject: "a\r\nBcc: x@y.com" }), "subject"));
  check("compose: a 151-character subject is refused", throws(() => composeEmail("thank-you/received", tpl, { ...values, subject: "s".repeat(151) }), "subject"));
  check(
    "compose: a list email without its one-click link is refused",
    throws(() => composeEmail("keep-sharing/anniversary", loadTemplate("keep-sharing/anniversary"), sampleValues("keep-sharing/anniversary", SITE)), "one-click"),
  );
  check("compose: missing blanks still come from fill", throws(() => composeEmail("thank-you/received", tpl, { ...values, heading: "" }), "missing: heading"));
}
{
  const t = plainText("keep-sharing/tell-everyone-the-story", sampleValues("keep-sharing/tell-everyone-the-story", SITE));
  check("text: every recipe row is listed with its question", t.includes("Sol kadhi") && t.includes("Give me Rohan Naik's sol kadhi recipe"));
  const g = plainText("needs-changes/general-edits", sampleValues("needs-changes/general-edits", SITE));
  check("text: a checklist is numbered", g.includes("1. First thing to change goes here.") && g.includes("3. Third thing"));
}
check("templates: an unknown id is refused", throws(() => loadTemplate("../../.env" as never), "unknown template"));

// --- the door: env-var names are literals tsc cannot check ------------------
// A typo reads an unset variable, and the door then fail-closes to 404 in
// production without a type error.
check(
  "analytics: /mailroom and its endpoints are untracked, /mailrooms is not",
  UNTRACKED_PATH.test("/mailroom") && UNTRACKED_PATH.test("/mailroom/api/mail") && !UNTRACKED_PATH.test("/mailrooms"),
);
process.env.MAILROOM_PASSWORD = "m-live";
process.env.KITCHEN_PASSWORD = "k-live";
process.env.ADMIN_PASSWORD = "p-live";
process.env.RECIPE_BOX_PASSWORD = "r-live";
check(
  "mailroom door is kc_mailroom on /mailroom and reads MAILROOM_PASSWORD",
  mailroom.cookie === "kc_mailroom" && mailroom.path === "/mailroom" && mailroom.password() === "m-live",
);
const mailroomToken = mailroom.issueToken("m-live").value;
check(
  "a mailroom session opens no other door",
  !kitchen.tokenValid(mailroomToken, "k-live") && !pantry.tokenValid(mailroomToken, "p-live") && !recipeBox.tokenValid(mailroomToken, "r-live"),
);
check(
  "no other door's session opens the mailroom",
  !mailroom.tokenValid(kitchen.issueToken("k-live").value, "m-live") &&
    !mailroom.tokenValid(pantry.issueToken("p-live").value, "m-live") &&
    !mailroom.tokenValid(recipeBox.issueToken("r-live").value, "m-live"),
);
delete process.env.MAILROOM_PASSWORD;
delete process.env.KITCHEN_PASSWORD;
delete process.env.ADMIN_PASSWORD;
delete process.env.RECIPE_BOX_PASSWORD;

if (failed > 0) {
  console.error(`\ncheck-mailroom: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-mailroom: all mailroom checks pass");
