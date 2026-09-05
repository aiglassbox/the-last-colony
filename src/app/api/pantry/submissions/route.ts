import { after, type NextRequest } from "next/server";

import { toCorpusCandidate } from "@/lib/community/candidate";
import {
  applyVerdict,
  getSubmission,
  overrideVerdict,
  publishSubmission,
  saveTranslation,
  translatedLangs,
  unpublishSubmission,
} from "@/lib/community/client";
import { moderate } from "@/lib/community/pipeline";
import { translateSubmission } from "@/lib/community/translate";
import { pantryAccess } from "@/lib/dash/auth";
import { SUPPORTED_LANGS, type SupportedLang } from "@/lib/lang/types";

/**
 * The pantry's writes and one export.
 *
 * The list and the detail are server-rendered by the page, which calls the
 * store directly; this route exists for what a render cannot do — write, and
 * hand back a file.
 *
 * GET  ?id=&download=1                    — a GREEN submission as a corpus candidate (JSON attachment)
 * POST { id, action: "override", card }   — the operator outranks the model
 * POST { id, action: "rerun" }            — moderate again: a pending doc whose AI pass failed, or any
 *                                           doc the operator wants judged by a newer prompt. Never an
 *                                           overridden or a published one.
 * POST { id, action: "publish" }          — the human gate: only a tagged GREEN document may be served
 * POST { id, action: "unpublish" }        — the takedown
 *
 * Behind the same cookie as the page, checked here as well: a route handler is
 * reachable regardless of what any page decided. Every failure of access is
 * the same 404 the page gives.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A re-run awaits the verdict inline — the operator is watching and wants the answer. */
export const maxDuration = 60;

const HEX_ID = /^[0-9a-f]{24}$/i;

function notFound(): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function GET(request: NextRequest) {
  if ((await pantryAccess()) !== "granted") return notFound();

  const params = request.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  if (!HEX_ID.test(id) || params.get("download") !== "1") {
    return Response.json({ error: "id (24 hex) and download=1 are required" }, { status: 400 });
  }

  const doc = await getSubmission(id);
  if (!doc) return Response.json({ error: "no such submission" }, { status: 404 });
  if (doc.status !== "green") {
    return Response.json({ error: "only GREEN submissions are corpus candidates" }, { status: 409 });
  }

  const candidate = toCorpusCandidate(doc);
  // The slug keeps whatever script the dish name was in — normalizeDish is
  // deliberate about that, and Phase 4 matches on it. A header value is a
  // ByteString, though, so a Devanagari slug throws as the Response is built.
  // RFC 5987 carries the real name; the quoted one is the byte-safe fallback.
  const asciiSlug = candidate.slug.replace(/[^ -~]/g, "").replace(/^-+|-+$/g, "") || "candidate";
  return new Response(`${JSON.stringify(candidate, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${asciiSlug}.json"; filename*=UTF-8''${encodeURIComponent(candidate.slug)}.json`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  if ((await pantryAccess()) !== "granted") return notFound();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  // `null` parses fine and then every field read on it throws.
  if (typeof raw !== "object" || raw === null) {
    return Response.json({ error: "body must be a JSON object" }, { status: 400 });
  }
  const body = raw as { id?: unknown; action?: unknown; card?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!HEX_ID.test(id)) return Response.json({ error: "id must be a 24-hex submission id" }, { status: 400 });

  if (body.action === "override") {
    if (body.card !== "GREEN" && body.card !== "RED") {
      return Response.json({ error: "card must be GREEN or RED" }, { status: 400 });
    }
    // Read first, so a stale id reads as 404 here exactly as it does on a
    // re-run, instead of telling the operator the store is down.
    const doc = await getSubmission(id);
    if (!doc) return Response.json({ error: "no such submission" }, { status: 404 });
    const ok = await overrideVerdict(id, body.card);
    if (!ok) return Response.json({ error: "could not write the override; the store may be down" }, { status: 503 });
    return Response.json({ ok: true, status: body.card === "GREEN" ? "green" : "red" });
  }

  if (body.action === "rerun") {
    const doc = await getSubmission(id);
    if (!doc) return Response.json({ error: "no such submission" }, { status: 404 });
    if (doc.verdict?.overridden_at) {
      return Response.json({ error: "overridden by an operator; the model does not get another say" }, { status: 409 });
    }
    if (doc.published_at) {
      return Response.json({ error: "published; unpublish before re-running the verdict" }, { status: 409 });
    }
    const verdict = await moderate(doc.submission);
    if (!verdict) {
      return Response.json({ error: "the verdict call failed; the submission stays as it was" }, { status: 502 });
    }
    const applied = await applyVerdict(id, verdict);
    if (!applied) {
      return Response.json({ error: "verdict not written — the store may be down, or an operator override landed first" }, { status: 503 });
    }
    return Response.json({ ok: true, status: verdict.card === "GREEN" ? "green" : "red", reasons: verdict.reasons });
  }

  if (body.action === "publish") {
    const result = await publishSubmission(id);
    if (result === "ok") {
      /* `after`, not `await`: the operator's click flushes before translation
         runs, the same pattern POST /api/submissions uses for the verdict.
         The recipe is already live in its original language; a missing
         translation falls back exactly as a corpus record falls back to
         English when a localization is missing — one language's failure is
         never the publish's failure. Republishing (or a retried job) only
         fills gaps: translatedLangs is read once, up front. */
      after(async () => {
        const doc = await getSubmission(id);
        if (!doc) {
          console.error(`[community] translate: submission ${id} not found after publish`);
          return;
        }
        const source = doc.dish?.language ?? "";
        let targets: readonly SupportedLang[];
        if (source === "") {
          // The model could not tell what language this submission is
          // written in (the store's "" for an unrecognised script or
          // mixture). No language is then safe to leave untranslated, so all
          // eight run, English included — an explicit branch, not a
          // comparison that happens to fall through.
          targets = SUPPORTED_LANGS;
        } else {
          targets = SUPPORTED_LANGS.filter((lang) => lang !== source);
        }
        const already = await translatedLangs(id);
        // Sequential, not parallel: eight concurrent calls against the same
        // submission is how a quota gets spent on one publish.
        for (const lang of targets) {
          if (already.includes(lang)) {
            console.log(`[community] translate ${id} -> ${lang}: already stored`);
            continue;
          }
          const translated = await translateSubmission(doc.submission, lang);
          if (!translated) {
            console.error(`[community] translate ${id} -> ${lang}: failed`);
            continue;
          }
          const saved = await saveTranslation(id, translated);
          console.log(`[community] translate ${id} -> ${lang}: ${saved ? "saved" : "save failed"}`);
        }
      });
      return Response.json({ ok: true, status: "published" });
    }
    if (result === "not_found") return Response.json({ error: "no such submission" }, { status: 404 });
    if (result === "not_green") {
      return Response.json({ error: "only a GREEN submission can be published; mark it GREEN first" }, { status: 409 });
    }
    if (result === "no_tag") {
      return Response.json({ error: "this document has no dish tag; re-run the verdict to generate one" }, { status: 409 });
    }
    return Response.json({ error: "could not write the publish; the store may be down" }, { status: 503 });
  }

  if (body.action === "unpublish") {
    const result = await unpublishSubmission(id);
    if (result === "not_found") return Response.json({ error: "no such submission" }, { status: 404 });
    if (result === "error") {
      return Response.json({ error: "could not write the unpublish; the store may be down" }, { status: 503 });
    }
    return Response.json({ ok: true, status: "unpublished" });
  }

  return Response.json({ error: "action must be override, rerun, publish, or unpublish" }, { status: 400 });
}
