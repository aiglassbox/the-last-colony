import type { NextRequest } from "next/server";

import { kitchenAccess } from "@/lib/dash/auth";
import { listThreads, readThread } from "@/lib/dash/queries/threads";
import { bound, parseRange, resolveRange } from "@/lib/dash/range";
import { db } from "@/lib/db/client";

/**
 * The transcript reader's data.
 *
 * GET ?id=<thread>            — one conversation, whole
 * GET ?range=&search=&page=   — a page of summaries
 *
 * Behind the same cookie as the page. That is not belt-and-braces: the page
 * gates the *render*, and a route handler is reachable directly regardless of
 * what any page decided, so an endpoint serving readers' conversations has to
 * check for itself. Every failure is the same 404 the page gives, so a wrong
 * cookie cannot distinguish "no access" from "no such route".
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound(): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function GET(request: NextRequest) {
  if ((await kitchenAccess()) !== "granted") return notFound();

  const sql = db();
  if (!sql) return Response.json({ error: "no database configured" }, { status: 503 });

  const params = request.nextUrl.searchParams;

  try {
    const id = params.get("id");
    if (id) {
      const conversation = await readThread(sql, id);
      if (!conversation) return Response.json({ error: "no such thread" }, { status: 404 });
      return Response.json({ conversation }, { headers: { "Cache-Control": "no-store" } });
    }

    const range = resolveRange(parseRange(params.get("range") ?? undefined));
    const page = Math.max(0, Math.min(Number(params.get("page") ?? 0) || 0, 500));
    // A search term is a filter, not a query language; length is capped so a
    // pathological `ilike` pattern cannot be posted at the database.
    const search = (params.get("search") ?? "").slice(0, 80);

    const result = await listThreads(sql, { since: bound(range.since), search, page });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[kitchen] threads failed:", error);
    return Response.json({ error: "could not read threads" }, { status: 500 });
  }
}
