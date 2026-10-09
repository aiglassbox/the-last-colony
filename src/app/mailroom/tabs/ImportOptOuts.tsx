"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { postMail } from "./write/post";

/** One paste of the launch campaign's unsubscribed addresses. */
export function ImportOptOuts() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  async function go() {
    setBusy(true);
    setNote(null);
    const result = await postMail<{ added: number; already: number; invalid?: string[] }>({ action: "import-opt-outs", raw });
    if (!result.ok) {
      setNote({ text: result.error, bad: true });
    } else {
      const { added, already, invalid = [] } = result.data;
      setNote({
        text: `Added ${added}, already opted out ${already}` + (invalid.length ? `. Could not read: ${invalid.join(", ")}` : ""),
        bad: invalid.length > 0,
      });
      setRaw("");
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="mr-import">
      <label className="k-login__label" htmlFor="mailroom-import">
        Paste the launch campaign&apos;s unsubscribed addresses
      </label>
      <textarea
        id="mailroom-import"
        className="k-input mr-import__box"
        rows={4}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
      />
      <div className="mr-import__row">
        <button type="button" className="k-button k-button--primary" onClick={go} disabled={busy || raw.trim() === ""}>
          {busy ? "Importing…" : "Import opt-outs"}
        </button>
        {note && (
          <span className={note.bad ? "k-error mr-inline__note" : "mr-inline__note"} role="status">
            {note.text}
          </span>
        )}
      </div>
    </div>
  );
}
