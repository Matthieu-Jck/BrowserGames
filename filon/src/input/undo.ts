// undo.ts — Ctrl/⌘+Z (D154): the last placement, ribbon drag, paste, upgrade or demolition taken
// back, through the player's own commands, so a replay sees an ordinary `remove` and `place`. Each
// gesture the build tools turn into commands is recorded as one step: the entities it put up (ids at
// or past the table's `nextId` before it) and those it took down (the candidates the gesture names —
// what its pieces replace, what its box holds — copied with their place, rotation, settings and
// wires before it runs). Undoing a step:
//   1. takes down what it put up and still stands (`remove`: refunded in full, its buffers to the Core);
//   2. puts back what it took down (`place` with its rotation and settings, `turned` so a routing
//      block keeps its way over a ribbon), paid again — its refund came in when it went;
//   3. strings its wires again to what stands (`link`), and points the older steps at the new ids
//      (ids are never reused, so a restored building is a new entity).
// Limits (D154): `DEPTH` steps, for this session and this colony only (a reload, a debug base or an
// import starts afresh); wires, marks, settings, land and research are not undone; what a step took
// down comes back empty (its items went to the Core) and only if the Core can pay for it again and
// its ground is free; a ribbon put up off the claim's land gives back its price, not the kites'
// surcharge (a removal never does). Pure of DOM: unit-tested in Node.
import { BUILDING_IDS } from '@/content/registry';
import { isLinkPoint } from '@/sim/power/links';
import type { Sim } from '@/sim/state';
import type { Rot } from '@/sim/types';

/** How many steps back Ctrl+Z goes. */
export const DEPTH = 32;

/** A building a step took down, as it stood. */
interface Gone { id: number; def: string; x: number; y: number; rot: Rot; cfg: number; links: number[] }

interface Step { sim: Sim; made: number[]; gone: Gone[] }

export interface UndoResult {
  /** Taken down (what the step had put up) and put back (what it had taken down). */
  removed: number;
  restored: number;
  /** What could not be put back: its ground taken since, or the Core short of its price. */
  failed: number;
}

export class UndoStack {
  private steps: Step[] = [];

  get size(): number { return this.steps.length; }

  clear(): void { this.steps = []; }

  /**
   * Run a gesture's commands as one step: `candidates` are the entities it may take down (copied
   * before it runs, with their wires). Nothing changed: nothing recorded. Returns the gesture's result.
   */
  record<T>(sim: Sim, candidates: Iterable<number>, fn: () => T): T {
    const next = sim.ents.nextId;
    const before: Gone[] = [];
    for (const id of new Set(candidates)) {
      const e = sim.ents.get(id);
      if (e && id !== sim.hearthId) before.push({ id, def: BUILDING_IDS[e.def]!, x: e.x, y: e.y, rot: e.rot, cfg: e.cfg, links: [...sim.linksOf(id)] });
    }
    const out = fn();
    const made: number[] = [];
    for (let id = next; id < sim.ents.nextId; id++) if (sim.ents.map.has(id)) made.push(id);
    const gone = before.filter((g) => !sim.ents.map.has(g.id)).sort((a, b) => a.id - b.id);
    if (made.length || gone.length) {
      this.steps.push({ sim, made, gone });
      if (this.steps.length > DEPTH) this.steps.splice(0, this.steps.length - DEPTH);
    }
    return out;
  }

  /** Take the last step back (null: nothing to undo on this colony). */
  undo(sim: Sim): UndoResult | null {
    // A step from another colony (a debug base swapped in, an import) means nothing here.
    this.steps = this.steps.filter((s) => s.sim === sim);
    const step = this.steps.pop();
    if (!step) return null;
    const res: UndoResult = { removed: 0, restored: 0, failed: 0 };
    for (const id of step.made) {
      const e = sim.ents.get(id);
      if (e && sim.remove(e.x, e.y)) res.removed++;
    }
    const now = new Map<number, number>(); // old id → the id it came back as
    for (const g of step.gone) {
      const r = sim.place(g.def, g.x, g.y, g.rot, g.cfg, true);
      if (r.ok && r.id) { now.set(g.id, r.id); res.restored++; } else res.failed++;
    }
    for (const g of step.gone) {
      const id = now.get(g.id);
      if (!id) continue;
      for (const o of g.links) {
        const other = now.get(o) ?? o;
        if (!sim.ents.get(other) || sim.links.has(id, other)) continue;
        // The pillar is the end a wire starts from.
        const [a, b] = isLinkPoint(sim.ents.get(other)!.def) ? [other, id] : [id, other];
        sim.link(a, b);
      }
    }
    // The older steps name the buildings put back by their new ids.
    if (now.size) {
      for (const s of this.steps) {
        s.made = s.made.map((id) => now.get(id) ?? id);
        for (const g of s.gone) g.links = g.links.map((id) => now.get(id) ?? id);
      }
    }
    return res;
  }
}
