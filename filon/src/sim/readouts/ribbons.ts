// readouts/ribbons.ts — what the Logistique view shows (D88): each ribbon line's throughput against
// what it can carry (a plain ribbon 60 items a minute, a swift one 120: its tier's pace), as a
// heat; the lines that jam (an item stuck at the head, nothing taking it) and the dead ends (a
// head that hands on to nothing). Read from the sim, never changing it.
//
// Throughput is what entered a chain (`Chain.pushedTotal`, carried over a recompile when the
// chain is the same) over the last `SPAN` ticks or so: `RibbonSampler` keeps two samples a chain,
// the older one `SPAN` to 2 × `SPAN` ticks back, so the figure is a few seconds' average and never
// blinks with the ribbon's step. A catch-up or a swapped colony starts the samples afresh.
import type { Chain } from '../flow/chain';
import type { Sim } from '../state';

/** Ticks a throughput figure averages over (at least; at most twice that). */
export const SPAN = 100;
/** A line's head holding the same item this many of its steps: it jams. */
export const JAM_STEPS = 4;
/** Utilisation ‰ from which a line counts as full. */
export const FULL = 900;

export interface RibbonLook {
  chain: Chain;
  /** Items a minute it can carry (its tier's pace). */
  perMin: number;
  /** Throughput ‰ of `perMin` (−1: not sampled long enough yet). */
  util: number;
  /** Cells holding an item, ‰ of the line. */
  fill: number;
  /** Its head holds an item nothing takes. */
  jam: boolean;
  /** Its head hands on to nothing. */
  dead: boolean;
}

export interface RibbonSummary { lines: number; full: number; jams: number; dead: number; idle: number }

interface Sample { tick: number; mu: number }

const keyOf = (c: Chain): string => `${c.tier}:${c.tiles[0]}:${c.tiles.length}`;

/** Each line's throughput, sampled over a few seconds of game time. */
export class RibbonSampler {
  private readonly old = new Map<string, Sample>();
  private readonly mid = new Map<string, Sample>();
  private of: Sim | null = null;
  private lastTick = -1;

  /** Take the samples only (cheap: no reading made), so a line's figure is ready when the view opens. */
  sample(sim: Sim): void {
    this.pass(sim, null);
  }

  /** Read every line of the colony now (call at the view's pace; it samples as the ticks go by). */
  read(sim: Sim): RibbonLook[] {
    const out: RibbonLook[] = [];
    this.pass(sim, out);
    return out;
  }

  private pass(sim: Sim, out: RibbonLook[] | null): void {
    const g = sim.graph;
    if (!g) return;
    // Another colony, or a jump in time (a catch-up): the samples start afresh.
    if (sim !== this.of || sim.tick < this.lastTick || sim.tick - this.lastTick > 3 * SPAN) { this.old.clear(); this.mid.clear(); this.of = sim; }
    this.lastTick = sim.tick;
    const now = sim.tick;
    const seen = new Set<string>();
    for (const c of g.chains) {
      const k = keyOf(c);
      seen.add(k);
      let a = this.old.get(k);
      const b = this.mid.get(k);
      if (!a || !b) {
        a = { tick: now, mu: c.pushedTotal };
        this.old.set(k, a); this.mid.set(k, a);
      } else if (now - b.tick >= SPAN) {
        // Every `SPAN` ticks the middle sample becomes the old one: the figure spans `SPAN` to 2 × `SPAN`.
        this.old.set(k, (a = b));
        this.mid.set(k, { tick: now, mu: c.pushedTotal });
      }
      if (!out) continue;
      const dt = now - a.tick;
      const util = dt >= SPAN / 4 ? Math.min(1000, Math.floor(((c.pushedTotal - a.mu) * 600) / (dt * c.perMin))) : -1;
      out.push({ chain: c, perMin: c.perMin, util, fill: fillOf(c), jam: jammed(c, now), dead: c.outE.length === 0 });
    }
    for (const k of [...this.old.keys()]) if (!seen.has(k)) { this.old.delete(k); this.mid.delete(k); }
  }
}

/** Cells holding an item, ‰ of the line (a conduit: its content against what it holds). */
export function fillOf(c: Chain): number {
  if (c.fluid) return c.capMu > 0 ? Math.min(1000, Math.floor((c.content * 1000) / c.capMu)) : 0;
  let n = 0;
  for (let i = 0; i < c.cells.length; i++) if (c.cells[i]) n++;
  return c.cells.length ? Math.floor((n * 1000) / c.cells.length) : 0;
}

/** Does its head hold an item that has not moved on for `JAM_STEPS` of its steps? */
export function jammed(c: Chain, now: number): boolean {
  if (c.fluid) return false;
  const L = c.cells.length;
  if (!L || !c.cells[L - 1]) return false;
  return now - c.moved[L - 1]! > JAM_STEPS * c.stepTicks;
}

/** The lines in a few figures: how many, full, jammed, dead ends, idle (nothing carried). */
export function ribbonSummary(looks: readonly RibbonLook[]): RibbonSummary {
  const s: RibbonSummary = { lines: looks.length, full: 0, jams: 0, dead: 0, idle: 0 };
  for (const l of looks) {
    if (l.jam) s.jams++;
    if (l.dead) s.dead++;
    if (l.util >= FULL && !l.jam) s.full++;
    if (l.util === 0 && l.fill === 0) s.idle++;
  }
  return s;
}
