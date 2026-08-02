"use client";

import { parseCommand } from "@/lib/chat/commands";
import type { TurnKind, TurnMode } from "@/lib/chat/turn";
import type { CorpusRecord } from "@/lib/corpus/types";

/**
 * Conversation state, as an external store.
 *
 * localStorage is an external system, so `useSyncExternalStore` is the right
 * primitive rather than a `useState` seeded from an effect — it gives React a
 * stable server snapshot to hydrate against and a client snapshot to swap in,
 * with no mismatch and no cascading render on mount.
 *
 * Threads live on the device. There is no account here and the product does
 * not need one, but a chat that forgets everything on refresh does not feel
 * like a chat.
 */

export type { TurnMode } from "@/lib/chat/turn";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Plain text. Replayed to the model, and shown directly on prose turns. */
  text: string;
  mode?: TurnMode;
  /** Why this turn is what it is. Drives every reason the card states. */
  kind?: TurnKind;
  /** Present on restoration turns — drives the card. */
  records?: CorpusRecord[];
  beats?: Partial<Record<string, string>>;
  /**
   * Superseded by `kind`. Still read, never written: threads persisted before
   * `kind` existed are on readers' devices carrying these. See `kindOf`.
   */
  empty?: boolean;
  modern?: boolean;
  streaming?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** The dish currently on screen, carried into follow-up turns. */
  activeRecordIds: string[];
}

export interface ChatState {
  conversations: Conversation[];
  currentId: string;
}

const KEY = "tlc.conversations.v1";
const MAX_STORED = 30;

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function emptyConversation(): Conversation {
  const now = Date.now();
  return {
    id: newId(),
    title: "New restoration",
    createdAt: now,
    updatedAt: now,
    messages: [],
    activeRecordIds: [],
  };
}

const MAX_TITLE = 42;

/** Raises the first letter of each word, leaving the rest of it alone. */
function titleCase(text: string): string {
  return text.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1));
}

/**
 * The first user message as a thread name.
 *
 * The composer sends `/recipe-card kheer`, but the slash is addressed to the
 * server, not to the reader — the rail should read `Kheer · Recipe Card`. The
 * command survives as a suffix rather than being dropped, so two threads on
 * the same dish under different commands stay tellable apart.
 */
export function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.text.trim();
  if (!first) return "New restoration";

  const { command, rest } = parseCommand(first);
  if (!rest) return command ? command.short : "New restoration";

  const suffix = command ? ` · ${command.short}` : "";
  const room = MAX_TITLE - suffix.length;
  const dish = titleCase(rest);
  return (dish.length > room ? `${dish.slice(0, room - 1)}…` : dish) + suffix;
}

function read(): Conversation[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: Conversation[]): void {
  try {
    const trimmed = [...list]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_STORED)
      // Streaming flags are transient; persisting one leaves a dead caret
      // blinking in a restored thread.
      .map((c) => ({
        ...c,
        messages: c.messages.map((m) => ({ ...m, streaming: false })),
      }));
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // A full or disabled localStorage must not break the conversation.
  }
}

// --- the store ------------------------------------------------------------

const SERVER_SNAPSHOT: ChatState = { conversations: [], currentId: "" };

let state: ChatState | null = null;
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ChatState {
  if (!state) {
    const stored = read();
    const conversations = stored.length ? stored : [emptyConversation()];
    state = { conversations, currentId: conversations[0].id };
  }
  return state;
}

export function getServerSnapshot(): ChatState {
  return SERVER_SNAPSHOT;
}

function isStreaming(s: ChatState): boolean {
  const current = s.conversations.find((c) => c.id === s.currentId);
  return Boolean(current?.messages.some((m) => m.streaming));
}

export function update(fn: (s: ChatState) => ChatState): void {
  state = fn(getSnapshot());
  // Skip the write while tokens are arriving — otherwise every delta
  // serialises the whole history to disk.
  if (!isStreaming(state)) write(state.conversations);
  for (const listener of listeners) listener();
}

/** Flush to storage regardless of streaming state — used when a turn ends. */
export function flush(): void {
  if (state) write(state.conversations);
}

// --- convenience mutators -------------------------------------------------

export function patchConversation(
  id: string,
  fn: (c: Conversation) => Conversation,
  { touch = true }: { touch?: boolean } = {},
): void {
  update((s) => ({
    ...s,
    conversations: s.conversations.map((c) =>
      c.id === id ? { ...fn(c), updatedAt: touch ? Date.now() : c.updatedAt } : c,
    ),
  }));
}

/**
 * Tokens landing in a message are not activity on the thread.
 *
 * `updatedAt` orders the rail and the history list, and this runs once per
 * revealed chunk — stamping it here re-sorted the sidebar on every frame of a
 * reply. The turn already bumped the timestamp when its messages were appended,
 * which is the moment that actually happened.
 */
export function patchMessage(
  conversationId: string,
  messageId: string,
  fn: (m: ChatMessage) => ChatMessage,
): void {
  patchConversation(
    conversationId,
    (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)),
    }),
    { touch: false },
  );
}

export function startConversation(): string {
  const fresh = emptyConversation();
  update((s) => ({ conversations: [fresh, ...s.conversations], currentId: fresh.id }));
  return fresh.id;
}

export function selectConversation(id: string): void {
  update((s) => ({ ...s, currentId: id }));
}

export function deleteConversation(id: string): void {
  update((s) => {
    const next = s.conversations.filter((c) => c.id !== id);
    if (next.length === 0) {
      const fresh = emptyConversation();
      return { conversations: [fresh], currentId: fresh.id };
    }
    return {
      conversations: next,
      currentId: s.currentId === id ? next[0].id : s.currentId,
    };
  });
}
