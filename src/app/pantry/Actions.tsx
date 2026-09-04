"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The operator's three powers.
 *
 * Override is final — the model does not get another say after it, which is
 * why the re-run button disappears. Re-run is for a pending doc whose AI pass
 * failed, and for any doc the operator wants judged by a newer prompt.
 * Download is a plain link: the route is cookie-gated like everything else.
 */
export function Actions({
  id,
  status,
  overridden,
}: {
  id: string;
  status: "pending" | "green" | "red";
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

  return (
    <div className="p-actions">
      {status !== "green" && (
        <button
          className="k-button k-button--primary"
          disabled={busy !== null}
          onClick={() => void post({ action: "override", card: "GREEN" }, "green")}
        >
          {busy === "green" ? "…" : "Mark GREEN"}
        </button>
      )}
      {status !== "red" && (
        <button className="k-button" disabled={busy !== null} onClick={() => void post({ action: "override", card: "RED" }, "red")}>
          {busy === "red" ? "…" : "Mark RED"}
        </button>
      )}
      {!overridden && (
        <button className="k-button" disabled={busy !== null} onClick={() => void post({ action: "rerun" }, "rerun")}>
          {busy === "rerun" ? "Asking the model…" : status === "pending" ? "Run verdict" : "Re-run verdict"}
        </button>
      )}
      {status === "green" && (
        <a className="k-button" href={`/api/pantry/submissions?id=${id}&download=1`}>
          Download corpus candidate
        </a>
      )}
      {note && (
        <p className="k-panel__note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
