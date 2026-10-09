"use client";

import { useState } from "react";

import type { AutoReceived } from "@/lib/mailroom/store";

import { postMail } from "./post";

/**
 * The words the automatic `received` email goes out with.
 *
 * A standing setting rather than an email, so it saves on its own and has
 * nothing to do with the one-off send above it. The switch stays disabled
 * until all four are written, because automatic sending with an empty heading
 * would go out to every new submitter unseen; the route refuses it as well.
 */

const EMPTY: AutoReceived = { enabled: false, subject: "", preheader: "", heading: "", message: "" };

const complete = (a: AutoReceived) => [a.subject, a.preheader, a.heading, a.message].every((v) => v.trim() !== "");

/** What would be saved: the switch counts only when all four are written. */
const effective = (a: AutoReceived): AutoReceived => ({ ...a, enabled: a.enabled && complete(a) });

export function AutoPanel({ initial }: { initial: AutoReceived | null }) {
  const [auto, setAuto] = useState<AutoReceived>(initial ?? EMPTY);
  const [saved, setSaved] = useState(() => JSON.stringify(effective(initial ?? EMPTY)));
  const [justSaved, setJustSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = effective(auto);
  const dirty = JSON.stringify(value) !== saved;

  function edit(patch: Partial<AutoReceived>) {
    setAuto((a) => ({ ...a, ...patch }));
    setJustSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const result = await postMail<{ ok: true }>({ action: "save-auto", auto: value });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(JSON.stringify(value));
    setJustSaved(true);
  }

  return (
    <section className="k-panel mr-auto" aria-labelledby="mr-auto-title">
      <div className="k-panel__head">
        <h2 className="k-panel__title" id="mr-auto-title">
          Automatic sending
        </h2>
      </div>
      <p className="k-panel__note">
        The received email that goes out by itself, filled with the submitter&apos;s name and recipe. Saved
        separately from the email above.
      </p>

      <fieldset className="mr-form" disabled={busy}>
        <div className="mr-field">
          <label className="mr-label" htmlFor="mr-auto-subject">
            Subject <span className="mr-count">{auto.subject.length}/150</span>
          </label>
          <input
            id="mr-auto-subject"
            className="k-input"
            value={auto.subject}
            maxLength={150}
            onChange={(e) => edit({ subject: e.target.value })}
          />
        </div>
        <div className="mr-field">
          <label className="mr-label" htmlFor="mr-auto-preheader">
            Inbox preview line
          </label>
          <input
            id="mr-auto-preheader"
            className="k-input"
            value={auto.preheader}
            maxLength={2000}
            onChange={(e) => edit({ preheader: e.target.value })}
          />
        </div>
        <div className="mr-field">
          <label className="mr-label" htmlFor="mr-auto-heading">
            Heading
          </label>
          <input
            id="mr-auto-heading"
            className="k-input"
            value={auto.heading}
            maxLength={2000}
            onChange={(e) => edit({ heading: e.target.value })}
          />
        </div>
        <div className="mr-field">
          <label className="mr-label" htmlFor="mr-auto-message">
            Message
          </label>
          <textarea
            id="mr-auto-message"
            className="k-input"
            rows={6}
            value={auto.message}
            maxLength={6000}
            aria-describedby="mr-auto-message-hint"
            onChange={(e) => edit({ message: e.target.value })}
          />
          <p className="mr-hint" id="mr-auto-message-hint">
            Leave an empty line between paragraphs
          </p>
        </div>

        <div className="mr-field">
          <label className="mr-switch">
            <input
              type="checkbox"
              role="switch"
              checked={value.enabled}
              disabled={!complete(auto)}
              aria-describedby="mr-auto-state"
              onChange={(e) => edit({ enabled: e.target.checked })}
            />
            Send this automatically when someone submits a recipe
          </label>
          <p className="mr-hint" id="mr-auto-state">
            {value.enabled ? "On" : "Off: nothing goes out by itself"}
            {complete(auto) ? "" : ". Write all four to switch it on."}
          </p>
        </div>
      </fieldset>

      <div className="mr-actions">
        <button type="button" className="k-button k-button--primary" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </button>
        <span className="mr-hint" role="status">
          {dirty ? "Not saved yet" : justSaved ? "Saved" : ""}
        </span>
      </div>
      {error ? (
        <p className="mr-alert" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
