import { checkRate, clientKey } from "@/lib/rate-limit";

import type { NextRequest } from "next/server";

/**
 * Liveness, and nothing else.
 *
 * It used to answer with the active provider's vendor and model and five
 * corpus counts, for a settings sheet that reported them. That sheet now has
 * one control and reads nothing from here (`components/SettingsSheet.tsx`),
 * so the disclosure had no reader left — an unauthenticated URL naming which
 * vendor and which model version answer every request, and how much of the
 * corpus is unverified, for nobody.
 *
 * Kept rather than deleted because an uptime check may be pointed at it, and
 * those want a 200 rather than a body. If nothing is watching it, this file
 * can go: grep says nothing in the repository fetches it.
 */

export const dynamic = "force-dynamic";

/** Generous: a monitor polls, and this does no work worth rationing. */
const MAX_CHECKS = 60;

export async function GET(request: NextRequest) {
  const rate = checkRate(`health:${clientKey(request)}`, Date.now(), MAX_CHECKS);
  if (!rate.ok) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
