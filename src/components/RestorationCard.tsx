"use client";

import { useState } from "react";

import { trackClient } from "@/lib/analytics";
import type { CorpusRecord } from "@/lib/corpus/types";
import type { Beat } from "@/lib/model/beats";
import { toPlainText } from "@/lib/model/plain-text";

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
  empty: boolean;
  /** True when the empty card is a modern dish (not a corpus gap) — reframes the note. */
  modern?: boolean;
  beats: Partial<Record<string, string>>;
  streaming: boolean;
}

const TITLES: Record<Beat, string> = {
  VERDICT: "The verdict",
  THEN: "Then",
  WHAT_CHANGED: "What changed",
  RESTORE_TODAY: "Restore it today",
};

export function RestorationCard({ data }: { data: CardData }) {
  const [open, setOpen] = useState<Record<Beat, boolean>>({
    VERDICT: true,
    THEN: true,
    WHAT_CHANGED: false,
    RESTORE_TODAY: false,
  });
  const [drawer, setDrawer] = useState(false);

  const ancient = data.records.find((r) => r.tier === "ancient") ?? data.records[0] ?? null;
  const modern =
    (ancient?.modern_counterpart_id
      ? data.records.find((r) => r.id === ancient.modern_counterpart_id)
      : null) ?? null;

  const toggle = (b: Beat) => setOpen((o) => ({ ...o, [b]: !o[b] }));

  return (
    <article className="card" style={{ marginTop: "1rem" }}>
      {/* Beat 1 — the gut-punch. Never collapsed behind a toggle header. */}
      <div style={{ padding: "1.2rem 1.15rem 1.05rem" }}>
        <p className="verdict" style={{ margin: 0 }}>
          {/* If the model wrote nothing — no key, a dropped stream — the
              editorial verdict on the record stands in. It is the same line the
              share image uses, so the card is never blank and never invents. */}
          {data.beats.VERDICT ?? (data.streaming ? "" : (ancient?.share_verdict ?? ""))}
          {data.streaming && !data.beats.THEN && <span className="caret" aria-hidden />}
        </p>
        {ancient && (
          <div style={{ marginTop: "0.85rem" }}>
            <ProvenanceBadge record={ancient} />
          </div>
        )}
        {data.empty && (
          <p
            style={{
              margin: "0.85rem 0 0",
              fontSize: "0.9rem",
              color: "var(--ink-soft)",
            }}
          >
            {data.modern
              ? "A modern dish, with no ancient original. What follows is its short history and a lighter version built on older principles, not drawn from a specific text."
              : "Not in the restored corpus yet. Nothing below is drawn from a text, because there is no text here to draw from."}
          </p>
        )}
      </div>

      <Beat
        beat="THEN"
        open={open.THEN}
        onToggle={toggle}
        badge={ancient?.dish_name_source ?? undefined}
      >
        <Prose text={data.beats.THEN} streaming={data.streaming} />
        {ancient?.provenance_class === "MODERN_DISH" && (
          <p style={{ margin: "0 0 0.2rem", color: "var(--ink-soft)", maxWidth: "62ch" }}>
            No ancient original, and we are not going to invent one. Here is what is
            actually in it — and which of those ingredients only reached India in the
            last few centuries.
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

      <Beat beat="WHAT_CHANGED" open={open.WHAT_CHANGED} onToggle={toggle}>
        <Prose text={data.beats.WHAT_CHANGED} streaming={data.streaming} />
        {ancient && modern && <ThenNow ancient={ancient} modern={modern} />}
        {ancient?.substitution_story && <NutritionDelta record={ancient} />}
      </Beat>

      <Beat beat="RESTORE_TODAY" open={open.RESTORE_TODAY} onToggle={toggle}>
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
      </Beat>

      {ancient && (
        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: "0.85rem 1.15rem",
            display: "flex",
            gap: "0.6rem",
            flexWrap: "wrap",
          }}
        >
          <a
            href={`/api/share/${ancient.slug}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackClient("card_shared", { slug: ancient.slug })}
            className="mono"
            style={{
              padding: "0.45rem 0.8rem",
              borderRadius: 999,
              border: "1px solid var(--line-strong)",
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            Share card
          </a>
          <a
            href={`/dish/${ancient.slug}`}
            className="mono"
            style={{
              padding: "0.45rem 0.8rem",
              borderRadius: 999,
              border: "1px solid var(--line-strong)",
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            Permalink
          </a>
        </div>
      )}

      {drawer && ancient && <SourceDrawer record={ancient} onClose={() => setDrawer(false)} />}
    </article>
  );
}

function Beat({
  beat,
  open,
  onToggle,
  badge,
  children,
}: {
  beat: Beat;
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
          {TITLES[beat]}
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

function Prose({ text, streaming }: { text?: string; streaming: boolean }) {
  if (!text) {
    return streaming ? (
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        <span className="caret" aria-hidden />
      </p>
    ) : null;
  }
  return (
    <div style={{ maxWidth: "62ch" }}>
      {toPlainText(text)
        .split(/\n{2,}/)
        .map((para, i) => (
          <p key={i} style={{ margin: i === 0 ? "0 0 0.6rem" : "0 0 0.6rem" }}>
            {para}
          </p>
        ))}
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

/**
 * Structures a no-record "restore today" beat. The model writes an intro line,
 * then an INGREDIENTS block and a METHOD block; we parse those into the same
 * list + numbered-steps shape the ancient card renders from a record. Falls
 * back to plain prose if the model didn't use the sections.
 */
function parseModernRecipe(text: string): {
  intro: string;
  ingredients: string[];
  steps: string[];
} {
  let section: "intro" | "ing" | "steps" = "intro";
  const intro: string[] = [];
  const ingredients: string[] = [];
  const steps: string[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const head = l.toUpperCase().replace(/[^A-Z]+$/, "");
    if (/^INGREDIENTS?$/.test(head)) {
      section = "ing";
      continue;
    }
    if (/^(METHOD|STEPS|DIRECTIONS)$/.test(head)) {
      section = "steps";
      continue;
    }
    if (section === "intro") intro.push(l);
    else if (section === "ing") ingredients.push(l.replace(/^[-*•]\s*/, ""));
    else steps.push(l.replace(/^\d+[.)]\s*/, ""));
  }
  return { intro: intro.join(" "), ingredients, steps };
}

function ModernRecipe({ text, streaming }: { text?: string; streaming: boolean }) {
  if (!text) {
    return streaming ? (
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        <span className="caret" aria-hidden />
      </p>
    ) : null;
  }
  const { intro, ingredients, steps } = parseModernRecipe(text);
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
          <ul style={{ margin: "0 0 0.9rem", paddingLeft: "1.1rem" }}>
            {ingredients.map((i, k) => (
              <li key={k} style={{ fontSize: "0.9rem", marginBottom: "0.22rem" }}>
                {i}
              </li>
            ))}
          </ul>
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
      {streaming && <span className="caret" aria-hidden />}
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
