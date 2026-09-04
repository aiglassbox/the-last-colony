"use client";

import { cardStrings, type CardStrings } from "@/lib/lang/card-strings";
import type { SupportedLang } from "@/lib/lang/types";
import { uiStrings } from "@/lib/lang/ui-strings";
import { toPlainText } from "@/lib/model/plain-text";
import {
  hasIngredientRows,
  parseIngredientRows,
  parseRecipeBeat,
} from "@/lib/model/recipe-beat";
import { IngredientRows } from "./IngredientRows";
import { Waiting } from "./RestorationCard";

/**
 * The Indianisation card (Tier 3).
 *
 * Structurally a sibling of the RestorationCard, but deliberately not the same:
 * a foreign dish has no ancient original and no source, so this card carries no
 * provenance badge and no source strip — nothing that would let a generated
 * fusion read as a cited restoration. Its accent is the "now" colour, not the
 * restoration orange, so the two are never confused at a glance.
 *
 * Everything here is model-written prose and a model-written swap list; there is
 * no record to render from, and the card says so plainly.
 */

export interface IndianizationData {
  beats: Partial<Record<string, string>>;
  streaming: boolean;
  /** The reply's language; the card's fixed lines follow it. */
  lang?: SupportedLang;
}

export function IndianisationCard({ data }: { data: IndianizationData }) {
  const { beats, streaming, lang } = data;
  const t = uiStrings(lang);
  const cs = cardStrings(lang);

  return (
    <article className="card" style={{ marginTop: "1rem" }}>
      <div style={{ padding: "1.2rem 1.15rem 1.05rem" }}>
        <p className="verdict" style={{ margin: 0 }}>
          {beats.VERDICT ?? ""}
          {streaming &&
            !beats.REBUILD &&
            (beats.VERDICT ? <span className="caret" aria-hidden /> : <Waiting />)}
        </p>
        <div style={{ marginTop: "0.85rem" }}>
          <span
            className="mono"
            style={{
              display: "inline-block",
              padding: "0.28rem 0.6rem",
              borderRadius: 999,
              border: "1px solid var(--now)",
              color: "var(--now)",
              fontSize: "0.72rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {t.fusionPill}
          </span>
        </div>
        {/* Said in words as well as on the chip, because the chip is a label
            and this is the sentence. Both avoid the words we file by: a reader
            meeting "ancient original" or "restoration" for the first time has
            to decode them before they can read the line, and they arrive in
            the same shape on every card. "Ours" does the disclosing better
            than "not a restoration" did, and needs no glossary.

            The corpus is deliberately not mentioned: whether we hold a record
            is irrelevant to a dish that was never Indian, and raising it
            implies one could arrive later.

            It used to open "this one did not come from India", which is the
            reason this card usually exists but is not something the card can
            know. The mode is the model's own call, and it took "dosa + idli
            fusion" for one — so a card built from two south Indian dishes told
            the reader they were not Indian, in the first line under the
            verdict. The route now says a fusion needs a foreign half, and this
            line no longer asserts the half either way: what is true of every
            card that reaches here, whatever the model decided upstream, is that
            the recipe below is ours and came out of no text. */}
        <p
          style={{
            margin: "0.85rem 0 0",
            fontSize: "0.9rem",
            color: "var(--ink-soft)",
          }}
        >
          {t.fusionNote}
        </p>
      </div>

      {(streaming || beats.REBUILD) && (
        <Section title={t.fusionRebuild}>
          <Prose text={beats.REBUILD} streaming={streaming} />
        </Section>
      )}

      {/* The swap table is gone from the card. The §SWAPS§ beat is still asked
          for and still parsed, because "Then and now" below is drawn from it —
          it is the component-by-component argument, and the diff would have
          nothing to say without it. What has gone is the second, tabular
          telling of the same thing directly under the rebuild. */}

      {(beats.PLATE || (streaming && Boolean(beats.SWAPS))) && (
        <Section title={t.fusionCook}>
          <Plate text={beats.PLATE} streaming={streaming} cs={cs} />
        </Section>
      )}

    </article>
  );
}

/* The download-card button and the shareTarget that built its
   `/api/share/turn` URL out of the swap rows are gone from this card for now,
   in step with the same removal on the RestorationCard. The §SWAPS§ beat is
   still asked for and still parsed upstream; nothing here reads it any more.
   Recover the removed code from history rather than rewriting it. */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: "1px solid var(--line)" }}>
      <div style={{ padding: "0.9rem 1.15rem 0.2rem" }}>
        <span className="mono" style={{ color: "var(--ink-muted)" }}>
          {title}
        </span>
      </div>
      <div style={{ padding: "0.2rem 1.15rem 1.15rem" }}>{children}</div>
    </section>
  );
}

function Prose({ text, streaming }: { text?: string; streaming: boolean }) {
  if (!text) {
    return streaming ? (
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        <Waiting />
      </p>
    ) : null;
  }
  return (
    <div style={{ maxWidth: "62ch" }}>
      {toPlainText(text)
        .split(/\n{2,}/)
        .map((para, i) => (
          <p key={i} style={{ margin: "0 0 0.6rem", lineHeight: 1.6 }}>
            {para}
          </p>
        ))}
    </div>
  );
}

/**
 * "Make it today" as a recipe rather than a paragraph.
 *
 * The swap table above already argues the case component by component; this
 * beat is the part the reader acts on, and a paragraph of quantities and
 * timings is unusable at the moment it is meant to be used. The ingredient
 * table carries the same "why this one" column the swap table does, because on
 * a fusion every ingredient is a choice and the reason is the whole point.
 *
 * Falls back to prose when the model wrote no sections, which is also every
 * line mid-stream before the INGREDIENTS header has arrived.
 */
function Plate({ text, streaming, cs }: { text?: string; streaming: boolean; cs: CardStrings }) {
  if (!text) {
    return streaming ? (
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        <Waiting />
      </p>
    ) : null;
  }
  const { intro, ingredients, steps, outro } = parseRecipeBeat(text);
  if (!ingredients.length && !steps.length) {
    return <Prose text={text} streaming={streaming} />;
  }
  return (
    <div style={{ maxWidth: "62ch" }}>
      {intro && <p style={{ margin: "0 0 0.8rem", lineHeight: 1.6 }}>{intro}</p>}
      {ingredients.length > 0 && (
        <>
          <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
            {cs.ingredients}
          </div>
          {hasIngredientRows(ingredients) ? (
            <IngredientRows
              rows={parseIngredientRows(ingredients)}
              caption={cs.whyThisOne}
              ingredientLabel={cs.ingredient}
              quantityLabel={cs.quantity}
            />
          ) : (
            <ul style={{ margin: "0 0 0.9rem", paddingLeft: "1.1rem" }}>
              {ingredients.map((i, k) => (
                <li key={k} style={{ fontSize: "0.9rem", marginBottom: "0.22rem" }}>
                  {i}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {steps.length > 0 && (
        <>
          <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
            {cs.method}
          </div>
          <ol style={{ margin: 0, paddingLeft: "1.15rem" }}>
            {steps.map((s, k) => (
              <li key={k} style={{ fontSize: "0.92rem", marginBottom: "0.4rem" }}>
                {s}
              </li>
            ))}
          </ol>
        </>
      )}
      {outro && (
        <p style={{ margin: "0.8rem 0 0", lineHeight: 1.6, color: "var(--ink-soft)" }}>{outro}</p>
      )}
      {streaming && <span className="caret" aria-hidden />}
    </div>
  );
}

