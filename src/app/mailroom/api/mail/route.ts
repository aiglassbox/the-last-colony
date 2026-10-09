import type { NextRequest } from "next/server";

import { mailPick } from "@/lib/community/client";
import { mailroomAccess } from "@/lib/dash/auth";
import { parseRecipients } from "@/lib/mailroom/budget";
import { SUBJECT_MAX } from "@/lib/mailroom/compose";
import { DraftError, FIELD_MAX, MESSAGE_MAX, parseDraft } from "@/lib/mailroom/draft";
import { previewDraft, sendDraft, sendRest } from "@/lib/mailroom/send";
import { importOptOuts, saveAutoReceived, servedReaders, type AutoReceived } from "@/lib/mailroom/store";

/**
 * The mailroom's one endpoint. The page renders everything it can read; this
 * does what a render cannot: preview, send, import, save.
 *
 * Behind the same cookie as the page, checked here as well, because a route
 * handler is reachable whatever a page decided. Every failure of access is
 * the page's 404. An operator-fixable problem (`DraftError`) is a 400 with
 * its message; anything else is a 500 that tells the operator to look at
 * the Sent tab before trying again, since a list send may have been part-way
 * through.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A day's 25 sends at Resend's pace fit with room to spare. */
export const maxDuration = 60;

/** One paste of the launch campaign's opt-outs. */
const IMPORT_MAX = 5000;

function notFound(): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
}

function autoFrom(raw: unknown): AutoReceived {
  const r = (raw ?? {}) as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const v = r[key];
    if (typeof v !== "string") throw new DraftError(`${key} must be text`);
    if (v.length > max) throw new DraftError(`${key}: over ${max} characters`);
    return v;
  };
  const auto: AutoReceived = {
    enabled: r.enabled === true,
    subject: text("subject", SUBJECT_MAX),
    preheader: text("preheader", FIELD_MAX),
    heading: text("heading", FIELD_MAX),
    message: text("message", MESSAGE_MAX),
  };
  if (/[\r\n]/.test(auto.subject)) throw new DraftError("subject: no line breaks");
  if (auto.enabled && [auto.subject, auto.preheader, auto.heading, auto.message].some((v) => v.trim() === "")) {
    throw new DraftError("write all four before switching automatic sending on");
  }
  return auto;
}

export async function POST(request: NextRequest) {
  if ((await mailroomAccess()) !== "granted") return notFound();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "preview":
        return Response.json(await previewDraft(parseDraft(body.draft)));
      case "send":
        return Response.json(await sendDraft(parseDraft(body.draft)));
      case "send-rest":
        if (typeof body.batchId !== "string") throw new DraftError("batchId is required");
        return Response.json(await sendRest(body.batchId));
      case "import-opt-outs": {
        if (typeof body.raw !== "string") throw new DraftError("paste the addresses as text");
        const { valid, invalid } = parseRecipients(body.raw);
        if (valid.length > IMPORT_MAX) throw new DraftError(`at most ${IMPORT_MAX} addresses per import`);
        return Response.json({ ...(await importOptOuts(valid)), invalid });
      }
      case "save-auto":
        await saveAutoReceived(autoFrom(body.auto));
        return Response.json({ ok: true });
      case "served": {
        const pick = typeof body.submissionId === "string" ? await mailPick(body.submissionId) : null;
        if (!pick) throw new DraftError("that submission was not found, or the recipe store is unavailable");
        return Response.json({ count: await servedReaders(pick.tag, pick.state) });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof DraftError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[mailroom] request failed:", error instanceof Error ? error.message : error);
    return Response.json(
      { error: "Something failed on our side. Check the Sent tab before trying again." },
      { status: 500 },
    );
  }
}
