"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Ends the session server-side and re-renders the page, which then shows the prompt. */
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/kitchen/auth", { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="k-button" onClick={() => void signOut()} disabled={busy}>
      {busy ? "…" : "Sign out"}
    </button>
  );
}
