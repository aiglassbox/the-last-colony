"use client";

import type { CSSProperties } from "react";

import { toPlainText } from "@/lib/model/plain-text";
import {
  hasIngredientRows,
  parseIngredientRows,
  parseRecipeBeat,
} from "@/lib/model/recipe-beat";
import { IngredientRows } from "./IngredientRows";
import { Waiting } from "./RestorationCard";
import { Download } from "lucide-react";
import { trackClient } from "@/lib/analytics";

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
}

export function IndianisationCard({ data }: { data: IndianizationData }) {
  const { beats, streaming } = data;
  const share = shareTarget(beats);

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
            Indian-inspired fusion · not a restoration
          </span>
        </div>
        {/* Said in words as well as on the chip, because the chip states what
            the card is and this states why. The corpus is deliberately not
            mentioned: whether we hold a record is irrelevant to a dish that was
            never Indian, and raising it implies one could arrive later. */}
        <p
          style={{
            margin: "0.85rem 0 0",
            fontSize: "0.9rem",
            color: "var(--ink-soft)",
          }}
        >
          Not an Indian-origin dish, so there is no ancient original to restore. What
          follows is a rebuild from Indian components, not a historical recipe.
        </p>
      </div>

      <Section title="Rebuilt with an Indian spirit">
        <Prose text={beats.REBUILD} streaming={streaming} />
      </Section>

      {(beats.SWAPS || streaming) && (
        <Section title="Component swaps">
          <SwapTable text={beats.SWAPS} streaming={streaming} />
        </Section>
      )}

      {(beats.PLATE || (streaming && Boolean(beats.SWAPS))) && (
        <Section title="Make it today">
          <Plate text={beats.PLATE} streaming={streaming} />
        </Section>
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
    </article>
  );
}

/**
 * The swap table is already a Then/Now: the foreign component on one side, the
 * Indian one on the other. That is the whole argument of the card, so it is
 * what the image carries.
 */
function shareTarget(beats: Partial<Record<string, string>>) {
  const verdict = (beats.VERDICT ?? "").trim();
  if (!verdict) return null;

  const rows = (beats.SWAPS ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("::"))
    .map((l) => l.split(/\s*::\s*/))
    .filter((p) => p[0] && p[1] && !/^<?(foreign part|indian swap)>?$/i.test(p[0].trim()))
    .slice(0, 5);

  const dish = verdict.split(/[.!?]/)[0].trim().slice(0, 60) || verdict.slice(0, 60);
  const params = new URLSearchParams({
    dish,
    verdict,
    note: "Indian reinterpretation",
    kind: "Not an Indian dish",
  });
  if (rows.length) {
    params.set("then", rows.map((r) => r[0]).join("|"));
    params.set("now", rows.map((r) => r[1]).join("|"));
    params.set("thenLabel", "Instead of");
    params.set("nowLabel", "Use");
  }

  // PLATE is how it is cooked. Its own steps where the model marked a METHOD
  // block, otherwise its sentences, which is still the method. Parsed rather
  // than split on newlines, because the beat now carries an INGREDIENTS block
  // too and those rows are not steps: splitting the whole beat put "a :: b ::
  // c" onto the image with its separators showing.
  const plate = (beats.PLATE ?? "").trim();
  const beat = parseRecipeBeat(plate);
  const flat = beat.steps.length
    ? beat.steps.map((s) => s.replace(/^[-*•]\s*/, ""))
    // The prose half only. An INGREDIENTS block with no METHOD after it would
    // otherwise reach the sentence splitter and land on the image as rows.
    : (beat.intro || plate).split(/(?<=[.!?])\s+/).map((x) => x.trim());
  const usable = flat.filter((x) => x.length > 12).slice(0, 6);
  if (usable.length) params.set("steps", usable.join("|"));

  const slug =
    dish.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "indianisation";
  return {
    href: `/api/share/turn?${params.toString()}`,
    filename: `kranti-cookbook-${slug}.png`,
    slug,
  };
}

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

const cell: CSSProperties = {
  padding: "0.5rem 0.6rem 0.5rem 0",
  borderBottom: "1px solid var(--line)",
  fontSize: "0.9rem",
  verticalAlign: "top",
};

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
function Plate({ text, streaming }: { text?: string; streaming: boolean }) {
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
 * The model emits one component per line as `foreign :: indian :: reason`, the
 * same discipline the swap table uses so a fusion is built from named parts
 * rather than a wall of prose. A line that does not parse is dropped rather than
 * shown malformed.
 */
function SwapTable({ text, streaming }: { text?: string; streaming: boolean }) {
  const seen = new Set<string>();
  const rows = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s*::\s*/);
      return { foreign: parts[0] ?? "", indian: parts[1] ?? "", why: parts[2] ?? "" };
    })
    .filter((r) => r.foreign && r.indian)
    // The prompt states the row format as "<foreign part> :: <indian swap>",
    // and the model has copied that line through as data, with or without the
    // brackets. The table already renders those words as its header, so it
    // arrived as a second header sitting in the body.
    .filter((r) => !/^<?(foreign part|indian swap)>?$/i.test(r.foreign.trim()))
    // The same swap has also come back twice in one table.
    .filter((r) => {
      const key = `${r.foreign} ${r.indian}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!rows.length) {
    return streaming ? (
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        <Waiting />
      </p>
    ) : null;
  }

  return (
    <div className="scroll-x">
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 460 }}>
        <thead>
          <tr>
            {["Foreign part", "Indian swap", "Why"].map((h) => (
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
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={cell}>{r.foreign}</td>
              <td style={{ ...cell, color: "var(--now)" }}>{r.indian}</td>
              <td style={{ ...cell, color: "var(--ink-soft)" }}>{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
