import { PROVENANCE, SERIES } from "@/lib/dash/tokens";
import type { Report } from "@/lib/dash/types";

import { BarList } from "../charts/BarList";
import { Panel } from "../ui/Panel";

/**
 * What people came here wanting.
 *
 * The only tab on this dashboard that is an instruction rather than a report.
 * The corpus is 199 records against a cuisine of lakhs of dishes, and the gap
 * list below is the shortest path from "somebody asked" to "we hold it" — in
 * demand order, which is the only ordering that matters when the next hundred
 * records have to be chosen.
 */
export function Demand({ report }: { report: Report }) {
  return (
    <div className="k-grid">
      <Panel
        title="Most asked"
        note="The reader's own words, with the slash command stripped and exact plurals folded together. This is the closest thing the product has to a search log."
        span={6}
      >
        <BarList items={report.asked} />
      </Panel>

      <Panel
        title="The corpus roadmap"
        note="Indian dishes the model judged worth restoring, that we hold no record for. Each of these is a reader who asked and left without the thing they came for."
        span={6}
        right={
          report.gaps.length ? (
            <span className="k-pill" style={{ color: SERIES[4] }}>
              {report.gaps.reduce((sum, g) => sum + g.n, 0)} misses
            </span>
          ) : null
        }
      >
        <BarList
          items={report.gaps.map((g) => ({ ...g, colour: SERIES[4] }))}
          emptyNote="No gaps in this window — every restoration attempt found a record."
        />
      </Panel>

      <Panel
        title="Records actually served"
        note="Which of the corpus is doing the work. A record nobody has ever been shown is a record that is not earning its validation."
        span={6}
      >
        <BarList
          items={report.topSlugs.map((r) => ({
            label: r.slug,
            n: r.n,
            colour: PROVENANCE[r.provenance] ?? SERIES[0],
          }))}
        />
        <div className="k-legend">
          {Object.entries(PROVENANCE).map(([name, colour]) => (
            <span className="k-legend__item" key={name}>
              <span className="k-legend__swatch" style={{ background: colour }} aria-hidden="true" />
              {name.replace("_", " ").toLowerCase()}
            </span>
          ))}
        </div>
      </Panel>

      <Panel
        title="Asked for, but not Indian"
        note="Nothing to restore, so these are not gaps. They are demand on the Indianise mode, and a list of what the campaign is being met with rather than what it offered."
        span={6}
      >
        <BarList
          items={report.foreign.map((f) => ({ ...f, colour: SERIES[2] }))}
          emptyNote="Nobody asked about a foreign dish in this window."
        />
      </Panel>

      <Panel
        title="Slash commands"
        note="Read off the thread title, so it only sees a command that opened a thread — a weak measure, and the only evidence there is that anybody found these."
        span={6}
      >
        <BarList
          items={report.commands}
          emptyNote="No command opened a thread in this window."
        />
      </Panel>
    </div>
  );
}
