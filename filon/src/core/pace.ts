// pace.ts — frame pacing under a cap (D100): which of the browser's animation frames to draw. The
// browser calls back at the display's rate (60 Hz, 120 Hz on a ProMotion screen, 144 Hz…); under a
// cap of `fps` a frame is drawn once at least 1000 / fps ms have passed since the last one drawn,
// less a little slack, so a 30 fps cap draws every other frame of a 60 Hz display and every fourth of
// a 120 Hz one instead of drifting between the two; and between two frames drawn it says how long to
// wait before asking the browser for the next one (`wait`), so the frames skipped are never asked
// for. Pure: the shell's loop (main.ts) asks it.

/** Slack (ms) under the interval: callbacks of a 60 Hz display land 16.7 ms apart, give or take a millisecond or two. */
const SLACK_MS = 3;
/** How far ahead of a due frame the browser is asked for one: more than a 60 Hz display's frame, so the due one is never missed. */
const LEAD_MS = 20;

export class FramePacer {
  private last = -Infinity;

  /** Draw a frame at `now` (ms) under a cap of `fps` (0: no cap, every frame)? It remembers the frames it lets through. */
  due(now: number, fps: number): boolean {
    if (fps > 0 && now - this.last < 1000 / fps - SLACK_MS) return false;
    this.last = now;
    return true;
  }

  /**
   * How long (ms) to wait at `now` before asking the browser for the next frame under a cap of `fps`:
   * up to about a display frame (`LEAD_MS`) before the next one is due, so the frames in between are
   * never asked for — the browser's frame pipeline then rests instead of waking at the display's rate
   * for nothing. 0: ask at once (no cap, or due soon).
   */
  wait(now: number, fps: number): number {
    if (fps <= 0 || this.last === -Infinity) return 0;
    return Math.max(0, this.last + 1000 / fps - SLACK_MS - LEAD_MS - now);
  }

  /** Forget the last frame (the next one is drawn whatever the cap). */
  reset(): void {
    this.last = -Infinity;
  }
}
