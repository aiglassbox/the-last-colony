"use client";

import {
  ChevronDown,
  History,
  Moon,
  PanelLeft,
  PanelLeftOpen,
  Settings,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";

import type { Conversation } from "@/lib/chat/store";
import type { Theme } from "@/lib/theme";

import { Logo } from "./Logo";

/**
 * The left rail.
 *
 * One component, three presentations, all driven by two booleans:
 *
 *   collapsed  — a 76px icon rail. Labels leave the page visually but stay in
 *                the accessibility tree, so a screen reader still hears them.
 *   overlay    — below 992px an expanded rail would crush the conversation, so
 *                it floats above the stage with a backdrop instead of pushing.
 *
 * There is no hamburger on desktop: the rail is always on screen, and the
 * toggle that collapses it is the same control that brings it back.
 */

export type SidebarView = "chat" | "history";

export interface SidebarProps {
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  conversations: Conversation[];
  currentId: string;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  /** The seal doubles as the way back to the chat. */
  onGoToChat: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Expanded on a narrow viewport — floats over the stage. */
  overlay?: boolean;
}

const RECENT_LIMIT = 8;

export function Sidebar({
  view,
  onViewChange,
  conversations,
  currentId,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  onOpenSettings,
  theme,
  onToggleTheme,
  onGoToChat,
  collapsed,
  onToggleCollapsed,
  overlay = false,
}: SidebarProps) {
  const ref = useRef<HTMLElement>(null);

  // While floating, Escape puts it away — the same expectation any overlay sets.
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, onToggleCollapsed]);

  const recent = conversations.filter((c) => c.messages.length > 0).slice(0, RECENT_LIMIT);

  const className = ["sidebar", collapsed ? "sidebar--collapsed" : "", overlay ? "sidebar--overlay" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <aside ref={ref} className={className} aria-label="Sidebar">
      <div className="sidebar__head">
        {/* The seal is the way home, as the logo is on every product. Its
            accessible name comes from the mark, so it survives the collapse. */}
        <button type="button" className="sidebar__brand" onClick={onGoToChat} title="Asli Rasoi">
          <Logo size={collapsed ? 34 : 46} />
        </button>
        {/* Floating over the page, this control dismisses rather than
            collapses — so it reads as a close, not a resize. */}
        <button
          type="button"
          className="icon-btn sidebar__toggle"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={overlay ? "Close menu" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={overlay ? "Close menu" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {overlay ? (
            <X size={19} aria-hidden />
          ) : collapsed ? (
            <PanelLeftOpen size={19} aria-hidden />
          ) : (
            <PanelLeft size={19} aria-hidden />
          )}
        </button>
      </div>

      <div className="sidebar__scroll">
        <button type="button" className="new-chat" onClick={onNewConversation}>
          <SquarePen size={19} className="new-chat__icon" aria-hidden />
          <span className="side-item__text">New Chat</span>
        </button>

        <button
          type="button"
          className="side-item side-item--history"
          data-active={view === "history" || undefined}
          aria-current={view === "history" ? "page" : undefined}
          onClick={() => onViewChange("history")}
          title={collapsed ? "History" : undefined}
        >
          <History size={19} className="side-item__icon" aria-hidden />
          <span className="side-item__text">History</span>
        </button>

        <nav className="side-group side-group--recent" aria-label="Recent conversations">
          <h2 className="side-group__label">
            Recents
            <ChevronDown size={15} aria-hidden />
          </h2>
          {/* Unlabelled history rows are meaningless at 76px, so the list is
              dropped from the icon rail — the clock above still reaches it. */}
          {!collapsed &&
            (recent.length === 0 ? (
              <p className="side-empty">Nothing yet. Name a dish to begin.</p>
            ) : (
              <ul className="side-list">
                {recent.map((c) => (
                  <li key={c.id} className="side-row">
                    <button
                      type="button"
                      className="side-item"
                      data-active={(c.id === currentId && view === "chat") || undefined}
                      onClick={() => onSelectConversation(c.id)}
                    >
                      <span className="side-item__text">{c.title}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn side-row__delete"
                      onClick={() => onDeleteConversation(c.id)}
                      aria-label={`Delete conversation: ${c.title}`}
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </nav>
      </div>

      <div className="side-group side-group--others">
        <h2 className="side-group__label">Others</h2>
        <ul className="side-list">
          <li>
            <button
              type="button"
              className="side-item"
              onClick={onOpenSettings}
              title={collapsed ? "Settings" : undefined}
            >
              <Settings size={19} className="side-item__icon" aria-hidden />
              <span className="side-item__text">Settings</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="side-item"
              onClick={onToggleTheme}
              role="switch"
              aria-checked={theme === "dark"}
              aria-label="Dark Mode"
              title="Dark Mode"
            >
              <Moon size={19} className="side-item__icon" aria-hidden />
              <span className="side-item__text">Dark Mode</span>
              <span aria-hidden className="switch" data-on={theme === "dark"}>
                <span className="switch__knob" />
              </span>
            </button>
          </li>
        </ul>
      </div>
    </aside>
  );
}
