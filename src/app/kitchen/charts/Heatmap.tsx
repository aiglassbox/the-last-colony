"use client";

import { INK, SEQUENTIAL } from "@/lib/dash/tokens";
import type { HeatCell } from "@/lib/dash/types";

import { Tip, useTip } from "./Tip";
import { useMeasure } from "./useMeasure";

/**
 * When people cook-curious, by weekday and hour, in IST.
 *
 * Magnitude, so a sequential ramp: one hue, seven steps, light to dark
 * reversed for a dark ground — the lowest step recedes toward the panel so an
 * hour with nothing in it reads as nothing rather than as a small value. A
 * categorical palette here would be the classic mistake, painting "3 threads"
 * and "30 threads" as two unrelated identities.
 *
 * An empty cell is drawn rather than skipped. The absence of a bar is easy to
 * miss; the presence of an empty cell is the shape of the quiet hours, and
 * those are half of what this figure is for.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LEFT = 34;
const TOP = 16;
const BOTTOM = 16;
const GAP = 2;

export function Heatmap({ cells, height = 176 }: { cells: HeatCell[]; height?: number }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, setTip, hide } = useTip();

  const grid = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c.n]));
  const max = Math.max(1, ...cells.map((c) => c.n));

  const plotWidth = Math.max(width - LEFT - 6, 10);
  const cellW = plotWidth / 24;
  const cellH = (height - TOP - BOTTOM) / 7;

  /* Zero gets the panel colour, not the ramp's first step — the ramp starts at
     "a little" and there has to be somewhere lower for "none" to sit. */
  const colour = (n: number) => {
    if (n <= 0) return "rgba(246, 236, 216, 0.045)";
    const step = Math.min(SEQUENTIAL.length - 1, Math.round((n / max) * (SEQUENTIAL.length - 1)));
    return SEQUENTIAL[Math.max(1, step)];
  };

  return (
    <div className="k-hover" ref={ref}>
      {width > 0 && (
        <svg
          className="k-fig"
          width={width}
          height={height}
          role="img"
          aria-label="Conversations by weekday and hour, India Standard Time"
        >
          {[0, 6, 12, 18, 23].map((hour) => (
            <text
              key={hour}
              x={LEFT + cellW * hour + cellW / 2}
              y={11}
              textAnchor="middle"
              fontSize={10}
              fill={INK.muted}
            >
              {hour === 0 ? "12a" : hour === 12 ? "12p" : hour > 12 ? `${hour - 12}p` : `${hour}a`}
            </text>
          ))}

          {DAYS.map((name, dow) => (
            <g key={name}>
              <text
                x={LEFT - 8}
                y={TOP + cellH * dow + cellH / 2 + 3.5}
                textAnchor="end"
                fontSize={10}
                fill={INK.muted}
              >
                {name}
              </text>
              {Array.from({ length: 24 }, (_, hour) => {
                const n = grid.get(`${dow}:${hour}`) ?? 0;
                return (
                  <rect
                    key={hour}
                    x={LEFT + cellW * hour + GAP / 2}
                    y={TOP + cellH * dow + GAP / 2}
                    width={Math.max(cellW - GAP, 1)}
                    height={Math.max(cellH - GAP, 1)}
                    rx={2}
                    fill={colour(n)}
                    onMouseEnter={() =>
                      setTip({
                        x: LEFT + cellW * hour + cellW / 2,
                        y: TOP + cellH * dow,
                        content: (
                          <>
                            <div className="k-tip__title">
                              {name} · {String(hour).padStart(2, "0")}:00 IST
                            </div>
                            <div className="k-tip__row">
                              {n} conversation{n === 1 ? "" : "s"}
                            </div>
                          </>
                        ),
                      })
                    }
                    onMouseLeave={hide}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      )}
      <Tip tip={tip} width={width} />

      <div className="k-legend" style={{ alignItems: "center" }}>
        <span style={{ color: INK.muted }}>quiet</span>
        {SEQUENTIAL.map((step) => (
          <span
            key={step}
            className="k-legend__swatch"
            style={{ background: step, width: 16, height: 8, borderRadius: 1, margin: 0 }}
            aria-hidden="true"
          />
        ))}
        <span style={{ color: INK.muted }}>busy · peak {max}</span>
      </div>
    </div>
  );
}
