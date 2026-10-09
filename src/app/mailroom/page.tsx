import Link from "next/link";
import { notFound } from "next/navigation";

import { mailPicks, publishedPicks } from "@/lib/community/client";
import { mailroomAccess } from "@/lib/dash/auth";
import { parseRange, RANGE_KEYS, resolveRange } from "@/lib/dash/range";
import { db } from "@/lib/db/client";
import { mailroomDailyMax } from "@/lib/mailroom/budget";
import {
  getAutoReceived,
  listOptOuts,
  listSends,
  sendTotals,
  sentToday,
  waitingBatches,
} from "@/lib/mailroom/store";

import { LoginForm } from "../kitchen/LoginForm";
import { LogoutButton } from "../kitchen/LogoutButton";
import { OptOuts } from "./tabs/OptOuts";
import { Sent } from "./tabs/Sent";
import { Write } from "./tabs/Write";

/**
 * The mailroom: write to contributors, see what went out, see who opted out.
 *
 * The kitchen's page pointed at a different job. State lives in the URL for the
 * kitchen's reasons: a shareable view, a working back button, no client store.
 * Only the Write tab holds a draft, and it holds it in the browser.
 */

export const dynamic = "force-dynamic";

const TABS = [
  { key: "write", label: "Write" },
  { key: "sent", label: "Sent" },
  { key: "opt-outs", label: "Opt-outs" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const SEARCH_MAX = 100;

function asTab(value: unknown): TabKey {
  return TABS.some((t) => t.key === value) ? (value as TabKey) : "write";
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Mailroom(props: PageProps<"/mailroom">) {
  const access = await mailroomAccess();

  // No password configured is not "open to everyone", it is "not here".
  if (access === "unconfigured") notFound();
  if (access === "denied") {
    return (
      <LoginForm
        endpoint="/mailroom/api/auth"
        title="The Mailroom"
        sub="The Kranti Cookbook — recipe emails"
        inputId="mailroom-password"
      />
    );
  }

  // The store throws without a database; say so instead of erroring.
  if (!db()) {
    return (
      <div className="kitchen__inner">
        <h1 className="k-head__title">The Mailroom</h1>
        <p className="k-caveat">
          No <strong>DATABASE_URL</strong> on this deployment, so the mailroom has no log and sends nothing.
        </p>
      </div>
    );
  }

  const params = await props.searchParams;
  const tab = asTab(one(params.tab));
  const rangeKey = parseRange(one(params.range));
  const q = (one(params.q) ?? "").slice(0, SEARCH_MAX);

  const max = mailroomDailyMax();
  const remaining = Math.max(0, max - (await sentToday()));

  const href = (next: { tab?: string; range?: string }) =>
    `/mailroom?tab=${next.tab ?? tab}&range=${next.range ?? rangeKey}`;

  let body;
  if (tab === "write") {
    const [submissions, published, auto] = await Promise.all([mailPicks(), publishedPicks(), getAutoReceived()]);
    body = <Write submissions={submissions} published={published} auto={auto} remaining={remaining} max={max} />;
  } else if (tab === "sent") {
    const range = resolveRange(rangeKey);
    const [totals, rows, waiting] = await Promise.all([
      sendTotals(range.since),
      listSends(range.since, q),
      waitingBatches(),
    ]);
    body = <Sent totals={totals} rows={rows} waiting={waiting} range={rangeKey} q={q} />;
  } else {
    body = <OptOuts rows={await listOptOuts()} />;
  }

  return (
    <div className="kitchen__inner">
      <header className="k-head">
        <div>
          <h1 className="k-head__title">The Mailroom</h1>
          <p className="k-head__sub">
            {remaining} of {max} left today · resets 5:30 am IST
          </p>
        </div>

        <div className="k-head__actions">
          {tab === "sent" && (
            <nav className="k-range" aria-label="Time range">
              {RANGE_KEYS.map((key) => (
                <Link key={key} href={href({ range: key })} aria-current={key === rangeKey} prefetch={false}>
                  {resolveRange(key).label.replace("Last ", "")}
                </Link>
              ))}
            </nav>
          )}
          <LogoutButton endpoint="/mailroom/api/auth" />
        </div>
      </header>

      <nav className="k-tabs" aria-label="Sections">
        {TABS.map((item) => (
          <Link
            key={item.key}
            className="k-tab"
            href={href({ tab: item.key })}
            aria-current={item.key === tab ? "page" : undefined}
            prefetch={false}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {body}

      <p className="k-caveat">
        Addresses are kept so you can see who was sent what. Opting out stops list emails only; emails
        about a person&apos;s own recipe still go.
      </p>
    </div>
  );
}
