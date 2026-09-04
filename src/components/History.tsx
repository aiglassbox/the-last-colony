"use client";

import { MessageSquare, Plus, Trash2 } from "lucide-react";

import type { Conversation } from "@/lib/chat/store";
import type { SupportedLang } from "@/lib/lang/types";
import { fill, type UiStrings } from "@/lib/lang/ui-strings";

/**
 * The History view.
 *
 * The sidebar's Recent group is a shortcut — the eight most recent threads, no
 * detail. This is the full list: every stored conversation, when it was last
 * touched, which dish it settled on, and how it opened. Selecting one hands
 * back to the thread view.
 */

export interface HistoryProps {
  conversations: Conversation[];
  currentId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  /** Labels in the language of the latest reply. */
  t: UiStrings;
  /** The same language, for dates and relative times. */
  lang?: SupportedLang;
}

/**
 * Coarse, deliberately — "3 days ago" is all anyone needs from a chat list.
 * `Intl` carries every language the app answers in, so no strings to translate.
 */
function relativeTime(ts: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return rtf.format(0, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  return new Date(ts).toLocaleDateString(lang, { day: "numeric", month: "short" });
}

/** The opening line of the reply, so a row says what the thread was about. */
function preview(conversation: Conversation, t: UiStrings): string {
  const reply = conversation.messages.find((m) => m.role === "assistant");
  const text = reply?.beats?.VERDICT ?? reply?.text ?? "";
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return t.noAnswerYet;
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
}

/** The dish the thread landed on — the one fact worth surfacing per row. */
function dish(conversation: Conversation): string | null {
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    const record = conversation.messages[i].records?.find((r) => r.tier === "ancient");
    if (record) return record.dish_name_source ?? record.dish_name_modern;
  }
  return null;
}

export function History({ conversations, currentId, onSelect, onDelete, onNew, t, lang }: HistoryProps) {
  const locale = lang ?? "en";
  // An untouched thread is the blank one the app always keeps open; listing it
  // as history would be listing nothing.
  const started = conversations
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="history">
      <div className="history__inner">
        <header className="history__head">
          <div>
            <h1 className="history__title display">{t.history}</h1>
            <p className="history__count">
              {started.length === 0
                ? t.nothingRestored
                : started.length === 1
                  ? t.restorationsOne
                  : fill(t.restorationsOther, { n: started.length })}
            </p>
          </div>
          <button type="button" className="pill" onClick={onNew}>
            <Plus size={16} className="pill__icon" aria-hidden />
            {t.newRestoration}
          </button>
        </header>

        {started.length === 0 ? (
          <div className="history__empty card">
            <MessageSquare size={22} aria-hidden />
            <p>{t.historyEmpty}</p>
          </div>
        ) : (
          <ul className="history__list">
            {started.map((c) => {
              const name = dish(c);
              return (
                <li key={c.id}>
                  <div className="history-card card" data-active={c.id === currentId || undefined}>
                    <button
                      type="button"
                      className="history-card__open"
                      onClick={() => onSelect(c.id)}
                    >
                      <span className="history-card__top">
                        <span className="history-card__title">{c.title}</span>
                        <span className="history-card__time">{relativeTime(c.updatedAt, locale)}</span>
                      </span>
                      <span className="history-card__preview">{preview(c, t)}</span>
                      <span className="history-card__meta">
                        {name && <span className="history-card__dish">{name}</span>}
                        <span>
                          {c.messages.length === 1
                            ? t.messagesOne
                            : fill(t.messagesOther, { n: c.messages.length })}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn history-card__delete"
                      onClick={() => onDelete(c.id)}
                      aria-label={fill(t.deleteConversation, { title: c.title })}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
