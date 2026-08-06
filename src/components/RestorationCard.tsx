"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { trackClient } from "@/lib/analytics";
import type { TurnKind } from "@/lib/chat/turn";
import type { CorpusRecord } from "@/lib/corpus/types";
import type { Beat } from "@/lib/model/beats";
import { toPlainText } from "@/lib/model/plain-text";
import {
  hasIngredientRows,
  ingredientLabel,
  parseIngredientRows,
  parseRecipeBeat,
} from "@/lib/model/recipe-beat";

import { IngredientRows } from "./IngredientRows";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { SourceDrawer } from "./SourceDrawer";

/**
 * The RestorationCard.
 *
 * The split that matters: model prose fills the four beats, and everything
 * citational — ingredient table, ancient method, source strip, provenance
 * badge, Then/Now diff, nutrition delta — is rendered here straight from the
 * retrieved record. The model never writes a citation because it never writes
 * that part of the card. It also means the record half is on screen the moment
 * retrieval returns, before the first token arrives.
 */

export interface CardData {
  records: CorpusRecord[];
  /** What the reader asked for. Names the dish on a card with no record. */
  query?: string;
  kind: TurnKind;
  beats: Partial<Record<string, string>>;
  streaming: boolean;
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
const RECORDLESS_NOTE: Partial<Record<TurnKind, string>> = {
  modern:
    "This one is younger than it tastes, so there is no older version to go back to. " +
    "What follows is how it came about, and a version built on older principles " +
    "rather than taken from a text.",
  gap:
    "An Indian dish we have not written up yet. Nothing below is drawn from a text, " +
    "because we do not hold one for it.",
  foreign:
    "This one did not come from India, so there is no older version to find. Nothing " +
    "below is drawn from a text, and none is implied.",
};

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

/** What the footer of a recordless card should say where a source would go. */
const SHARE_FOOTER: Partial<Record<TurnKind, { note: string; kind: string }>> = {
  modern: { note: "Component restoration", kind: "A modern dish, with no older version" },
  gap: { note: "Component restoration", kind: "Not written up yet" },
  foreign: { note: "Indian reinterpretation", kind: "Not an Indian dish" },
};

/**
 * Where the download button points, and what the file is called.
 *
 * A record card is rendered server-side from the record, so the slug is all the
 * route needs. A card with no record has nothing on the server to render from,
 * so what is on screen travels in the query string instead: the dish, the
 * verdict the model wrote, and the first few ingredients of the version it
 * offered. No text, no verse, no period, no provenance class — the things the
 * share image must never generate are exactly the things a recordless turn
 * never had.
 */
function shareTarget(
  data: CardData,
  ancient: CorpusRecord | null,
): { href: string; filename: string; slug: string } | null {
  if (ancient) {
    return {
      href: `/api/share/${ancient.slug}`,
      filename: `kranti-cookbook-${ancient.slug}.png`,
      slug: ancient.slug,
    };
  }

  const verdict = (data.beats.VERDICT ?? "").trim();
  const footer = SHARE_FOOTER[data.kind];
  // Mid-stream there is no verdict yet, and nothing to put on a card.
  if (!verdict || !footer) return null;

  const dish = titleCase(data.query ?? "") || firstLine(verdict);
  const recipe = parseRecipeBeat(data.beats.RESTORE_TODAY ?? "");
  // Name and quantity only. The reason field is the card's, not the image's:
  // the column of short strings on a 1080×1350 has no room for it, and the raw
  // "a :: b :: c" line went onto the image with its separators showing.
  const now = parseIngredientRows(recipe.ingredients).slice(0, 6).map(ingredientLabel);
  const steps = recipe.steps.slice(0, 7);

  const params = new URLSearchParams({
    dish,
    verdict,
    note: footer.note,
    kind: footer.kind,
  });
  if (now.length) {
    params.set("now", now.join("|"));
    params.set("nowLabel", "Cook this");
  }
  if (steps.length) params.set("steps", steps.join("|"));

  const slug = dish.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "restoration";
  return {
    href: `/api/share/turn?${params.toString()}`,
    filename: `kranti-cookbook-${slug}.png`,
    slug,
  };
}

/** Last resort when the reply carries no query: the verdict's opening clause. */
function firstLine(verdict: string): string {
  const first = verdict.split(/[.!?]/)[0].trim();
  return first.length > 3 && first.length <= 60 ? first : verdict.slice(0, 60);
}

/** A typed query is lower case; the line above a headline should not be. */
function titleCase(text: string): string {
  return text.trim().slice(0, 60).replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1));
}

export function RestorationCard({ data }: { data: CardData }) {
  const [open, setOpen] = useState<Record<Beat, boolean>>({
    VERDICT: true,
    THEN: true,
    WHAT_CHANGED: false,
    // Open. This is the one beat the reader is meant to act on, and behind a
    // collapsed header it reads as though the card never says how to cook it.
    RESTORE_TODAY: true,
  });
  const [drawer, setDrawer] = useState(false);

  const ancient = data.records.find((r) => r.tier === "ancient") ?? data.records[0] ?? null;
  const modern =
    (ancient?.modern_counterpart_id
      ? data.records.find((r) => r.id === ancient.modern_counterpart_id)
      : null) ?? null;

  const toggle = (b: Beat) => setOpen((o) => ({ ...o, [b]: !o[b] }));

  // Every card that has something to say can be taken away. A record card is
  // built server-side from the record; a card with no record is built from what
  // is on screen, because otherwise half the product cannot travel.
  const share = shareTarget(data, ancient);

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
  const shows = (beat: Beat): boolean => {
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
          {data.beats.VERDICT ?? (data.streaming ? "" : (ancient?.share_verdict ?? ""))}
          {data.streaming &&
            !data.beats.THEN &&
            (data.beats.VERDICT ? <span className="caret" aria-hidden /> : <Waiting />)}
        </p>
        {ancient && (
          <div style={{ marginTop: "0.85rem" }}>
            <ProvenanceBadge record={ancient} />
          </div>
        )}
        {RECORDLESS_NOTE[data.kind] && (
          <p
            style={{
              margin: "0.85rem 0 0",
              fontSize: "0.9rem",
              color: "var(--ink-soft)",
            }}
          >
            {RECORDLESS_NOTE[data.kind]}
          </p>
        )}
      </div>

      {shows("THEN") && (
      <Beat
        beat="THEN"
        kind={data.kind}
        open={open.THEN}
        onToggle={toggle}
        badge={ancient?.dish_name_source ?? undefined}
      >
        <Prose text={data.beats.THEN} streaming={data.streaming} />
        {ancient?.provenance_class === "MODERN_DISH" && (
          <p style={{ margin: "0 0 0.2rem", color: "var(--ink-soft)", maxWidth: "62ch" }}>
            There is no older version of this, and we are not going to invent one.
            Here is what is actually in it, and which of those ingredients only
            reached India in the last few centuries.
          </p>
        )}
        {ancient && (
          <>
            {/* The ingredient table earns its place on a modern dish too: the
                "why it was there" column is where the arrivals get named. */}
            <IngredientTable record={ancient} />
            {ancient.provenance_class !== "MODERN_DISH" && (
              <>
                <Method record={ancient} />
                <SourceStrip record={ancient} onOpen={() => setDrawer(true)} />
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
                {ancient.contested_points.map((c) => (
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

      {shows("WHAT_CHANGED") && (
      <Beat beat="WHAT_CHANGED" kind={data.kind} open={open.WHAT_CHANGED} onToggle={toggle}>
        <Prose text={data.beats.WHAT_CHANGED} streaming={data.streaming} />
        {ancient && modern ? (
          <ThenNow ancient={ancient} modern={modern} />
        ) : (
          /* No modern counterpart record — but the substitution story names what
             replaced what, so the diff can be drawn from that instead. Records
             from the index have no counterpart and would otherwise show nothing
             here, which is the beat doing the most work on the card. */
          <ThenNowFromChanges record={ancient} />
        )}
        {ancient?.substitution_story && <NutritionDelta record={ancient} />}
      </Beat>
      )}

      {shows("RESTORE_TODAY") && (
      <Beat beat="RESTORE_TODAY" kind={data.kind} open={open.RESTORE_TODAY} onToggle={toggle}>
        {ancient?.restore_today ? (
          <>
            <Prose text={data.beats.RESTORE_TODAY} streaming={data.streaming} />
            <RestoreToday record={ancient} />
          </>
        ) : (
          // No record (a modern dish or a corpus gap): the model writes the
          // ingredients and method into the beat, and we structure them here the
          // same way the ancient card structures a record's restore_today.
          <ModernRecipe text={data.beats.RESTORE_TODAY} streaming={data.streaming} />
        )}
        {ancient?.make_today_notes && <MakeTodayNotes notes={ancient.make_today_notes} />}
      </Beat>
      )}

      {share && (
        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: "0.85rem 1.15rem",
            display: "flex",
            gap: "0.6rem",
            flexWrap: "wrap",
          }}
        >
          {/* Downloads rather than opening in a tab. The card is a 1080×1350
              image made to be posted, and a reader who wanted to look at it is
              already looking at the card it was made from. */}
          <a
            href={share.href}
            download={share.filename}
            onClick={() => trackClient("card_shared", { slug: share.slug })}
            className="mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.45rem 0.8rem",
              borderRadius: 999,
              border: "1px solid var(--line-strong)",
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            <Download size={14} aria-hidden />
            Download card
          </a>
        </div>
      )}

      {drawer && ancient && <SourceDrawer record={ancient} onClose={() => setDrawer(false)} />}
    </article>
  );
}

function Beat({
  beat,
  kind,
  open,
  onToggle,
  badge,
  children,
}: {
  beat: Beat;
  kind: TurnKind;
  open: boolean;
  onToggle: (b: Beat) => void;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        className="beat-toggle"
        aria-expanded={open}
        onClick={() => onToggle(beat)}
      >
        <span className="mono" style={{ color: "var(--ink-muted)" }}>
          {TITLES[kind][beat]}
        </span>
        {badge && (
          <span className="display" style={{ fontSize: "0.95rem", color: "var(--orange)" }}>
            {badge}
          </span>
        )}
        <span className="chevron" data-open={open} aria-hidden>
          ›
        </span>
      </button>
      {open && <div style={{ padding: "0.2rem 1.15rem 1.15rem" }}>{children}</div>}
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

function IngredientTable({ record }: { record: CorpusRecord }) {
  if (!record.ingredients.length) return null;
  return (
    <div className="scroll-x" style={{ marginTop: "0.9rem" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 460 }}>
        <thead>
          <tr>
            {["Ingredient", "Quantity", "Why it was there"].map((h) => (
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
          {record.ingredients.map((i) => (
            <tr key={i.name}>
              <td style={cell}>
                {i.name}
                {i.sanskrit && (
                  <span style={{ color: "var(--orange)", fontStyle: "italic" }}> · {i.sanskrit}</span>
                )}
              </td>
              <td style={{ ...cell, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
                {i.quantity_modern ?? i.quantity_source ?? "not recorded"}
              </td>
              <td style={{ ...cell, color: "var(--ink-soft)" }}>{i.function}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "0.5rem 0.6rem 0.5rem 0",
  borderBottom: "1px solid var(--line)",
  fontSize: "0.9rem",
  verticalAlign: "top",
};

function Method({ record }: { record: CorpusRecord }) {
  if (!record.method_reconstructed.length) return null;
  return (
    <div style={{ marginTop: "1.1rem" }}>
      <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
        The method
      </div>
      <ol style={{ margin: 0, paddingLeft: "1.15rem", maxWidth: "62ch" }}>
        {record.method_reconstructed.map((s, i) => (
          <li key={i} style={{ marginBottom: "0.4rem", fontSize: "0.93rem" }}>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SourceStrip({ record, onOpen }: { record: CorpusRecord; onOpen: () => void }) {
  const verified = record.verification.status === "editor_verified";
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
          Source
        </div>
        <div className="display" style={{ fontSize: "0.98rem" }}>
          {record.source.text}
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--ink-soft)" }}>
          {verified
            ? [record.source.locus, record.source.edition].filter(Boolean).join(" · ")
            : "Citation not yet verified, so no verse or page is shown"}
        </div>
      </div>
      <span className="mono" style={{ marginLeft: "auto", color: "var(--orange)" }}>
        Open
      </span>
    </button>
  );
}

function ThenNow({ ancient, modern }: { ancient: CorpusRecord; modern: CorpusRecord }) {
  return (
    <div className="scroll-x" style={{ marginTop: "1rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.8rem",
          minWidth: 360,
        }}
      >
        <Column
          title="Then"
          colour="var(--orange)"
          items={ancient.ingredients.map((i) => i.name)}
        />
        <Column title="Now" colour="var(--now)" items={modern.ingredients.map((i) => i.name)} />
      </div>
    </div>
  );
}

/**
 * Then/Now drawn from the substitution story rather than a counterpart record.
 *
 * The original diff needs two records — an ancient dish and the modern dish it
 * became — and only the fourteen hand-authored records have that pair. The 199
 * indexed records have no counterpart, so this beat rendered empty for them.
 *
 * But the diff was never really about two dishes. It is about what replaced
 * what, and `substitution_story.changed` says so directly: ghee became
 * vanaspati, gur became mill-refined sugar. Each of those pairs is sourced in
 * `displacements.json`, so this shows the same comparison from stronger
 * evidence — an ingredient-level claim with a citation, rather than an
 * inference from two ingredient lists sitting side by side.
 */
function ThenNowFromChanges({ record }: { record: CorpusRecord | null }) {
  const changed = record?.substitution_story?.changed ?? [];
  if (changed.length === 0) return null;
  return (
    <div className="scroll-x" style={{ marginTop: "1rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.8rem",
          minWidth: 360,
        }}
      >
        <Column title="Then" colour="var(--orange)" items={changed.map((c) => c.from)} />
        <Column title="Now" colour="var(--now)" items={changed.map((c) => c.to)} />
      </div>
      <p style={{ margin: "0.6rem 0 0", fontSize: "0.8rem", color: "var(--ink-muted)" }}>
        These substitutions happened across Indian kitchens, not only in this dish.
      </p>
    </div>
  );
}

function Column({ title, colour, items }: { title: string; colour: string; items: string[] }) {
  return (
    <div
      style={{
        border: `1px solid ${colour}`,
        borderRadius: 12,
        padding: "0.7rem 0.8rem",
      }}
    >
      <div className="mono" style={{ color: colour, marginBottom: "0.45rem" }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: "1rem" }}>
        {items.map((i) => (
          <li key={i} style={{ fontSize: "0.88rem", marginBottom: "0.25rem" }}>
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ARROW: Record<string, string> = {
  up: "↑",
  down: "↓",
  unchanged: "→",
  mixed: "↕",
};

function NutritionDelta({ record }: { record: CorpusRecord }) {
  const delta = record.substitution_story?.nutrition_delta ?? {};
  const entries = Object.entries(delta);
  if (!entries.length) return null;
  return (
    <div style={{ marginTop: "1rem" }}>
      <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
        Then → now, by axis
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
            {axis.replace(/_/g, " ")} <strong>{ARROW[dir] ?? "→"}</strong>
          </span>
        ))}
      </div>
      <p style={{ margin: "0.6rem 0 0", fontSize: "0.8rem", color: "var(--ink-muted)" }}>
        A comparison between two versions of one dish. Not a health claim, and not advice.
        For anything personal, talk to a doctor or a dietitian.
      </p>
    </div>
  );
}

function ModernRecipe({ text, streaming }: { text?: string; streaming: boolean }) {
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
            Ingredients
          </div>
          {/* The table only once the model has committed to the three-field
              shape. A plain list stays a plain list: an older completion, a
              model that ignored the format, and every line mid-stream before
              its separators have arrived would otherwise render as a table of
              one-cell rows that reflows as it fills. */}
          {hasIngredientRows(ingredients) ? (
            <IngredientRows rows={parseIngredientRows(ingredients)} />
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
            Method
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
function MakeTodayNotes({ notes }: { notes: NonNullable<CorpusRecord["make_today_notes"]> }) {
  if (notes.keep.length === 0 && notes.techniques.length === 0) return null;
  return (
    <div style={{ marginTop: "1.1rem", maxWidth: "62ch" }}>
      {notes.keep.length > 0 && (
        <>
          <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
            Keep these as the record has them
          </div>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.1rem" }}>
            {notes.keep.map((k) => (
              <li key={k.keep} style={{ fontSize: "0.9rem", marginBottom: "0.3rem" }}>
                {k.keep}
                <span style={{ color: "var(--ink-soft)" }}> — not {k.not}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {notes.techniques.length > 0 && (
        <>
          <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
            Doing it in a modern kitchen
          </div>
          {notes.techniques.map((t) => (
            <div key={t.archaic} style={{ marginBottom: "0.7rem" }}>
              <div style={{ fontSize: "0.9rem" }}>{t.modern}</div>
              {t.keep && (
                <div style={{ fontSize: "0.84rem", color: "var(--ink-soft)", marginTop: "0.2rem" }}>
                  Keep {t.keep}
                </div>
              )}
            </div>
          ))}
        </>
      )}
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.8rem", color: "var(--ink-muted)" }}>
        The record gives a method but not amounts, so quantities are yours to judge.
      </p>
    </div>
  );
}

function RestoreToday({ record }: { record: CorpusRecord }) {
  const r = record.restore_today!;
  return (
    <div style={{ marginTop: "0.9rem" }}>
      <div className="mono" style={{ color: "var(--ink-muted)", marginBottom: "0.5rem" }}>
        {r.time_min} minutes · kirana ingredients
      </div>
      <ul style={{ margin: "0 0 0.9rem", paddingLeft: "1.1rem", maxWidth: "62ch" }}>
        {r.ingredients.map((i) => (
          <li key={i} style={{ fontSize: "0.9rem", marginBottom: "0.22rem" }}>
            {i}
          </li>
        ))}
      </ul>
      <ol style={{ margin: 0, paddingLeft: "1.15rem", maxWidth: "62ch" }}>
        {r.steps.map((s, i) => (
          <li key={i} style={{ fontSize: "0.92rem", marginBottom: "0.4rem" }}>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}
