// sequencer.ts — the score's clock, pure: a look-ahead scheduler on the audio clock. The shell
// calls it every frame with the audio time; it hands back the eighth-note steps that start within
// the look-ahead window, each with its exact audio time, so Web Audio plays them sample-accurately
// however irregular the frames are. The tempo may change between calls (it follows the time of
// day): each step's length is the one in force when it is reached. When the clock jumps ahead of
// the grid (a long hitch), the missed steps are skipped — counted, never played late in a burst —
// so the bar lines stay where they were.

/** One step to play: its index (bars are 8 steps) and its audio time (s). */
export interface Tick { i: number; t: number }

export class Sequencer {
  /** Audio time of the next step (s); negative until the first call. */
  next = -1;
  /** Index of the next step. */
  index = 0;

  /**
   * @param lookahead how far ahead steps are handed out (s): longer than any frame gap we expect.
   * @param lead where the very first step lands after the first call (s).
   */
  constructor(readonly lookahead = 0.35, readonly lead = 0.08) {}

  /** The steps starting in [now, now + lookahead), each once, at `stepDur` seconds apart. */
  due(now: number, stepDur: number, out: Tick[] = []): Tick[] {
    const d = Math.max(0.02, stepDur);
    if (this.next < 0) this.next = now + this.lead;
    if (this.next < now) {
      const k = Math.ceil((now - this.next) / d);
      this.next += k * d;
      this.index += k;
    }
    while (this.next < now + this.lookahead) {
      out.push({ i: this.index, t: this.next });
      this.next += d;
      this.index++;
    }
    return out;
  }

  /** Start over (the next call starts a fresh grid). */
  reset(): void {
    this.next = -1;
    this.index = 0;
  }
}
