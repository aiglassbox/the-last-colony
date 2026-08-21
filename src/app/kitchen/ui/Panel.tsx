import type { ReactNode } from "react";

import { INK, SERIES, STATUS } from "@/lib/dash/tokens";
import type { Delta } from "@/lib/dash/types";

/**
 * The two containers every panel on this page is made of.
 *
 * Server components — they hold no state and take no events, so shipping them
 * to the browser would be paying transfer for markup that never changes after
 * paint. Only the figures themselves are client components, and only because
 * they carry a hover layer.
 */

export function Panel({
  title,
  note,
  span = 6,
  children,
  right,
}: {
  title: string;
  note?: string;
  span?: 3 | 4 | 5 | 6 | 7 | 8 | 12;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className={`k-panel k-span-${span}`}>
      <div className="k-panel__head">
        <h2 className="k-panel__title">{title}</h2>
        {right}
      </div>
      {note ? <p className="k-panel__note">{note}</p> : null}
      <div className="k-panel__body">{children}</div>
    </section>
  );
}

/**
 * A headline figure with its own history.
 *
 * The delta is never shown as a bare arrow. "+34" with no baseline is the same
 * decoration as a number with no comparison, so the previous period's value is
 * printed beside it — and when the window is all-time there is no previous
 * period, so nothing is shown rather than a fabricated 100%.
 *
 * Direction is carried by an arrow glyph and the word beside it as well as by
 * colour, because green-versus-red is the one pairing a red-green colour
 * blindness makes indistinguishable, and it is the pairing every dashboard
 * reaches for first.
 */
export function StatTile({
  label,
  delta,
  suffix,
  spark,
  hint,
  invert = false,
  span = 3,
  comparable = true,
}: {
  label: string;
  delta: Delta;
  suffix?: string;
  spark?: number[];
  hint?: string;
  /** True where up is bad — errors, bounces. */
  invert?: boolean;
  span?: 3 | 4 | 6;
  /** False for the all-time window, where there is no preceding period at all. */
  comparable?: boolean;
}) {
  const change = delta.before > 0 ? Math.round(((delta.now - delta.before) / delta.before) * 100) : null;
  const rising = delta.now > delta.before;
  const flat = delta.now === delta.before;
  const good = invert ? !rising : rising;

  const tone = flat ? "flat" : good ? "up" : "down";
  const colour = flat ? INK.muted : good ? STATUS.good : STATUS.critical;

  return (
    <section className={`k-panel k-span-${span}`}>
      <div className="k-panel__head">
        <h2 className="k-panel__title">{label}</h2>
      </div>

      <strong className="k-stat__value">
        {delta.now.toLocaleString("en-IN")}
        {suffix ? <span style={{ fontSize: 18, color: INK.secondary }}>{suffix}</span> : null}
      </strong>

      <div className="k-stat__row">
        {delta.before > 0 ? (
          <>
            <span className={`k-delta k-delta--${tone}`} style={{ color: colour }}>
              <span aria-hidden="true">{flat ? "→" : rising ? "↑" : "↓"}</span>
              {change !== null ? `${Math.abs(change)}%` : ""}
              <span className="sr-only">{flat ? "unchanged" : rising ? "up" : "down"}</span>
            </span>
            <span className="k-delta__base">was {delta.before.toLocaleString("en-IN")}</span>
          </>
        ) : (
          <span className="k-delta__base">
            {/* Three different silences, and they mean different things. */}
            {!comparable
              ? (hint ?? "all time — nothing before this to compare against")
              : (hint ?? "nothing in the period before this one")}
          </span>
        )}
      </div>

      {spark && spark.length > 1 ? <Spark values={spark} /> : null}
    </section>
  );
}

/**
 * The tile's own history, unlabelled and unaxed.
 *
 * A sparkline is shape, not measurement — it says "climbing", "spiky", "flat"
 * and nothing more precise, which is why it carries no axis and no tooltip. The
 * chart below it is where a reader goes for a value.
 */
function Spark({ values }: { values: number[] }) {
  const width = 120;
  const height = 26;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${i * step} ${height - (v / max) * (height - 3) - 1.5}`)
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ marginTop: 10, display: "block", overflow: "visible" }}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} fill="none" stroke={SERIES[0]} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
