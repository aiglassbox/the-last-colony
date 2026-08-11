"use client";

import { ChevronDown, PanelLeft, PanelLeftOpen, Settings, SquarePen, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Conversation } from "@/lib/chat/store";

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

export interface SidebarProps {
  conversations: Conversation[];
  currentId: string;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  /** The seal doubles as the way back to the chat. */
  onGoToChat: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Expanded on a narrow viewport — floats over the stage. */
  overlay?: boolean;
}

const RECENT_LIMIT = 8;

export function Sidebar({
  conversations,
  currentId,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  onOpenSettings,
  onGoToChat,
  collapsed,
  onToggleCollapsed,
  overlay = false,
}: SidebarProps) {
  const ref = useRef<HTMLElement>(null);
  const [recentsOpen, setRecentsOpen] = useState(true);

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
        {collapsed && !overlay ? (
          /* Collapsed, the rail shows only the seal. Pointing at it swaps the
             mark for the expand icon in the same square, so the one thing on
             screen is also the control — no second button competing with it. */
          <button
            type="button"
            className="rail-open"
            onClick={onToggleCollapsed}
            aria-expanded={false}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <span className="rail-open__mark">
              <Logo size={40} />
            </span>
            <span className="rail-open__icon" aria-hidden>
              <PanelLeftOpen size={22} />
            </span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className="sidebar__brand"
              onClick={onGoToChat}
              title="The Kranti Cookbook"
            >
              <Logo size={40} />
            </button>
            <button
              type="button"
              className="icon-btn sidebar__toggle"
              onClick={onToggleCollapsed}
              aria-expanded
              aria-label={overlay ? "Close menu" : "Collapse sidebar"}
              title={overlay ? "Close menu" : "Collapse sidebar"}
            >
              {overlay ? <X size={19} aria-hidden /> : <PanelLeft size={19} aria-hidden />}
            </button>
          </>
        )}
      </div>

      <div className="sidebar__scroll">
        <button type="button" className="new-chat" onClick={onNewConversation}>
          <SquarePen size={19} className="new-chat__icon" aria-hidden />
          <span className="side-item__text">New Chat</span>
        </button>

        <nav className="side-group side-group--recent" aria-label="Recent conversations">
          {/* The heading is the control: the chevron the comp draws next to
              "Recents" folds the list away. A real <button> inside the <h2>
              keeps the heading in the document outline while making the whole
              row clickable and announceable as expandable. */}
          <h2 className="side-group__label">
            <button
              type="button"
              className="side-group__toggle"
              onClick={() => setRecentsOpen((open) => !open)}
              aria-expanded={recentsOpen}
              aria-controls="recents-list"
            >
              Recents
              <ChevronDown size={15} className="side-group__chevron" aria-hidden />
            </button>
          </h2>
          {/* Unlabelled rows are meaningless at 76px, so the list is dropped
              from the icon rail entirely. */}
          {!collapsed &&
            recentsOpen &&
            (recent.length === 0 ? (
              <p className="side-empty">Nothing yet. Name a dish to begin.</p>
            ) : (
              <ul className="side-list" id="recents-list">
                {recent.map((c) => (
                  <li key={c.id} className="side-row">
                    <button
                      type="button"
                      className="side-item"
                      data-active={c.id === currentId || undefined}
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
        </ul>
      </div>
    </aside>
  );
}
