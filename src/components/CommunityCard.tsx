"use client";

import { useState } from "react";

import type { CommunityCardData } from "@/lib/community/card";
import type { SupportedLang } from "@/lib/lang/types";
import { fill, uiStrings } from "@/lib/lang/ui-strings";

import "./community-card.css";

/**
 * The community card (Tier 4).
 *
 * Not a variant of `RestorationCard` — a new component for a surface a corpus
 * record can never reach. `CommunityCardData` (`lib/community/card.ts`) has no
 * field for a locus, a provenance class, or `contact`, so this card is
 * structurally incapable of rendering a source strip, a corpus badge, or the
 * submitter's contact details: there is nothing here to wire up even by
 * mistake. It has no share control either — the two existing cards own their
 * own, and screenshot treatment for this one is parked in the spec.
 *
 * The recipe text follows its own language — `data.language`, or
 * `data.translated_from.language` once the reader has toggled to the
 * original — carried as a `lang` attribute on the verbatim block below. The
 * chrome around it (the header, the toggle, the section labels) follows the
 * reader's language instead, resolved through `uiStrings(lang)`. That split
 * is why `language` survived the add-a-recipe form's simplification.
 */
export function CommunityCard({
  data,
  lang,
}: {
  data: CommunityCardData;
  /** The reader's language. Chrome only. */
  lang?: SupportedLang;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const t = uiStrings(lang);

  const original = data.translated_from;
  const showingOriginal = Boolean(original) && showOriginal;

  // A local toggle over text the payload already carries in full — no fetch,
  // no loading state, because `translated_from` was sent down with the turn.
  const shown =
    showingOriginal && original
      ? {
          recipeName: original.recipe_name,
          story: original.story,
          ingredients: original.ingredients,
          method: original.method,
          lang: original.language ?? undefined,
        }
      : {
          recipeName: data.recipe_name,
          story: data.story,
          ingredients: data.ingredients,
          method: data.method,
          lang: data.language ?? undefined,
        };

  const place = data.city ? `${data.city}, ${data.state}` : data.state;

  return (
    <article className="card community-card" style={{ marginTop: "1rem" }}>
      <div className="community-card__head">
        <p className="mono community-card__eyebrow">{t.communityHeader}</p>
        <h2 className="verdict community-card__title" lang={shown.lang}>
          {shown.recipeName}
        </h2>
        <p className="community-card__attribution">
          {fill(t.communityAttribution, {
            name: data.display_name,
            relation: data.belongs_to,
            place,
          })}
        </p>
      </div>

      {original && (
        <div className="community-card__translated">
          <span>{t.communityTranslated}</span>
          <button
            type="button"
            className="mono ghost-btn"
            aria-pressed={showOriginal}
            onClick={() => setShowOriginal((v) => !v)}
          >
            {showOriginal ? t.communityShowTranslation : t.communityShowOriginal}
          </button>
        </div>
      )}

      {/* After the attribution and before the story: a real kitchen photo is
          the strongest trust signal on the page. The aspect-ratio box holds
          the layout still while the lazy-loaded image is still in flight. */}
      {data.photo_url && (
        <div className="community-card__photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- a route that already
              serves immutable, cache-forever bytes; next/image would re-fetch and
              re-encode a photo whose id is its version */}
          <img
            src={data.photo_url}
            loading="lazy"
            alt={fill(t.communityPhotoAlt, { dish: shown.recipeName, state: data.state })}
          />
        </div>
      )}

      <div className="community-card__body" lang={shown.lang}>
        <p className="community-card__story">{shown.story}</p>

        <section>
          <h3 className="mono community-card__label">{t.communityIngredients}</h3>
          <ul className="community-card__list">
            {shown.ingredients.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mono community-card__label">{t.communityMethod}</h3>
          <ol className="community-card__list">
            {shown.method.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </section>
      </div>

      {data.other_states.length > 0 && (
        <p className="community-card__other-states">
          {fill(t.communityOtherStates, { states: joinWithAnd(data.other_states, t.cardAnd) })}
        </p>
      )}

      <p className="community-card__footer">{t.communityNotRestored}</p>
    </article>
  );
}

/**
 * "Punjab, Kerala and Assam" — the Oxford comma the app already uses for
 * `cardSilences` on `RestorationCard`, reused here rather than reinvented.
 */
function joinWithAnd(items: string[], and: string): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} ${and} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${and} ${items[items.length - 1]}`;
}
