"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Settings. Deliberately small — it shows only things that are real: what the
 * model layer is actually running, and how much corpus is behind the answers.
 * The provider line exists because "there is no prose" has exactly two common
 * causes, a missing key and a spent quota, and neither is visible from the
 * chat surface.
 *
 * There is no appearance control: the cookbook ships one theme, so a light/dark
 * switch would be a control that changes nothing.
 */

interface Health {
  provider: { vendor: string; model: string } | null;
  corpus: {
    records: number;
    ancient: number;
    attested: number;
    unverified: number;
    swaps: number;
  };
}

export function SettingsSheet({
  onClearConversations,
  onClose,
}: {
  onClearConversations: () => void;
  onClose: () => void;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  /**
   * The parent owns whether this is mounted, so closing it destroys the node
   * on the same frame as the click and the sheet vanishes rather than leaves.
   * Closing is therefore a state of its own: every dismissal starts the exit,
   * and the parent is told only once the animation has actually finished.
   */
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);

  useEffect(() => {
    void fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && requestClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  /* A reader who has asked for less motion gets none of this: the exit is
     skipped and the sheet closes on the spot, as it did before. */
  useEffect(() => {
    if (!closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) onClose();
  }, [closing, onClose]);

  return (
    <>
      <div
        className={`drawer-backdrop${closing ? " drawer-backdrop--closing" : ""}`}
        onClick={requestClose}
        aria-hidden
      />
      <div
        className={`drawer${closing ? " drawer--closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        /* The exit owns the unmount: the parent hears about it when the sheet
           has left the screen, not when the click happened. */
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) onClose();
        }}
      >
        <div className="mx-auto max-w-[680px] px-6 pb-12 pt-6">
          <div className="mb-6 flex items-center gap-3">
            <div>
              <p className="mono m-0 text-[var(--ink-muted)]">Settings</p>
              <h2 id="settings-title" className="display m-0 text-xl">
                Preferences
              </h2>
            </div>
            <button type="button" className="icon-btn ml-auto" onClick={requestClose} aria-label="Close">
              <X size={18} aria-hidden />
            </button>
          </div>

          <Row label="Model">
            {health === null ? (
              <span className="text-sm text-[var(--ink-muted)]">Checking…</span>
            ) : health.provider ? (
              <span className="text-sm">
                {health.provider.vendor} · {health.provider.model}
              </span>
            ) : (
              <span className="text-sm text-[var(--orange)]">
                No key set, so cards still render from the corpus
              </span>
            )}
          </Row>

          {health && (
            <Row label="Corpus">
              <span className="text-sm text-[var(--ink-soft)]">
                {health.corpus.records} records · {health.corpus.attested} attested ·{" "}
                {health.corpus.unverified} awaiting verification · {health.corpus.swaps} swaps
              </span>
            </Row>
          )}

          <Row label="Conversations">
            {confirmClear ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  className="ghost-btn"
                  style={{ color: "var(--orange)", borderColor: "var(--orange)" }}
                  onClick={() => {
                    onClearConversations();
                    setConfirmClear(false);
                    requestClose();
                  }}
                >
                  Delete all, confirm
                </button>
                <button type="button" className="ghost-btn" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="ghost-btn" onClick={() => setConfirmClear(true)}>
                Clear history
              </button>
            )}
          </Row>

          <p className="mt-6 max-w-[60ch] text-sm leading-relaxed text-[var(--ink-muted)]">
            Restorations are drawn from a sourced corpus. Where a citation has not been
            checked against the printed edition, the card says so on its badge and in its
            source drawer.
          </p>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] py-4">
      <span className="min-w-[140px] text-sm font-medium">{label}</span>
      <span className="ml-auto">{children}</span>
    </div>
  );
}
