"use client";

import { X } from "lucide-react";
import { useState } from "react";

import { useDrawerExit } from "@/lib/use-drawer-exit";

/**
 * Settings.
 *
 * One control. It used to also report which model was answering and how much
 * corpus was behind it, which was a diagnostic for the team rather than
 * anything a reader could act on — and it sat in a sheet the width of the
 * window to hold three lines of text.
 *
 * Clearing history is destructive and cannot be undone, so the single button
 * asks before it does it. That is one control in two states, not two controls.
 */
export function SettingsSheet({
  onClearConversations,
  onClose,
}: {
  onClearConversations: () => void;
  onClose: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  const { requestClose, backdropClassName, drawerClassName, onAnimationEnd } = useDrawerExit(
    onClose,
    "modal",
  );

  return (
    <>
      <div className={backdropClassName} onClick={requestClose} aria-hidden />
      <div
        className={drawerClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="modal__head">
          <h2 id="settings-title" className="display m-0 text-xl">
            Settings
          </h2>
          <button type="button" className="icon-btn ml-auto" onClick={requestClose} aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="modal__body">
          <button
            type="button"
            className="ghost-btn modal__action"
            data-confirm={confirmClear ? "true" : undefined}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              onClearConversations();
              setConfirmClear(false);
              requestClose();
            }}
          >
            {confirmClear ? "Delete every conversation, confirm" : "Clear history"}
          </button>

          {/* Standing, not only once the button is armed. What it costs is
              worth knowing before the first click, not after it. */}
          <p className="modal__note">
            Clearing history removes all the chat on this device and there is no undo.
          </p>
        </div>
      </div>
    </>
  );
}
