"use client";

import { INK, SERIES } from "@/lib/dash/tokens";
import type { DepthRow } from "@/lib/dash/types";

import { Tip, useTip } from "./Tip";
import { useMeasure } from "./useMeasure";

/**
 * How far a thread got before it ended.
 *
 * A turn is a question and a reply, so the x axis is relabelled in turns rather
 * than in messages — "2 messages" is a database fact and "1 question" is the
 * thing anybody wants to know. The first bar is the one to read: it is every
 * reader the product answered once and did not hold.
 */

/* Generous headroom: the tallest bar carries a label above it, and at 14px the
   label was clipped by the top of the figure whenever bucket one was the peak —
   which it usually is. */
const PAD = { top: 24, right: 8, bottom: 28, left: 30 };

export function Histogram({ rows, height = 176 }: { rows: DepthRow[]; height?: number }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, setTip, hide } = useTip();

  if (!rows.length) return <p className="k-empty">Nothing in this window yet.</p>;

  const total = rows.reduce((sum, r) => sum + r.threads, 0);
  const max = Math.max(1, ...rows.map((r) => r.threads));
  const plotWidth = Math.max(width - PAD.left - PAD.right, 10);
  const plotHeight = height - PAD.top - PAD.bottom;
  const slot = plotWidth / rows.length;
  const barWidth = Math.max(4, Math.min(slot - 6, 44));
  const baseline = PAD.top + plotHeight;

  return (
    <div className="k-hover" ref={ref}>
      {width > 0 && (
        <svg
          className="k-fig"
          width={width}
          height={height}
          role="img"
          aria-label="Threads by number of turns"
        >
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={baseline}
            y2={baseline}
            stroke={INK.axis}
            strokeWidth={1}
          />
          <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end" fontSize={10} fill={INK.muted}>
            {max}
          </text>

          {rows.map((row, index) => {
            const h = (row.threads / max) * plotHeight;
            const cx = PAD.left + slot * index + slot / 2;
            const turns = Math.max(1, Math.round(row.messages / 2));
            const share = Math.round((row.threads / total) * 100);
            return (
              <g
                key={row.messages}
                onMouseEnter={() =>
                  setTip({
                    x: cx,
                    y: baseline - h,
                    content: (
                      <>
                        <div className="k-tip__title">
                          {turns} question{turns === 1 ? "" : "s"}
                        </div>
                        <div className="k-tip__row">
                          {row.threads} thread{row.threads === 1 ? "" : "s"} · {share}%
                        </div>
                      </>
                    ),
                  })
                }
                onMouseLeave={hide}
              >
                <rect x={cx - slot / 2} y={PAD.top} width={slot} height={plotHeight} fill="transparent" />
                <rect
                  x={cx - barWidth / 2}
                  y={baseline - h}
                  width={barWidth}
                  height={Math.max(h, 1)}
                  rx={4}
                  fill={SERIES[0]}
                />
                {/* One hue for every bar: these are buckets of the same thing,
                    and length already says which is biggest. The bucket that
                    matters gets a direct label instead of a second colour,
                    which would read as a second series. */}
                {index === 0 && (
                  <text
                    x={cx}
                    y={baseline - h - 6}
                    textAnchor="middle"
                    fontSize={11}
                    fill={INK.primary}
                  >
                    {share}% asked once
                  </text>
                )}
                <text x={cx} y={height - 14} textAnchor="middle" fontSize={10} fill={INK.muted}>
                  {turns}
                </text>
              </g>
            );
          })}

          <text
            x={PAD.left + plotWidth / 2}
            y={height - 2}
            textAnchor="middle"
            fontSize={10}
            fill={INK.muted}
          >
            questions asked in the thread
          </text>
        </svg>
      )}
      <Tip tip={tip} width={width} />
    </div>
  );
}
