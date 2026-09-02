"use client";

import { useState } from "react";

import type { TurnKind } from "@/lib/chat/turn";
import type { CorpusRecord } from "@/lib/corpus/types";
import { cardStrings, type CardStrings, type HistoryBeat } from "@/lib/lang/card-strings";
import {
  EN_LABELS,
  type LocalizedCard,
  type LocalizedLabels,
  type NutritionAxis,
} from "@/lib/lang/localized-card";
import type { SupportedLang } from "@/lib/lang/types";
import { fill, uiStrings, type UiStrings } from "@/lib/lang/ui-strings";
import type { Beat } from "@/lib/model/beats";
import { toPlainText } from "@/lib/model/plain-text";
import {
  hasIngredientRows,
  parseIngredientRows,
  parseRecipeBeat,
} from "@/lib/model/recipe-beat";

import { IngredientRows } from "./IngredientRows";
import { SourceDrawer } from "./SourceDrawer";

/**
 * The RestorationCard.
 *
 * The split that matters: model prose fills the beats, and everything
 * citational — ingredient table, ancient method, source strip, nutrition delta
 * — is rendered here from the retrieved record. The model never writes a
 * citation because it never writes that part of the card. It also means the
 * record half is on screen the moment retrieval returns, before the first token
 * arrives.
 *
 * On a non-English turn each of those fields is rendered from the record's
 * precomputed localized card (`data.localized`, built by `localize:corpus` and
 * loaded server-side) instead, falling back to the English record per field
 * when a localization is missing. That is still not the model writing the
 * citation live — it is reviewed, committed translation data, the same trust
 * model as the corpus itself.
 *
 * How many beats depends on the turn: a dish with a past gets all four, a
 * modern dish gets the verdict and the cooking. See `tellsHistory`.
 */

export interface CardData {
  records: CorpusRecord[];
  /** What the reader asked for. Names the dish on a card with no record. */
  query?: string;
  kind: TurnKind;
  beats: Partial<Record<string, string>>;
  streaming: boolean;
  /** Precomputed localized cards per record slug, on a non-English turn. */
  localized?: Record<string, LocalizedCard>;
  /** Reader's language, for the recordless card's static chrome. */
  lang?: SupportedLang;
}

/**
 * Why this card has no record, in the reader's terms.
 *
 * One entry per reason, rather than a sentence assembled from flags. The
 * distinction that matters is the last two: a gap is a statement about us and
 * implies a record could arrive later, while a foreign dish is a statement
 * about the dish and no amount of corpus work will change it. Saying "not in
 * the restored corpus yet" under a pizza promised a record that can never
 * exist.
 */
// The note itself and the modern/gap/foreign section titles are translated per
// language in `card-strings.ts`; `cardStrings(data.lang)` resolves them below.
// The `record`-kind labels stay in `TITLES`/the per-record localized store.

/**
 * Beat headings, by what kind of turn this is.
 *
 * "Then" and "What changed" are the right words for a dish with a record
 * behind it: there is a then, and something did change. On a dish with no
 * record they are a question the card cannot answer, printed as though it had.
 * A modern dish has no "then" — only its components do — and a heading that
 * claims otherwise is the card asserting history the turn does not hold.
 *
 * The keys are untouched on purpose. They are the wire protocol: the marker the
 * model writes, the field the parser fills, the shape stored in localStorage on
 * readers' devices. Only the words on screen vary, so nothing downstream and
 * nothing already saved has to know this exists.
 *
 * Short by design. These sit above the text as labels, not as sentences.
 */
const TITLES: Record<TurnKind, Record<Beat, string>> = {
  record: {
    VERDICT: "The verdict",
    THEN: "Then",
    WHAT_CHANGED: "What changed",
    RESTORE_TODAY: "Cook it today",
  },
  modern: {
    VERDICT: "The verdict",
    THEN: "What's in it",
    WHAT_CHANGED: "Where its parts came from",
    RESTORE_TODAY: "Cook it closer",
  },
  gap: {
    VERDICT: "The verdict",
    THEN: "What we can say",
    WHAT_CHANGED: "What likely changed",
    RESTORE_TODAY: "Cook it closer",
  },
  foreign: {
    VERDICT: "The verdict",
    THEN: "What's in it",
    WHAT_CHANGED: "Where its parts came from",
    RESTORE_TODAY: "Cook it closer",
  },
};

/**
 * The localized-label key for each beat heading. Only the `record` kind maps
 * cleanly — its headings ("The verdict", "Then", "What changed", "Cook it
 * today") are the ones the label set was written for. Other kinds relabel these
 * ("What's in it") and are left in English, so a localized title is applied only
 * on a record-kind card.
 */
const RECORD_LABEL: Record<Beat, "verdict" | "then" | "whatChanged" | "cookToday"> = {
  VERDICT: "verdict",
  THEN: "then",
  WHAT_CHANGED: "whatChanged",
  RESTORE_TODAY: "cookToday",
};

/* The download-card button and everything that pointed it at
   `/api/share/...` — SHARE_FOOTER, shareTarget, firstLine, titleCase — are
   gone from this card for now. The image route itself still exists and still
   renders `/dish/[slug]` OpenGraph previews; what has been withdrawn is the
   reader's way in. Recover the removed code from history when the share is
   brought back rather than rewriting it. */

export function RestorationCard({ data }: { data: CardData }) {
  const [drawer, setDrawer] = useState(false);

  const ancient = data.records.find((r) => r.tier === "ancient") ?? data.records[0] ?? null;
  const modern =
    (ancient?.modern_counterpart_id
      ? data.records.find((r) => r.id === ancient.modern_counterpart_id)
      : null) ?? null;

  // The localized card for the ancient record, if this turn carried one. Every
  // field below prefers the localization and falls back to the English record,
  // so a missing or partial localization is never a blank — only untranslated.
  const loc = ancient ? (data.localized?.[ancient.slug] ?? null) : null;
  const labels: LocalizedLabels = loc?.labels ?? EN_LABELS;

  // The recordless card's static chrome — notes, section titles, table headers —
  // in the reader's language. English per field where a translation is missing.
  const cs = cardStrings(data.lang);
  // The fixed lines neither the record store nor the card chrome carries.
  const t = uiStrings(data.lang);
  const note = data.kind !== "record" ? cs.note[data.kind] : undefined;

  const titleFor = (beat: Beat): string => {
    if (data.kind === "record") return loc ? labels[RECORD_LABEL[beat]] : TITLES.record[beat];
    return cs.title[data.kind][beat as HistoryBeat] ?? TITLES[data.kind][beat];
  };

  /**
   * Whether a beat has anything under its heading.
   *
   * A beat holds model prose, evidence rendered from the record, or both, and
   * it is drawn whenever it holds either. A completion that skipped a marker —
   * a dropped stream, a reply that ignored the format, an older thread saved
   * before a beat existed — left a heading with nothing beneath it, which reads
   * as the card having failed to load rather than as having nothing to say.
   *
   * Only once the stream is done. While it is running an empty beat is a beat
   * whose text has not arrived yet, so it stays and shows its waiting dots:
   * hiding it would mean every card assembling itself hole by hole as the
   * markers land.
   *
   * That "only once the stream is done" is the whole trick, and it is why this
   * needs no plan declared by the server. During the stream the card genuinely
   * cannot tell "not written yet" from "not applicable" — but it does not have
   * to, because it treats both the same and waits. After the stream those two
   * cases collapse into one: nothing came, and nothing is coming.
   */
  /**
   * A modern dish is the verdict and the cooking, and nothing between.
   *
   * Those two beats exist to hold a past against a present. A dish with no
   * older version has neither to show: "what's in it" restates the ingredient
   * table further down, and "where its parts came from" is a paragraph of
   * commodity history in front of the one thing the reader came for. The axes
   * still run — they are the comparison that survives without a then.
   */
  const tellsHistory = data.kind !== "modern";

  const shows = (beat: Beat): boolean => {
    if ((beat === "THEN" || beat === "WHAT_CHANGED") && !tellsHistory) return false;
    if (data.streaming) return true;
    if (data.beats[beat]) return true;
    switch (beat) {
      case "THEN":
        return Boolean(ancient);
      case "WHAT_CHANGED":
        return Boolean(
          (ancient && modern) ||
            ancient?.substitution_story?.changed.length ||
            (ancient?.substitution_story &&
              Object.keys(ancient.substitution_story.nutrition_delta).length),
        );
      case "RESTORE_TODAY":
        return Boolean(ancient?.restore_today || ancient?.make_today_notes);
      default:
        return true;
    }
  };

  return (
    <article className="card" style={{ marginTop: "1rem" }}>
      {/* Beat 1 — the gut-punch. Never collapsed behind a toggle header. */}
      <div style={{ padding: "1.2rem 1.15rem 1.05rem" }}>
        <p className="verdict" style={{ margin: 0 }}>
          {/* If the model wrote nothing — no key, a dropped stream — the
              editorial verdict on the record stands in. It is the same line the
              share image uses, so the card is never blank and never invents. */}
          {data.beats.VERDICT ??
            (data.streaming ? "" : (loc?.record.verdict ?? ancient?.share_verdict ?? ""))}
          {data.streaming &&
            !data.beats.THEN &&
            (data.beats.VERDICT ? <span className="caret" aria-hidden /> : <Waiting />)}
        </p>
        {/* No provenance class on the card. "RECONSTRUCTED" and "MODERN DISH"
            are the corpus's own vocabulary, and a pill of it above the answer
            asks the reader to learn a taxonomy before they can read a recipe.
            What the class was protecting is the citation, and that is still
            stated where it belongs: the source strip below says in words when
            a record has not been checked, and withholds the verse and page
            until it has. */}
        {note && (
          <p
            style={{
              margin: "0.85rem 0 0",
              fontSize: "0.9rem",
              color: "var(--ink-soft)",
            }}
          >
            {note}
          </p>
        )}
      </div>

      {/* A short account of what changed. The Then/Now ingredient columns that
          used to sit here were a second telling of the recipe printed
          immediately above the recipe itself, and they are staying gone. */}
      {shows("WHAT_CHANGED") && (
      <Beat beat="WHAT_CHANGED" kind={data.kind} title={titleFor("WHAT_CHANGED")}>
        <Prose text={data.beats.WHAT_CHANGED} streaming={data.streaming} />
      </Beat>
      )}

      {/* Its own section rather than the tail of "what changed", so it survives
          on a modern dish, where that beat is not drawn at all and these axes
          are the only comparison the card has left to make. */}
      {ancient?.substitution_story && (
        <div className="card-axes">
          <NutritionDelta record={ancient} kind={data.kind} loc={loc} labels={labels} cs={cs} />
        </div>
      )}

      {shows("THEN") && (
      <Beat
        beat="THEN"
        kind={data.kind}
        title={titleFor("THEN")}
        badge={ancient?.dish_name_source ?? undefined}
      >
        <Prose text={data.beats.THEN} streaming={data.streaming} />
        {ancient?.provenance_class === "MODERN_DISH" && (
          <p style={{ margin: "0 0 0.2rem", color: "var(--ink-soft)", maxWidth: "62ch" }}>
            {t.cardModernNote}
          </p>
        )}
        {ancient && (
          <>
            {/* What the dish was: the components the text names, and the method
                as it describes them. The version you can cook is its own
                section below, the same way a dish with no record gets one — an
                ancient dish was the only kind that had lost it. */}
            <IngredientTable record={ancient} loc={loc} labels={labels} t={t} />
            {ancient.provenance_class !== "MODERN_DISH" && (
              <>
                <Method record={ancient} loc={loc} labels={labels} />
                <SourceStrip record={ancient} loc={loc} labels={labels} onOpen={() => setDrawer(true)} />
              </>
            )}
            {ancient.provenance_class === "MODERN_DISH" && ancient.contested_points.length > 0 && (
              <ul
                style={{
                  margin: "1rem 0 0",
                  paddingLeft: "1.1rem",
                  color: "var(--ink-soft)",
                  maxWidth: "62ch",
                }}
              >
                {(loc?.record.contested_points ?? ancient.contested_points).map((c) => (
                  <li key={c} style={{ fontSize: "0.9rem", marginBottom: "0.35rem" }}>
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Beat>
      )}

      {/* The version you can cook, on every card that has one.
          Above is what the dish was; this is what to do about it tonight —
          ingredients you can buy and a method for a modern kitchen. A dish
          with a record takes them from the record, a dish without takes them
          from the beat the model wrote, and both arrive under the same
          heading in the same place. */}
      {shows("RESTORE_TODAY") && (
      <Beat beat="RESTORE_TODAY" kind={data.kind} title={titleFor("RESTORE_TODAY")}>
        {ancient?.restore_today ? (
          <>
            <Prose text={data.beats.RESTORE_TODAY} streaming={data.streaming} />
            <RestoreToday record={ancient} loc={loc} labels={labels} />
          </>
        ) : (
          <ModernRecipe text={data.beats.RESTORE_TODAY} streaming={data.streaming} cs={cs} />
        )}
        {ancient?.make_today_notes && <MakeTodayNotes notes={ancient.make_today_notes} t={t} />}
      </Beat>
      )}

      {drawer && ancient && (
        <SourceDrawer record={ancient} t={t} onClose={() => setDrawer(false)} />
      )}
    </article>
  );
}

/**
 * A section of the answer, always open.
 *
 * These used to be toggles. A reader who asks what their dinner used to be is
 * owed the answer, not a set of headings to open one at a time — and the two
 * that were collapsed by default were what changed and the recipe, which is
 * the whole of what they came for. The headings stay, because they are how you
 * find the recipe in a long card; the chevron and the hiding are gone.
 */
function Beat({
  beat,
  kind,
  badge,
  title,
  children,
}: {
  beat: Beat;
  kind: TurnKind;
  badge?: string;
  /** Localized heading; falls back to the English `TITLES` entry. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="beat-head">
        <h3 className="mono" style={{ margin: 0, fontWeight: 400, color: "var(--ink-muted)" }}>
          {title ?? TITLES[kind][beat]}
        </h3>
        {badge && (
          <span className="display" style={{ fontSize: "0.95rem", color: "var(--orange)" }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ padding: "0.2rem 1.15rem 1.15rem" }}>{children}</div>
    </section>
  );
}

/**
 * The pause before a beat has any text.
 *
 * A model takes about a second to its first token, and a card that shows
 * nothing for that second reads as broken. This is not a spinner: it sits on
 * the line the text will occupy, at the size the text will be, so nothing jumps
 * when the words arrive.
 */
export function Waiting() {
  return (
    <span className="thinking" aria-label="Writing" role="status">
      <span aria-hidden />
      <span aria-hidden />
      <span aria-hidden />
    </span>
  );
}

/**
 * A run of lines that belong to one another: a paragraph, a list, or steps.
 *
 * The model writes ingredients as "- " lines and steps as "1." lines whether or
 * not the turn asked for INGREDIENTS and METHOD headers. Splitting only on
 * blank lines ran those back into a single paragraph, so a method arrived as
 * one long sentence with the step numbers still in it.
 */
type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; lines: string[] }
  | { kind: "ol"; lines: string[] };

const BULLET = /^[-*•]\s+/;
const NUMBER = /^\d+[.)]\s+/;

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l) {
      // A blank line closes whatever was open, so the next run starts fresh.
      if (blocks.length && blocks[blocks.length - 1].lines.length) blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const kind: Block["kind"] = BULLET.test(l) ? "ul" : NUMBER.test(l) ? "ol" : "p";
    const content = l.replace(BULLET, "").replace(NUMBER, "");
    const last = blocks[blocks.length - 1];
    // Prose wraps, so consecutive plain lines join. List items never do.
    if (last && last.kind === kind && (kind !== "p" || last.lines.length)) last.lines.push(content);
    else blocks.push({ kind, lines: [content] });
  }
  return blocks.filter((b) => b.lines.length);
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
      {toBlocks(toPlainText(text)).map((block, i) => {
        if (block.kind === "ul") {
          return (
            <ul key={i} style={{ margin: "0 0 0.7rem", paddingLeft: "1.1rem" }}>
              {block.lines.map((l, k) => (
                <li key={k} style={{ marginBottom: "0.22rem", fontSize: "0.92rem" }}>
                  {l}
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={i} style={{ margin: "0 0 0.7rem", paddingLeft: "1.15rem" }}>
              {block.lines.map((l, k) => (
                <li key={k} style={{ marginBottom: "0.4rem", fontSize: "0.92rem" }}>
                  {l}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i} style={{ margin: "0 0 0.6rem" }}>
            {block.lines.join(" ")}
          </p>
        );
      })}
    </div>
  );
}

function IngredientTable({
  record,
  loc,
  labels,
  t,
}: {
  record: CorpusRecord;
  loc: LocalizedCard | null;
  labels: LocalizedLabels;
  t: UiStrings;
}) {
  if (!record.ingredients.length) return null;
  // Localized rows are validated index-aligned with the record, so index maps
  // directly. A missing localization leaves `li` undefined and each field falls
  // back to the English record.
  const li = (idx: number) => loc?.record.ingredients[idx];

  /**
   * Which columns this record can actually fill.
   *
   * A record read out of the vector index carries an ingredient's name and
   * little else: the pipeline schema has no field for what an ingredient was
   * doing, so `ingredientOf` writes "not recorded in this source" rather than
   * inventing one, and many of its quantities are the literal string
   * "unspecified". Printed as a table that was three columns wide regardless,
   * that became a column of "unspecified" beside a column of "not recorded in
   * this source" — twelve cells saying nothing, which reads as the card having
   * failed rather than as the source being quiet.
   *
   * The fix is not to fill those cells in. It is to stop drawing a column that
   * holds nothing and say it once underneath instead, which is the rule
   * `IngredientRows` already follows on the recordless path.
   */
  const quantityOf = (i: (typeof record.ingredients)[number]) =>
    meaningful(i.quantity_modern) ?? meaningful(i.quantity_source);

  /**
   * A column has to earn its width, so quantity needs half the rows and not
   * merely one of them. Sambar's indexed record carries a quantity for one
   * ingredient in ten, and a column that is nine dashes and a value is the
   * same failure at a smaller scale. Below the threshold the value is not
   * thrown away — it goes inline beside the ingredient it belongs to, where
   * one of them reads as a note rather than as a gap in a table.
   */
  const filled = record.ingredients.filter((i) => quantityOf(i)).length;
  const withQuantity = filled * 2 >= record.ingredients.length;
  const withFunction = record.ingredients.some((i) => meaningful(i.function));

  const headers = [
    labels.ingredient,
    ...(withQuantity ? [labels.quantity] : []),
    ...(withFunction ? [labels.whyItWasThere] : []),
  ];

  const silences = [
    withQuantity ? null : t.cardNoQuantities,
    withFunction ? null : t.cardNoFunction,
  ].filter(Boolean);

  return (
    <div className="scroll-x" style={{ marginTop: "0.9rem" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: withFunction ? 460 : 280 }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="mono"
                style={{
                  textAlign: "left",
                  color: "var(--ink-muted)",
                  padding: "0.4rem 0.6rem 0.4rem 0",
                  borderBottom: "1px solid var(--line-strong)",
                  fontWeight: 400,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {record.ingredients.map((i, idx) => {
            const l = li(idx);
            const name = l?.name ?? i.name;
            const qty = l?.quantity ?? quantityOf(i);
            const fn = l?.function ?? meaningful(i.function);
            return (
              <tr key={i.name}>
                <td style={cell}>
                  {name}
                  {/* The source-language term stays as itself — a proper noun. */}
                  {i.sanskrit && (
                    <span style={{ color: "var(--orange)", fontStyle: "italic" }}> · {i.sanskrit}</span>
                  )}
                  {!withQuantity && qty && (
                    <span style={{ color: "var(--ink-muted)" }}> ({qty})</span>
                  )}
                </td>
                {withQuantity && (
                  <td style={{ ...cell, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                    {qty ?? "—"}
                  </td>
                )}
                {withFunction && (
                  <td style={{ ...cell, color: "var(--ink-soft)" }}>{fn ?? "—"}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Said once, quietly, rather than repeated down a column. */}
      {silences.length > 0 && (
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.82rem", color: "var(--ink-muted)" }}>
          {fill(t.cardSilences, { silences: silences.join(` ${t.cardAnd} `) })}
        </p>
      )}
    </div>
  );
}

/**
 * A cell's content, or null where it only looks like content.
 *
 * Two different pipelines put placeholder text where a value would go —
 * "unspecified" arrives in the indexed records' own quantity field, and
 * "not recorded in this source" is written by `ingredientOf` because the
 * schema has nowhere to say nothing. Both are honest as prose and useless as a
 * table cell, and a column of either is indistinguishable from a rendering
 * fault. Treating them as absent is what lets the column drop.
 */
const EMPTY_MARKERS = new Set([
  "unspecified",
  "not recorded",
  "not recorded in this source",
  "not specified",
  "unknown",
  "n/a",
  "na",
  "none",
  "-",
  "—",
]);

function meaningful(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return EMPTY_MARKERS.has(text.toLowerCase()) ? null : text;
}

const cell: React.CSSProperties = {
  padding: "0.5rem 0.6rem 0.5rem 0",
  borderBottom: "1px solid var(--line)",
  fontSize: "0.9rem",
  verticalAlign: "top",
};

function Method({
  record,
  loc,
  labels,
}: {
  record: CorpusRecord;
  loc: LocalizedCard | null;
  labels: LocalizedLabels;
}) {
  if (!record.method_reconstructed.length) return null;
  const steps = loc?.record.method ?? record.method_reconstructed;
  return (
    <div style={{ marginTop: "1.1rem" }}>
      <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
        {labels.theMethod}
      </div>
      <ol style={{ margin: 0, paddingLeft: "1.15rem", maxWidth: "62ch" }}>
        {steps.map((s, i) => (
          <li key={i} style={{ marginBottom: "0.4rem", fontSize: "0.93rem" }}>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SourceStrip({
  record,
  loc,
  labels,
  onOpen,
}: {
  record: CorpusRecord;
  loc: LocalizedCard | null;
  labels: LocalizedLabels;
  onOpen: () => void;
}) {
  const verified = record.verification.status === "editor_verified";
  const src = loc?.record.source;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        marginTop: "1.1rem",
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: "0.7rem",
        padding: "0.7rem 0.8rem",
        borderRadius: 12,
        border: "1px solid var(--line-strong)",
        background: "transparent",
        color: "var(--ink)",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ color: "var(--ink-muted)" }}>
          {labels.source}
        </div>
        <div className="display" style={{ fontSize: "0.98rem" }}>
          {src?.text ?? record.source.text}
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--ink-soft)" }}>
          {verified
            ? [src?.locus ?? record.source.locus, src?.edition ?? record.source.edition]
                .filter(Boolean)
                .join(" · ")
            : labels.citationUnverified}
        </div>
      </div>
      <span className="mono" style={{ marginLeft: "auto", color: "var(--orange)" }}>
        {labels.open}
      </span>
    </button>
  );
}


/**
 * The restored version, in ingredients you can buy.
 *
 * Straight from `record.restore_today` — quantities, timings and steps are the
 * record's, not the model's, for the same reason the historical table is.
 */
function RestoreToday({
  record,
  loc,
  labels,
}: {
  record: CorpusRecord;
  loc: LocalizedCard | null;
  labels: LocalizedLabels;
}) {
  const r = record.restore_today!;
  // Localized restore_today is validated index-aligned, so fall back per array.
  const ingredients = loc?.record.restore_today?.ingredients ?? r.ingredients;
  const steps = loc?.record.restore_today?.steps ?? r.steps;
  return (
    <div style={{ marginTop: "0.9rem" }}>
      <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
        {r.time_min} {labels.minutes} · {labels.kiranaIngredients}
      </div>
      <ul style={{ margin: "0 0 0.9rem", paddingLeft: "1.1rem", maxWidth: "62ch" }}>
        {ingredients.map((i, k) => (
          <li key={k} style={{ fontSize: "0.9rem", marginBottom: "0.22rem" }}>
            {i}
          </li>
        ))}
      </ul>
      <ol style={{ margin: 0, paddingLeft: "1.15rem", maxWidth: "62ch" }}>
        {steps.map((s, i) => (
          <li key={i} style={{ fontSize: "0.92rem", marginBottom: "0.4rem" }}>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

const ARROW: Record<string, string> = {
  up: "↑",
  down: "↓",
  unchanged: "→",
  mixed: "↕",
};

/**
 * Which way each nutrition axis moved between the two versions of the dish.
 *
 * This was removed alongside the Then/Now ingredient columns as part of the
 * same duplication, but only those columns were duplication — they reprinted
 * the ingredient table that sits directly below them. The axes are not stated
 * anywhere else on the card, so they came back without them.
 *
 * Direction only, never a magnitude, and the axes are limited to the six the
 * schema defines — `nutrition_delta` is built by filtering against DELTA_AXES,
 * so nothing else can reach here. The line underneath is not boilerplate: a
 * row of arrows invites being read as a health claim about the reader, and it
 * is a comparison between two recipes.
 */
function NutritionDelta({
  record,
  kind,
  loc,
  labels,
  cs,
}: {
  record: CorpusRecord;
  kind: TurnKind;
  loc: LocalizedCard | null;
  labels: LocalizedLabels;
  cs: CardStrings;
}) {
  const delta = record.substitution_story?.nutrition_delta ?? {};
  const entries = Object.entries(delta);
  if (!entries.length) return null;
  // The localized axis name, else the localized label set, else the English key.
  const axisLabel = (axis: string): string =>
    loc?.record.axes[axis as NutritionAxis] ?? labels.axes[axis as NutritionAxis] ?? axis.replace(/_/g, " ");
  return (
    <div style={{ marginTop: "1rem" }}>
      <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
        {/* On a dish with no older version these axes are not a then and a now
            — they are the plate as it is usually made against the one built
            from the swap table. Saying "then" here would smuggle back the past
            the headings above just stopped claiming. Only the record-kind
            heading has a localized label; the "usual → restored" variant stays
            English. */}
        {kind === "record" ? labels.byAxis : cs.usualRestored}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {entries.map(([axis, dir]) => (
          <span
            key={axis}
            style={{
              padding: "0.28rem 0.6rem",
              borderRadius: 999,
              border: "1px solid var(--line-strong)",
              fontSize: "0.82rem",
            }}
          >
            {axisLabel(axis)} <strong>{ARROW[dir] ?? "→"}</strong>
          </span>
        ))}
      </div>
      <p style={{ margin: "0.6rem 0 0", fontSize: "0.8rem", color: "var(--ink-muted)" }}>
        {labels.deltaCaption}
      </p>
    </div>
  );
}

function ModernRecipe({
  text,
  streaming,
  cs,
}: {
  text?: string;
  streaming: boolean;
  cs: CardStrings;
}) {
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
          {/* The table only once the model has committed to the three-field
              shape. A plain list stays a plain list: an older completion, a
              model that ignored the format, and every line mid-stream before
              its separators have arrived would otherwise render as a table of
              one-cell rows that reflows as it fills. */}
          {hasIngredientRows(ingredients) ? (
            <IngredientRows
              rows={parseIngredientRows(ingredients)}
              ingredientLabel={cs.ingredient}
              quantityLabel={cs.quantity}
              caption={cs.whyThisOne}
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

/**
 * Cooking a record's own method in a modern kitchen.
 *
 * Not a recipe — a translation. Both halves are derived from tables rather
 * than written per dish: which ingredient to keep traditional comes from
 * `displacements.json`, and how to do a technique without the equipment comes
 * from `techniques.json`.
 *
 * The "keep" list is filtered upstream to genuine losses only. Rock salt gave
 * way to iodised salt and charcoal to LPG, and both were public-health gains —
 * telling a reader to reverse those would be advice that harms them.
 */
function MakeTodayNotes({
  notes,
  t,
}: {
  notes: NonNullable<CorpusRecord["make_today_notes"]>;
  t: UiStrings;
}) {
  if (notes.keep.length === 0 && notes.techniques.length === 0) return null;
  return (
    <div style={{ marginTop: "1.1rem", maxWidth: "62ch" }}>
      {notes.keep.length > 0 && (
        <>
          <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
            {t.cardKeepHeading}
          </div>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.1rem" }}>
            {notes.keep.map((k) => (
              <li key={k.keep} style={{ fontSize: "0.9rem", marginBottom: "0.3rem" }}>
                {k.keep}
                <span style={{ color: "var(--ink-soft)" }}> — {fill(t.cardNotX, { x: k.not })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {notes.techniques.length > 0 && (
        <>
          <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
            {t.cardModernKitchen}
          </div>
          {notes.techniques.map((tech) => (
            <div key={tech.archaic} style={{ marginBottom: "0.7rem" }}>
              <div style={{ fontSize: "0.9rem" }}>{tech.modern}</div>
              {tech.keep && (
                <div style={{ fontSize: "0.84rem", color: "var(--ink-soft)", marginTop: "0.2rem" }}>
                  {fill(t.cardKeepX, { x: tech.keep })}
                </div>
              )}
            </div>
          ))}
        </>
      )}
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.8rem", color: "var(--ink-muted)" }}>
        {t.cardQuantitiesYours}
      </p>
    </div>
  );
}

