"use client";

import {
  ArrowLeftRight,
  ArrowUpIcon,
  ClipboardList,
  Flame,
  MenuIcon,
  Moon,
  PlusIcon,
  ScrollText,
  Soup,
  SquareIcon,
  Sun,
  Utensils,
  Wheat,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteConversation,
  deriveTitle,
  flush,
  getServerSnapshot,
  getSnapshot,
  newId,
  patchConversation,
  patchMessage,
  selectConversation,
  startConversation,
  subscribe,
  type ChatMessage,
} from "@/lib/chat/store";
import type { CorpusRecord } from "@/lib/corpus/types";
import type { Beat } from "@/lib/model/beats";
import {
  getServerSnapshot as themeServerSnapshot,
  getSnapshot as themeSnapshot,
  subscribe as themeSubscribe,
  toggleTheme,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

import { Message } from "./Message";
import { SwapPanel } from "./SwapPanel";

/**
 * The chat surface.
 *
 * Layout follows the supplied component: the hook centred, a composer beneath
 * it, quick-action pills under that. That design is an empty state, so it is
 * used as one — once a thread starts, the composer carries over and the middle
 * becomes the scrolling conversation.
 *
 * The background is a flat fill from `--paper`, and every piece of chrome
 * resolves through the tokens, so light and dark are a single attribute flip
 * on <html> rather than two sets of hardcoded classes.
 */

const HOOK = "Name one Indian dish you eat almost every week.";
const SUBHOOK = "I will show you what it used to be.";

const DISHES = [
  { label: "Idli", icon: <Soup className="w-4 h-4" /> },
  { label: "Khichdi", icon: <Utensils className="w-4 h-4" /> },
  { label: "Kheer", icon: <Flame className="w-4 h-4" /> },
  { label: "Roti", icon: <Wheat className="w-4 h-4" /> },
  { label: "Pav bhaji", icon: <ScrollText className="w-4 h-4" /> },
];

interface StreamEvent {
  type: "meta" | "delta" | "text" | "done" | "error";
  mode?: "restoration" | "conversation";
  records?: CorpusRecord[];
  empty?: boolean;
  beat?: Beat;
  text?: string;
  message?: string;
}

export function Chat({ initialSlug }: { initialSlug?: string }) {
  const { conversations, currentId } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const theme = useSyncExternalStore(themeSubscribe, themeSnapshot, themeServerSnapshot);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [swapOpen, setSwapOpen] = useState<null | "single" | "pantry">(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fired = useRef(false);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  const messages = current?.messages ?? [];
  const isEmpty = messages.length === 0;

  // ---- auto-resizing composer -------------------------------------------

  const MIN_H = 48;
  const MAX_H = 150;

  const adjustHeight = useCallback((reset?: boolean) => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = `${MIN_H}px`;
    if (reset) return;
    el.style.height = `${Math.max(MIN_H, Math.min(el.scrollHeight, MAX_H))}px`;
  }, []);

  // Collapse to one row on mount — otherwise the textarea renders at its
  // default two rows and the composer sits taller than it ever needs to.
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.style.height = `${MIN_H}px`;
  }, []);

  // ---- scrolling ---------------------------------------------------------

  const onScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    // Stay pinned only if the reader is already near the bottom — scrolling up
    // mid-stream to re-read something should not yank you back down.
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (!stick.current) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversations]);

  // ---- sending -----------------------------------------------------------

  const send = useCallback(
    async (text: string, slug?: string) => {
      const trimmed = text.trim();
      if ((!trimmed && !slug) || busy) return;

      const state = getSnapshot();
      const conversationId = state.currentId;
      const base = state.conversations.find((c) => c.id === conversationId);
      if (!base) return;

      stick.current = true;
      setBusy(true);

      const userMsg: ChatMessage = { id: newId(), role: "user", text: trimmed || (slug ?? "") };
      const replyId = newId();
      const reply: ChatMessage = {
        id: replyId,
        role: "assistant",
        text: "",
        mode: "restoration",
        beats: {},
        streaming: true,
      };

      const priorMessages = base.messages;
      const activeRecordIds = base.activeRecordIds;

      patchConversation(conversationId, (c) => ({
        ...c,
        messages: [...c.messages, userMsg, reply],
        title: c.messages.length === 0 ? deriveTitle([userMsg]) : c.title,
      }));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            slug,
            activeRecordIds,
            messages: [...priorMessages, userMsg].map((m) => ({
              role: m.role,
              content: m.text,
            })),
          }),
        });

        if (!res.ok || !res.body) {
          const detail = (await res.json().catch(() => ({ error: "Request failed." }))) as {
            error?: string;
          };
          patchMessage(conversationId, replyId, (m) => ({ ...m, error: detail.error }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let evt: StreamEvent;
            try {
              evt = JSON.parse(line) as StreamEvent;
            } catch {
              continue;
            }

            if (evt.type === "meta") {
              const records = evt.records ?? [];
              patchMessage(conversationId, replyId, (m) => ({
                ...m,
                mode: evt.mode ?? "restoration",
                records,
                empty: Boolean(evt.empty),
              }));
              if (records.length) {
                patchConversation(conversationId, (c) => ({
                  ...c,
                  activeRecordIds: records.map((r) => r.id),
                }));
              }
            } else if (evt.type === "delta" && evt.beat) {
              const beat = evt.beat;
              patchMessage(conversationId, replyId, (m) => ({
                ...m,
                beats: { ...m.beats, [beat]: (m.beats?.[beat] ?? "") + (evt.text ?? "") },
              }));
            } else if (evt.type === "text") {
              patchMessage(conversationId, replyId, (m) => ({
                ...m,
                text: m.text + (evt.text ?? ""),
              }));
            } else if (evt.type === "error") {
              patchMessage(conversationId, replyId, (m) => ({ ...m, error: evt.message }));
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patchMessage(conversationId, replyId, (m) => ({
            ...m,
            error: "Lost the connection. Try again.",
          }));
        }
      } finally {
        abortRef.current = null;
        // Restoration turns keep their prose in `beats`; flatten a copy into
        // `text` so the next request can replay this turn to the model.
        patchMessage(conversationId, replyId, (m) => ({
          ...m,
          streaming: false,
          text:
            m.mode === "restoration"
              ? [m.beats?.VERDICT, m.beats?.THEN, m.beats?.WHAT_CHANGED, m.beats?.RESTORE_TODAY]
                  .filter(Boolean)
                  .join("\n\n")
              : m.text,
        }));
        flush();
        setBusy(false);
      }
    },
    [busy],
  );

  // Deep link from a QR code or a permalink. Deferred a tick — `send` sets
  // React state on its first line, and doing that synchronously in an effect
  // cascades a render.
  useEffect(() => {
    if (fired.current || !initialSlug || !currentId) return;
    fired.current = true;
    const id = setTimeout(() => void send(initialSlug, initialSlug), 0);
    return () => clearTimeout(id);
  }, [initialSlug, currentId, send]);

  // ---- composer actions --------------------------------------------------

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input;
    setInput("");
    adjustHeight(true);
    void send(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const startNew = () => {
    abortRef.current?.abort();
    startConversation();
    setHistoryOpen(false);
    setInput("");
    adjustHeight(true);
  };

  const openThread = (id: string) => {
    abortRef.current?.abort();
    selectConversation(id);
    setHistoryOpen(false);
  };

  // ---- pieces ------------------------------------------------------------

  const composer = (
    <form onSubmit={submit} className="w-full">
      <div className="relative rounded-xl border border-[var(--line-strong)] bg-[var(--paper-2)] focus-within:border-[var(--then)]">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            adjustHeight();
          }}
          onKeyDown={onKeyDown}
          placeholder={isEmpty ? "idli, khichdi, pav bhaji…" : "Ask a follow-up…"}
          aria-label="Message"
          className={cn(
            "w-full resize-none border-none bg-transparent px-4 py-3 text-sm text-[var(--ink)]",
            "min-h-[48px] placeholder:text-[var(--ink-faint)]",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
          )}
          style={{ overflow: "hidden" }}
        />

        <div className="flex items-center justify-between p-3 pt-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSwapOpen("pantry")}
            aria-label="Read my pantry"
            title="Read my pantry"
          >
            <ClipboardList className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2">
            {busy ? (
              <Button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop generating"
                className="gap-1 rounded-lg bg-[var(--ink-faint)] px-3 text-[var(--paper)]"
              >
                <SquareIcon className="h-3.5 w-3.5 fill-current" />
                <span className="sr-only">Stop</span>
              </Button>
            ) : (
              <Button
                type="submit"
                onClick={submit}
                disabled={!input.trim()}
                aria-label="Send"
                className={cn(
                  "gap-1 rounded-lg px-3 transition-colors",
                  input.trim()
                    ? "bg-[var(--then)] text-[var(--paper)] hover:opacity-90"
                    : "cursor-not-allowed bg-[var(--surface)] text-[var(--ink-faint)]",
                )}
              >
                <ArrowUpIcon className="h-4 w-4" />
                <span className="sr-only">Send</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );

  const quickActions = (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
      {DISHES.map((d) => (
        <QuickAction key={d.label} icon={d.icon} label={d.label} onClick={() => void send(d.label)} />
      ))}
      <QuickAction
        icon={<ArrowLeftRight className="h-4 w-4" />}
        label="Swap an ingredient"
        onClick={() => setSwapOpen("single")}
      />
      <QuickAction
        icon={<ClipboardList className="h-4 w-4" />}
        label="Read my pantry"
        onClick={() => setSwapOpen("pantry")}
      />
    </div>
  );

  return (
    <div className="relative flex h-dvh w-full flex-col items-center overflow-hidden bg-[var(--paper)]">
      <header className="flex w-full flex-none items-center gap-1 border-b border-[var(--line)] px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setHistoryOpen(true)}
          aria-label="Conversations"
        >
          <MenuIcon className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1 px-1">
          <div className="mono text-[var(--then)]">The Great Indian Food Restoration</div>
          {!isEmpty && (
            <div className="truncate text-xs text-[var(--ink-faint)]">{current?.title}</div>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setSwapOpen("single")}
          aria-label="Ingredient swap tool"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={startNew}
          aria-label="New chat"
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
      </header>

      {isEmpty ? (
        <>
          <div className="flex w-full flex-1 flex-col items-center justify-center px-4">
            <div className="text-center">
              <h1 className="display text-3xl text-[var(--ink)] sm:text-4xl">{HOOK}</h1>
              <p className="mt-3 text-[var(--ink-soft)]">{SUBHOOK}</p>
            </div>
          </div>

          <div className="mb-[12vh] w-full max-w-3xl flex-none px-4">
            {composer}
            {quickActions}
          </div>
        </>
      ) : (
        <>
          <div
            ref={threadRef}
            onScroll={onScroll}
            className="w-full flex-1 overflow-y-auto overscroll-contain"
          >
            <div className="mx-auto max-w-3xl px-4 pb-6 pt-2">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
            </div>
          </div>

          <div className="w-full max-w-3xl flex-none px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {composer}
            <p className="mt-2 text-center text-[0.7rem] text-[var(--ink-faint)]">
              Unverified citations are labelled on the card.
            </p>
          </div>
        </>
      )}

      {historyOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setHistoryOpen(false)} aria-hidden />
          <aside
            className="fixed inset-y-0 left-0 z-[60] flex w-[min(84vw,300px)] flex-col border-r border-[var(--line-strong)] bg-[var(--paper-2)]"
            aria-label="Conversations"
          >
            <div className="flex items-center gap-2 border-b border-[var(--line)] p-3">
              <div className="mono flex-1 text-[var(--ink-faint)]">Conversations</div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-3">
              <Button type="button" variant="outline" onClick={startNew} className="w-full">
                <PlusIcon className="h-4 w-4" /> New restoration
              </Button>
            </div>

            <div className="overflow-y-auto px-2 pb-4">
              {conversations.map((c) => (
                <div key={c.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openThread(c.id)}
                    className={cn(
                      "flex-1 truncate rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      c.id === currentId
                        ? "border-[var(--then)] text-[var(--ink)]"
                        : "border-transparent text-[var(--ink-soft)] hover:text-[var(--ink)]",
                    )}
                  >
                    {c.title}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteConversation(c.id)}
                    aria-label={`Delete ${c.title}`}
                    className="h-7 w-7"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}

      {swapOpen && <SwapPanel mode={swapOpen} onClose={() => setSwapOpen(null)} />}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="flex items-center gap-2 rounded-full bg-[var(--paper-2)]"
    >
      {icon}
      <span className="text-xs">{label}</span>
    </Button>
  );
}
