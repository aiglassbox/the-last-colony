"use client";

import { useState } from "react";

import type { CorpusRecord, ProvenanceClass } from "@/lib/corpus/types";

/**
 * The provenance badge. Required on every ancient claim, four states, tappable
 * to explain itself.
 *
 * It also carries the verification state. A record whose locus has not been
 * checked against the printed edition gets a visible "unchecked" mark — the
 * validator already forbids such a record from claiming ATTESTED, and this is
 * the same honesty made visible to the reader rather than only to the build.
 */

const COPY: Record<ProvenanceClass, { label: string; colour: string; explain: string }> = {
  ATTESTED: {
    label: "Attested",
    colour: "var(--attested)",
    explain:
      "The verse exists and is quoted here. You can read the original, the transliteration and the translation in the source drawer, with the edition and page.",
  },
  RECONSTRUCTED: {
    label: "Reconstructed",
    colour: "var(--reconstructed)",
    explain:
      "A source describes this dish, but not completely. The gaps (quantities, timings, sometimes the method) are filled in from food history and from how related preparations were handled. The ingredients are from the text; the recipe is a careful reading.",
  },
  INFERRED: {
    label: "Inferred",
    colour: "var(--inferred)",
    explain:
      "No verse describes this preparation. What you are reading is built from what was available in the period and how comparable dishes were made. Treat it as an argument, not a record.",
  },
  MODERN_DISH: {
    label: "Modern dish",
    colour: "var(--modern)",
    explain:
      "There is no older version of this dish to go back to, and we are not going to invent one. What can be put back are its components: the thickener, the fat, the flour, the sweetener.",
  },
};

export function ProvenanceBadge({ record }: { record: CorpusRecord }) {
  const [open, setOpen] = useState(false);
  const copy = COPY[record.provenance_class];
  const unchecked = record.verification.status !== "editor_verified";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.3rem 0.6rem",
          borderRadius: 999,
          border: `1px solid ${copy.colour}`,
          color: copy.colour,
          background: "transparent",
          cursor: "pointer",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: copy.colour,
            display: "inline-block",
          }}
        />
        {copy.label}
        {unchecked && <span style={{ opacity: 0.75 }}>· unchecked</span>}
      </button>

      {open && (
        <p
          style={{
            margin: "0.55rem 0 0",
            fontSize: "0.86rem",
            lineHeight: 1.5,
            color: "var(--ink-soft)",
            maxWidth: "60ch",
          }}
        >
          {copy.explain}
          {unchecked && (
            <>
              {" "}
              <strong style={{ color: "var(--ink)" }}>
                No editor has checked this citation against the printed edition yet
              </strong>
              , so no verse number, page or original-language text is shown. {record.verification.note}
            </>
          )}
        </p>
      )}
    </div>
  );
}
