import { SERIES } from "@/lib/dash/tokens";
import type { RecipeReport } from "@/lib/dash/types";

import { BarList } from "../../kitchen/charts/BarList";
import { MixBar } from "../../kitchen/charts/MixBar";
import { StackedDays } from "../../kitchen/charts/StackedDays";
import { Panel, StatTile } from "../../kitchen/ui/Panel";

/**
 * What lands in the store. Read from Atlas, seed rows excluded, back to the
 * first submission — unlike the funnel, none of this needed a beacon.
 */
export function Submissions({ report }: { report: RecipeReport }) {
  const s = report.submissions;
  const comparable = report.comparable;

  if (!s) {
    return (
      <div className="k-grid">
        <Panel title="Store unavailable" span={12}>
          <p className="k-empty">
            The submission store did not answer, or <strong>ATLAS_*</strong> is not set on this
            deployment. The Funnel tab reads a different database and is unaffected.
          </p>
        </Panel>
      </div>
    );
  }

  const hours = s.publishMedianHours;

  return (
    <div className="k-grid">
      <StatTile label="Submitted" delta={s.submitted} comparable={comparable} span={4} />
      <StatTile label="Published" delta={s.published} comparable={comparable} span={4} />
      <StatTile
        label="Cleared, not yet published"
        delta={s.green}
        comparable={comparable}
        span={4}
        hint="the model said yes; nobody has published it"
      />
      <StatTile
        label="Awaiting a verdict"
        delta={s.pending}
        invert
        comparable={comparable}
        span={6}
        hint="a lost verdict leaves a row here for a /pantry re-run"
      />
      <StatTile label="Rejected" delta={s.red} invert comparable={comparable} span={6} />

      <Panel
        title="Submissions per day, by where they stand now"
        note="A row's status today, on the day it came in. Slots are in palette order so neighbours stay distinguishable; the legend carries the meaning."
        span={8}
      >
        <StackedDays
          rows={s.daily}
          segments={[
            { key: "pending", label: "Awaiting verdict", colour: SERIES[0] },
            { key: "green", label: "Cleared", colour: SERIES[1] },
            { key: "red", label: "Rejected", colour: SERIES[2] },
            { key: "published", label: "Published", colour: SERIES[3] },
          ]}
        />
      </Panel>

      <Panel title="Moderation" span={4}>
        <table className="k-table">
          <tbody>
            <tr>
              <td>Operator overrides</td>
              <td className="num">{s.overrides.toLocaleString("en-IN")}</td>
            </tr>
            <tr>
              <td>Median submit to publish</td>
              <td className="num">{hours === null ? "—" : `${hours} h`}</td>
            </tr>
          </tbody>
        </table>
        <BarList items={s.publishTimes} unit="recipe" emptyNote="Nothing published in this window." />
      </Panel>

      <Panel
        title="Where they come from"
        note={`The state the submitter chose. ${s.withCity} of ${s.submitted.now} named a city too.`}
        span={6}
      >
        <BarList items={s.states} unit="recipe" emptyNote="Nothing submitted in this window." />
      </Panel>

      <Panel title="From a photo or typed in" note="Photo means a reading landed and prefilled the form." span={6}>
        <MixBar
          segments={[
            { key: "image", label: "From a photo", colour: SERIES[0], n: s.modes.image },
            { key: "manual", label: "Typed in", colour: SERIES[1], n: s.modes.manual },
          ]}
        />
      </Panel>

      <Panel title="Whose recipe" span={4}>
        <BarList items={s.relations} unit="recipe" emptyNote="Nothing submitted in this window." />
      </Panel>

      <Panel title="Language" note="As the verdict model read it, not as the form asked." span={4}>
        <BarList items={s.languages} unit="recipe" emptyNote="Nothing submitted in this window." />
      </Panel>

      <Panel title="Top dishes" span={4}>
        <BarList items={s.dishes} unit="recipe" emptyNote="Nothing submitted in this window." />
      </Panel>

      <Panel
        title="Dishes with more than one version"
        note="Several families or states for one dish, at any status. Only the published ones are what serving chooses between."
        span={12}
      >
        {s.versions.length ? (
          <table className="k-table">
            <thead>
              <tr>
                <th>Dish</th>
                <th className="num">Versions</th>
                <th>States</th>
              </tr>
            </thead>
            <tbody>
              {s.versions.map((v) => (
                <tr key={v.tag}>
                  <td>{v.tag}</td>
                  <td className="num">{v.versions}</td>
                  <td>{v.states.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="k-empty">No dish has two versions in this window.</p>
        )}
      </Panel>
    </div>
  );
}
