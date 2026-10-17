// cues.ts — how the sound cues behave, pure: which ones are generic UI feedback, which answer a
// moment, their priority, how often they may play, their trim, and their measured peak. The shell
// queues the cues of a frame and `arbitrate` keeps what the ear should get: when a specific cue
// (a placement, a refusal, a quest done…) answers the same moment as generic ones (the button
// click that caused it, the toast that reports it), the generic ones drop; otherwise the most
// important generic one plays. Duplicates merge (their counts add up). `RateLimiter` then spaces
// each cue (a burst of toasts does not machine-gun), and `ribbonTicks` spreads one soft tick per
// ribbon tile laid, capped. The recipes themselves are in sfx.ts.
import type { SfxCue } from '@/core/bus';

export interface CueSpec {
  /** Generic UI feedback (a click, a tab, a toast): gives way to a specific cue in the same frame. */
  readonly generic: boolean;
  /** Does it answer the moment (generic cues of the same frame drop)? Ambient cues do not. */
  readonly covers: boolean;
  /** Among the generic cues of one frame, the highest plays. */
  readonly prio: number;
  /** Least time between two plays of this cue (ms). */
  readonly gapMs: number;
  /** Trim applied to the recipe (dB): the per-cue level knob. */
  readonly trimDb: number;
  /**
   * Peak measured at full sliders, alone, through the master chain (dBFS; the offline check in
   * docs/audio.md). Every cue stays under −6 dBFS; update it when a recipe or its trim changes.
   */
  readonly peakDb: number;
}

const ui = (prio: number, gapMs: number, trimDb: number, peakDb: number): CueSpec => ({ generic: true, covers: false, prio, gapMs, trimDb, peakDb });
const act = (gapMs: number, trimDb: number, peakDb: number, covers = true): CueSpec => ({ generic: false, covers, prio: 10, gapMs, trimDb, peakDb });

export const CUES: Record<SfxCue, CueSpec> = {
  click: ui(1, 45, 4, -20),
  select: ui(1, 60, 6, -23),
  tab: ui(2, 60, 5, -21),
  'toast.info': ui(3, 150, 3, -23),
  'toast.good': ui(4, 150, 2, -20),
  'toast.warn': ui(5, 150, 5, -19),
  'toast.bad': ui(6, 150, 2, -17),
  open: act(120, 2.5, -16),
  close: act(120, 2.5, -16),
  view: act(250, 8, -26),
  place: act(60, 1, -11),
  ribbon: act(0, 4.5, -17),
  demolish: act(120, 5, -18),
  refused: act(200, 3, -11),
  mark: act(120, 8, -24),
  link: act(100, 3, -15),
  unlink: act(100, 6, -13),
  research: act(800, 2, -10),
  quest: act(1500, 2.5, -12),
  sale: act(150, 7, -16),
  purchase: act(150, 7, -15),
  lift: act(15000, 0, -25, false),
  delivered: act(1000, 2, -16),
  notice: act(2000, 8, -19),
  vein: act(400, 3, -17),
};

export interface QueuedCue { cue: SfxCue; n: number }

/**
 * The cues of one frame, as they should play: duplicates merged (counts summed), generic cues
 * dropped when a covering cue is there, else only the highest-priority generic one kept.
 * Specific cues keep their first-come order. `covered`: something else answers the moment (a
 * building's signature, D120), so the generic cues drop as well.
 */
export function arbitrate(batch: readonly QueuedCue[], covered = false): QueuedCue[] {
  const merged = new Map<SfxCue, QueuedCue>();
  for (const q of batch) {
    const m = merged.get(q.cue);
    if (m) m.n += q.n;
    else merged.set(q.cue, { cue: q.cue, n: q.n });
  }
  const all = [...merged.values()];
  const specific = all.filter((q) => !CUES[q.cue].generic);
  if (covered || specific.some((q) => CUES[q.cue].covers)) return specific;
  let top: QueuedCue | null = null;
  for (const q of all) if (CUES[q.cue].generic && (!top || CUES[q.cue].prio > CUES[top.cue].prio)) top = q;
  return top ? [...specific, top] : specific;
}

/** Spaces each cue: a cue plays only if its gap has passed since it last played. */
export class RateLimiter {
  private readonly last = new Map<SfxCue, number>();

  /** May `cue` play at time `now` (seconds)? Records it when it may. */
  allow(cue: SfxCue, now: number): boolean {
    const prev = this.last.get(cue);
    if (prev !== undefined && now - prev < CUES[cue].gapMs / 1000 - 1e-9) return false;
    this.last.set(cue, now);
    return true;
  }
}

/** At most this many ticks for one ribbon drag, however long. */
export const MAX_RIBBON_TICKS = 14;

/**
 * Offsets (s) of the soft ticks for `n` ribbon tiles laid: one per tile up to the cap, 30–60 ms
 * apart (a short drag ticks slowly, a long one runs), never closer than 30 ms.
 */
export function ribbonTicks(n: number): number[] {
  const k = Math.max(1, Math.min(MAX_RIBBON_TICKS, Math.floor(n)));
  const gap = Math.min(0.06, Math.max(0.03, 0.42 / k));
  return Array.from({ length: k }, (_, i) => i * gap);
}
