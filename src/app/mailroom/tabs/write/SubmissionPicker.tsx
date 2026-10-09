"use client";

import { useState } from "react";

import type { MailPick } from "@/lib/mailroom/draft";

/**
 * Whose submission a thank-you or needs-changes email is about. Only
 * submissions with a code-verified address are listed (the page loads them
 * that way), newest first. The search narrows the list in the browser; it is
 * not part of the draft, so typing in it never invalidates a preview.
 */

function standing(p: MailPick): { key: string; word: string } {
  if (p.published) return { key: "published", word: "Published" };
  if (p.status === "green") return { key: "cleared", word: "Cleared" };
  if (p.status === "red") return { key: "rejected", word: "Rejected" };
  return { key: "pending", word: "Awaiting verdict" };
}

export function SubmissionPicker({
  submissions,
  chosenId,
  onChoose,
}: {
  submissions: MailPick[] | null;
  chosenId: string | null;
  onChoose: (pick: MailPick) => void;
}) {
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const shown = (submissions ?? []).filter(
    (s) => !query || [s.recipe_name, s.display_name, s.state, s.contact ?? ""].join(" ").toLowerCase().includes(query),
  );

  return (
    <div className="mr-field">
      <label className="mr-label" htmlFor="mr-search">
        Find a submission
      </label>
      <input
        id="mr-search"
        className="k-input"
        type="search"
        value={search}
        autoComplete="off"
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      {submissions === null ? (
        <p className="k-empty">The recipe store is unavailable.</p>
      ) : submissions.length === 0 ? (
        <p className="k-empty">No submission has a verified email address yet.</p>
      ) : shown.length === 0 ? (
        <p className="k-empty">No submission matches that.</p>
      ) : (
        <div className="k-thread-list mr-picklist">
          {shown.map((s) => {
            const st = standing(s);
            return (
              <button
                key={s.id}
                type="button"
                className="k-thread"
                aria-pressed={s.id === chosenId}
                onClick={() => onChoose(s)}
              >
                <span className="k-thread__title">{s.recipe_name}</span>
                <span className="k-thread__meta">
                  <span>{s.display_name}</span>
                  <span>{s.state}</span>
                  <span className={`k-pill mr-status--${st.key}`}>{st.word}</span>
                </span>
                <span className="k-thread__meta mr-contact">{s.contact}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
