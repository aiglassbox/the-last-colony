"use client";

import { useMemo } from "react";

import { INK, SERIES } from "@/lib/dash/tokens";

import { Legend, Tip, TipRow, useTip } from "./Tip";
import { useMeasure } from "./useMeasure";

/**
 * Threads and devices over time, on one axis.
 *
 * One axis, deliberately, and it is worth saying why since a second one is the
 * reflex here: threads and devices are both counts of the same kind of thing,
 * and a device can never exceed the threads it started, so the two share a
 * scale honestly and the gap between the lines *is* the reading — it is
 * threads-per-device, drawn. Giving devices its own right-hand axis would let
 * that gap be set by whatever scaling made the picture look busiest, which is
 * how a dual-axis chart lies without anyone intending it to.
 */

/**
 * Generic over the row, so a caller passes its own shape and the compiler
 * checks that every series key exists on it. The alternative — an index
 * signature on the prop — would have every caller cast, and a cast is exactly
 * where a renamed column silently becomes a flat line at zero.
 */
interface Props<T extends { day: string }> {
  rows: readonly T[];
  series: { key: Extract<keyof T, string>; label: string; colour: string }[];
  height?: number;
  /** The first series is drawn as an area as well as a line. */
  area?: boolean;
}

const PAD = { top: 12, right: 10, bottom: 22, left: 36 };

/** Ticks a person would choose: 1, 2, 5 and their powers. */
function niceMax(value: number): number {
  if (value <= 4) return Math.max(value, 1);
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(date)} ${names[Number(month) - 1] ?? ""}`.trim();
}

export function TimeSeries<T extends { day: string }>({
  rows,
  series,
  height = 200,
  area = true,
}: Props<T>) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const { tip, setTip, hide } = useTip();

  const max = useMemo(
    () =>
      niceMax(
        Math.max(1, ...rows.flatMap((r) => series.map((s) => Number(r[s.key] ?? 0)))),
      ),
    [rows, series],
  );

  const plotWidth = Math.max(width - PAD.left - PAD.right, 10);
  const plotHeight = height - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (rows.length <= 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;

  if (!rows.length) return <p className="k-empty">Nothing in this window yet.</p>;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  /* Label density is a function of the pixels available, not of the row count.
     Deriving it from `rows.length` alone printed "20 Aug21 Aug" on a phone —
     the same seven labels the desktop panel has, in a third of the width. */
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(plotWidth / 58))));

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const index = Math.round(((px - PAD.left) / plotWidth) * (rows.length - 1));
    const clamped = Math.min(Math.max(index, 0), rows.length - 1);
    const row = rows[clamped];
    setTip({
      x: x(clamped),
      y: PAD.top,
      content: (
        <>
          <div className="k-tip__title">{shortDay(row.day)}</div>
          {series.map((s) => (
            <TipRow
              key={s.key}
              colour={s.colour}
              label={s.label}
              value={String(row[s.key] ?? 0)}
            />
          ))}
        </>
      ),
    });
  }

  const hovered =
    tip && rows.length > 1
      ? Math.round(((tip.x - PAD.left) / plotWidth) * (rows.length - 1))
      : null;

  return (
    <div className="k-hover" ref={ref}>
      {width > 0 && (
        <svg
          className="k-fig"
          width={width}
          height={height}
          onMouseMove={onMove}
          onMouseLeave={hide}
          role="img"
          aria-label={`${series.map((s) => s.label).join(" and ")} by day`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? INK.axis : INK.grid}
                strokeWidth={1}
              />
              <text x={PAD.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill={INK.muted}>
                {tick}
              </text>
            </g>
          ))}

          {rows.map((row, index) =>
            index % labelEvery === 0 || index === rows.length - 1 ? (
              <text
                key={row.day}
                x={x(index)}
                y={height - 6}
                /* The end labels are centred on the plot edge, so half of each
                   would sit outside the figure. Anchor them inward instead. */
                textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}
                fontSize={10}
                fill={INK.muted}
              >
                {shortDay(row.day)}
              </text>
            ) : null,
          )}

          {area && (
            <path
              d={
                `M ${x(0)} ${y(Number(rows[0][series[0].key] ?? 0))} ` +
                rows
                  .map((row, i) => `L ${x(i)} ${y(Number(row[series[0].key] ?? 0))}`)
                  .join(" ") +
                ` L ${x(rows.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`
              }
              fill={series[0].colour}
              opacity={0.12}
            />
          )}

          {series.map((s) => (
            <path
              key={s.key}
              d={rows
                .map((row, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(Number(row[s.key] ?? 0))}`)
                .join(" ")}
              fill="none"
              stroke={s.colour}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {hovered !== null && hovered >= 0 && hovered < rows.length && (
            <g>
              <line
                x1={x(hovered)}
                x2={x(hovered)}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
                stroke={INK.axis}
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hovered)}
                  cy={y(Number(rows[hovered][s.key] ?? 0))}
                  r={4}
                  fill={s.colour}
                  /* A 2px ring in the surface colour keeps two markers legible
                     where the series cross. */
                  stroke="#182610"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
        </svg>
      )}
      <Tip tip={tip} width={width} />
      <Legend items={series.map((s) => ({ colour: s.colour, label: s.label }))} />
    </div>
  );
}

export const DEFAULT_SERIES = [
  { key: "threads", label: "Conversations", colour: SERIES[0] },
  { key: "devices", label: "Devices", colour: SERIES[3] },
];
