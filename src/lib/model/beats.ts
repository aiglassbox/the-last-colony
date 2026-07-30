/**
 * Incremental parser for the §BEAT§ markers the model emits.
 *
 * The card renders as the model writes, so this has to work on partial text: a
 * marker can arrive split across two deltas ("§VER" then "DICT§"), and text
 * must not be attributed to a beat until its marker has closed. The parser
 * holds back any tail that could still turn out to be the start of a marker.
 */

export const BEATS = ["VERDICT", "THEN", "WHAT_CHANGED", "RESTORE_TODAY"] as const;
export type Beat = (typeof BEATS)[number];

const MARKERS = BEATS.map((b) => `§${b}§`);
/** Longest prefix we might have to hold back while a marker is still arriving. */
const MAX_MARKER = Math.max(...MARKERS.map((m) => m.length));

export interface BeatDelta {
  beat: Beat;
  text: string;
}

export class BeatParser {
  private buffer = "";
  private current: Beat | null = null;

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
      const out = [{ beat: this.current, text: this.buffer }];
      this.buffer = "";
      return out;
    }
    this.buffer = "";
    return [];
  }

  private findMarker(): { beat: Beat; index: number; length: number } | null {
    let best: { beat: Beat; index: number; length: number } | null = null;
    for (let i = 0; i < MARKERS.length; i++) {
      const index = this.buffer.indexOf(MARKERS[i]);
      if (index !== -1 && (!best || index < best.index)) {
        best = { beat: BEATS[i], index, length: MARKERS[i].length };
      }
    }
    return best;
  }

  /** How many trailing characters could still be the head of a marker. */
  private holdBack(): number {
    const tail = this.buffer.slice(-MAX_MARKER);
    for (let n = Math.min(tail.length, MAX_MARKER); n > 0; n--) {
      const candidate = tail.slice(tail.length - n);
      if (MARKERS.some((m) => m.startsWith(candidate))) return n;
    }
    return 0;
  }
}
