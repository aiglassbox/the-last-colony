import { SERIES } from "@/lib/dash/tokens";
import type { RecipeReport } from "@/lib/dash/types";

import { BarList } from "../../kitchen/charts/BarList";
import { MixBar } from "../../kitchen/charts/MixBar";
import { TimeSeries } from "../../kitchen/charts/TimeSeries";
import { Panel, StatTile } from "../../kitchen/ui/Panel";
import { Figure } from "./Figure";

/**
 * Whether the recipes people send reach anybody. Read from the
 * `community_served` event chat writes on every community turn, so it starts
 * at the deploy that stored events, not at this tab.
 */
export function Reach({ report }: { report: RecipeReport }) {
  const { reach: r, comparable } = report;
  const translatedShare = r.serves.now ? Math.round((r.translated / r.serves.now) * 100) : null;

  return (
    <div className="k-grid">
      <StatTile label="Community recipes served" delta={r.serves} comparable={comparable} />
      <StatTile label="Readers reached" delta={r.readers} comparable={comparable} hint="distinct devices" />
      <StatTile label="Dishes served" delta={r.dishes} comparable={comparable} />
      <Figure
        label="Corpus gaps filled"
        value={r.gapFill}
        suffix="%"
        comparable={comparable}
        empty="No dish asks missed the corpus in this window."
      />

      <Panel title="Serves per day" span={8}>
        <TimeSeries
          rows={r.daily}
          series={[
            { key: "serves", label: "Serves", colour: SERIES[0] },
            { key: "readers", label: "Readers", colour: SERIES[3] },
          ]}
          height={190}
        />
      </Panel>

      <Panel
        title="How the version was chosen"
        note={
          translatedShare === null
            ? "Which rule picked the row a reader saw."
            : `Which rule picked the row a reader saw. ${translatedShare}% were shown translated.`
        }
        span={4}
      >
        <MixBar
          segments={r.rules.map((rule, index) => ({
            key: rule.label,
            label: rule.label,
            colour: SERIES[index],
            n: rule.n,
          }))}
        />
      </Panel>

      <Panel title="Most served dishes" span={4}>
        <BarList items={r.topDishes} unit="serve" emptyNote="Nothing served in this window." />
      </Panel>

      <Panel title="Recipes from" note="The state on the recipe that was served." span={4}>
        <BarList
          items={r.servedStates.map((s) => ({ ...s, colour: SERIES[1] }))}
          unit="serve"
          emptyNote="Nothing served in this window."
        />
      </Panel>

      <Panel title="Served to" note="Where the reader was, resolved at the edge. Devices." span={4}>
        <BarList
          items={r.regions.map((s) => ({ ...s, colour: SERIES[3] }))}
          unit="device"
          emptyNote="No located serves in this window."
        />
      </Panel>
    </div>
  );
}
