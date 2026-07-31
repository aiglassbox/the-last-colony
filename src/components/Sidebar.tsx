"use client";

import { History, MessageCircle, Moon, PanelLeft, Plus, Settings, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

import type { Conversation } from "@/lib/chat/store";
import type { Theme } from "@/lib/theme";

import { Logo } from "./Logo";

/**
 * The left rail.
 *
 * One component serves both layouts: in the flow on desktop, and as an
 * off-canvas drawer below 992px. The drawer variant takes focus, traps Escape
 * and is labelled as a dialog; the docked variant is a plain navigation
 * landmark, because a permanently visible sidebar is not a dialog.
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
  /** Rendered as an overlay drawer rather than docked in the flow. */
  asDrawer?: boolean;
  onClose?: () => void;
  /** Desktop only — hides the rail and reveals the floating opener. */
  onCollapse?: () => void;
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
  asDrawer = false,
  onClose,
  onCollapse,
}: SidebarProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!asDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [asDrawer, onClose]);

  const recent = conversations.filter((c) => c.messages.length > 0).slice(0, RECENT_LIMIT);

  return (
    <aside
      ref={ref}
      className={asDrawer ? "sidebar sidebar--drawer" : "sidebar"}
      aria-label="Sidebar"
      {...(asDrawer ? { role: "dialog" as const, "aria-modal": true } : {})}
    >
      <div className="flex items-center gap-3">
        <Logo />
        <span className="display flex-1 truncate text-[1.05rem] leading-tight">
          Swadeshi Rasooi AI
        </span>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 36, height: 36, borderRadius: 10 }}
          onClick={asDrawer ? onClose : onCollapse}
          aria-label={asDrawer ? "Close sidebar" : "Collapse sidebar"}
        >
          <PanelLeft size={18} aria-hidden />
        </button>
      </div>

      <div className="sidebar__scroll">
        <nav className="side-group" aria-label="Features">
          <h2 className="side-group__label">Features</h2>
          <ul className="m-0 list-none space-y-1 p-0">
            <li>
              <button
                type="button"
                className="side-item"
                data-active={view === "chat"}
                aria-current={view === "chat" ? "page" : undefined}
                onClick={() => onViewChange("chat")}
              >
                <MessageCircle size={18} className="side-item__icon" aria-hidden />
                <span className="side-item__text">Chat</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="side-item"
                data-active={view === "history"}
                aria-current={view === "history" ? "page" : undefined}
                onClick={() => onViewChange("history")}
              >
                <History size={18} className="side-item__icon" aria-hidden />
                <span className="side-item__text">History</span>
              </button>
            </li>
          </ul>
        </nav>

        <nav className="side-group" aria-label="Recent conversations">
          <h2 className="side-group__label">Recent</h2>
          {recent.length === 0 ? (
            <p className="m-0 px-4 text-sm text-[var(--ink-muted)]">
              Nothing yet. Name a dish to begin.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-1 p-0">
              {recent.map((c) => (
                <li key={c.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    className="side-item flex-1"
                    data-active={c.id === currentId && view === "chat"}
                    onClick={() => onSelectConversation(c.id)}
                  >
                    <span className="side-item__text">{c.title}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    style={{ width: 32, height: 32, border: 0 }}
                    onClick={() => onDeleteConversation(c.id)}
                    aria-label={`Delete conversation: ${c.title}`}
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="side-item mt-1"
            onClick={onNewConversation}
            style={{ color: "var(--orange)" }}
          >
            <Plus size={18} className="side-item__icon" style={{ color: "var(--orange)" }} aria-hidden />
            <span className="side-item__text">New restoration</span>
          </button>
        </nav>
      </div>

      <div className="side-group mb-0 border-t border-[var(--line)] pt-4">
        <h2 className="side-group__label">Others</h2>
        <ul className="m-0 list-none space-y-1 p-0">
          <li>
            <button type="button" className="side-item" onClick={onOpenSettings}>
              <Settings size={18} className="side-item__icon" aria-hidden />
              <span className="side-item__text">Setting</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="side-item"
              onClick={onToggleTheme}
              role="switch"
              aria-checked={theme === "dark"}
            >
              <Moon size={18} className="side-item__icon" aria-hidden />
              <span className="side-item__text flex-1">Dark Mode</span>
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
