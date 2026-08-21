"use client";

import { INK } from "@/lib/dash/tokens";

import { Tip, useTip } from "./Tip";
import { useMeasure } from "./useMeasure";

/**
 * One bar, showing a whole split to 100%.
 *
 * A donut was the obvious alternative and is worse at exactly the job this has:
 * comparing four shares. Angle is the hardest channel to read accurately, and
 * the two smallest slices of a donut — which here are the two most interesting,
 * because they are the failures — are the ones it hides. A single stacked bar
 * puts every share on one common baseline where length does the work.
 *
 * A 2px gap in the panel colour separates the segments, so the boundaries stay
 * visible for a reader who cannot separate two adjacent hues.
 */

export interface MixSegment {
  key: string;
  label: string;
  colour: string;
  n: number;
}

export function MixBar({ segments, height = 34 }: { segments: MixSegment[]; height?: number }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, setTip, hide } = useTip();

  const total = segments.reduce((sum, s) => sum + s.n, 0);
  if (!total) return <p className="k-empty">Nothing in this window yet.</p>;

  const GAP = 2;
  const usable = Math.max(width - GAP * (segments.length - 1), 10);

  /* Offsets are computed before the JSX rather than by advancing a cursor
     inside it. A variable mutated while rendering is a variable whose value
     depends on how many times React chose to render, which is not a thing a
     component is allowed to depend on. */
  const laid = segments.reduce<{ segment: MixSegment; x: number; w: number }[]>(
    (acc, segment) => {
      const previous = acc[acc.length - 1];
      const x = previous ? previous.x + previous.w + GAP : 0;
      return [...acc, { segment, x, w: (segment.n / total) * usable }];
    },
    [],
  );

  return (
    <div className="k-hover" ref={ref}>
      {width > 0 && (
        <svg className="k-fig" width={width} height={height} role="img" aria-label="Share of turns">
          {laid.map(({ segment: s, x, w }, index) => {
            const first = index === 0;
            const last = index === segments.length - 1;
            return (
              <rect
                key={s.key}
                x={x}
                y={0}
                width={Math.max(w, 1)}
                height={height}
                rx={first || last ? 4 : 0}
                fill={s.colour}
                onMouseEnter={() =>
                  setTip({
                    x: x + w / 2,
                    y: 0,
                    content: (
                      <>
                        <div className="k-tip__title">{s.label}</div>
                        <div className="k-tip__row">
                          {s.n.toLocaleString("en-IN")} · {Math.round((s.n / total) * 100)}%
                        </div>
                      </>
                    ),
                  })
                }
                onMouseLeave={hide}
              />
            );
          })}
        </svg>
      )}
      <Tip tip={tip} width={width} />

      {/* Four or fewer, so every segment is directly labelled as well as
          legended — identity never rests on colour alone. */}
      <div className="k-legend">
        {segments.map((s) => (
          <span className="k-legend__item" key={s.key}>
            <span className="k-legend__swatch" style={{ background: s.colour }} aria-hidden="true" />
            {s.label}
            <span style={{ color: INK.muted }}>
              {s.n.toLocaleString("en-IN")} · {Math.round((s.n / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
