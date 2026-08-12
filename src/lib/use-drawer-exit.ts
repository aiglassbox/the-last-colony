"use client";

import { useCallback, useEffect, useState, type AnimationEvent } from "react";

/**
 * Lets a drawer leave the screen before it is unmounted.
 *
 * Every drawer here is rendered conditionally by its parent, so closing one
 * destroys the node on the same frame as the click and it vanishes rather than
 * leaves. Closing is therefore a state the drawer holds: a dismissal starts the
 * exit, and the parent is told only once the animation has finished.
 *
 * Anyone who has asked for less motion gets none of it and the drawer closes on
 * the spot, which is also the path taken if the animation never runs — there is
 * no timer here waiting to be missed.
 */
export function useDrawerExit(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) onClose();
  }, [closing, onClose]);

  // Escape is a dismissal like any other and takes the same route out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && requestClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  return {
    requestClose,
    backdropClassName: `drawer-backdrop${closing ? " drawer-backdrop--closing" : ""}`,
    drawerClassName: `drawer${closing ? " drawer--closing" : ""}`,
    /* Guarded on the target: a drawer full of its own animations would
       otherwise unmount on the first one of them to finish. */
    onAnimationEnd: (event: AnimationEvent<HTMLElement>) => {
      if (closing && event.target === event.currentTarget) onClose();
    },
  };
}
