import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { formatReport, readReport } from "@/lib/email/report";

/**
 * GET /api/email-report?token=<EMAIL_REPORT_TOKEN>&sent=2000[&tokens=1]
 *
 * The campaign's numbers, for whoever cannot get at a connection string.
 *
 * The Neon credentials on this deployment were created by Vercel's integration
 * and may be stored write-only, which means the people running the campaign can
 * deploy the site but cannot read the database it is already talking to. This
 * route closes that gap without moving any credential: it asks the app's own
 * `db()` handle, which has the connection string in its environment and never
 * reveals it.
 *
 * `EMAIL_REPORT_TOKEN` is a new variable whoever sets it up chooses themselves,
 * so it can be created without being able to read anything that already exists.
 * Unset, this route does not exist — a report endpoint that quietly serves
 * everybody because somebody forgot a variable is worse than no endpoint, and
 * failing closed is the only safe default for a URL that lists who clicked what.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time, so the token cannot be recovered a byte at a time. */
function tokenMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function denied(): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function GET(request: NextRequest) {
  const expected = process.env.EMAIL_REPORT_TOKEN;
  // Not configured is not "open to everyone", it is "not here".
  if (!expected) return denied();

  // A wrong token gets the same 404 as an unconfigured route, so probing cannot
  // even establish that a report exists here.
  if (!tokenMatches(request.nextUrl.searchParams.get("token"), expected)) return denied();

  const sql = db();
  if (!sql) {
    return new Response("No database is configured on this deployment.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const sent = Number(request.nextUrl.searchParams.get("sent") ?? 2000);
  const includeTokens = request.nextUrl.searchParams.get("tokens") === "1";

  try {
    const report = await readReport(sql, { includeTokens });
    return new Response(formatReport(report, Number.isFinite(sent) && sent > 0 ? sent : 2000), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    console.error("[email-report] failed:", error);
    return new Response("Could not read the report. Check the server log.\n", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
