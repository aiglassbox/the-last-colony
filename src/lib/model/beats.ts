/**
 * Incremental parser for the §BEAT§ markers the model emits.
 *
 * The card renders as the model writes, so this has to work on partial text: a
 * marker can arrive split across two deltas ("§VER" then "DICT§"), and text
 * must not be attributed to a beat until its marker has closed. The parser
 * holds back any tail that could still turn out to be the start of a marker.
 *
 * Generalised over the marker set so a restoration turn and a Tier-3
 * Indianisation turn can each parse their own beats with the same partial-safe
 * logic — the only difference is which markers they recognise.
 */

export const BEATS = ["VERDICT", "THEN", "WHAT_CHANGED", "RESTORE_TODAY"] as const;
export type Beat = (typeof BEATS)[number];

/** Tier-3 Indianisation card beats. */
export const INDIANIZE_BEATS = ["VERDICT", "REBUILD", "SWAPS", "PLATE"] as const;
export type IndianizeBeat = (typeof INDIANIZE_BEATS)[number];

export interface BeatDelta {
  beat: string;
  text: string;
}

/** The public surface the route streams through, regardless of marker set. */
export interface StreamingParser {
  push(chunk: string): BeatDelta[];
  end(): BeatDelta[];
}

export class MarkerParser<B extends string> implements StreamingParser {
  private buffer = "";
  private current: B | null = null;
  private readonly markers: string[];
  private readonly maxMarker: number;

  constructor(private readonly beats: readonly B[]) {
    this.markers = beats.map((b) => `§${b}§`);
    this.maxMarker = Math.max(...this.markers.map((m) => m.length));
  }

  /** Feed a chunk of model text; get back whatever can be safely emitted. */
  push(chunk: string): BeatDelta[] {
    this.buffer += chunk;
    const out: BeatDelta[] = [];

    for (;;) {
      const hit = this.findMarker();

      if (hit) {
        const before = this.buffer.slice(0, hit.index);
        if (this.current && before) out.push({ beat: this.current, text: before });
        this.current = hit.beat;
        this.buffer = this.buffer.slice(hit.index + hit.length);
        continue;
      }

      // No complete marker. Emit everything except a tail that might still
      // become one, so "§VER" is never rendered as literal text.
      const safeUpTo = this.buffer.length - this.holdBack();
      if (safeUpTo > 0 && this.current) {
        out.push({ beat: this.current, text: this.buffer.slice(0, safeUpTo) });
      }
      if (safeUpTo > 0) this.buffer = this.buffer.slice(safeUpTo);
      break;
    }

    return out.filter((d) => d.text.length > 0);
  }

  /** Flush whatever is left once the stream ends. */
  end(): BeatDelta[] {
    if (this.current && this.buffer) {
      const out: BeatDelta[] = [{ beat: this.current, text: this.buffer }];
      this.buffer = "";
      return out;
    }
    this.buffer = "";
    return [];
  }

  private findMarker(): { beat: B; index: number; length: number } | null {
    let best: { beat: B; index: number; length: number } | null = null;
    for (let i = 0; i < this.markers.length; i++) {
      const index = this.buffer.indexOf(this.markers[i]);
      if (index !== -1 && (!best || index < best.index)) {
        best = { beat: this.beats[i], index, length: this.markers[i].length };
      }
    }
    return best;
  }

  /** How many trailing characters could still be the head of a marker. */
  private holdBack(): number {
    const tail = this.buffer.slice(-this.maxMarker);
    for (let n = Math.min(tail.length, this.maxMarker); n > 0; n--) {
      const candidate = tail.slice(tail.length - n);
      if (this.markers.some((m) => m.startsWith(candidate))) return n;
    }
    return 0;
  }
}

/** Restoration turn parser — the original four beats. */
export class BeatParser extends MarkerParser<Beat> {
  constructor() {
    super(BEATS);
  }
}
