"use client";

import { SERIES } from "@/lib/dash/tokens";

/**
 * A ranked list, drawn.
 *
 * Nominal categories — dish names — so every bar takes the same hue rather than
 * being coloured by its own value. Colouring these by rank would spend the
 * identity channel re-encoding what bar length already says, and would repaint
 * the survivors every time the window changed.
 *
 * Built from DOM elements rather than SVG on purpose: the labels are the point
 * here, they are of unpredictable length, and letting the browser ellipsise
 * them is better than measuring text in script.
 */

export interface BarItem {
  label: string;
  n: number;
  /** Alternate spellings folded into this row, shown so the merge is visible. */
  variants?: string[];
  colour?: string;
  href?: string;
}

export function BarList({
  items,
  unit = "",
  emptyNote = "Nothing in this window yet.",
}: {
  items: BarItem[];
  /**
   * Singular. An "s" is appended unless the count is one, which covers
   * "device" and "people"-free cases and nothing harder — the moment a caller
   * needs an irregular plural, this should take a [singular, plural] pair
   * rather than grow a rule.
   */
  unit?: string;
  emptyNote?: string;
}) {
  if (!items.length) return <p className="k-empty">{emptyNote}</p>;
  const max = Math.max(...items.map((i) => i.n), 1);

  return (
    <div className="k-bars">
      {items.map((item) => (
        <div className="k-bar" key={item.label}>
          <div className="k-bar__label">
            <span className="k-bar__name" title={item.label}>
              {item.label}
              {item.variants?.length ? (
                <span className="k-variants"> · also “{item.variants.join("”, “")}”</span>
              ) : null}
            </span>
            <span className="k-bar__value">
              {item.n.toLocaleString("en-IN")}
              {unit ? ` ${unit}${item.n === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          <div className="k-bar__track">
            <div
              className="k-bar__fill"
              style={{
                width: `${(item.n / max) * 100}%`,
                background: item.colour ?? SERIES[0],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
