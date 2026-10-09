"use client";

import type { MailPick } from "@/lib/mailroom/draft";

/**
 * The published recipes a tell-everyone email shows off, in the order they
 * were ticked, each with the question its "Try it" button types into Kranti.
 * Only ids and questions go to the server; the recipe's name, its sender and
 * the state are read from the live store there, so the email can only show a
 * recipe that is published and credit the person who sent it.
 */

/** `RECIPES_MAX` in `lib/mailroom/draft.ts`. */
export const RECIPES_MAX = 12;
const QUESTION_MAX = 200;

export interface Picked {
  id: string;
  question: string;
}

export function RecipePicker({
  published,
  picked,
  onTick,
  onQuestion,
}: {
  published: MailPick[] | null;
  picked: Picked[];
  onTick: (pick: MailPick, on: boolean) => void;
  onQuestion: (id: string, question: string) => void;
}) {
  const full = picked.length >= RECIPES_MAX;

  return (
    <>
      <p className="mr-hint">
        {picked.length} chosen. They appear in the order you tick them, at most {RECIPES_MAX}.
      </p>
      {published === null ? (
        <p className="k-empty">The recipe store is unavailable.</p>
      ) : published.length === 0 ? (
        <p className="k-empty">Nothing is published yet.</p>
      ) : (
        <div className="mr-picklist">
          {published.map((p) => {
            const at = picked.findIndex((r) => r.id === p.id);
            const on = at >= 0;
            return (
              <div key={p.id} className="mr-recipe">
                <label className="mr-check">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && full}
                    onChange={(e) => onTick(p, e.target.checked)}
                  />
                  <span>
                    {p.recipe_name}{" "}
                    <span className="mr-recipe__from">
                      from {p.display_name}, {p.state}
                    </span>
                  </span>
                  {on ? (
                    <span className="mr-order">
                      <span className="sr-only">position </span>
                      {at + 1}
                    </span>
                  ) : null}
                </label>
                {on ? (
                  <div className="mr-field">
                    <label className="mr-label" htmlFor={`mr-q-${p.id}`}>
                      Question
                    </label>
                    <input
                      id={`mr-q-${p.id}`}
                      className="k-input"
                      value={picked[at].question}
                      maxLength={QUESTION_MAX}
                      onChange={(e) => onQuestion(p.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.preventDefault();
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {full ? <p className="mr-hint">That is the most one email holds. Untick one to choose another.</p> : null}
    </>
  );
}
