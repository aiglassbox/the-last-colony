/**
 * The launch email's numbers, printed.
 *
 *   npm run email:report
 *   npm run email:report -- --sent 2000     # sets the CTR denominator
 *   npm run email:report -- --tokens        # adds the per-token detail
 *
 * This is the route for whoever holds a connection string: it reads over one
 * that never leaves the operator's machine. Whoever does not hold one — the
 * Vercel integration can store the credential write-only — reads the identical
 * numbers from `/api/email-report`, which shares both the queries and the
 * formatter with this script so the two can never disagree.
 */
import "dotenv/config";

import { neon } from "@neondatabase/serverless";

import { formatReport, readReport } from "../src/lib/email/report";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.Last_Colony_DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    console.error("No connection string? Use /api/email-report instead — see the README.");
    process.exit(1);
  }

  const sent = Number(arg("sent") ?? 2000);
  const includeTokens = process.argv.includes("--tokens");

  const report = await readReport(neon(url), { includeTokens });
  console.log(formatReport(report, sent));

  if (!arg("sent")) {
    console.log("(denominator is the default 2000; pass --sent <n> for the real send count)");
  }
  if (!includeTokens) {
    console.log("Pass --tokens for the per-contact breakdown and the hot list.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
