"use client";

import { INK, ORDINAL } from "@/lib/dash/tokens";
import type { FunnelStage } from "@/lib/dash/types";

/**
 * Arrival to advocacy.
 *
 * Stages are ordered by definition — you cannot share a card you never saw —
 * so this takes the ordinal ramp rather than categorical hues, and the reader
 * sees the sequence in the colour without consulting a legend. The darkest
 * step still clears 2:1 against the panel, so the last stage is a mark and not
 * a hole in the page.
 *
 * Every bar is directly labelled with its count and its rate against the stage
 * above, because the interesting number in a funnel is never the width — it is
 * the drop, and a reader should not have to divide two bars by eye to find it.
 */

export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.n ?? 0;
  if (!stages.length || top === 0) {
    return (
      <p className="k-empty">
        No events yet. This fills in as soon as the first visitor arrives after deploy.
      </p>
    );
  }

  return (
    <div className="k-bars" style={{ gap: 12 }}>
      {stages.map((stage, index) => {
        const previous = index === 0 ? stage.n : stages[index - 1].n;
        const share = top ? (stage.n / top) * 100 : 0;
        const step = previous ? Math.round((stage.n / previous) * 100) : 0;

        return (
          <div key={stage.label}>
            <div className="k-bar__label">
              <span className="k-bar__name">{stage.label}</span>
              <span className="k-bar__value">
                {stage.n.toLocaleString("en-IN")}
                {index > 0 && (
                  <span style={{ color: INK.muted, fontWeight: 400 }}>
                    {" "}
                    · {step}% of previous
                  </span>
                )}
              </span>
            </div>
            <div className="k-bar__track" style={{ height: 20 }}>
              <div
                className="k-bar__fill"
                style={{
                  /* Zero is drawn as zero. A minimum-width stub on an empty
                     stage reads as a small value, which is the one thing a
                     funnel must never say about a stage nobody reached. */
                  width: share === 0 ? 0 : `${Math.max(share, 1.5)}%`,
                  background: ORDINAL[Math.min(index, ORDINAL.length - 1)],
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: INK.muted, marginTop: 3 }}>{stage.note}</div>
          </div>
        );
      })}
    </div>
  );
}
