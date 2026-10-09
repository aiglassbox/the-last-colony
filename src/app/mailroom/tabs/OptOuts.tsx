import { Panel } from "../../kitchen/ui/Panel";
import { ImportOptOuts } from "./ImportOptOuts";
import { formatIst } from "./format";

const HOW = {
  link: "unsubscribe link",
  "one-click": "Gmail/Yahoo button",
  "launch-import": "launch import",
} as const;

/** Who has asked not to get list emails. Submitter emails ignore this. */
export function OptOuts({
  rows,
}: {
  rows: { email: string; opted_out_at: string; source: keyof typeof HOW }[];
}) {
  return (
    <div className="k-grid">
      <Panel title="Import" span={12}>
        <ImportOptOuts />
      </Panel>

      <Panel title={`Opted out (${rows.length.toLocaleString("en-IN")})`} span={12}>
        {rows.length === 0 ? (
          <p className="k-empty">Nobody has opted out yet.</p>
        ) : (
          <div className="k-scroll">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>When (IST)</th>
                  <th>How</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email}>
                    <td>{r.email}</td>
                    <td>{formatIst(r.opted_out_at)}</td>
                    <td>{HOW[r.source] ?? r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
