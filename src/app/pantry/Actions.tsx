"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PantryView } from "@/lib/community/client";

/**
 * The operator's powers, one set per view.
 *
 * Buttons are what a view usually allows; the store is what actually
 * enforces it — an overridden or published document refuses a re-run, a
 * non-green or untagged document refuses publish — so a stale button (a
 * router.refresh() that lands mid-edit, two tabs open on the same doc)
 * surfaces the store's refusal as a note, never a silent no-op.
 *
 * The view is derived from the document, never from the tab the operator
 * arrived on, so an action taken here changes the set on the next render.
 * Re-run is hidden once an operator has overridden the verdict — the model
 * does not get another say, and the route refuses it anyway.
 *
 * Pending has no Mark GREEN: that path produces an untagged green document
 * nothing can ever match. Rejecting junk needs no tag; approving does. Red
 * already carries a tag from the original verdict, so Red → Green → Published
 * works with nothing but Mark GREEN.
 */
export function Actions({
  id,
  view,
  overridden,
}: {
  id: string;
  view: PantryView;
  overridden: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setNote(null);
    try {
      const res = await fetch("/api/pantry/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; status?: string; reasons?: string[] };
      if (!res.ok) {
        setNote(payload.error ?? `That did not work (${res.status}).`);
        return;
      }
      setNote(`Now ${payload.status}${payload.reasons?.length ? ` — ${payload.reasons.join("; ")}` : ""}.`);
      router.refresh();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const download = (
    <a className="k-button" href={`/api/pantry/submissions?id=${id}&download=1`}>
      Download Corpus Candidate
    </a>
  );

  return (
    <div className="p-actions">
      {view === "pending" && (
        <>
          {!overridden && (
            <button className="k-button" disabled={busy !== null} onClick={() => void post({ action: "rerun" }, "rerun")}>
              {busy === "rerun" ? "Asking the model…" : "Re-Run Verdict"}
            </button>
          )}
          <button className="k-button" disabled={busy !== null} onClick={() => void post({ action: "override", card: "RED" }, "red")}>
            {busy === "red" ? "…" : "Mark RED"}
          </button>
        </>
      )}

      {view === "red" && (
        <button
          className="k-button k-button--primary"
          disabled={busy !== null}
          onClick={() => void post({ action: "override", card: "GREEN" }, "green")}
        >
          {busy === "green" ? "…" : "Mark GREEN"}
        </button>
      )}

      {view === "green" && (
        <>
          <button className="k-button" disabled={busy !== null} onClick={() => void post({ action: "override", card: "RED" }, "red")}>
            {busy === "red" ? "…" : "Mark RED"}
          </button>
          {!overridden && (
            <button className="k-button" disabled={busy !== null} onClick={() => void post({ action: "rerun" }, "rerun")}>
              {busy === "rerun" ? "Asking the model…" : "Re-Run Verdict"}
            </button>
          )}
          {download}
          <button
            className="k-button k-button--primary"
            disabled={busy !== null}
            onClick={() => void post({ action: "publish" }, "publish")}
          >
            {busy === "publish" ? "…" : "Mark Published"}
          </button>
        </>
      )}

      {view === "published" && (
        <>
          {download}
          <button className="k-button" disabled={busy !== null} onClick={() => void post({ action: "unpublish" }, "unpublish")}>
            {busy === "unpublish" ? "…" : "Remove from Published"}
          </button>
        </>
      )}

      {note && (
        <p className="k-panel__note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
