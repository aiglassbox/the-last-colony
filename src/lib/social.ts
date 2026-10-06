/**
 * The home screen's social links, and the geometry of the dock that holds
 * them (`components/SocialDock.tsx`).
 *
 * Kept out of the component so the order, the hrefs and the slot arithmetic
 * can be checked without a DOM — `scripts/check-social-dock.ts`.
 */

export type Network = "instagram" | "youtube" | "x";

export interface Social {
  network: Network;
  /** The link's accessible name; the icon itself is decorative. */
  label: string;
  href: string;
  icon: string;
}

/** The order the dock starts in. A drag reorders it until reload, never here. */
export const SOCIALS: readonly Social[] = [
  {
    network: "instagram",
    label: "Kranti Cookbook on Instagram",
    href: "https://www.instagram.com/kranticookbook/",
    icon: "/brand/social/instagram.svg",
  },
  {
    network: "youtube",
    label: "Kranti Cookbook on YouTube",
    href: "https://www.youtube.com/channel/UCOoB6U474PW5jpidGElnJcg",
    icon: "/brand/social/youtube.svg",
  },
  {
    network: "x",
    label: "Kranti Cookbook on X",
    href: "https://x.com/kranticookbook",
    icon: "/brand/social/x.svg",
  },
];

/** An icon's diameter, and the pitch the icons sit at: an 8px gap. */
export const SIZE = 36;
export const STEP = 44;

/** A row's width, and a column's height. */
export const SPAN = STEP * (SOCIALS.length - 1) + SIZE;

export type DockAxis = "row" | "column";

/**
 * Where a slot sits, measured back from the dock's bottom-right corner.
 *
 * From the corner, not the start, because the corner is the one point a row
 * and a column share. The dock is pinned there, so when it flips the last
 * icon stays where it is and the others swing round it — and their paths pass
 * close enough on the way for the goo to fuse them.
 */
export function slotOffset(slot: number): number {
  return -(SOCIALS.length - 1 - slot) * STEP;
}

export function slotPoint(axis: DockAxis, slot: number): { x: number; y: number } {
  return axis === "row" ? { x: slotOffset(slot), y: 0 } : { x: 0, y: slotOffset(slot) };
}

/** `order` with `id` lifted out and set down at `slot`, clamped to the list. */
export function moveTo(order: readonly number[], id: number, slot: number): number[] {
  const next = order.filter((x) => x !== id);
  next.splice(Math.min(Math.max(slot, 0), next.length), 0, id);
  return next;
}
