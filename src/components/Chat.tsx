"use client";

import { Menu, SquarePen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { parseCommand } from "@/lib/chat/commands";
import {
  deleteConversation,
  deriveTitle,
  flush,
  getServerSnapshot,
  getSnapshot,
  hydrateFromServer,
  newId,
  patchConversation,
  patchMessage,
  selectConversation,
  startConversation,
  subscribe,
  type ChatMessage,
} from "@/lib/chat/store";
import { flushSync } from "@/lib/chat/sync";
import type { TurnKind, TurnMode } from "@/lib/chat/turn";
import { PROSE, Typewriter } from "@/lib/chat/typewriter";
import type { CommunityCardData } from "@/lib/community/card";
import type { CorpusRecord } from "@/lib/corpus/types";
import { deviceId } from "@/lib/device-id";
import type { LocalizedCard } from "@/lib/lang/localized-card";
import type { SupportedLang } from "@/lib/lang/types";
import { uiStrings } from "@/lib/lang/ui-strings";
import {
  getServerSnapshot as railServerSnapshot,
  getSnapshot as railSnapshot,
  setCollapsed as setRailCollapsed,
  subscribe as railSubscribe,
  toggleCollapsed as toggleRail,
} from "@/lib/sidebar-store";
import { Composer } from "./Composer";
import { History } from "./History";
import { Logo, TwoBrothersMark } from "./Logo";
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

/**
 * The hero type.
 *
 * The headline is set in two strings because it breaks in a fixed place; the
 * stylesheet uppercases it, so it is written in sentence case here and the
 * apostrophe is the typographic one rather than a straight quote.
 *
 * The deck is one string and wraps where it likes. It carried a hand break
 * while it was a single sentence long enough to need directing — four
 * sentences have their own rhythm, and forcing a fold into the middle of one
 * would cut against it.
 */
const HEADING_HEAD = "It’s time to decolonise";
const HEADING_TAIL = "our kitchens";
const SUBHEADING =
  "The British colonised our land. Then they came for our grain. All for their selfish wants. " +
  "Today, we reclaim our food and cook it the Indian way.";

/** The hero composer's prompt. The follow-up field keeps its own, milder line. */
const PROMPT_PLACEHOLDER = "What recipe would you like to reclaim today?";

interface StreamEvent {
  type: "meta" | "delta" | "text" | "done" | "error" | "redact";
  mode?: TurnMode;
  kind?: TurnKind | null;
  records?: CorpusRecord[];
  lang?: SupportedLang;
  localized?: Record<string, LocalizedCard>;
  /** Present on a community-mode meta event — drives `CommunityCard`. */
  community?: CommunityCardData;
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

export function Chat({ initialSlug }: { initialSlug?: string }) {
  const { conversations, currentId } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
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

  // The page follows the conversation: the chrome is in the language of the
  // latest finished reply — one whose meta has arrived, so a streaming turn
  // never flickers the rail back to English — and English when there is none.
  // A card keeps its own language; this is only the frame around it.
  const uiLang = [...messages].reverse().find((m) => m.role === "assistant" && m.mode)?.lang;
  const t = useMemo(() => uiStrings(uiLang), [uiLang]);

  // Screen readers pick pronunciation from the document language.
  useEffect(() => {
    document.documentElement.lang = uiLang ?? "en";
  }, [uiLang]);

  // ---- the server mirror --------------------------------------------------

  /**
   * Ask the mirror for this device's threads, and make sure whatever is queued
   * leaves before the page does.
   *
   * `visibilitychange` rather than `unload`: a phone browser backgrounding a
   * tab frequently never fires the latter, and that is exactly the moment a
   * thread would be lost.
   */
  useEffect(() => {
    void hydrateFromServer();
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSync();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

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

  /**
   * The position the follow animation last wrote.
   *
   * The animation's own scrolling fires the handler below, which would see it
   * has not caught up, conclude the reader scrolled away and stop following.
   * A flag set for the duration of the write does not work: during streaming
   * the animation writes every frame and clears on the next, so the flag is
   * true almost continuously and the reader's own scrolling is swallowed with
   * it — they scroll up, nothing registers, and the next frame pulls them back
   * down. Recognising the value we wrote costs nothing and cannot be starved,
   * and it does not care which input moved the thread: wheel, touch, keyboard
   * or a drag on the scrollbar all read as the reader.
   */
  const wroteScroll = useRef<number | null>(null);

  const onScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    if (wroteScroll.current !== null && Math.abs(el.scrollTop - wroteScroll.current) <= 2) {
      wroteScroll.current = null;
      return;
    }
    wroteScroll.current = null;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  /**
   * Follow the text rather than jump past it.
   *
   * `scrollTop = scrollHeight` lands on the bottom of the card, which during a
   * restoration turn is the collapsed beat headers and the share buttons, not
   * the sentence being written. Every token then re-jumped there, so the reader
   * was held below the writing for the whole turn.
   *
   * Easing toward the target instead means the view drifts down at roughly the
   * speed the words arrive, and the line being written stays where the eye
   * already is. Anyone who scrolls up keeps their place: `stick` is false and
   * this does nothing until they come back down.
   */
  const follow = useRef<number | null>(null);
  useEffect(() => {
    if (!stick.current || follow.current !== null) return;
    const step = () => {
      const el = threadRef.current;
      if (!el || !stick.current) {
        follow.current = null;
        return;
      }
      const target = el.scrollHeight - el.clientHeight;
      const gap = target - el.scrollTop;
      if (gap < 1) {
        follow.current = null;
        return;
      }
      // A long way behind is a new turn, not streaming: close it quickly.
      el.scrollTop += gap > 600 ? gap : Math.max(1, gap * 0.18);
      // Remember where we put it, so the event this causes is recognisable.
      wroteScroll.current = el.scrollTop;
      follow.current = requestAnimationFrame(step);
    };
    follow.current = requestAnimationFrame(step);
    return () => {
      if (follow.current !== null) cancelAnimationFrame(follow.current);
      follow.current = null;
    };
  }, [conversations]);

  /**
   * Put a turn at the top of the view and leave it there.
   *
   * Called with the question the reader just asked, so the answer is written
   * downward from the top of the screen instead of upward from the bottom of
   * it. Waits a frame for the two new messages to be in the DOM, then moves
   * the thread by the distance between the turn and the top of the viewport.
   *
   * `.thread__inner > *:last-child` carries the room this needs — an empty
   * reply is only a few lines tall, and without something to scroll into the
   * turn would stop wherever it ran out of thread.
   */
  const anchor = useCallback((messageId: string) => {
    requestAnimationFrame(() => {
      const el = threadRef.current;
      const node = el?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      if (!el || !node) return;
      const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top;
      el.scrollTop += delta - 8;
      // So the scroll event this fires is recognised as ours, not the reader's.
      wroteScroll.current = el.scrollTop;
    });
  }, []);

  // ---- sending ------------------------------------------------------------

  const send = useCallback(
    async (text: string, slug?: string) => {
      const trimmed = text.trim();
      if ((!trimmed && !slug) || busy) return;

      const state = getSnapshot();
      const conversationId = state.currentId;
      const base = state.conversations.find((c) => c.id === conversationId);
      if (!base) return;

      // Not stuck to the bottom. The answer is about to be written under the
      // question, and following the bottom of it means the reader is held at
      // the last line while everything above scrolls past unread — the answer
      // appears to arrive from underneath. `anchor` puts the question at the
      // top instead and leaves it there; scrolling down to the end by hand
      // turns following back on, which is what `onScroll` is for.
      stick.current = false;
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
        // Minus any slash command: "/pre-raj biryani" is a request about
        // biryani, and biryani is what belongs on the share card.
        query: parseCommand(trimmed).rest || slug || trimmed,
      };

      const priorMessages = base.messages;
      const activeRecordIds = base.activeRecordIds;

      patchConversation(conversationId, (c) => ({
        ...c,
        messages: [...c.messages, userMsg, reply],
        title: c.messages.length === 0 ? deriveTitle([userMsg]) : c.title,
      }));

      anchor(userMsg.id);

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

      const device = deviceId();

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          /* The device id is sent so the events the route logs can be joined to
             the thread they produced. Without it a `dish_queried` line and the
             conversation it started are two unrelated rows, and the funnel from
             arrival to answer cannot be computed at all. Same id the mirror
             files under; null when storage is off, and the header is simply
             absent then. */
          headers: {
            "content-type": "application/json",
            ...(device ? { "x-device-id": device } : {}),
          },
          signal: controller.signal,
          body: JSON.stringify({
            slug,
            activeRecordIds,
            messages: [...priorMessages, userMsg].map((m) => ({ role: m.role, content: m.text })),
          }),
        });

        if (!res.ok || !res.body) {
          const detail = (await res.json().catch(() => ({ error: t.requestFailed }))) as {
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
              // A community turn carries no corpus records, ever — forced to
              // `[]` here rather than trusted to an absent `evt.records`, so a
              // reader's follow-up is never answered about whatever record was
              // last on screen before their family recipe replaced it.
              const records = evt.mode === "community" ? [] : (evt.records ?? []);
              patchMessage(conversationId, replyId, (m) => ({
                ...m,
                mode: evt.mode ?? "restoration",
                kind: evt.kind ?? undefined,
                records,
                lang: evt.lang,
                localized: evt.localized,
                community: evt.community,
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
            error: t.lostConnection,
          }));
        }
      } finally {
        abortRef.current = null;
        patchMessage(conversationId, replyId, (m) => ({
          ...m,
          streaming: false,
          // A community turn has no beats — it was never typed into the
          // Typewriter beat by beat, only `community` arrived on `meta` — so
          // it falls to the `m.text` branch below like every other mode that
          // is not built from beats. Giving it its own beats-join branch would
          // join an absent array into "", wiping the turn's text.
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
    [busy, anchor, t],
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
    // A typed "/pre-raj biryani" still works: the route parses the command off
    // the front of the message, and `send` strips it again for the share-card
    // query. `send` is the empty guard.
    setInput("");
    void send(input);
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

  return (
    /* The rail out narrows the stage and slides the hero type sideways onto
       the painted trees, where cream on cream stops being readable. The
       painting softens for as long as the rail is open and comes back the
       moment it closes — see `.app--rail-open`. */
    <div className={railCollapsed ? "app" : "app app--rail-open"}>
      <a href="#main" className="skip-link">
        {t.skipToContent}
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
        onGoToChat={goToChat}
        collapsed={railCollapsed}
        onToggleCollapsed={toggleRail}
        overlay={overlay}
        t={t}
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
            aria-label={t.openMenu}
          >
            <Menu size={20} aria-hidden />
          </button>
          {/* The lockup, as everywhere else. This was the wordmark set as text,
              which is the brand drawn in the interface font rather than the
              brand — and it is the one place a reader on a phone sees it. */}
          <button
            type="button"
            className="topbar__brand"
            onClick={goToChat}
            aria-label="Kranti Cookbook"
            title="Kranti Cookbook"
          >
            <Logo size={28} />
          </button>
          {/* Only once there is a thread to leave. On the opening screen this
              starts a new chat from a chat that has not been started — the
              control is already what the reader is looking at, so it offers a
              way out of nowhere. The spacer holds its 40px so the lockup stays
              centred rather than sliding right when it goes. */}
          {isEmpty ? (
            <span className="topbar__btn" aria-hidden />
          ) : (
            <button
              type="button"
              className="topbar__btn"
              onClick={startNew}
              aria-label={t.newChat}
            >
              <SquarePen size={19} aria-hidden />
            </button>
          )}
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
                t={t}
                lang={uiLang}
              />
            ) : isEmpty && phone ? (
              /* The phone opening screen: headline in the free space, actions
                 and composer anchored to the bottom where the thumb is. The
                 composer leaves the orange card here — a 150px input inside a
                 full-bleed gradient block is most of a small screen. */
              <>
                <div className="hero-wrap hero-wrap--phone">
                  <section className="hero" aria-labelledby="hero-title">
                    <TwoBrothersMark className="hero__mark" />
                    <h1 id="hero-title" className="hero__title">
                      {HEADING_HEAD}
                      <br /> {HEADING_TAIL}
                    </h1>
                    <p className="hero__subtitle">
                      {SUBHEADING}
                    </p>
                  </section>
                </div>

                <div className="thread__foot">
                  <div className="thread__foot-inner">
                    <Composer
                      value={input}
                      onChange={setInput}
                      onSubmit={submit}
                      onStop={() => abortRef.current?.abort()}
                      busy={busy}
                      placeholder={PROMPT_PLACEHOLDER}
                      variant="flat"
                      minHeight={64}
                      inputRef={promptRef}
                      t={t}
                      lang={uiLang}
                    />
                  </div>
                </div>
              </>
            ) : isEmpty ? (
              <div className="hero-wrap">
                <section className="hero" aria-labelledby="hero-title">
                  <TwoBrothersMark className="hero__mark" />
                  <h1 id="hero-title" className="hero__title">
                    {HEADING_HEAD}
                    <br /> {HEADING_TAIL}
                  </h1>
                  <p className="hero__subtitle">
                    {SUBHEADING}
                  </p>

                  <Composer
                    value={input}
                    onChange={setInput}
                    onSubmit={submit}
                    onStop={() => abortRef.current?.abort()}
                    busy={busy}
                    placeholder={PROMPT_PLACEHOLDER}
                    inputRef={promptRef}
                    minHeight={72}
                    t={t}
                    lang={uiLang}
                  />
                </section>
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
                      placeholder={t.followUp}
                      variant="flat"
                      minHeight={72}
                      inputRef={promptRef}
                      t={t}
                      lang={uiLang}
                    />
                    <p className="mt-2 text-center text-[0.7rem] text-[var(--ink-muted)]">
                      {t.unverifiedNote}
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
          onClearConversations={clearAll}
          onClose={() => setSettingsOpen(false)}
          t={t}
        />
      )}
    </div>
  );
}
