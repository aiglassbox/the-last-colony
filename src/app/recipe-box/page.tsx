import Link from "next/link";
import { notFound } from "next/navigation";

import { recipeBoxAccess } from "@/lib/dash/auth";
import { parseRange, RANGE_KEYS, resolveRange } from "@/lib/dash/range";
import { buildRecipeReport } from "@/lib/dash/recipe-report";
import { NoDatabaseError } from "@/lib/dash/report";

import { LoginForm } from "../kitchen/LoginForm";
import { LogoutButton } from "../kitchen/LogoutButton";
import { Funnel } from "./tabs/Funnel";

/**
 * The recipe box: the Add Recipe numbers.
 *
 * The kitchen's page, pointed at a different question. State lives in the URL
 * for the kitchen's reasons — a shareable view, a working back button, no
 * client store — and it shows counts only: no submitter's name, email, story
 * or photo is queried here. That view is the pantry's.
 */

export const dynamic = "force-dynamic";

const TABS = [{ key: "funnel", label: "Funnel" }] as const;

type TabKey = (typeof TABS)[number]["key"];

function asTab(value: unknown): TabKey {
  return TABS.some((t) => t.key === value) ? (value as TabKey) : "funnel";
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RecipeBox(props: PageProps<"/recipe-box">) {
  const access = await recipeBoxAccess();

  // No password configured is not "open to everyone", it is "not here".
  if (access === "unconfigured") notFound();
  if (access === "denied") {
    return (
      <LoginForm
        endpoint="/recipe-box/api/auth"
        title="The Recipe Box"
        sub="The Kranti Cookbook — Add Recipe numbers"
        inputId="recipe-box-password"
      />
    );
  }

  const params = await props.searchParams;
  const range = parseRange(one(params.range));
  const tab = asTab(one(params.tab));

  let report;
  try {
    report = await buildRecipeReport(range);
  } catch (error) {
    if (error instanceof NoDatabaseError) {
      return (
        <div className="kitchen__inner">
          <h1 className="k-head__title">The Recipe Box</h1>
          <p className="k-caveat">
            No <strong>DATABASE_URL</strong> on this deployment, so there is nothing to read. The
            funnel reads the same event log the kitchen does.
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
    `/recipe-box?tab=${next.tab ?? tab}&range=${next.range ?? range}`;

  return (
    <div className="kitchen__inner">
      <header className="k-head">
        <div>
          <h1 className="k-head__title">The Recipe Box</h1>
          <p className="k-head__sub">
            {report.rangeLabel} · read {generated} IST · all times India Standard Time
          </p>
        </div>

        <div className="k-head__actions">
          <nav className="k-range" aria-label="Time range">
            {RANGE_KEYS.map((key) => (
              <Link key={key} href={href({ range: key })} aria-current={key === range} prefetch={false}>
                {resolveRange(key).label.replace("Last ", "")}
              </Link>
            ))}
          </nav>
          <LogoutButton endpoint="/recipe-box/api/auth" />
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

      {tab === "funnel" && <Funnel report={report} />}

      <p className="k-caveat">
        <strong>What these numbers are.</strong> The funnel is beacons the form fires, counted from
        the deploy that added them. A reader whose browser blocks first-party analytics is not in
        them at all.
      </p>
    </div>
  );
}
