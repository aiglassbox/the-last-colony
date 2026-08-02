"use client";

import { Code2, FileText, ImageIcon, type LucideIcon, Menu, Pencil, SquarePen } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  applyCommand,
  COMMANDS,
  parseCommand,
  type SlashCommand,
} from "@/lib/chat/commands";
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
import type { TurnKind, TurnMode } from "@/lib/chat/turn";
import { PROSE, Typewriter } from "@/lib/chat/typewriter";
import type { CorpusRecord } from "@/lib/corpus/types";
import {
  getServerSnapshot as railServerSnapshot,
  getSnapshot as railSnapshot,
  setCollapsed as setRailCollapsed,
  subscribe as railSubscribe,
  toggleCollapsed as toggleRail,
} from "@/lib/sidebar-store";
import {
  getServerSnapshot as themeServerSnapshot,
  getSnapshot as themeSnapshot,
  subscribe as themeSubscribe,
  toggleTheme,
} from "@/lib/theme";

import { Composer } from "./Composer";
import { History } from "./History";
import { Message } from "./Message";
import { SettingsSheet } from "./SettingsSheet";
import { Sidebar, type SidebarView } from "./Sidebar";

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
  type: "meta" | "delta" | "text" | "done" | "error" | "redact";
  mode?: TurnMode;
  kind?: TurnKind | null;
  records?: CorpusRecord[];
  beat?: string;
  text?: string;
  message?: string;
}

/** Below this width an expanded rail floats over the stage instead of docking. */
const COMPACT_BREAKPOINT = 991;
/**
 * Below this width the rail leaves the layout entirely and its controls move
 * to a top bar. A docked rail on a 375px screen costs a sixth of the width
 * before a single word of the answer is drawn.
 */
const PHONE_BREAKPOINT = 767;

/** Icons live here rather than in the command table, which the server imports. */
const COMMAND_ICONS: Record<string, LucideIcon> = {
  "recipe-card": ImageIcon,
  "pre-raj": Code2,
  "healthier-swap": Pencil,
  "oil-match": FileText,
};

export function Chat({ initialSlug }: { initialSlug?: string }) {
  const { conversations, currentId } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const theme = useSyncExternalStore(themeSubscribe, themeSnapshot, themeServerSnapshot);
  const railCollapsed = useSyncExternalStore(railSubscribe, railSnapshot, railServerSnapshot);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<SidebarView>("chat");
  const [compact, setCompact] = useState(false);
  const [phone, setPhone] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fired = useRef(false);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  const messages = current?.messages ?? [];
  const isEmpty = messages.length === 0;

  // Read back out of the input rather than held as separate state, so typing
  // or deleting the slash by hand stays in step with the pills.
  const activeCommand = parseCommand(input).command;

  // ---- viewport -----------------------------------------------------------

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${COMPACT_BREAKPOINT}px)`);
    const phoneMq = window.matchMedia(`(max-width: ${PHONE_BREAKPOINT}px)`);
    const apply = () => {
      setCompact(mq.matches);
      setPhone(phoneMq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    phoneMq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      phoneMq.removeEventListener("change", apply);
    };
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
      // No mode until `meta` says which one. Seeding "restoration" painted an
      // empty card for one round-trip on every turn, including the prose ones
      // that never wanted a card at all.
      const reply: ChatMessage = {
        id: replyId,
        role: "assistant",
        text: "",
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

      // The wire order is the reveal order, so one queue covers every beat.
      const typer = new Typewriter((key, text) => {
        if (key === PROSE) {
          patchMessage(conversationId, replyId, (m) => ({ ...m, text: m.text + text }));
          return;
        }
        patchMessage(conversationId, replyId, (m) => ({
          ...m,
          beats: { ...m.beats, [key]: (m.beats?.[key] ?? "") + text },
        }));
      });

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
                kind: evt.kind ?? undefined,
                records,
              }));
              // Assigned unconditionally, including when empty. Guarding this on
              // `records.length` left the previous dish active through any turn
              // that carried none — ask for kheer, then pizza, then "what oil?",
              // and the follow-up was answered about kheer. The server echoes the
              // carried records back on a reply turn, so clearing here is only
              // ever clearing something that genuinely left the screen.
              patchConversation(conversationId, (c) => ({
                ...c,
                activeRecordIds: records.map((r) => r.id),
              }));
            } else if (evt.type === "delta" && evt.beat) {
              typer.push(evt.beat, evt.text ?? "");
            } else if (evt.type === "text") {
              typer.push(PROSE, evt.text ?? "");
            } else if (evt.type === "redact") {
              // The server caught the completion reproducing the prompt after
              // some of it had already been sent. Drop what was rendered, and
              // the queue with it, before the refusal arrives.
              typer.cancel();
              patchMessage(conversationId, replyId, (m) => ({ ...m, text: "", beats: {} }));
            } else if (evt.type === "error") {
              patchMessage(conversationId, replyId, (m) => ({ ...m, error: evt.message }));
            }
          }
        }

        // The wire is done; the caret is not. Hold the turn open until the
        // queue has emptied, or the card would snap to its full text.
        await typer.finish();
      } catch (err) {
        typer.cancel();
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
              : m.mode === "indianize"
                ? [m.beats?.VERDICT, m.beats?.REBUILD, m.beats?.SWAPS, m.beats?.PLATE]
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

  // While the rail is floating over the stage, acting on it should also put it
  // away — otherwise the result of the click sits hidden behind the rail.
  const dismissOverlay = () => {
    if (compact && !railCollapsed) setRailCollapsed(true);
  };

  const startNew = () => {
    abortRef.current?.abort();
    startConversation();
    dismissOverlay();
    setView("chat");
    setInput("");
  };

  const openConversation = (id: string) => {
    abortRef.current?.abort();
    selectConversation(id);
    dismissOverlay();
    setView("chat");
  };

  // Deleting the last conversation leaves a fresh empty one behind, which is
  // exactly the desired end state.
  const clearAll = () => {
    abortRef.current?.abort();
    for (const c of [...conversations]) deleteConversation(c.id);
    setView("chat");
  };

  // Expanded on a narrow viewport: the rail floats, so it needs a backdrop.
  const overlay = compact && !railCollapsed;

  const goToChat = () => {
    setView("chat");
    dismissOverlay();
  };

  // A pill writes its command into the composer and hands the caret back — it
  // does not run anything. The turn only leaves when the reader sends it.
  const pickCommand = (command: SlashCommand) => {
    setInput((current) => applyCommand(current, command));
    setView("chat");
    // After the paint, so the caret lands past the command the reader just
    // inserted rather than at whatever index it held before.
    requestAnimationFrame(() => {
      const el = promptRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  // One definition, two placements: beneath the hero on a desktop, stacked
  // directly above the pinned composer on a phone.
  const quickActions = (
    <div className="actions" role="group" aria-label="Prompt starters">
      {COMMANDS.map((command) => {
        const Icon = COMMAND_ICONS[command.slug];
        return (
          <button
            key={command.slug}
            type="button"
            className="pill"
            data-active={activeCommand?.slug === command.slug || undefined}
            aria-pressed={activeCommand?.slug === command.slug}
            onClick={() => pickCommand(command)}
          >
            <Icon size={16} className="pill__icon" aria-hidden />
            {command.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <Sidebar
        view={view}
        onViewChange={(v: SidebarView) => {
          setView(v);
          dismissOverlay();
        }}
        conversations={conversations}
        currentId={currentId}
        onSelectConversation={openConversation}
        onDeleteConversation={deleteConversation}
        onNewConversation={startNew}
        onOpenSettings={() => {
          setSettingsOpen(true);
          dismissOverlay();
        }}
        theme={theme}
        onToggleTheme={toggleTheme}
        onGoToChat={goToChat}
        collapsed={railCollapsed}
        onToggleCollapsed={toggleRail}
        overlay={overlay}
      />

      {overlay && (
        <div className="drawer-backdrop" onClick={() => setRailCollapsed(true)} aria-hidden />
      )}

      {/* On a phone the rail's three jobs — open the menu, go home, start a
          new thread — move up here, where a thumb can reach them and they cost
          no horizontal space. */}
      {phone && (
        <header className="topbar">
          <button
            type="button"
            className="topbar__btn"
            onClick={() => setRailCollapsed(false)}
            aria-label="Open menu"
          >
            <Menu size={20} aria-hidden />
          </button>
          <button type="button" className="topbar__brand" onClick={goToChat}>
            Kranti Cookbook
          </button>
          <button
            type="button"
            className="topbar__btn"
            onClick={startNew}
            aria-label="New restoration"
          >
            <SquarePen size={19} aria-hidden />
          </button>
        </header>
      )}

      <main id="main" className="canvas">
        <div className="stage">
          <div className="stage__glow" aria-hidden />

          <div className="stage__body">
            {view === "history" ? (
              <History
                conversations={conversations}
                currentId={currentId}
                onSelect={openConversation}
                onDelete={deleteConversation}
                onNew={startNew}
              />
            ) : isEmpty && phone ? (
              /* The phone opening screen: headline in the free space, actions
                 and composer anchored to the bottom where the thumb is. The
                 composer leaves the orange card here — a 150px input inside a
                 full-bleed gradient block is most of a small screen. */
              <>
                <div className="hero-wrap hero-wrap--phone">
                  <section className="hero" aria-labelledby="hero-title">
                    <h1 id="hero-title" className="hero__title">
                      {HEADING}
                    </h1>
                    <p className="hero__subtitle">{SUBHEADING}</p>
                  </section>
                </div>

                <div className="thread__foot">
                  <div className="thread__foot-inner">
                    {quickActions}
                    <Composer
                      value={input}
                      onChange={setInput}
                      onSubmit={submit}
                      onStop={() => abortRef.current?.abort()}
                      busy={busy}
                      placeholder={activeCommand?.hint ?? "Name a dish…"}
                      variant="flat"
                      minHeight={64}
                      inputRef={promptRef}
                    />
                  </div>
                </div>
              </>
            ) : isEmpty ? (
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
                    placeholder={activeCommand?.hint ?? "Type a dish to travel back in time…"}
                    inputRef={promptRef}
                    minHeight={150}
                  />
                </section>

                {quickActions}
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
                      placeholder={activeCommand?.hint ?? "Ask a follow-up…"}
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
