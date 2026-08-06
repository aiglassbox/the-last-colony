"use client";

import type { CSSProperties } from "react";

import type { IngredientRow } from "@/lib/model/recipe-beat";

/**
 * The ingredient table for a card with no record.
 *
 * Deliberately the same three columns as the record table in RestorationCard,
 * because a reader should not have to learn a second layout for the same
 * information. The third heading is where they part: a record says why an
 * ingredient *was* there, and this says why it is being used now — the
 * component it restores, what it does to the dish, or the axis it wins on.
 *
 * The reason column disappears when no row carries one. The model is told to
 * leave the field empty rather than invent a reason, so an empty column is the
 * expected outcome for a dish whose components are not in `<component_swaps>`,
 * and a table of blank cells looks like a bug rather than a silence.
 */
export function IngredientRows({
  rows,
  caption = "Why this one",
}: {
  rows: IngredientRow[];
  caption?: string;
}) {
  if (!rows.length) return null;

  const withReason = rows.some((r) => r.why);
  const withQuantity = rows.some((r) => r.quantity);

  // The reason is a clause, not a label, so it is given the room to be one.
  // Left to itself the browser divides the width by content, and a column of
  // sentences beside two columns of short strings ends up the narrowest of the
  // three — a word per line against acres of empty quantity column.
  const headers: Array<{ label: string; width?: string }> = [
    { label: "Ingredient", width: withReason ? "26%" : undefined },
    ...(withQuantity ? [{ label: "Quantity", width: withReason ? "20%" : undefined }] : []),
    ...(withReason ? [{ label: caption, width: "54%" }] : []),
  ];

  return (
    <div className="scroll-x" style={{ marginBottom: "0.9rem" }}>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          tableLayout: withReason ? "fixed" : "auto",
          minWidth: withReason ? 460 : 280,
        }}
      >
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h.label}
                className="mono"
                style={{
                  textAlign: "left",
                  color: "var(--ink-muted)",
                  padding: "0.4rem 0.6rem 0.4rem 0",
                  borderBottom: "1px solid var(--line-strong)",
                  fontWeight: 400,
                  width: h.width,
                }}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={cell}>{r.name}</td>
              {withQuantity && (
                <td
                  style={{
                    ...cell,
                    color: "var(--ink-soft)",
                    // Only where the layout is content-driven. Under the fixed
                    // layout the reason column needs, a quantity that refuses to
                    // wrap runs out of its cell and under the next one.
                    whiteSpace: withReason ? "normal" : "nowrap",
                  }}
                >
                  {r.quantity}
                </td>
              )}
              {withReason && (
                <td style={{ ...cell, color: "var(--ink-soft)", lineHeight: 1.45 }}>{r.why}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cell: CSSProperties = {
  padding: "0.5rem 0.6rem 0.5rem 0",
  borderBottom: "1px solid var(--line)",
  fontSize: "0.9rem",
  verticalAlign: "top",
};
