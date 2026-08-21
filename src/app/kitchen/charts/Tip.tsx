"use client";

import { useCallback, useState, type ReactNode } from "react";

/**
 * The hover layer, shared by every figure here.
 *
 * An SVG chart in a browser is interactive whether or not anyone planned for
 * it, and a chart with no tooltip forces the reader to estimate values off an
 * axis that was deliberately made recessive. So a crosshair and a readout are
 * the default, and the only figure that goes without is one with no plot.
 *
 * Positioned in the container's own coordinates rather than the viewport's, so
 * it survives the page scrolling under it and does not need a portal. The tip
 * itself is `pointer-events: none` — a tooltip that can steal the pointer it
 * was summoned by flickers.
 */

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const hide = useCallback(() => setTip(null), []);
  return { tip, setTip, hide };
}

export function Tip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;

  /* Clamped so a tooltip on the last bar does not hang off the panel. The
     transform in CSS centres it, so the usable range is half a tip's width in
     from either edge; 90px is a generous half for the two-line readouts here. */
  const left = Math.min(Math.max(tip.x, 90), Math.max(width - 90, 90));

  return (
    <div className="k-tip" style={{ left, top: Math.max(tip.y - 10, 26) }} role="presentation">
      {tip.content}
    </div>
  );
}

/** A swatch and a label, so the readout names the series rather than relying on its colour. */
export function TipRow({ colour, label, value }: { colour: string; label: string; value: string }) {
  return (
    <div className="k-tip__row">
      <span className="k-legend__swatch" style={{ background: colour }} aria-hidden="true" />
      <span>{label}</span>
      <strong style={{ marginLeft: 4, fontWeight: 500 }}>{value}</strong>
    </div>
  );
}

export function Legend({ items }: { items: { colour: string; label: string }[] }) {
  return (
    <div className="k-legend">
      {items.map((item) => (
        <span className="k-legend__item" key={item.label}>
          <span
            className="k-legend__swatch"
            style={{ background: item.colour }}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
