"use client";

import {
  animate,
  domAnimation,
  LazyMotion,
  m,
  MotionConfig,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { trackClient } from "@/lib/analytics";
import {
  moveTo,
  SIZE,
  slotFor,
  slotOffset,
  slotPoint,
  SOCIALS,
  SPAN,
  type DockAxis,
  type Network,
} from "@/lib/social";

/**
 * The home screen's social links — Instagram, YouTube, X — in a dock that is
 * also a reorderable list.
 *
 * Adapted from the "Reorder list" block (`Arrange`) of Bencho's Liquid
 * studies, MIT licensed — bencho.dev/licence. The comments carried over with
 * its code are Bencho's and say why its numbers are what they are. What
 * changed for icons:
 *
 * - The rows were people: a face, a name, a presence dot. Here they are the
 *   three icons in `public/brand/social/`, which stand where Bencho's
 *   `AVATARS` stub stood. The goo's opaque layer is the icons' orange
 *   circles; the unfiltered layer above it is the icons themselves.
 * - The list runs on either axis — a column while the rail is open, a row
 *   while it is closed; `Chat.tsx` decides — and the flip rides the same
 *   spring that carries an icon to its slot.
 * - Every row is a link. A press becomes a drag only past `SLOP` pixels, and
 *   the click that ends a drag is cancelled, so a tap still opens the page.
 * - Bencho's `useTokens` probe stays behind. It resolves tokens to rgb for
 *   Framer when a theme or fill flips; this site has one theme, and the
 *   dock's two colours change on a CSS transition instead.
 */

/* ── inlined from lab/motionkit ──────────────────────── */
/* ══ liquid ═══════════════════════════════════════════════
   Shared parts for the Framer Motion layer: one spring, one
   goo filter, one velocity→skew binding.

   ── why the filter is a hook ────────────────────────────
   The filter is embedded in each component's own return, but
   its id CANNOT be a literal. Every block here renders twice
   at once — once in the wall card, once in the detail overlay
   — and duplicate SVG ids do not scope, they collide: the
   second instance silently steals the first one's filter.
   useId() gives each mount its own name.

   ── what the goo can and cannot do ──────────────────────
   This is feGaussianBlur + feColorMatrix, not a shader. The
   matrix multiplies alpha by `cut` and subtracts half of it,
   so alpha below 0.5 lands on zero and everything above 0.536
   is fully opaque. That hard edge is what fuses nearby shapes
   into one blob — and it is also why this must never touch
   text: glyph antialiasing lives entirely below 0.5, so type
   under this filter loses its edges and then itself. */

/* the elastic, as specified: ζ = 14 / (2·√(220·0.5)) ≈ 0.67,
   so it overshoots about 6% before it settles. A deliberate
   bounce, not a wobble. */
const LIQUID = {
  type: "spring" as const,
  stiffness: 220,
  damping: 14,
  mass: 0.5,
};

function useGoo(blur = 7, cut = 28) {
  /* useId yields ":r0:" — legal in an id attribute but not in
     a url(#…) reference, so strip the colons. */
  const id = `goo-${useId().replace(/:/g, "")}`;
  const goo = (
    <svg className="liq-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id={id}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="smear" />
          <feColorMatrix
            in="smear"
            type="matrix"
            values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${cut} ${-(cut / 2)}`}
          />
        </filter>
      </defs>
    </svg>
  );
  return { id, url: `url(#${id})`, goo };
}

/* ── the shared constraint ───────────────────────────────
   Everything on a filtered layer must be OPAQUE. The goo
   filter thresholds alpha, so a translucent fill under it
   disappears. That is why each of these has two layers: an
   opaque blob layer that carries the filter, and an unfiltered
   layer above it carrying the text — antialiased type would
   be eaten by the same threshold. */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* how much a flung row deforms, 0..100 */
const GIVE = 50;
/* how far it tilts into the throw, 0..100 */
const LEAN = 18;

/* Under this many pixels of travel a press is a click and the link opens;
   past it the press is a drag. For a mouse, four is above its jitter on a
   click and half the 8px gap between icons. */
const SLOP = 4;
/* a fingertip wobbles further than a mouse on a tap, and browsers allow it
   about 10px before a tap stops being a tap */
const TOUCH_SLOP = 10;

/* The held swell. Bencho widens a held pill by 12px; a circle swells
   instead. 36 × 1.22 is a 44px blob under a 36 × 1.06 = 38px icon, so the
   icon in your hand wears a 3px halo in `--lift`. At rest the blob is a
   touch smaller than its icon, so the goo's hard, unantialiased edge always
   sits under the image's soft one rather than showing as a stepped ring. */
const HELD_BLOB = 1.22;
const REST_BLOB = 0.94;
const HELD_ICON = 1.06;

/* the transforms an icon not in your hand rests at */
const FLAT = { scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 };

const noSubscribe = () => () => {};

/**
 * Mounted after hydration, never on the server. The rail's collapsed state
 * lives in localStorage, so the server renders the rail open and the client
 * corrects it on hydration — and the dock reads its starting positions once,
 * from the first axis it sees. Rendered on the server, a reader whose rail is
 * closed would watch the column spring into a row on every load. Rendered
 * after, the first axis is the true one, and the icons scale in from nothing
 * on the same spring.
 */
export function SocialDock({ axis, className }: { axis: DockAxis; className: string }) {
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  return client ? <Dock axis={axis} className={className} /> : null;
}

/* ══ 2 · Arrange ══════════════════════════════════════════
   A reorderable list where the row you hold is free — nothing
   clamps it to a rail. Only its height decides where the list
   opens, and that reading is what gets clamped.

   The rows are rendered ONCE in a fixed DOM order and moved by
   transform, so .arr-row[3] is whoever was fourth in the data,
   not whoever is fourth on screen. The catalog's demo script
   depends on exactly that. */
/* Here the fixed order matters for a second reason: the icon in
   your hand holds pointer capture, and a DOM node that React
   moves to reorder a list is removed and reinserted, which
   drops the capture mid-drag. */
function Dock({ axis, className }: { axis: DockAxis; className: string }) {
  /* visual order, as data indices. The ONLY thing here that is
     React state — everything that moves is a motion value, so a
     drag re-renders when the order changes and not before. */
  const [order, setOrder] = useState<number[]>(() => SOCIALS.map((_, i) => i));
  const [held, setHeld] = useState<number | null>(null);

  /* a press that has not yet travelled SLOP, and the drag it becomes */
  const press = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const grab = useRef<{ id: number; from: number; slot: number; last: number; at: number } | null>(null);
  /* Set when a press became a drag, so the click that ends it is cancelled.
     Cleared on the next press, so a drag whose click never came — a lost
     capture, a cancelled touch — cannot swallow the next real click. */
  const dragged = useRef(false);
  const stage = useRef<HTMLElement | null>(null);

  /* ── 2.6, down from 3.6 ──────────────────────────────────
     The blur is what fuses two rows, and it is also why the
     gaps did not read as equal. A threshold on summed alpha
     means the DRAWN edge of a row depends on how much
     neighbouring mass is inside its blur — and the two middle
     rows have a neighbour on each side where the top and
     bottom have one. Same geometry, measured identical to
     three decimals in both the overlay and the wall; different
     result on screen.

     At 3.6 the 6px gap was 1.7 blur radii, which is well
     inside the range where a neighbour contributes. At 2.6 it
     is 2.3, and the tail arriving from the far side is a
     fraction of what it was — so the end rows and the middle
     rows neck by amounts much closer together.

     Not lower, and not the pitch instead. The fusing IS this
     component: rows passing each other during a drag come far
     closer than 6px, and that is the moment the goo exists
     for. Softening it keeps that and quietens the resting
     state; opening the pitch would have cost the fusing at
     every distance. The threshold is untouched at 28 so this
     changes one thing. */
  /* Here the resting gap is 8px, 3.1 blur radii, so icons at rest do not
     neck at all; they fuse when a drag or the row↔column flip brings them
     closer. */
  const { url: gooUrl, goo } = useGoo(2.6, 28);

  const reduced = useReducedMotion();

  /* One motion value per row, declared flat rather than mapped:
     four names is uglier than a loop and cannot get the hook
     order wrong if PEOPLE ever changes length. */
  /* Three pairs here, one per icon and axis, started at their slots on the
     axis the dock mounts with. `check-social-dock.ts` pins SOCIALS at three
     so a fourth icon cannot ship without a fourth pair. */
  const x0 = useMotionValue(slotPoint(axis, 0).x), y0 = useMotionValue(slotPoint(axis, 0).y);
  const x1 = useMotionValue(slotPoint(axis, 1).x), y1 = useMotionValue(slotPoint(axis, 1).y);
  const x2 = useMotionValue(slotPoint(axis, 2).x), y2 = useMotionValue(slotPoint(axis, 2).y);
  const xs = useMemo(() => [x0, x1, x2], [x0, x1, x2]);
  const ys = useMemo(() => [y0, y1, y2], [y0, y1, y2]);

  /* the throw, as a value rather than as state — this changes on
     every pointermove and must not cost a render */
  const vel = useMotionValue(0);
  const squash = useTransform(vel, (v) => 1 + Math.abs(v) * (GIVE / 100) * 0.12);
  const wide = useTransform(squash, (q) => 1 / q);
  const tilt = useTransform(vel, (v) => v * (LEAN / 100) * 2.6);

  /* Rows that are not in your hand spring to their slot. The
     held one is excluded: its value is being written directly
     from the pointer, and animating the same value would fight
     the finger for it. */
  /* The same effect carries the row↔column flip: a new axis is a new slot
     for every icon. Asked for less motion, it jumps instead. */
  useEffect(() => {
    const how = reduced ? { duration: 0 } : LIQUID;
    order.forEach((id, slot) => {
      if (id === held) return;
      const to = slotPoint(axis, slot);
      animate(xs[id], to.x, how);
      animate(ys[id], to.y, how);
    });
  }, [order, held, axis, reduced, xs, ys]);

  const down = (id: number) => (e: React.PointerEvent<HTMLAnchorElement>) => {
    if (grab.current || e.button !== 0) return;
    press.current = { id, x: e.clientX, y: e.clientY, t: e.timeStamp };
    dragged.current = false;
  };

  const up = () => {
    press.current = null;
    if (!grab.current) return;
    grab.current = null;
    setHeld(null);
    vel.set(0);
  };

  const move = (e: React.PointerEvent<HTMLAnchorElement>) => {
    /* No button down means the press ended somewhere this link never heard
       about — a flick off the icon, released elsewhere. Without this, the
       next hover would read the stale press and start a drag nobody holds. */
    if ((e.buttons & 1) === 0) {
      up();
      return;
    }
    let g = grab.current;
    if (!g) {
      const p = press.current;
      if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) < (e.pointerType === "mouse" ? SLOP : TOUCH_SLOP)) return;
      /* capture so a drag that wanders off the row keeps
         reporting to it. It THROWS if the id is not a live
         pointer — a synthetic event from a test or a rehearsal
         is exactly that — and it was the first statement in the
         handler, so the throw took `setHeld` and the whole grab
         down with it. The drag is perfectly usable without the
         capture; it must not be able to prevent one. */
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch { /* not a live pointer */ }
      /* measured from where the press began, not where it crossed SLOP,
         so the icon does not jump four pixels to catch up — and timed from
         then too, so the slop travel does not read as a fling */
      const from = axis === "row" ? p.x : p.y;
      /* A spring still settling on this icon — after a reorder, a release or
         a flip — would keep writing the value the pointer now owns: `set()`
         does not stop an animation, `stop()` does. */
      xs[p.id].stop();
      ys[p.id].stop();
      g = grab.current = { id: p.id, from, slot: order.indexOf(p.id), last: from, at: p.t };
      dragged.current = true;
      setHeld(p.id);
      vel.set(0);
    }

    const el = stage.current;
    /* zoom correction: the card is scaled, so a screen delta is
       not a layout delta */
    const k = el ? (el.getBoundingClientRect().width / (el.offsetWidth || 1)) || 1 : 1;
    const at = axis === "row" ? e.clientX : e.clientY;
    const d = (at - g.from) / k;

    /* THE fix for the jump. The held row is measured from the
       slot it was picked up in, never from the slot it is
       currently occupying — that one changes underneath the
       gesture as the list reorders, and reading it here made the
       row leap a full row-height at the exact moment the shuffle
       happened. Pinned to the finger means pinned to where the
       finger started. */
    (axis === "row" ? xs : ys)[g.id].set(slotOffset(g.slot) + d);

    const now = e.timeStamp;
    const dt = Math.max(8, now - g.at);
    vel.set(clamp(((at - g.last) / k / dt) * 16, -3, 3));
    g.last = at;
    g.at = now;

    /* where the row's own height says it belongs — this reading
       is clamped, the row itself is not */
    const want = slotFor(g.slot, d);
    if (want !== order.indexOf(g.id)) {
      const id = g.id;
      /* a detent: the one moment in the drag with a real event
         in it, so it gets the dry click rather than the slide */
      setOrder((o) => moveTo(o, id, want));
    }
  };

  const click = (network: Network) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (dragged.current) {
      dragged.current = false;
      e.preventDefault();
      return;
    }
    trackClient("social_clicked", { network });
  };

  /* A key press is never the end of a drag, so whatever a lost drag left in
     `dragged` must not cancel the click Enter is about to make. With a drag
     live, though, a key pressed mid-drag (Shift, say) must not un-cancel the
     closing click of that drag. */
  const keyed = () => {
    if (!grab.current) dragged.current = false;
  };

  /* stretched along the throw, narrowed across it, leaning into it — the
     axis decides which of the two is the throw */
  const deform =
    axis === "row"
      ? { scaleX: squash, scaleY: wide, skewX: tilt }
      : { scaleX: wide, scaleY: squash, skewY: tilt };

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <nav
          ref={stage}
          aria-label="Kranti Cookbook on social media"
          className={`dock ${className}`}
          data-axis={axis}
          style={{ "--span": `${SPAN}px`, "--size": `${SIZE}px` } as React.CSSProperties}
        >
          {goo}

          {/* the opaque layer that fuses */}
          <div className="dock__blobs" aria-hidden="true" style={{ filter: gooUrl }}>
            {SOCIALS.map((s, i) => {
              const isHeld = held === i;
              return (
                <m.span
                  key={s.network}
                  className="dock__blob"
                  data-held={isHeld || undefined}
                  style={{ x: xs[i], y: ys[i] }}
                  initial={{ scale: 0 }}
                  animate={{ scale: isHeld ? HELD_BLOB : REST_BLOB }}
                  transition={LIQUID}
                >
                  <m.span className="dock__skin" style={isHeld && !reduced ? deform : FLAT} />
                </m.span>
              );
            })}
          </div>

          {/* and the unfiltered layer that carries the icons */}
          <div className="dock__ink">
            {SOCIALS.map((s, i) => {
              const isHeld = held === i;
              return (
                <m.a
                  key={s.network}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="dock__link"
                  data-held={isHeld || undefined}
                  draggable={false}
                  style={{ x: xs[i], y: ys[i] }}
                  initial={{ scale: 0 }}
                  animate={{ scale: isHeld ? HELD_ICON : 1 }}
                  transition={LIQUID}
                  onPointerDown={down(i)}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  onLostPointerCapture={up}
                  onClick={click(s.network)}
                  onKeyDown={keyed}
                >
                  {/* draggable={false} is load-bearing: an <img> is
                      natively draggable, so pressing the face began
                      an HTML5 drag, which cancels the pointer
                      sequence outright — the row simply would not
                      pick up if you happened to grab it there. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- a 36px SVG served as is; next/image has nothing to optimise */}
                  <img src={s.icon} alt="" width={SIZE} height={SIZE} draggable={false} />
                </m.a>
              );
            })}
          </div>
        </nav>
      </MotionConfig>
    </LazyMotion>
  );
}
