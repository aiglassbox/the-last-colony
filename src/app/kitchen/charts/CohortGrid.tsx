"use client";

import { INK, SEQUENTIAL } from "@/lib/dash/tokens";
import type { CohortRow } from "@/lib/dash/types";

/**
 * Weekly cohorts and what became of them.
 *
 * Cell shade is a retention *rate*, not a count — otherwise a big cohort with
 * poor retention outshines a small one that held everybody, which is the
 * opposite of what a cohort table is for. The count is printed in the cell, so
 * shade and number answer the two different questions side by side.
 *
 * This table is never windowed. Filtering it to the last seven days would leave
 * only the devices that came back, and every cohort would read as perfectly
 * retained — a table that gets more flattering the more you narrow it is not
 * measuring retention.
 */

function shade(rate: number): string {
  if (rate <= 0) return "transparent";
  const step = Math.min(SEQUENTIAL.length - 1, Math.max(1, Math.round(rate * (SEQUENTIAL.length - 1))));
  return SEQUENTIAL[step];
}

export function CohortGrid({ rows }: { rows: CohortRow[] }) {
  if (!rows.length) return <p className="k-empty">No cohorts yet.</p>;

  const weeks = Math.max(...rows.map((r) => r.retained.filter((n) => n > 0).length), 1);

  return (
    <div className="k-scroll">
      <table className="k-table">
        <thead>
          <tr>
            <th>Week starting</th>
            <th className="num">Devices</th>
            {Array.from({ length: weeks }, (_, i) => (
              <th key={i} className="num">
                {i === 0 ? "W0" : `+${i}w`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.cohort}>
              <td>{row.cohort}</td>
              <td className="num">{row.size}</td>
              {Array.from({ length: weeks }, (_, i) => {
                const n = row.retained[i] ?? 0;
                const rate = row.size ? n / row.size : 0;
                return (
                  <td
                    key={i}
                    className="num"
                    style={{
                      background: shade(rate),
                      color: rate > 0.55 ? "#101a0a" : INK.secondary,
                      textAlign: "center",
                      minWidth: 44,
                    }}
                    title={`${n} of ${row.size} · ${Math.round(rate * 100)}%`}
                  >
                    {n || "·"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
