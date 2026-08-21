"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The container's pixel width, watched.
 *
 * The alternative — a fixed `viewBox` scaled with `preserveAspectRatio="none"`
 * — is what most quick SVG charts do and it is why they look wrong: it scales
 * the geometry and the stroke together, so a 2px line becomes 3.4px on a wide
 * screen and 1.1px in a narrow panel, and circular markers turn into ellipses.
 * Measuring instead means every figure is drawn at true pixel size and the mark
 * specs mean what they say.
 *
 * Returns 0 before the first measurement, which callers use to skip rendering
 * rather than to draw something at zero width and then reflow it.
 */
export function useMeasure<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node) return;

    setWidth(node.clientWidth);
    observer.current = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      // Sub-pixel jitter from a scrollbar appearing would otherwise loop.
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
    });
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, width];
}
