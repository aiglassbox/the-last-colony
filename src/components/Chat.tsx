"use client";

import { Code2, FileText, ImageIcon, Menu, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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

import { Composer } from "./Composer";
import { Message } from "./Message";
import { SettingsSheet } from "./SettingsSheet";
import { Sidebar, type SidebarView } from "./Sidebar";
import { SwapPanel } from "./SwapPanel";

/**
 * The application shell.
 *
 * Presentation only — the turn-mode routing, retrieval gates, streaming
 * protocol and corpus guarantees all sit below this file and are untouched by
 * the visual layer. What changed here is the frame: a docked rail, a rounded
 * stage, and a hero that becomes a thread once a conversation starts.
 */

const HEADING = "What are you cooking today?";
const SUBHEADING =
  "Enter a modern dish to unearth its original, pre-1858 recipe and see what British cash-crop policies erased from our diet.";

interface StreamEvent {
  type: "meta" | "delta" | "text" | "done" | "error";
  mode?: "restoration" | "conversation";
  records?: CorpusRecord[];
  empty?: boolean;
  beat?: Beat;
  text?: string;
  message?: string;
}

/** Below this width the rail leaves the flow and returns as a drawer. */
const DRAWER_BREAKPOINT = 991;

export function Chat({ initialSlug }: { initialSlug?: string }) {
  const { conversations, currentId } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const theme = useSyncExternalStore(themeSubscribe, themeSnapshot, themeServerSnapshot);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<SidebarView>("chat");
  const [railOpen, setRailOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [swap, setSwap] = useState<null | { mode: "single" | "pantry"; item?: string }>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fired = useRef(false);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  const messages = current?.messages ?? [];
  const isEmpty = messages.length === 0 || view === "history";

  const activeRecord =
    [...messages].reverse().find((m) => m.records?.length)?.records?.find((r) => r.tier === "ancient") ??
    null;

  // ---- viewport -----------------------------------------------------------

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${DRAWER_BREAKPOINT}px)`);
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ---- scrolling ----------------------------------------------------------

  const onScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (!stick.current) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversations]);

  // ---- sending ------------------------------------------------------------

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
      setView("chat");

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
            messages: [...priorMessages, userMsg].map((m) => ({ role: m.role, content: m.text })),
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

  // Deep link from a QR code or permalink, deferred a tick — `send` sets state
  // on its first line and doing that inside an effect cascades a render.
  useEffect(() => {
    if (fired.current || !initialSlug || !currentId) return;
    fired.current = true;
    const id = setTimeout(() => void send(initialSlug, initialSlug), 0);
    return () => clearTimeout(id);
  }, [initialSlug, currentId, send]);

  // ---- actions ------------------------------------------------------------

  const submit = () => {
    const text = input;
    setInput("");
    void send(text);
  };

  const focusPrompt = () => {
    setView("chat");
    promptRef.current?.focus();
  };

  const startNew = () => {
    abortRef.current?.abort();
    startConversation();
    setRailOpen(false);
    setView("chat");
    setInput("");
  };

  const openConversation = (id: string) => {
    abortRef.current?.abort();
    selectConversation(id);
    setRailOpen(false);
    setView("chat");
  };

  // Deleting the last conversation leaves a fresh empty one behind, which is
  // exactly the desired end state.
  const clearAll = () => {
    abortRef.current?.abort();
    for (const c of [...conversations]) deleteConversation(c.id);
    setView("chat");
  };

  const railProps = {
    view,
    onViewChange: (v: SidebarView) => {
      setView(v);
      setRailOpen(false);
    },
    conversations,
    currentId,
    onSelectConversation: openConversation,
    onDeleteConversation: deleteConversation,
    onNewConversation: startNew,
    onOpenSettings: () => {
      setSettingsOpen(true);
      setRailOpen(false);
    },
    theme,
    onToggleTheme: toggleTheme,
  };

  const showFloatingOpener = compact || railCollapsed;

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {!compact && !railCollapsed && (
        <Sidebar {...railProps} onCollapse={() => setRailCollapsed(true)} />
      )}

      {railOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setRailOpen(false)} aria-hidden />
          <Sidebar {...railProps} asDrawer onClose={() => setRailOpen(false)} />
        </>
      )}

      <main id="main" className="canvas">
        <div className="stage">
          <div className="stage__glow" aria-hidden />

          {showFloatingOpener && (
            <button
              type="button"
              className="icon-btn"
              style={{ position: "absolute", top: 16, left: 16, zIndex: 2 }}
              onClick={() => (compact ? setRailOpen(true) : setRailCollapsed(false))}
              aria-label="Open sidebar"
            >
              <Menu size={18} aria-hidden />
            </button>
          )}

          <div className="stage__body">
            {isEmpty ? (
              <div className="hero-wrap">
                <section className="hero" aria-labelledby="hero-title">
                  <h1 id="hero-title" className="hero__title">
                    {HEADING}
                  </h1>
                  <p className="hero__subtitle">{SUBHEADING}</p>

                  <Composer
                    value={input}
                    onChange={setInput}
                    onSubmit={submit}
                    onStop={() => abortRef.current?.abort()}
                    busy={busy}
                    placeholder="Type a dish to travel back in time…"
                    inputRef={promptRef}
                    minHeight={150}
                  />
                </section>

                <div className="actions" role="group" aria-label="Quick actions">
                  <button
                    type="button"
                    className="pill"
                    onClick={() =>
                      activeRecord
                        ? window.open(`/api/share/${activeRecord.slug}`, "_blank", "noopener")
                        : focusPrompt()
                    }
                  >
                    <ImageIcon size={16} className="pill__icon" aria-hidden />
                    Generate Recipe Card
                  </button>
                  <button type="button" className="pill" onClick={submit}>
                    <Code2 size={16} className="pill__icon" aria-hidden />
                    Pre-Raj Version
                  </button>
                  <button type="button" className="pill" onClick={() => setSwap({ mode: "single" })}>
                    <Pencil size={16} className="pill__icon" aria-hidden />
                    Healthier Swap
                  </button>
                  <button
                    type="button"
                    className="pill"
                    onClick={() => setSwap({ mode: "single", item: "refined seed oil" })}
                  >
                    <FileText size={16} className="pill__icon" aria-hidden />
                    Oil Match
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="thread" ref={threadRef} onScroll={onScroll}>
                  <div className="thread__inner">
                    {messages.map((m) => (
                      <Message key={m.id} message={m} />
                    ))}
                  </div>
                </div>

                <div className="thread__foot">
                  <div className="thread__foot-inner">
                    <Composer
                      value={input}
                      onChange={setInput}
                      onSubmit={submit}
                      onStop={() => abortRef.current?.abort()}
                      busy={busy}
                      placeholder="Ask a follow-up…"
                      variant="flat"
                      minHeight={72}
                      inputRef={promptRef}
                    />
                    <p className="mt-2 text-center text-[0.7rem] text-[var(--ink-muted)]">
                      Unverified citations are labelled on the card.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      {swap && (
        <SwapPanel mode={swap.mode} initialItem={swap.item} onClose={() => setSwap(null)} />
      )}

      {settingsOpen && (
        <SettingsSheet
          theme={theme}
          onToggleTheme={toggleTheme}
          onClearConversations={clearAll}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
