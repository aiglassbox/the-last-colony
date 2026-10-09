import { mailPick, publishedPicks } from "@/lib/community/client";
import type { TemplateValues } from "@/lib/mail-templates/fill";
import { TEMPLATES, type TemplateId } from "@/lib/mail-templates/registry";
import { siteUrl } from "@/lib/site-url";

import { MAX_RECIPIENTS, mailroomDailyMax, parseRecipients, planBatch } from "./budget";
import { composeEmail, type Composed } from "./compose";
import { DraftError, isTemplateId, valuesFromDraft, type Draft, type MailPick, type RecipeFacts } from "./draft";
import { oneClickUrl, unsubscribeUrl } from "./links";
import { questionFindsRecipe } from "./question";
import {
  claimWaiting,
  createBatch,
  getAutoReceived,
  getBatch,
  logQueued,
  logSend,
  optedOutAmong,
  sentToday,
  tokenFor,
  updateSend,
  waitingInBatch,
} from "./store";
import { loadTemplate } from "./templates";

/**
 * Preview, send, "Send the rest", and the automatic `received`.
 *
 * Every email goes through `composeEmail`, so through part 1's
 * `fillTemplate`: values escaped, links https only, every blank filled. A
 * submitter email's address is read from the store by id, never from the
 * form. A list email gets its person's own unsubscribe link and Gmail's
 * one-click header. Every attempt is written to `mail_sends`, including the
 * ones that were not sent.
 */

const FROM = "Kranti Cookbook <noreply@kranticookbook.com>";
const RESEND_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 8000;
/** Stands in for a person's token in a preview; never stored, never valid. */
const PREVIEW_TOKEN = "preview0preview0preview0";

export interface Preview {
  subject: string;
  html: string;
  text: string;
  warnings: string[];
  to: string | null;
  recipients: { valid: number; invalid: string[]; optedOut: number; send: number; waiting: number } | null;
  remaining: number;
}

export interface SendSummary {
  sent: number;
  optedOut: number;
  waiting: number;
  failed: number;
  overLimit: number;
  batchId: string | null;
  errors: string[];
}

const empty = (): SendSummary => ({ sent: 0, optedOut: 0, waiting: 0, failed: 0, overLimit: 0, batchId: null, errors: [] });

/**
 * One email to Resend. A timeout reports failure even though Resend may have
 * sent it anyway; the log then says "failed" for a message that arrived,
 * which is the safe way round for an operator deciding whether to resend.
 */
async function resendSend(to: string, email: Composed): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set" };
  const replyTo = process.env.MAIL_REPLY_TO?.trim();
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      // Sender and recipient last, so nothing composed can override them.
      body: JSON.stringify({
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(Object.keys(email.headers).length > 0 && { headers: email.headers }),
        ...(replyTo && { reply_to: replyTo }),
        from: FROM,
        to,
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown; name?: unknown } | null;
    if (res.ok && typeof body?.id === "string") return { ok: true, id: body.id };
    return { ok: false, error: `resend ${res.status}${typeof body?.name === "string" ? ` ${body.name}` : ""}` };
  } catch (error) {
    return { ok: false, error: `resend call failed (${error instanceof Error ? error.name : "unknown"})` };
  }
}

function compose(id: TemplateId, values: TemplateValues, oneClick?: string): Composed {
  return composeEmail(id, loadTemplate(id), values, oneClick);
}

/** The live recipes a tell-everyone draft names. Empty for every other email. */
async function recipeMap(draft: Draft): Promise<Map<string, RecipeFacts>> {
  if (!draft.recipes?.length) return new Map();
  const live = await publishedPicks();
  if (!live) throw new Error("the recipe store is unavailable");
  return new Map(live.map((m) => [m.id, m]));
}

async function requireSubmission(id: string | undefined): Promise<MailPick & { contact: string }> {
  if (!id) throw new DraftError("choose the submission this email is about");
  const pick = await mailPick(id);
  if (!pick) throw new DraftError("that submission was not found, or the recipe store is unavailable");
  if (!pick.verified || !pick.contact) throw new DraftError("that submission has no verified email address");
  return { ...pick, contact: pick.contact };
}

function questionWarnings(draft: Draft, values: TemplateValues, recipes: Map<string, RecipeFacts>, sub: MailPick | null): string[] {
  const warnings: string[] = [];
  if (sub && typeof values.question === "string" && !questionFindsRecipe(values.question, sub.tag, sub.aliases)) {
    warnings.push(`The question no longer names ${sub.recipe_name}, so Kranti may answer with something else.`);
  }
  for (const row of draft.recipes ?? []) {
    const r = recipes.get(row.id);
    const q = row.question.trim();
    if (r && q && !questionFindsRecipe(q, r.tag, r.aliases)) {
      warnings.push(`The question for ${r.recipe_name} no longer names it, so Kranti may answer with something else.`);
    }
  }
  return warnings;
}

const remainingToday = async (): Promise<number> => Math.max(0, mailroomDailyMax() - (await sentToday()));

/** The addresses a list draft names; Preview and Send refuse the same lists. */
function listRecipients(draft: Draft): { valid: string[]; invalid: string[] } {
  const { valid, invalid } = parseRecipients(draft.recipients ?? "");
  if (valid.length === 0) throw new DraftError("paste at least one valid address");
  if (valid.length > MAX_RECIPIENTS) throw new DraftError(`at most ${MAX_RECIPIENTS} addresses per send`);
  return { valid, invalid };
}

export async function previewDraft(draft: Draft): Promise<Preview> {
  const site = siteUrl();
  const recipes = await recipeMap(draft);
  const values = valuesFromDraft(draft, site, recipes);
  // Before the allowance read, so a list that Send would refuse fails at once.
  const addresses = TEMPLATES[draft.template].audience === "submitter" ? null : listRecipients(draft);
  const remaining = await remainingToday();

  if (addresses === null) {
    const sub = await requireSubmission(draft.submissionId);
    const email = compose(draft.template, values);
    return { ...email, warnings: questionWarnings(draft, values, recipes, sub), to: sub.contact, recipients: null, remaining };
  }

  const { valid, invalid } = addresses;
  const plan = planBatch(valid, await optedOutAmong(valid), remaining);
  const email = compose(
    draft.template,
    { ...values, unsubscribe_url: unsubscribeUrl(site, PREVIEW_TOKEN) },
    oneClickUrl(site, PREVIEW_TOKEN),
  );
  return {
    ...email,
    warnings: questionWarnings(draft, values, recipes, null),
    to: null,
    recipients: { valid: valid.length, invalid, optedOut: plan.optedOut.length, send: plan.send.length, waiting: plan.waiting.length },
    remaining,
  };
}

export async function sendDraft(draft: Draft): Promise<SendSummary> {
  return TEMPLATES[draft.template].audience === "submitter" ? sendToSubmitter(draft) : sendToList(draft);
}

async function sendToSubmitter(draft: Draft): Promise<SendSummary> {
  const site = siteUrl();
  const sub = await requireSubmission(draft.submissionId);
  const email = compose(draft.template, valuesFromDraft(draft, site, new Map()));
  const base = { template: draft.template, to: sub.contact, subject: email.subject, source: "mailroom" as const };

  if ((await remainingToday()) <= 0) {
    await logSend({ ...base, status: "over_limit", error: "daily limit reached" });
    return { ...empty(), overLimit: 1, errors: ["Today's mailroom allowance is used up. It resets at midnight UTC (5:30 am IST)."] };
  }
  const result = await resendSend(sub.contact, email);
  await logSend({ ...base, status: result.ok ? "sent" : "failed", resendId: result.ok ? result.id : null, error: result.ok ? null : result.error });
  return result.ok ? { ...empty(), sent: 1 } : { ...empty(), failed: 1, errors: [result.error] };
}

async function deliverToListMember(id: TemplateId, values: TemplateValues, to: string, site: string) {
  const token = await tokenFor(to);
  const email = compose(id, { ...values, unsubscribe_url: unsubscribeUrl(site, token) }, oneClickUrl(site, token));
  return resendSend(to, email);
}

/**
 * Pause between Resend calls: its default rate limit is a few requests a
 * second, and a 429 would be logged as failed and never retried.
 * ponytail: 25 sends is about 12 s of gaps inside the route's 60 s. If a 429
 * ever shows in the log, treat it as waiting instead of failed.
 */
const SEND_GAP_MS = 500;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The one loop behind a new list send and "Send the rest". Every address
 * already has a `waiting` row. Before each Resend call the allowance is read
 * afresh and the row is claimed, so overlapping sends cannot spend the same
 * allowance twice or send the same row twice. (The same address in two
 * batches is sent twice, by design.) Addresses the allowance
 * does not reach stay `waiting`. Opt-outs are re-checked here, since a day may
 * have passed.
 */
async function sendWaiting(batchId: string, id: TemplateId, values: TemplateValues, site: string, summary: SendSummary): Promise<SendSummary> {
  const waiting = await waitingInBatch(batchId);
  const opted = await optedOutAmong(waiting.map((w) => w.to));
  let capped = false;
  let sentOne = false;

  for (const w of waiting) {
    if (opted.has(w.to)) {
      await updateSend(w.id, "opted_out", null, "opted out");
      summary.optedOut += 1;
      continue;
    }
    // The pause comes first so the allowance read, the claim and the send run
    // back to back; a timeout mid-pause must not leave a claimed row unsent.
    if (!capped) {
      if (sentOne) await pause(SEND_GAP_MS);
      if ((await remainingToday()) <= 0) capped = true;
    }
    if (capped) {
      summary.waiting += 1;
      continue;
    }
    if (!(await claimWaiting(w.id))) continue;
    sentOne = true;
    const result = await deliverToListMember(id, values, w.to, site);
    await updateSend(w.id, result.ok ? "sent" : "failed", result.ok ? result.id : null, result.ok ? null : result.error);
    if (result.ok) summary.sent += 1;
    else {
      summary.failed += 1;
      summary.errors.push(`${w.to}: ${result.error}`);
    }
  }
  return summary;
}

async function sendToList(draft: Draft): Promise<SendSummary> {
  const site = siteUrl();
  const { valid, invalid } = listRecipients(draft);

  const recipes = await recipeMap(draft);
  const values = valuesFromDraft(draft, site, recipes);
  // Composed once with a stand-in token before anything is logged, so a draft
  // with a hole in it is refused whole, not after the first send.
  const subject = compose(
    draft.template,
    { ...values, unsubscribe_url: unsubscribeUrl(site, PREVIEW_TOKEN) },
    oneClickUrl(site, PREVIEW_TOKEN),
  ).subject;

  const stored: Draft = { ...draft };
  delete stored.recipients;
  const batchId = await createBatch(draft.template, stored);
  const opted = await optedOutAmong(valid);
  const base = { batchId, template: draft.template, subject, source: "mailroom" as const };

  // Every address gets a row before the first send, so a send cut off part-way
  // leaves the unreached ones `waiting` for "Send the rest".
  const optedOutList = valid.filter((to) => opted.has(to));
  await logQueued(base, optedOutList, "opted_out", "opted out");
  await logQueued(base, valid.filter((to) => !opted.has(to)), "waiting", null);

  return sendWaiting(batchId, draft.template, values, site, {
    ...empty(),
    batchId,
    optedOut: optedOutList.length,
    errors: invalid.length > 0 ? [`Could not read: ${invalid.join(", ")}`] : [],
  });
}

/**
 * A list's waiting addresses, within today's allowance, with the batch's own
 * stored form. A recipe unpublished since then refuses the whole batch, rather
 * than showing a recipe that is no longer live.
 */
export async function sendRest(batchId: string): Promise<SendSummary> {
  const batch = await getBatch(batchId);
  if (!batch || !isTemplateId(batch.template)) throw new DraftError("no such list send");
  const draft = { ...(batch.draft as Draft), template: batch.template };
  const site = siteUrl();
  const values = valuesFromDraft(draft, site, await recipeMap(draft));
  return sendWaiting(batchId, draft.template, values, site, { ...empty(), batchId });
}

/**
 * The automatic thank-you, sent from the submission route's `after()`. It
 * goes only when the operator has saved its text and switched it on, and only
 * within today's allowance. Missing or switched-off text is skipped silently,
 * or every submission would write a row; only the over-limit skip is logged.
 * It never throws: a submission must not fail because an email did.
 */
export async function sendAutoReceived(to: string, displayName: string, recipeName: string): Promise<void> {
  const id: TemplateId = "thank-you/received";
  try {
    const auto = await getAutoReceived();
    if (!auto?.enabled) return;
    const email = compose(id, {
      site_url: siteUrl(),
      subject: auto.subject,
      preheader: auto.preheader,
      heading: auto.heading,
      message: auto.message,
      display_name: displayName,
      recipe_name: recipeName,
    });
    const base = { template: id, to, subject: email.subject, source: "auto" as const };
    if ((await remainingToday()) <= 0) {
      await logSend({ ...base, status: "over_limit", error: "daily limit reached" });
      return;
    }
    const result = await resendSend(to, email);
    await logSend({ ...base, status: result.ok ? "sent" : "failed", resendId: result.ok ? result.id : null, error: result.ok ? null : result.error });
  } catch (error) {
    console.error("[mailroom] automatic received failed:", error instanceof Error ? error.message : error);
  }
}
