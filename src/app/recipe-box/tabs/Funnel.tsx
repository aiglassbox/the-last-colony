import { SERIES } from "@/lib/dash/tokens";
import type { RecipeReport } from "@/lib/dash/types";

import { BarList } from "../../kitchen/charts/BarList";
import { Funnel as FunnelChart } from "../../kitchen/charts/Funnel";
import { TimeSeries } from "../../kitchen/charts/TimeSeries";
import { Panel, StatTile } from "../../kitchen/ui/Panel";
import { Figure } from "./Figure";

/**
 * How people get into the Add Recipe form, how far they get, and what stops
 * them. Everything here is a beacon the form fires, so it starts at the deploy
 * that added them and nothing earlier can be filled in.
 */
export function Funnel({ report }: { report: RecipeReport }) {
  const { funnel: f, comparable } = report;
  const logged = f.presses.now + f.opens.now > 0 || f.stages.some((s) => s.n > 0);

  return (
    <div className="k-grid">
      {!logged && (
        <Panel title="Nothing logged yet" span={12}>
          <p className="k-empty">
            No sidebar presses or form steps in this window. Tracking starts at the deploy that
            added it; nothing before that was recorded and none of it can be back-filled.
          </p>
        </Panel>
      )}

      <StatTile
        label="Sidebar presses"
        delta={f.presses}
        spark={f.daily.map((d) => d.presses)}
        comparable={comparable}
      />
      <StatTile label="Devices that pressed" delta={f.pressDevices} comparable={comparable} />
      <StatTile
        label="Form opens"
        delta={f.opens}
        spark={f.daily.map((d) => d.opens)}
        comparable={comparable}
      />
      <StatTile label="Devices that opened" delta={f.openDevices} comparable={comparable} />

      <StatTile
        label="Accepted submissions"
        delta={f.acceptedDevices}
        comparable={comparable}
        span={4}
        hint="devices whose submit the server stored"
      />
      <Figure
        label="Opened to accepted"
        value={f.rate}
        suffix="%"
        comparable={comparable}
        empty="Nobody opened the form in this window."
      />
      <Figure
        label="Median time to finish"
        value={f.medianMinutes}
        suffix=" min"
        invert
        comparable={comparable}
        empty="Nothing was accepted in this window."
      />

      <Panel
        title="Presses and opens"
        note="The sidebar button is the only way into the form from the app, so opens with no press beside them arrived by a link or a typed URL."
        span={8}
      >
        <TimeSeries
          rows={f.daily}
          series={[
            { key: "presses", label: "Sidebar presses", colour: SERIES[0] },
            { key: "opens", label: "Form opens", colour: SERIES[3] },
          ]}
          height={190}
        />
      </Panel>

      <Panel
        title="How far they got"
        note="Devices, not presses: a reader who sends four codes is one reader at that step."
        span={4}
      >
        <FunnelChart stages={f.stages} />
      </Panel>

      <Panel
        title="The photo shortcut"
        note="Attached photos, then what the reading made of them. Raw counts."
        span={4}
      >
        <BarList items={f.photo} unit="photo" emptyNote="No photos attached in this window." />
      </Panel>

      <Panel
        title="Refusals, by step and reason"
        note="Every time the form was told no. Raw counts: one reader retrying is several bars' worth."
        span={4}
      >
        <BarList
          items={f.refusals.map((r) => ({ ...r, colour: SERIES[1] }))}
          emptyNote="Nothing refused in this window."
        />
      </Panel>

      <Panel
        title="Second tries"
        note="Presses beside the devices that made them. Many resends from few devices is a slow or spam-filed code mail."
        span={4}
      >
        <table className="k-table">
          <thead>
            <tr>
              <th>Press</th>
              <th className="num">Presses</th>
              <th className="num">Devices</th>
            </tr>
          </thead>
          <tbody>
            {f.secondary.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="num">{row.n.toLocaleString("en-IN")}</td>
                <td className="num">{row.devices.toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="Time to finish"
        note="From opening the form to an accepted submit, in the reader's one sitting. A reader who came back the next day is clamped at a day."
        span={12}
      >
        <BarList items={f.finish} unit="submission" emptyNote="Nothing was accepted in this window." />
      </Panel>
    </div>
  );
}
