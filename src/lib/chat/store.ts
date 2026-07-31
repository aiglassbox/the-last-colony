"use client";

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

export type TurnMode = "restoration" | "conversation" | "indianize";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Plain text. Replayed to the model, and shown directly on prose turns. */
  text: string;
  mode?: TurnMode;
  /** Present on restoration turns — drives the card. */
  records?: CorpusRecord[];
  beats?: Partial<Record<string, string>>;
  empty?: boolean;
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

/** First user message, trimmed. The convention every chat product uses. */
export function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.text.trim();
  if (!first) return "New restoration";
  return first.length > 42 ? `${first.slice(0, 42)}…` : first;
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

export function patchConversation(id: string, fn: (c: Conversation) => Conversation): void {
  update((s) => ({
    ...s,
    conversations: s.conversations.map((c) =>
      c.id === id ? { ...fn(c), updatedAt: Date.now() } : c,
    ),
  }));
}

export function patchMessage(
  conversationId: string,
  messageId: string,
  fn: (m: ChatMessage) => ChatMessage,
): void {
  patchConversation(conversationId, (c) => ({
    ...c,
    messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)),
  }));
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
