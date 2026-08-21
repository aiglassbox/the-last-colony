import { INK, SERIES, STATUS } from "@/lib/dash/tokens";
import type { Report } from "@/lib/dash/types";

import { BarList } from "../charts/BarList";
import { TimeSeries } from "../charts/TimeSeries";
import { Panel } from "../ui/Panel";

/**
 * Where the people came from.
 *
 * Two sources, and they answer different halves. The event log knows which
 * placement sent a visit; the thread mirror knows whether that visit turned
 * into anything. Neither is worth much alone, which is why the attribution
 * table joins them and puts `converted` beside `visits` — a source that sends a
 * thousand people and no conversations is buying the wrong thousand, and no
 * event in the log says that as plainly as its absence from the mirror does.
 */
export function Reach({ report }: { report: Report }) {
  const { email } = report;
  const openToClick = email.uniqueOpeners
    ? Math.round((email.uniqueClickers / email.uniqueOpeners) * 100)
    : null;

  return (
    <div className="k-grid">
      <Panel
        title="Where visits came from"
        note="`converted` counts devices from this placement that went on to start a conversation. It is the column to read; visits alone is a vanity number."
        span={12}
      >
        {report.attribution.length ? (
          <div className="k-scroll">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Medium</th>
                  <th>Campaign</th>
                  <th className="num">Visits</th>
                  <th className="num">Devices</th>
                  <th className="num">Converted</th>
                  <th className="num">Rate</th>
                </tr>
              </thead>
              <tbody>
                {report.attribution.map((row) => {
                  const rate = row.devices ? Math.round((row.converted / row.devices) * 100) : 0;
                  return (
                    <tr key={`${row.source}/${row.medium}/${row.campaign}`}>
                      <td>{row.source}</td>
                      <td>{row.medium}</td>
                      <td>{row.campaign}</td>
                      <td className="num">{row.visits.toLocaleString("en-IN")}</td>
                      <td className="num">{row.devices.toLocaleString("en-IN")}</td>
                      <td className="num">{row.converted.toLocaleString("en-IN")}</td>
                      <td
                        className="num"
                        style={{ color: rate >= 40 ? STATUS.good : rate > 0 ? INK.secondary : INK.muted }}
                      >
                        {rate}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="k-empty">
            No visits recorded yet. Attribution starts from the first arrival after this deploy —
            campaign markers were never stored before it, so nothing can be back-filled.
          </p>
        )}
      </Panel>

      <Panel
        title="Every event, counted"
        note="Devices rather than fires, beside the raw count. A wide gap between the two columns is one enthusiastic reader, not reach."
        span={5}
      >
        {report.events.length ? (
          <table className="k-table">
            <thead>
              <tr>
                <th>Event</th>
                <th className="num">Fires</th>
                <th className="num">Devices</th>
              </tr>
            </thead>
            <tbody>
              {report.events.map((event) => (
                <tr key={event.event}>
                  <td>{event.event.replace(/_/g, " ")}</td>
                  <td className="num">{event.n.toLocaleString("en-IN")}</td>
                  <td className="num">{event.devices.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="k-empty">
            Nothing logged yet. Until this deploy, `track()` wrote to stdout and nowhere else.
          </p>
        )}
      </Panel>

      <Panel
        title="Launch email"
        note="Bots are separated rather than hidden. Mail security appliances open and click every link within seconds of delivery, and a click rate that quietly includes them is fiction."
        span={7}
      >
        <table className="k-table">
          <tbody>
            <tr>
              <td>Unique openers</td>
              <td className="num">{email.uniqueOpeners.toLocaleString("en-IN")}</td>
              <td style={{ color: INK.muted }}>{email.opens.toLocaleString("en-IN")} opens</td>
            </tr>
            <tr>
              <td>Unique clickers</td>
              <td className="num">{email.uniqueClickers.toLocaleString("en-IN")}</td>
              <td style={{ color: INK.muted }}>{email.clicks.toLocaleString("en-IN")} clicks</td>
            </tr>
            <tr>
              <td>Clickers per opener</td>
              <td className="num">{openToClick === null ? "—" : `${openToClick}%`}</td>
              <td style={{ color: INK.muted }}>
                {openToClick !== null && openToClick > 100
                  ? "over 100% — an open is only seen if images load, a click always is"
                  : "of the people who opened"}
              </td>
            </tr>
            <tr>
              <td>Filtered as automated</td>
              <td className="num">{email.automated.toLocaleString("en-IN")}</td>
              <td style={{ color: INK.muted }}>excluded from the rows above</td>
            </tr>
            <tr>
              <td>Unsubscribed</td>
              <td className="num" style={{ color: email.suppressed > 0 ? STATUS.warning : undefined }}>
                {email.suppressed.toLocaleString("en-IN")}
              </td>
              <td style={{ color: INK.muted }}>standing, never windowed</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="Where the email sent people" span={5}>
        <BarList
          /* A destination nobody reached is not a bar of length zero, it is a
             row that should not be here — the untagged `(none)` bucket in
             particular is always present in the group-by and usually empty. */
          items={email.perCode.filter((c) => c.n > 0).map((c) => ({ ...c, colour: SERIES[3] }))}
          unit="people"
          emptyNote="No clicks in this window."
        />
      </Panel>

      <Panel
        title="Email activity by day"
        note="Automated opens and clicks already removed."
        span={7}
      >
        <TimeSeries
          rows={email.daily}
          series={[
            { key: "opens", label: "Opens", colour: SERIES[0] },
            { key: "clicks", label: "Clicks", colour: SERIES[3] },
          ]}
          height={190}
        />
      </Panel>
    </div>
  );
}
