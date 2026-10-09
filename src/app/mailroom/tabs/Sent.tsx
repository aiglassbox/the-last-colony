import type { RangeKey } from "@/lib/dash/range";
import type { SendLogRow, SendStatus } from "@/lib/mailroom/store";

import { Panel } from "../../kitchen/ui/Panel";
import { formatIst } from "./format";
import { SendRestButton } from "./SendRestButton";

const STATUSES: { key: SendStatus; label: string }[] = [
  { key: "sent", label: "Sent" },
  { key: "opted_out", label: "Opted out" },
  { key: "waiting", label: "Waiting" },
  { key: "failed", label: "Failed" },
  { key: "over_limit", label: "Over limit" },
];

const WORD: Record<SendStatus, string> = {
  sent: "sent",
  opted_out: "opted out",
  waiting: "waiting",
  failed: "failed",
  over_limit: "over limit",
};

/** The send log: what is waiting for tomorrow, totals per email, and every attempt. */
export function Sent({
  totals,
  rows,
  waiting,
  range,
  q,
}: {
  totals: { template: string; status: SendStatus; n: number }[];
  rows: SendLogRow[];
  waiting: { batch_id: string; template: string; waiting: number; created_at: string }[];
  range: RangeKey;
  q: string;
}) {
  const templates = [...new Set(totals.map((t) => t.template))];
  const count = (template: string, status: SendStatus) =>
    totals.find((t) => t.template === template && t.status === status)?.n ?? 0;

  return (
    <div className="k-grid">
      {waiting.length > 0 && (
        <Panel
          title="Waiting for tomorrow"
          note="A list went past today's allowance. The rest can go once the day resets."
          span={12}
        >
          <div className="k-scroll">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th className="num">Waiting</th>
                  <th>Pasted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {waiting.map((w) => (
                  <tr key={w.batch_id}>
                    <td>{w.template}</td>
                    <td className="num">{w.waiting.toLocaleString("en-IN")}</td>
                    <td>{formatIst(w.created_at)}</td>
                    <td>
                      <SendRestButton batchId={w.batch_id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Totals by email" span={12}>
        {templates.length === 0 ? (
          <p className="k-empty">Nothing has been sent in this window.</p>
        ) : (
          <div className="k-scroll">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Email</th>
                  {STATUSES.map((s) => (
                    <th key={s.key} className="num">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t}>
                    <td>{t}</td>
                    {STATUSES.map((s) => (
                      <td key={s.key} className="num">
                        {count(t, s.key).toLocaleString("en-IN")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Every attempt"
        note="Newest first, at most 200. Times are India Standard Time."
        span={12}
        right={
          <form action="/mailroom" className="mr-search">
            <input type="hidden" name="tab" value="sent" />
            <input type="hidden" name="range" value={range} />
            <label className="mr-search__label" htmlFor="mailroom-search">
              Search address, subject or email
            </label>
            <input
              id="mailroom-search"
              className="k-input"
              name="q"
              defaultValue={q}
              maxLength={100}
              autoComplete="off"
            />
            <button type="submit" className="k-button">
              Search
            </button>
          </form>
        }
      >
        {rows.length === 0 ? (
          <p className="k-empty">{q ? "Nothing matches that search." : "Nothing has been sent in this window."}</p>
        ) : (
          <div className="k-scroll">
            <table className="k-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Email</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Outcome</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatIst(r.created_at)}</td>
                    <td>{r.template}</td>
                    <td>{r.to}</td>
                    <td>{r.subject}</td>
                    <td>
                      {WORD[r.status]}
                      {(r.status === "failed" || r.status === "over_limit") && r.error ? `: ${r.error}` : ""}
                    </td>
                    <td>{r.source === "auto" ? "auto" : "page"}</td>
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
