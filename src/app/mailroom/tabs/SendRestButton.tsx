"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { SendSummary } from "@/lib/mailroom/send";

import { postMail } from "./write/post";

/** Sends what a list batch left waiting, up to today's allowance. */
export function SendRestButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  async function go() {
    setBusy(true);
    setNote(null);
    const result = await postMail<SendSummary>({ action: "send-rest", batchId });
    if (!result.ok) {
      setNote({ text: result.error, bad: true });
    } else {
      const d = result.data;
      setNote({
        text:
          `Sent ${d.sent} · still waiting ${d.waiting} · opted out ${d.optedOut} · failed ${d.failed}` +
          (d.failed > 0 ? `. ${d.errors.join("; ")}` : ""),
        bad: d.failed > 0,
      });
    }
    // Rows may have changed even when the answer was an error.
    router.refresh();
    setBusy(false);
  }

  return (
    <span className="mr-inline">
      <button type="button" className="k-button" onClick={go} disabled={busy}>
        {busy ? "Sending…" : "Send the rest"}
      </button>
      {note && (
        <span className={note.bad ? "k-error mr-inline__note" : "mr-inline__note"} role="status">
          {note.text}
        </span>
      )}
    </span>
  );
}
