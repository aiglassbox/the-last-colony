"use client";

import {
  History,
  MessageCircle,
  PanelLeft,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";

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
 * There is no hamburger anywhere: the rail is always on screen, and the toggle
 * that collapses it is the same control that brings it back.
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
  /** The wordmark doubles as the way back to the chat. */
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

  const className = [
    "sidebar",
    collapsed ? "sidebar--collapsed" : "",
    overlay ? "sidebar--overlay" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside ref={ref} className={className} aria-label="Sidebar">
      <div className="sidebar__head">
        {collapsed && !overlay ? (
          /* Collapsed, the rail shows only the mark. Pointing at it swaps the
             mark for the expand icon in the same square, so the one thing on
             screen is also the control and nothing competes with it for a
             76px column. On touch, where there is no hover, the mark stays and
             the tap expands. */
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
            {/* The logo is the way home, as it is on every product where it is
                a control. The lockup already reads "The Kranti Cookbook", so
                the accessible name sits on the button rather than in text
                beside it. */}
            <button
              type="button"
              className="sidebar__brand"
              onClick={onGoToChat}
              aria-label="Kranti Cookbook"
              title="Kranti Cookbook"
            >
              <Logo size={34} />
            </button>
            {/* Floating over the stage, this control dismisses rather than
                collapses — so it reads as a close, not a resize. */}
            <button
              type="button"
              className="icon-btn sidebar__toggle"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={overlay ? "Close menu" : "Collapse sidebar"}
              title={overlay ? "Close menu" : "Collapse sidebar"}
            >
              {overlay ? <X size={19} aria-hidden /> : <PanelLeft size={18} aria-hidden />}
            </button>
          </>
        )}
      </div>

      <div className="sidebar__scroll">
        <nav className="side-group" aria-label="Features">
          <h2 className="side-group__label">Features</h2>
          <ul className="side-list">
            <li>
              <SideItem
                label="Chat"
                icon={<MessageCircle size={18} className="side-item__icon" aria-hidden />}
                active={view === "chat"}
                collapsed={collapsed}
                onClick={() => onViewChange("chat")}
                current
              />
            </li>
            <li>
              <SideItem
                label="History"
                icon={<History size={18} className="side-item__icon" aria-hidden />}
                active={view === "history"}
                collapsed={collapsed}
                onClick={() => onViewChange("history")}
                current
              />
            </li>
          </ul>
        </nav>

        <nav className="side-group side-group--recent" aria-label="Recent conversations">
          <h2 className="side-group__label">Recent</h2>
          {/* Unlabelled history rows are meaningless at 76px, so the list is
              dropped from the icon rail — creating a new one is not. */}
          {!collapsed &&
            (recent.length === 0 ? (
              <p className="side-empty">Nothing yet. Name a dish to begin.</p>
            ) : (
              <ul className="side-list">
                {recent.map((c) => (
                  <li key={c.id} className="side-row">
                    <SideItem
                      label={c.title}
                      active={c.id === currentId && view === "chat"}
                      collapsed={false}
                      onClick={() => onSelectConversation(c.id)}
                    />
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
          <SideItem
            label="New restoration"
            icon={<Plus size={18} className="side-item__icon" aria-hidden />}
            collapsed={collapsed}
            onClick={onNewConversation}
            accent
          />
        </nav>
      </div>

      <div className="side-group side-group--others">
        <h2 className="side-group__label">Others</h2>
        <ul className="side-list">
          <li>
            <SideItem
              label="Setting"
              icon={<Settings size={18} className="side-item__icon" aria-hidden />}
              collapsed={collapsed}
              onClick={onOpenSettings}
            />
          </li>
        </ul>
      </div>
    </aside>
  );
}

function SideItem({
  label,
  icon,
  active,
  collapsed,
  onClick,
  accent,
  current,
}: {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  collapsed: boolean;
  onClick: () => void;
  accent?: boolean;
  current?: boolean;
}) {
  return (
    <button
      type="button"
      className="side-item"
      data-active={active ? "true" : undefined}
      aria-current={current && active ? "page" : undefined}
      onClick={onClick}
      /* The label is still rendered and still read out when collapsed — it is
         only clipped visually — so `title` adds a pointer hint without being
         the sole source of the accessible name. */
      title={collapsed ? label : undefined}
      /* The rail is the one cream surface in the design, and `--orange` is an
         alias for cream — right on the painted ground, invisible here. The CTA
         red is the accent that reads against beige. */
      style={accent ? { color: "var(--red)" } : undefined}
    >
      {icon}
      <span className="side-item__text">{label}</span>
    </button>
  );
}
