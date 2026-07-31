"use client";

import type { CSSProperties } from "react";

import { toPlainText } from "@/lib/model/plain-text";

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

  return (
    <article className="card" style={{ marginTop: "1rem" }}>
      <div style={{ padding: "1.2rem 1.15rem 1.05rem" }}>
        <p className="verdict" style={{ margin: 0 }}>
          {beats.VERDICT ?? ""}
          {streaming && !beats.REBUILD && <span className="caret" aria-hidden />}
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
          <Prose text={beats.PLATE} streaming={streaming} />
        </Section>
      )}
    </article>
  );
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
        <span className="caret" aria-hidden />
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
 * The model emits one component per line as `foreign :: indian :: reason`, the
 * same discipline the swap table uses so a fusion is built from named parts
 * rather than a wall of prose. A line that does not parse is dropped rather than
 * shown malformed.
 */
function SwapTable({ text, streaming }: { text?: string; streaming: boolean }) {
  const rows = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s*::\s*/);
      return { foreign: parts[0] ?? "", indian: parts[1] ?? "", why: parts[2] ?? "" };
    })
    .filter((r) => r.foreign && r.indian);

  if (!rows.length) {
    return streaming ? (
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        <span className="caret" aria-hidden />
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
