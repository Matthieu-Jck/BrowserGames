// landscape.ts — making room: tiles marked for digging (rock) or filling (water, salt flats),
// and the one job each excavator / backfiller runs on the nearest workable mark in its reach.
// A job's progress and rubble follow the allowance rules of space.ts (path-independent, so the
// offline catch-up drives the same jobs as pseudo-flows); a finished tile turns to floor —
// reclaimed land when it touches a zone — and a dug tile gives up its embedded ore.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, itemIdx } from '@/content/registry';
import { EPOCH } from '../constants';
import { footprint } from '../entities';
import { ReservoirNode } from '../flow/nodes';
import { inWorld } from '../world/grid';
import { isRock, T, type Ent } from '../types';
import {
  advanceJob, canDig, digRubble, digTicks, embedded, fillCost, fillTicks, jobDone, type Job, type JobKind,
} from '../space';
import type { Sim } from '../state';

const RUBBLE = (): number => itemIdx('stone');

/** Mark tiles for digging (rock) or filling (water / salt); `on: false` clears marks. */
export function designate(sim: Sim, tiles: readonly number[], on = true): number {
  let n = 0;
  for (const t of tiles) {
    const x = t % 1024, y = (t - x) / 1024;
    if (!inWorld(x, y)) continue;
    if (!on) { if (sim.designated.delete(t)) n++; continue; }
    if (sim.designated.has(t) || !sim.revealed(x, y)) continue;
    const tt = sim.grid.terrain(x, y);
    const kind: JobKind | null = isRock(tt) ? 'dig' : tt === T.Shallow || tt === T.Deep || tt === T.Salt ? 'fill' : null;
    if (!kind || sim.grid.occ[t] !== 0) continue; // a building stands there (on rock too, D44)
    sim.designated.set(t, kind);
    n++;
  }
  if (n) { sim.jobsDirty = true; sim.log.push({ tick: sim.tick, cmd: { k: 'designate', tiles: [...tiles], on } }); }
  return n;
}

/** Machine reach: an excavator's in tiles from its footprint's edge (D54), a backfiller's from its centre. */
const reachOf = (e: Pick<Ent, 'def'>): number => (BUILDING_KIND[e.def] === 'excavator' ? BAL.digReach : BAL.fillReach);

/**
 * Is tile (x, y) in a machine's reach? An excavator digs what lies within `digReach` tiles of its
 * footprint (owner, 2026-10-13: "excavator reach should be greatly reduced. Should be almost next
 * to the mountain"); a backfiller fills within `fillReach` of its centre. Integers only (doubled
 * coordinates for the centre).
 */
export function inReach(e: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>, x: number, y: number): boolean {
  const [w, h] = footprint(e.def, e.rot);
  const r = reachOf(e);
  if (BUILDING_KIND[e.def] === 'excavator') {
    const dx = Math.max(0, e.x - x, x - (e.x + w - 1)), dy = Math.max(0, e.y - y, y - (e.y + h - 1));
    return dx * dx + dy * dy <= r * r;
  }
  return (2 * x - (2 * e.x + w - 1)) ** 2 + (2 * y - (2 * e.y + h - 1)) ** 2 <= 4 * r * r;
}

/**
 * Give idle excavators / backfillers the nearest workable marked tile in reach (ids in order,
 * squared distances on doubled centres: integers only).
 */
export function assignJobs(sim: Sim): void {
  sim.jobsDirty = false;
  if (!sim.designated.size) return;
  const taken = new Set(sim.jobs.map((j) => j.tile));
  const busy = new Set(sim.jobs.map((j) => j.ent));
  for (const e of sim.ents.sorted()) {
    const k = BUILDING_KIND[e.def];
    if ((k !== 'excavator' && k !== 'backfiller') || e.builtAt !== 0 || busy.has(e.id) || sim.isDormant(e)) continue;
    const want: JobKind = k === 'excavator' ? 'dig' : 'fill';
    const [w, h] = footprint(e.def, e.rot);
    const cx2 = 2 * e.x + w - 1, cy2 = 2 * e.y + h - 1; // doubled centre: nearest first
    let best = -1, bd = Infinity;
    for (const [t, kind] of sim.designated) {
      if (kind !== want || taken.has(t) || sim.grid.occ[t] !== 0) continue; // built on since it was marked
      const x = t % 1024, y = (t - x) / 1024;
      const d = (2 * x - cx2) ** 2 + (2 * y - cy2) ** 2;
      if (d >= bd || !inReach(e, x, y)) continue;
      const tt = sim.grid.terrain(x, y);
      if (want === 'dig' ? !canDig(tt, sim.mods) : fillCost(tt, sim.mods) === null) continue;
      best = t; bd = d;
    }
    if (best < 0) continue;
    const bx = best % 1024, by = (best - bx) / 1024;
    const tt = sim.grid.terrain(bx, by);
    const job: Job = want === 'dig'
      ? { ent: e.id, kind: 'dig', tile: best, dur: digTicks(tt, sim.mods), el: 0, mu: digRubble(tt, sim.mods), moved: 0 }
      : { ent: e.id, kind: 'fill', tile: best, dur: fillTicks(), el: 0, mu: fillCost(tt, sim.mods)!, moved: 0 };
    sim.jobs.push(job);
    sim.jobs.sort((a, b) => a.ent - b.ent);
    taken.add(best);
    sim.dirty = true; // the machine now draws full power
  }
}

/** The store a job moves rubble in/out of (its machine's reservoir), or null. */
export function jobStore(sim: Sim, j: Job): Float64Array | null {
  const n = sim.graph?.nodeByEnt.get(j.ent);
  return n instanceof ReservoirNode ? n.stock : null;
}

export const jobCap = (j: Job): number => (j.kind === 'dig' ? BAL.excavatorCap : BAL.backfillerCap) * 1000;

/** Power satisfaction (‰) of a job's machine. */
export function jobSat(sim: Sim, j: Job, satOf: (net: number) => number): number {
  const n = sim.graph?.nodeByEnt.get(j.ent);
  return n && n.net >= 0 ? satOf(n.net) : 0;
}

/** Advance every job by `ticks` (online: 1). Returns true when one completed. */
export function advanceJobs(sim: Sim, ticks: number, satOf: (net: number) => number, sats?: (j: Job) => number): boolean {
  let any = false;
  const rubble = RUBBLE();
  for (const j of sim.jobs) {
    const st = jobStore(sim, j);
    if (!st) continue;
    const moved = advanceJob(j, st, rubble, jobCap(j), ticks, sats ? sats(j) : jobSat(sim, j, satOf));
    if (moved) {
      if (j.kind === 'dig') sim.produced[rubble] = sim.produced[rubble]! + moved;
      else sim.consumed[rubble] = sim.consumed[rubble]! + moved;
    }
    if (jobDone(j)) any = true;
  }
  return any;
}

/**
 * Finish completed jobs: the tile turns to floor (the claim's where its parcel is), dug tiles
 * give up their embedded ore to the Hearth. True when the flow graph must be recompiled (a
 * pump lost or found its water).
 */
export function completeJobs(sim: Sim): boolean {
  let recompile = false;
  for (const j of sim.jobs.filter(jobDone)) {
    sim.jobs.splice(sim.jobs.indexOf(j), 1);
    const x = j.tile % 1024, y = (j.tile - x) / 1024;
    sim.designated.delete(j.tile);
    if (j.kind === 'dig') {
      sim.grid.setTerrain(x, y, T.Dug);
      if (sim.grid.level(x, y) !== 0) sim.grid.setLevel(x, y, 0); // dug down to the floor (D45)
      const ore = embedded(x, y, sim.mods, sim.grid.source.embedCopper);
      for (const o of ore) { sim.stock[o.item] = sim.stock[o.item]! + o.mu; sim.produced[o.item] = sim.produced[o.item]! + o.mu; }
      sim.events.push({ k: 'dug', tile: j.tile, ore });
    } else {
      sim.grid.setTerrain(x, y, T.Filled);
      sim.events.push({ k: 'filled', tile: j.tile });
    }
    // Pumps read the water around them.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const o = sim.entityAt(x + dx, y + dy);
      if (o && BUILDING_KIND[o.def] === 'pump') recompile = true;
    }
    sim.jobsDirty = true;
    sim.dirty = true;
  }
  return recompile;
}

/** Online: hand out work (when marks or machines changed, and once a minute), advance, finish. */
export function landscapeTick(sim: Sim): void {
  if (sim.jobsDirty || sim.tick % EPOCH === 0) assignJobs(sim);
  if (sim.jobs.length && advanceJobs(sim, 1, (n) => sim.ctx.sat[n]!)) completeJobs(sim);
}
