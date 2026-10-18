// work-look.ts — which buildings look at work (D83, owner, 2026-10-15: « si une machine ne
// fonctionne pas […] il faut qu'elle ait un style distinct qui le montre, peut-être tout éteinte
// alors que sinon on a de la lumière, du feu, ou du mouvement »). A production building that works
// keeps its lights, its fire and its motion; one that does not is drawn switched off: its unlit
// art (art/unlit.ts), no night glow or work lamp, its moving part still. Pure: it reads the sim
// (node statuses, the research projects, the grids) and never changes it.
//
// What counts as working, per kind (`workOf`, in the sim's systems/work.ts since D85: the debug
// bases are checked for buildings that stay off with it):
// - machines: crafting, powered (`Ok` / `LowPower`); drills, sand collectors, pumps: extracting,
//   powered; fuel generators: burning (dispatched, fuelled); research labs: a project on a powered
//   grid (an autonomous lab whenever it computes, D122); servers, wind turbines, solar panels,
//   geothermal plants: on a grid (a server on a powered one).
// - A *passing* stop — inputs late (`Starved`), output backed up (`Blocked`), a generator not
//   called on (`Idle`) or waiting for fuel — keeps the
//   look for `WORK_GRACE` ticks after it last worked, so a machine fed a little slower than it
//   crafts never blinks between two crafts. A hard stop — no recipe, no power, no grid, dormant,
//   still being built — switches it off at once.
// - Logistics (ribbons, routing blocks, stores, posts, docks), the Heart and the excavator and
//   backfiller (to be redesigned) keep one look.
//
// `WorkLook` samples at most once per game tick (10 Hz, nothing while paused) over the watched
// buildings only, and reports the ones whose look flipped; the views apply those flips and nothing
// else (BuildingsView: textures and tints; LightsView: glows, on its `version`).
import type { Sim } from '@/sim/state';
import type { Ent } from '@/sim/types';
import { WORK_GRACE, looksAtWork, workOf } from '@/sim/systems/work';

// What counts as working lives in the sim (systems/work.ts: the debug bases check it too).
export { LOOKS_AT_WORK, WORK_GRACE, looksAtWork, workOf, type Work } from '@/sim/systems/work';

/** The tint a switched-off building's extras take (its moving part, a panel's petals and cells; its body until its unlit picture is baked): greyed, a little darker. */
export const OFF_TINT = 0xb3aebf;

const NONE: readonly number[] = [];

/** Which watched buildings look at work, sampled per game tick; the flips for the views to apply. */
export class WorkLook {
  private ents: Ent[] = [];
  /** The tick each building was last seen at work. */
  private readonly last = new Map<number, number>();
  private readonly lit = new Map<number, boolean>();
  private readonly flips: number[] = [];
  private at = -1;
  /** The colony watched: another one (a debug base swapped in, an import) starts from nothing — its ids and ticks are its own. */
  private of: Sim | null = null;
  /** Bumped whenever a look flips (LightsView re-applies on a change). */
  version = 0;

  /** The buildings to watch, on structural changes; what was known of those still standing is kept. */
  rebuild(sim: Sim): void {
    if (sim !== this.of) { this.of = sim; this.last.clear(); this.lit.clear(); }
    this.ents = sim.ents.sorted().filter((e) => looksAtWork(e.def));
    const ids = new Set(this.ents.map((e) => e.id));
    for (const id of [...this.lit.keys()]) if (!ids.has(id)) { this.lit.delete(id); this.last.delete(id); }
    this.at = -1; // sample at once: a new building's look is known before it is ever drawn lit
  }

  /**
   * Once per game tick at most (paused: nothing): each watched building's look, and the ones that
   * flipped since the last sample (a building seen for the first time counts as a flip). The array
   * is reused: read it before the next call.
   */
  sample(sim: Sim): readonly number[] {
    if (sim.tick === this.at) return NONE;
    this.at = sim.tick;
    const out = this.flips;
    out.length = 0;
    for (const e of this.ents) {
      const w = workOf(sim, e);
      if (w === 'on') this.last.set(e.id, sim.tick);
      const t = this.last.get(e.id);
      const on = w === 'on' || (w === 'pause' && t !== undefined && t <= sim.tick && sim.tick - t <= WORK_GRACE);
      if (this.lit.get(e.id) === on) continue;
      this.lit.set(e.id, on);
      out.push(e.id);
    }
    if (out.length) this.version++;
    return out;
  }

  /** Does a building look at work? (Yes for the kinds with one look, and before its first sample.) */
  isLit(id: number): boolean {
    return this.lit.get(id) ?? true;
  }

  /** Watched buildings, and how many of them look switched off (perf, debug). */
  counts(): { watched: number; off: number } {
    let off = 0;
    for (const v of this.lit.values()) if (!v) off++;
    return { watched: this.ents.length, off };
  }
}
