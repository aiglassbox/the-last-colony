import { KIND_COLOUR, KIND_LABEL, PROVENANCE, PROVENANCE_ORDER } from "@/lib/dash/tokens";
import type { Report } from "@/lib/dash/types";

import { CohortGrid } from "../charts/CohortGrid";
import { Histogram } from "../charts/Histogram";
import { MixBar } from "../charts/MixBar";
import { Panel } from "../ui/Panel";

/**
 * Did the thing work.
 *
 * The tab that will get somebody's attention on a bad week. Two numbers here
 * are load-bearing and neither is a count: the corpus hit rate, which is the
 * share of turns that found a record when the model judged there should be one,
 * and the one-and-done rate, which is the share of readers the product answered
 * and then lost.
 */

/**
 * The paint order of the mix bar, and therefore the slot order of the palette.
 * The two are kept in step deliberately — see `KIND_COLOUR`. Failure last is
 * also the right reading order: the bar runs from the product working to the
 * product not working.
 */
const KIND_ORDER = ["record", "modern", "foreign", "conversation", "gap"];

export function Product({ report }: { report: Report }) {
  const byKind = new Map(report.kinds.map((k) => [k.kind, k.n]));
  const segments = KIND_ORDER.filter((kind) => (byKind.get(kind) ?? 0) > 0).map((kind) => ({
    key: kind,
    label: KIND_LABEL[kind] ?? kind,
    colour: KIND_COLOUR[kind] ?? "#93a684",
    n: byKind.get(kind) ?? 0,
  }));

  /* Restoration attempts only. A foreign dish is not a miss and a follow-up
     reply is not an attempt — folding either into the denominator would move
     this number without anything about the corpus having changed. */
  const found = byKind.get("record") ?? 0;
  const missed = byKind.get("gap") ?? 0;
  const attempts = found + missed;
  const hitRate = attempts ? Math.round((found / attempts) * 100) : null;

  const totalThreads = report.depth.reduce((sum, r) => sum + r.threads, 0);
  const single = report.depth.find((r) => r.messages <= 2)?.threads ?? 0;
  const followed = totalThreads - single;
  const followRate = totalThreads ? Math.round((followed / totalThreads) * 100) : 0;

  const provenanceSegments = PROVENANCE_ORDER.map((name) => ({
    key: name,
    label: name.replace("_", " ").toLowerCase(),
    colour: PROVENANCE[name],
    n: report.provenance.find((p) => p.provenance === name)?.n ?? 0,
  })).filter((s) => s.n > 0);

  return (
    <div className="k-grid">
      <Panel
        title="What every reply actually was"
        note="Five outcomes, and only one of them is a miss. A foreign dish has no ancient original to find, so it is not a corpus gap — conflating the two is how a roadmap fills up with pizza."
        span={7}
      >
        <MixBar segments={segments} />
      </Panel>

      <Panel
        title="Corpus hit rate"
        note="Of the turns where the model judged there was an older form to restore, the share where we held the record."
        span={5}
      >
        {hitRate === null ? (
          <p className="k-empty">No restoration attempts in this window.</p>
        ) : (
          <>
            <strong className="k-stat__value">
              {hitRate}
              <span style={{ fontSize: 20, color: "var(--ink-2)" }}>%</span>
            </strong>
            <p className="k-panel__note" style={{ marginTop: 10, marginBottom: 0 }}>
              {found.toLocaleString("en-IN")} found · {missed.toLocaleString("en-IN")} missed, out of{" "}
              {attempts.toLocaleString("en-IN")} attempts.{" "}
              {missed === 0
                ? "A clean 100% is real rather than a broken query: retrieval declines rather than guessing, so a turn only reaches this denominator once a record was already found. What it does not measure is the reader who asked for something so far outside the corpus that the model called it modern or foreign instead — those are on the Demand tab."
                : "Every miss is a row on the Demand tab with the dish name attached."}
            </p>
          </>
        )}
      </Panel>

      <Panel
        title="How far a thread got"
        note="A turn is a question and a reply. The first bar is every reader the product answered once and did not hold."
        span={7}
      >
        <Histogram rows={report.depth} />
      </Panel>

      <Panel title="Follow-up rate" span={5}>
        <strong className="k-stat__value">
          {followRate}
          <span style={{ fontSize: 20, color: "var(--ink-2)" }}>%</span>
        </strong>
        <p className="k-panel__note" style={{ marginTop: 10 }}>
          {followed.toLocaleString("en-IN")} of {totalThreads.toLocaleString("en-IN")} threads got a
          second question. This is the closest thing the product has to a measure of whether the
          first answer was interesting rather than merely correct.
        </p>
      </Panel>

      <Panel
        title="Evidence behind what we served"
        note="A confidence scale, so it takes one hue and reads darker as the evidence thins. Modern dishes sit outside it in their own colour — that is not weaker evidence for an ancient original, it is the claim that there is not one."
        span={6}
      >
        <MixBar segments={provenanceSegments} />
      </Panel>

      <Panel
        title="Weekly cohorts"
        note="Never windowed. Filtering a cohort table to the last seven days leaves only the devices that came back, and every cohort reads as perfectly retained."
        span={6}
      >
        <CohortGrid rows={report.cohorts} />
      </Panel>
    </div>
  );
}
