"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { COMMON_TAGS, TEMPLATE_IDS, TEMPLATES, type TemplateId } from "@/lib/mail-templates/registry";
import type { Draft, MailPick } from "@/lib/mailroom/draft";
import type { Preview, SendSummary } from "@/lib/mailroom/send";
import type { AutoReceived } from "@/lib/mailroom/store";

import { AutoPanel } from "./write/AutoPanel";
import { PreviewPane } from "./write/PreviewPane";
import { postMail } from "./write/post";
import { RECIPES_MAX, RecipePicker, type Picked } from "./write/RecipePicker";
import { SubmissionPicker } from "./write/SubmissionPicker";

/**
 * The Write tab: pick one of the nine emails, fill it, preview it, send it.
 *
 * The form holds words and choices only. Every link, and a submitter's
 * address, is the server's to add, so nothing typed here can point an email
 * somewhere else. The mailroom modules are imported for their types alone:
 * they pull in node:crypto, node:fs and mongodb, which must not reach the
 * browser, so the few limits and the default question are repeated here.
 *
 * Send is offered only for the exact draft that was last previewed. The
 * draft is compared as JSON, so any change after a preview, however small,
 * means previewing again; and a send consumes its preview, so a second click
 * cannot send the same email twice.
 */

export interface WriteProps {
  submissions: MailPick[] | null; // verified submissions, newest first; null when the store is down
  published: MailPick[] | null; // live recipes for tell-everyone; null when the store is down
  auto: AutoReceived | null; // the saved automatic-received text, or null if never saved
  remaining: number; // today's allowance left
  max: number; // the daily allowance
}

const FOLDERS = [
  { key: "thank-you", label: "Thank you" },
  { key: "needs-changes", label: "Needs changes" },
  { key: "keep-sharing", label: "Keep sharing" },
] as const;

/** Each email's name and when it is used, from the templates spec's table. */
const EMAILS: Record<TemplateId, { name: string; use: string }> = {
  "thank-you/received": { name: "Received", use: "Right after their recipe reaches us. Can be sent automatically." },
  "thank-you/published": { name: "Published", use: "When their recipe goes live on Kranti." },
  "thank-you/milestone": { name: "Milestone", use: "When their recipe has been shown to a set number of readers." },
  "needs-changes/general-edits": { name: "General edits", use: "When a few things need fixing before it can go live." },
  "needs-changes/health-claim": {
    name: "Health claim",
    use: "When the recipe says something about health or healing that we can't publish.",
  },
  "needs-changes/missing-details": {
    name: "Missing details",
    use: "When something is missing, such as quantities, steps or cooking time.",
  },
  "keep-sharing/add-your-recipe": {
    name: "Add your recipe",
    use: "Invites people who haven't submitted yet to add a family recipe.",
  },
  "keep-sharing/tell-everyone-the-story": {
    name: "Tell everyone the story",
    use: "Shows off published recipes, each with a button that asks Kranti for it.",
  },
  "keep-sharing/anniversary": {
    name: "Anniversary",
    use: "On Kranti Cookbook's own anniversary. It celebrates the site, not one recipe.",
  },
};

const LABELS: Record<string, string> = {
  display_name: "Their name",
  recipe_name: "Recipe name",
  state: "State",
  belongs_to: "Whose recipe (e.g. grandmother)",
  quoted_line: "Their line",
  suggested_line: "Your suggested wording",
  date_label: "Anniversary (e.g. 1 year)",
  count: "Readers reached",
  question: "Question Kranti should be asked",
};

const LIST_LABELS: Record<string, string> = {
  changes: "Things to change",
  missing: "What's missing",
  prompts: "Prompts (one per line, three read best)",
};

/** Filled from the chosen submission, and shown beside it. */
const PERSON_TAGS = ["display_name", "recipe_name", "state", "belongs_to"] as const;

/** subject, preheader, heading, message: every email has them, and they survive a change of email. */
const COMMON = COMMON_TAGS.filter((tag) => !tag.endsWith("_url"));

/** The server's limits (`draft.ts`, `compose.ts`, `question.ts`), so the form stops at them. The server still checks. */
const SUBJECT_MAX = 150;
const FIELD_MAX = 2_000;
const MESSAGE_MAX = 6_000;
const QUESTION_MAX = 200;

/** `tryQuestion` in `lib/mailroom/question.ts`, which cannot be imported here: it brings the community matcher with it. */
const defaultQuestion = (name: string, recipe: string) => `Give me ${name.trim()}'s ${recipe.trim().toLowerCase()} recipe`;

export function Write({ submissions, published, auto, remaining, max }: WriteProps) {
  const router = useRouter();

  const [template, setTemplate] = useState<TemplateId>(TEMPLATE_IDS[0]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<Record<string, string>>({});
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Picked[]>([]);
  const [recipients, setRecipients] = useState("");
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);

  const [view, setView] = useState<"form" | "preview">("form");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SendSummary | null>(null);

  /* The reader count is fetched on choosing a milestone submission. Each
     request is numbered and only the newest may land, so choosing A then B
     quickly cannot leave A's count in B's email. */
  const countTicket = useRef(0);

  const spec = TEMPLATES[template];
  const toPerson = spec.audience === "submitter";
  const blanks = spec.tags.filter((tag) => !tag.endsWith("_url"));
  const personBlanks = blanks.filter((tag) => (PERSON_TAGS as readonly string[]).includes(tag));
  const ownBlanks = blanks.filter((tag) => !personBlanks.includes(tag));
  const listNames = Object.keys(spec.lists).filter((name) => name !== "recipes");
  const picksRecipes = "recipes" in spec.lists;
  const chosen = submissions?.find((s) => s.id === submissionId) ?? null;

  const draft: Draft = { template, fields, lists: {} };
  for (const name of listNames) draft.lists[name] = (lists[name] ?? "").split("\n");
  if (toPerson && submissionId) draft.submissionId = submissionId;
  if (!toPerson) draft.recipients = recipients;
  if (picksRecipes) draft.recipes = recipes;
  const draftKey = JSON.stringify(draft);
  const fresh = preview !== null && previewKey === draftKey;

  const setField = (tag: string, value: string) => setFields((f) => ({ ...f, [tag]: value }));

  function chooseTemplate(next: TemplateId) {
    if (next === template) return;
    const kept: Record<string, string> = {};
    for (const tag of COMMON) if (fields[tag] !== undefined) kept[tag] = fields[tag];
    setTemplate(next);
    setSummary(null);
    setFields(kept);
    setLists({});
    setSubmissionId(null);
    setRecipes([]);
    setRecipients("");
    countTicket.current += 1;
    setCounting(false);
    setCountError(null);
    setView("form");
    setConfirming(false);
    setError(null);
  }

  function chooseSubmission(pick: MailPick) {
    setSubmissionId(pick.id);
    const next = { ...fields };
    for (const tag of personBlanks) next[tag] = pick[tag as (typeof PERSON_TAGS)[number]];
    if (blanks.includes("question")) next.question = defaultQuestion(pick.display_name, pick.recipe_name);
    if (blanks.includes("count")) {
      next.count = "";
      void loadCount(pick.id);
    }
    setFields(next);
  }

  async function loadCount(id: string) {
    const ticket = ++countTicket.current;
    setCounting(true);
    setCountError(null);
    const result = await postMail<{ count: number }>({ action: "served", submissionId: id });
    if (ticket !== countTicket.current) return;
    setCounting(false);
    if (result.ok) setField("count", result.data.count.toLocaleString("en-IN"));
    else setCountError(result.error);
  }

  function tick(pick: MailPick, on: boolean) {
    setRecipes((rs) => {
      if (!on) return rs.filter((r) => r.id !== pick.id);
      if (rs.length >= RECIPES_MAX || rs.some((r) => r.id === pick.id)) return rs;
      return [...rs, { id: pick.id, question: defaultQuestion(pick.display_name, pick.recipe_name) }];
    });
  }

  async function runPreview(event: FormEvent) {
    event.preventDefault();
    const sent = draftKey;
    setBusy("preview");
    setError(null);
    setSummary(null);
    setConfirming(false);
    const result = await postMail<Preview>({ action: "preview", draft });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPreview(result.data);
    setPreviewKey(sent);
    setView("preview");
  }

  async function runSend() {
    if (!fresh || busy) return;
    setBusy("send");
    setError(null);
    const result = await postMail<SendSummary>({ action: "send", draft });
    // Whatever came back, this preview is spent: a 500 may follow a partial
    // list send, and sending again from here would repeat the part that went.
    setPreviewKey(null);
    setBusy(null);
    setConfirming(false);
    if (result.ok) setSummary(result.data);
    else setError(result.error);
    router.refresh();
  }

  function confirmText(p: Preview): string {
    if (!p.recipients) return `Send to ${chosen?.display_name ?? p.to}?`;
    const r = p.recipients;
    return `Send to ${r.send} ${r.send === 1 ? "person" : "people"} now (${r.optedOut} opted out, ${r.waiting} waiting)?`;
  }

  const allowance = (
    <span className="mr-allowance">
      {remaining} of {max} left today
    </span>
  );

  const errorLine = error ? (
    <p className="mr-alert" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <div className="mr-write">
      <section className="k-panel mr-picker" aria-label="Choose an email">
        {FOLDERS.map((folder) => (
          <fieldset key={folder.key} className="mr-folder" disabled={busy !== null}>
            <legend className="k-panel__title">{folder.label}</legend>
            {TEMPLATE_IDS.filter((id) => id.startsWith(`${folder.key}/`)).map((id) => (
              <label key={id} className="mr-email">
                <input
                  type="radio"
                  name="mr-email"
                  className="sr-only"
                  value={id}
                  checked={template === id}
                  onChange={() => chooseTemplate(id)}
                />
                <span className="mr-email__name">{EMAILS[id].name}</span>
                <span className="mr-email__use">{EMAILS[id].use}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </section>

      <div className="mr-compose">
        <section className="k-panel" aria-labelledby="mr-compose-title">
          <h2 className="mr-compose__title" id="mr-compose-title">
            {EMAILS[template].name}
          </h2>
          <p className="k-panel__note">
            {EMAILS[template].use} {toPerson ? "Goes to one submitter." : "Goes to the addresses you paste."}
          </p>

          {/* Hidden, not unmounted, during a preview: Edit brings back the
              form exactly as it was, down to the search box. */}
          <form onSubmit={runPreview} hidden={view === "preview" && preview !== null}>
            <fieldset className="mr-form" disabled={busy !== null}>
              <fieldset className="mr-section">
                <legend className="k-panel__title">To</legend>
                {toPerson ? (
                  <div className="mr-who">
                    <SubmissionPicker submissions={submissions} chosenId={submissionId} onChoose={chooseSubmission} />

                    <div className="mr-person">
                      <p className="mr-meta">
                        {chosen ? `To: ${chosen.contact ?? "no address on file"}` : "Choose a submission to fill these in."}
                      </p>
                      <div className="mr-pair">
                        {personBlanks.map((tag) => (
                          <div key={tag} className="mr-field">
                            <label className="mr-label" htmlFor={`mr-f-${tag}`}>
                              {LABELS[tag] ?? tag}
                            </label>
                            <input
                              id={`mr-f-${tag}`}
                              className="k-input"
                              value={fields[tag] ?? ""}
                              maxLength={FIELD_MAX}
                              onChange={(e) => setField(tag, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mr-field">
                    <label className="mr-label" htmlFor="mr-recipients">
                      Paste addresses: one per line, or separated by commas
                    </label>
                    <textarea
                      id="mr-recipients"
                      className="k-input"
                      rows={5}
                      value={recipients}
                      spellCheck={false}
                      onChange={(e) => setRecipients(e.target.value)}
                    />
                  </div>
                )}
              </fieldset>

              <fieldset className="mr-section">
                <legend className="k-panel__title">Words</legend>
                <div className="mr-field">
                  <label className="mr-label" htmlFor="mr-f-subject">
                    Subject{" "}
                    <span className="mr-count">
                      {(fields.subject ?? "").length}/{SUBJECT_MAX}
                    </span>
                  </label>
                  <input
                    id="mr-f-subject"
                    className="k-input"
                    value={fields.subject ?? ""}
                    maxLength={SUBJECT_MAX}
                    onChange={(e) => setField("subject", e.target.value)}
                  />
                </div>
                <div className="mr-field">
                  <label className="mr-label" htmlFor="mr-f-preheader">
                    Inbox preview line
                  </label>
                  <input
                    id="mr-f-preheader"
                    className="k-input"
                    value={fields.preheader ?? ""}
                    maxLength={FIELD_MAX}
                    onChange={(e) => setField("preheader", e.target.value)}
                  />
                </div>
                <div className="mr-field">
                  <label className="mr-label" htmlFor="mr-f-heading">
                    Heading
                  </label>
                  <input
                    id="mr-f-heading"
                    className="k-input"
                    value={fields.heading ?? ""}
                    maxLength={FIELD_MAX}
                    onChange={(e) => setField("heading", e.target.value)}
                  />
                </div>
                <div className="mr-field">
                  <label className="mr-label" htmlFor="mr-f-message">
                    Message
                  </label>
                  <textarea
                    id="mr-f-message"
                    className="k-input mr-message"
                    rows={10}
                    value={fields.message ?? ""}
                    maxLength={MESSAGE_MAX}
                    aria-describedby="mr-message-hint"
                    onChange={(e) => setField("message", e.target.value)}
                  />
                  <p className="mr-hint" id="mr-message-hint">
                    Leave an empty line between paragraphs
                  </p>
                </div>
              </fieldset>

              {ownBlanks.length > 0 || listNames.length > 0 ? (
                <fieldset className="mr-section">
                  <legend className="k-panel__title">Details</legend>
                  {ownBlanks.length > 0 ? (
                    <div className="mr-pair">
                      {ownBlanks.map((tag) => (
                        <div key={tag} className={tag === "question" ? "mr-field mr-wide" : "mr-field"}>
                          <label className="mr-label" htmlFor={`mr-f-${tag}`}>
                            {LABELS[tag] ?? tag}
                          </label>
                          <input
                            id={`mr-f-${tag}`}
                            className="k-input"
                            value={fields[tag] ?? ""}
                            maxLength={tag === "question" ? QUESTION_MAX : FIELD_MAX}
                            aria-describedby={tag === "count" ? "mr-count-note" : undefined}
                            onChange={(e) => setField(tag, e.target.value)}
                          />
                          {tag === "count" && countError ? (
                            <p className="mr-alert" id="mr-count-note" role="alert">
                              {countError}
                            </p>
                          ) : tag === "count" ? (
                            <p className="mr-hint" id="mr-count-note">
                              {counting
                                ? "Counting readers…"
                                : "Different readers shown this recipe. Filled in when you choose the submission."}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {listNames.map((name) => (
                    <div key={name} className="mr-field">
                      <label className="mr-label" htmlFor={`mr-l-${name}`}>
                        {LIST_LABELS[name] ?? name}
                      </label>
                      <textarea
                        id={`mr-l-${name}`}
                        className="k-input"
                        rows={5}
                        value={lists[name] ?? ""}
                        onChange={(e) => setLists((l) => ({ ...l, [name]: e.target.value }))}
                      />
                    </div>
                  ))}
                </fieldset>
              ) : null}

              {picksRecipes ? (
                <fieldset className="mr-section">
                  <legend className="k-panel__title">Recipes</legend>
                  <RecipePicker
                    published={published}
                    picked={recipes}
                    onTick={tick}
                    onQuestion={(id, question) =>
                      setRecipes((rs) => rs.map((r) => (r.id === id ? { ...r, question } : r)))
                    }
                  />
                </fieldset>
              ) : null}
            </fieldset>

            <div className="mr-actions">
              <button type="submit" className="k-button k-button--primary" disabled={busy !== null}>
                {busy === "preview" ? "Previewing…" : "Preview"}
              </button>
              {allowance}
            </div>
            {view === "form" ? errorLine : null}
          </form>

          {view === "preview" && preview ? (
            <>
              <PreviewPane preview={preview} />

              <div className="mr-actions">
                {confirming ? (
                  <>
                    <p className="mr-confirm">{confirmText(preview)}</p>
                    <button
                      type="button"
                      className="k-button k-button--primary"
                      onClick={runSend}
                      disabled={!fresh || busy !== null}
                    >
                      {busy === "send" ? "Sending…" : "Yes, send"}
                    </button>
                    <button
                      type="button"
                      className="k-button"
                      onClick={() => setConfirming(false)}
                      disabled={busy !== null}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="k-button" onClick={() => setView("form")} disabled={busy !== null}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="k-button k-button--primary"
                      onClick={() => setConfirming(true)}
                      disabled={!fresh || busy !== null}
                    >
                      Send…
                    </button>
                  </>
                )}
                {allowance}
              </div>
              {errorLine}
            </>
          ) : null}

          {summary ? (
            <div className={summary.failed + summary.overLimit > 0 ? "mr-banner mr-banner--bad" : "mr-banner"} role="status">
              <p>
                Sent {summary.sent} · opted out {summary.optedOut} · waiting {summary.waiting} · failed {summary.failed}
              </p>
              {summary.errors.length > 0 ? (
                <ul>
                  {summary.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : null}
              <Link href="/mailroom?tab=sent">See it in the Sent tab</Link>
            </div>
          ) : null}
        </section>

        {/* Hidden rather than unmounted, so unsaved words survive a look at another email. */}
        <div hidden={template !== "thank-you/received"}>
          <AutoPanel initial={auto} />
        </div>
      </div>
    </div>
  );
}
