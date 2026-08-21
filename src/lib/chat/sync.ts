"use client";

import { deviceId } from "@/lib/device-id";

import type { Conversation } from "./store";

/**
 * The server mirror of the threads on this device.
 *
 * The device stays the source of truth. Writes go to localStorage first and
 * are pushed here after, so a slow or missing database costs the mirror and
 * never the conversation in front of the reader. Every failure below is
 * swallowed for that reason: there is nothing the reader could do about it and
 * nothing of theirs is lost.
 */

/** Long enough to coalesce a burst of writes, short enough to survive a tab close. */
const PUSH_DELAY = 1200;

/* The id moved to a directive-free module so the analytics shim — which route
   handlers import — can read it without crossing a client boundary. Re-exported
   here because this is where every existing caller looks for it. */
export { deviceId } from "@/lib/device-id";

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Conversation[] | null = null;

async function push(conversations: Conversation[]): Promise<void> {
  const id = deviceId();
  if (!id) return;
  try {
    await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": id },
      body: JSON.stringify({ conversations }),
      keepalive: true,
    });
  } catch {
    // Offline, or the mirror is down. The device copy already holds it.
  }
}

/** Queue a push. Repeated calls collapse into one. */
export function scheduleSync(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;
  pending = conversations;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const next = pending;
    pending = null;
    if (next) void push(next);
  }, PUSH_DELAY);
}

/**
 * Send anything still queued while the page is going away.
 *
 * `keepalive` is what lets this outlive the document, and `visibilitychange`
 * rather than `unload` because a phone browser backgrounding a tab often never
 * fires the latter.
 */
export function flushSync(): void {
  if (!pending) return;
  const next = pending;
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  void push(next);
}

/** This device's threads as the server has them. Empty if it has none. */
export async function fetchConversations(): Promise<Conversation[]> {
  const id = deviceId();
  if (!id) return [];
  try {
    const response = await fetch("/api/conversations", { headers: { "x-device-id": id } });
    if (!response.ok) return [];
    const body = (await response.json()) as { conversations?: Conversation[] };
    return Array.isArray(body.conversations) ? body.conversations : [];
  } catch {
    return [];
  }
}
