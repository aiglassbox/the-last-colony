import Link from "next/link";
import { notFound } from "next/navigation";

import { kitchenAccess } from "@/lib/dash/auth";
import { parseRange, RANGE_KEYS, resolveRange } from "@/lib/dash/range";
import { buildReport, NoDatabaseError } from "@/lib/dash/report";

import { LoginForm } from "./LoginForm";
import { LogoutButton } from "./LogoutButton";
import { Threads } from "./Threads";
import { Demand } from "./tabs/Demand";
import { Overview } from "./tabs/Overview";
import { Product } from "./tabs/Product";
import { Reach } from "./tabs/Reach";

/**
 * The kitchen.
 *
 * A server component that reads the cookie and then either renders a password
 * prompt or twenty panels of numbers. State lives in the URL rather than in the
 * client — the window and the tab are both query parameters — which costs a
 * round trip on a tab change and buys three things worth more than it: a
 * shareable link to a specific view, a back button that works, and no
 * client-side store to keep in sync with a server that already had the data.
 */

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "product", label: "Product" },
  { key: "demand", label: "Demand" },
  { key: "reach", label: "Reach" },
  { key: "threads", label: "Threads" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function asTab(value: unknown): TabKey {
  return TABS.some((t) => t.key === value) ? (value as TabKey) : "overview";
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Kitchen(props: PageProps<"/kitchen">) {
  const access = await kitchenAccess();

  /* No password configured is not "open to everyone", it is "not here" — the
     same posture /api/email-report takes, and for the same reason: a dashboard
     that quietly serves the world because somebody forgot an environment
     variable is worse than no dashboard. */
  if (access === "unconfigured") notFound();
  if (access === "denied") return <LoginForm />;

  const params = await props.searchParams;
  const range = parseRange(one(params.range));
  const tab = asTab(one(params.tab));

  let report;
  try {
    report = await buildReport(range);
  } catch (error) {
    if (error instanceof NoDatabaseError) {
      return (
        <div className="kitchen__inner">
          <h1 className="k-head__title">The Kitchen</h1>
          <p className="k-caveat">
            No <strong>DATABASE_URL</strong> on this deployment, so there is nothing to read. The
            dashboard reads the same connection the app writes threads to.
          </p>
        </div>
      );
    }
    throw error;
  }

  const generated = new Date(report.generatedAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const href = (next: { tab?: string; range?: string }) =>
    `/kitchen?tab=${next.tab ?? tab}&range=${next.range ?? range}`;

  return (
    <div className="kitchen__inner">
      <header className="k-head">
        <div>
          <h1 className="k-head__title">The Kitchen</h1>
          <p className="k-head__sub">
            {report.rangeLabel} · read {generated} IST · all times India Standard Time
          </p>
        </div>

        <div className="k-head__actions">
          <nav className="k-range" aria-label="Time range">
            {RANGE_KEYS.map((key) => (
              <Link
                key={key}
                href={href({ range: key })}
                aria-current={key === range}
                prefetch={false}
              >
                {resolveRange(key).label.replace("Last ", "")}
              </Link>
            ))}
          </nav>
          <LogoutButton />
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

      {tab === "overview" && <Overview report={report} />}
      {tab === "product" && <Product report={report} />}
      {tab === "demand" && <Demand report={report} />}
      {tab === "reach" && <Reach report={report} />}
      {/* Keyed on the window so a range change resets the reader's page and
          selection by remounting, rather than by an effect that fires a render
          after the list has already been asked for at a stale offset. */}
      {tab === "threads" && <Threads key={range} range={range} />}

      <p className="k-caveat">
        <strong>What these numbers are.</strong> Everything drawn from conversations counts people
        who <em>typed</em> — a reader who lands, reads the hero and leaves writes no row, so those
        figures are a floor on traffic rather than a measure of it. The Reach tab is the other half,
        and it starts from the first visit after this deploy: campaign markers were never stored
        before it and cannot be back-filled.{" "}
        <strong>One undercount worth knowing about.</strong>{" "}
        The thread mirror is replace-by-device
        and a browser keeps thirty threads, so a heavy device&rsquo;s oldest threads are deleted from
        the server when it syncs. Short windows are exact; a long all-time window undercounts, and
        undercounts most for the readers who used the product most.
      </p>
    </div>
  );
}
