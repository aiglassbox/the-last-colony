"use client";

import { INK } from "@/lib/dash/tokens";

import { Legend, Tip, TipRow, useTip } from "./Tip";
import { useMeasure } from "./useMeasure";

/**
 * Stacked bars, one per day.
 *
 * The 2px gap between the two segments is not decoration. Without it the
 * boundary between "new" and "returning" is a colour change alone, and on a
 * short bar under simulated deuteranopia that boundary vanishes — the reader
 * sees one bar of ambiguous provenance. The gap is a second channel carrying
 * the same information, which is the whole point of a spacer.
 *
 * Bars sit on the baseline with rounded ends at the top only, so the zero line
 * stays a line rather than becoming a row of lozenges floating above it.
 */

interface Segment {
  key: string;
  label: string;
  colour: string;
}

/** Generic for the same reason `TimeSeries` is: no caller should have to cast. */
interface Props<T extends { day: string }> {
  rows: readonly T[];
  segments: (Segment & { key: Extract<keyof T, string> })[];
  height?: number;
}

const PAD = { top: 12, right: 10, bottom: 22, left: 32 };
const GAP = 2;
const RADIUS = 4;

function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(date)} ${names[Number(month) - 1] ?? ""}`.trim();
}

/** A rect with only its top corners rounded — the data end, not the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h);
  return (
    `M ${x} ${y + h} L ${x} ${y + radius} Q ${x} ${y} ${x + radius} ${y} ` +
    `L ${x + w - radius} ${y} Q ${x + w} ${y} ${x + w} ${y + radius} ` +
    `L ${x + w} ${y + h} Z`
  );
}

export function StackedDays<T extends { day: string }>({
  rows,
  segments,
  height = 190,
}: Props<T>) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, setTip, hide } = useTip();

  if (!rows.length) return <p className="k-empty">Nothing in this window yet.</p>;

  const totals = rows.map((row) =>
    segments.reduce((sum, s) => sum + Number(row[s.key] ?? 0), 0),
  );
  const max = Math.max(1, ...totals);

  const plotWidth = Math.max(width - PAD.left - PAD.right, 10);
  const plotHeight = height - PAD.top - PAD.bottom;
  const slot = plotWidth / rows.length;
  const barWidth = Math.max(3, Math.min(slot - 3, 26));

  const baseline = PAD.top + plotHeight;
  const scale = (value: number) => (value / max) * plotHeight;
  // Same reasoning as TimeSeries: labels are budgeted in pixels, not in rows.
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(plotWidth / 58))));

  return (
    <div className="k-hover" ref={ref}>
      {width > 0 && (
        <svg
          className="k-fig"
          width={width}
          height={height}
          role="img"
          aria-label={segments.map((s) => s.label).join(" against ")}
        >
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={baseline - plotHeight * f}
              y2={baseline - plotHeight * f}
              stroke={f === 0 ? INK.axis : INK.grid}
              strokeWidth={1}
            />
          ))}
          <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end" fontSize={10} fill={INK.muted}>
            {max}
          </text>

          {rows.map((row, index) => {
            const cx = PAD.left + slot * index + slot / 2;
            /* Only the segments that actually have a value are drawn, and the
               last of those carries the rounded end — the top of the stack is
               the data end, not whichever segment happens to be listed last. */
            const visible = segments.filter((s) => Number(row[s.key] ?? 0) > 0);
            let cursor = baseline;
            return (
              <g
                key={row.day}
                onMouseEnter={() =>
                  setTip({
                    x: cx,
                    y: baseline - scale(totals[index]),
                    content: (
                      <>
                        <div className="k-tip__title">{shortDay(row.day)}</div>
                        {segments.map((s) => (
                          <TipRow
                            key={s.key}
                            colour={s.colour}
                            label={s.label}
                            value={String(row[s.key] ?? 0)}
                          />
                        ))}
                      </>
                    ),
                  })
                }
                onMouseLeave={hide}
              >
                {/* A full-height target, so a one-device day is as easy to hover
                    as a sixty-device one. */}
                <rect
                  x={cx - slot / 2}
                  y={PAD.top}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                />
                {visible.map((s, position) => {
                  const value = Number(row[s.key] ?? 0);
                  const h = scale(value);
                  const isTop = position === visible.length - 1;
                  const y = cursor - h;
                  cursor = y - GAP;
                  return isTop ? (
                    <path
                      key={s.key}
                      d={topRounded(cx - barWidth / 2, y, barWidth, h, RADIUS)}
                      fill={s.colour}
                    />
                  ) : (
                    <rect
                      key={s.key}
                      x={cx - barWidth / 2}
                      y={y}
                      width={barWidth}
                      height={h}
                      fill={s.colour}
                    />
                  );
                })}
              </g>
            );
          })}

          {rows.map((row, index) =>
            index % labelEvery === 0 || index === rows.length - 1 ? (
              <text
                key={row.day}
                x={PAD.left + slot * index + slot / 2}
                y={height - 6}
                textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}
                fontSize={10}
                fill={INK.muted}
              >
                {shortDay(row.day)}
              </text>
            ) : null,
          )}
        </svg>
      )}
      <Tip tip={tip} width={width} />
      <Legend items={segments.map((s) => ({ colour: s.colour, label: s.label }))} />
    </div>
  );
}
