import { SERIES } from "@/lib/dash/tokens";
import type { Report } from "@/lib/dash/types";

import { Funnel } from "../charts/Funnel";
import { Heatmap } from "../charts/Heatmap";
import { StackedDays } from "../charts/StackedDays";
import { TimeSeries } from "../charts/TimeSeries";
import { Panel, StatTile } from "../ui/Panel";

/**
 * The tab somebody opens at nine in the morning.
 *
 * Five figures, in the order the questions get asked: how many, how that
 * compares, when, who is new, and how far they got. Anything that needs a
 * paragraph of setup belongs on one of the other tabs.
 */
export function Overview({ report }: { report: Report }) {
  const { totals, daily } = report;
  /* All-time has no period before it, so its tiles say that instead of
     "nothing happened last month" — which would be a claim about a month that
     does not exist. The report states this; it is not inferred from the label. */
  const comparable = report.comparable;
  const threadSpark = daily.map((d) => d.threads);
  const deviceSpark = daily.map((d) => d.devices);

  const perThread = totals.conversations.now
    ? (totals.messages.now / totals.conversations.now).toFixed(1)
    : "0";
  const perDevice = totals.devices.now
    ? (totals.conversations.now / totals.devices.now).toFixed(1)
    : "0";

  return (
    <div className="k-grid">
      <StatTile label="Devices" delta={totals.devices} spark={deviceSpark} comparable={comparable} />
      <StatTile
        label="Conversations"
        delta={totals.conversations}
        spark={threadSpark}
        comparable={comparable}
      />
      <StatTile label="Messages" delta={totals.messages} comparable={comparable} />
      <StatTile
        label="Came back another day"
        delta={totals.multiDayDevices}
        comparable={comparable}
        hint="devices with threads on two or more days"
      />

      <Panel
        title="Conversations and devices"
        note="Both are counts of the same kind of thing, so they share one axis — the gap between the lines is conversations per device, drawn."
        span={8}
      >
        <TimeSeries
          rows={daily}
          series={[
            { key: "threads", label: "Conversations", colour: SERIES[0] },
            { key: "devices", label: "Devices", colour: SERIES[3] },
          ]}
          height={220}
        />
      </Panel>

      <Panel title="Shape of use" span={4}>
        <table className="k-table">
          <tbody>
            <tr>
              <td>Messages per conversation</td>
              <td className="num">{perThread}</td>
            </tr>
            <tr>
              <td>Conversations per device</td>
              <td className="num">{perDevice}</td>
            </tr>
            <tr>
              <td>Devices with more than one thread</td>
              <td className="num">
                {totals.returningDevices.now} of {totals.devices.now}
              </td>
            </tr>
            <tr>
              <td>Devices back on a second day</td>
              <td className="num">
                {totals.multiDayDevices.now} of {totals.devices.now}
              </td>
            </tr>
            <tr>
              <td>Replies that failed</td>
              <td className="num">{report.errors}</td>
            </tr>
          </tbody>
        </table>
        <p className="k-panel__note" style={{ marginTop: 12, marginBottom: 0 }}>
          A second thread in one sitting is curiosity. A second thread on a second day is the
          product having been remembered — the row worth watching.
        </p>
      </Panel>

      <Panel
        title="New against returning devices"
        note="New is measured against all history, not against this window — a device first seen in June and back today is returning."
        span={7}
      >
        <StackedDays
          rows={report.newReturning}
          segments={[
            { key: "fresh", label: "First time", colour: SERIES[0] },
            { key: "returning", label: "Returning", colour: SERIES[3] },
          ]}
        />
      </Panel>

      <Panel title="When people ask" note="Weekday against hour, India Standard Time." span={5}>
        <Heatmap cells={report.heat} />
      </Panel>

      <Panel
        title="Arrival to advocacy"
        note={
          report.hasEvents
            ? "Counted in devices, not events — one reader opening nine drawers should not outrank nine readers opening one."
            : "The event log is empty. It fills from the first visit after this deploy; nothing before it was ever stored."
        }
        span={12}
      >
        <Funnel stages={report.funnel} />
      </Panel>
    </div>
  );
}
