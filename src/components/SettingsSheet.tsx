"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Settings.
 *
 * A small popup with one thing in it. The model and corpus readouts that used
 * to live here were diagnostics, not settings — they belong in /api/health,
 * which still serves them.
 *
 * Clearing is two-step. It deletes every thread on the device and there is no
 * undo, so the first press only arms it.
 */

export function SettingsSheet({
  onClearConversations,
  onClose,
}: {
  onClearConversations: () => void;
  onClose: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <div className="popup" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="popup__head">
          <h2 id="settings-title" className="popup__title">
            Settings
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn popup__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <p className="popup__note">
          Every thread is kept on this device only. Clearing removes all of them, and there
          is no undo.
        </p>

        {confirmClear ? (
          <div className="popup__actions">
            <button
              type="button"
              className="popup__btn popup__btn--danger"
              onClick={() => {
                onClearConversations();
                setConfirmClear(false);
                onClose();
              }}
            >
              Delete everything
            </button>
            <button
              type="button"
              className="popup__btn"
              onClick={() => setConfirmClear(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="popup__actions">
            <button
              type="button"
              className="popup__btn popup__btn--danger"
              onClick={() => setConfirmClear(true)}
            >
              Clear history
            </button>
          </div>
        )}
      </div>
    </>
  );
}
