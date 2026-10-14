// power.ts — the online power step and the wire commands (D25).
//
// The step: for each grid, last tick's demands against this epoch's weather (sun, gusts),
// solved in merit order (renewables → fuel generators → accumulators) into a satisfaction ‰ every
// consumer on the grid runs at, the generators' dispatch, and the accumulators' charge. The offline
// catch-up solves the same per regime (docs/offline.md), with the same `weatherAt` and
// generator functions (power/network.ts). What a grid asks for and what it can burn are small
// named functions (`gridDemand`, `fuelKw`), so the climate follow-up adds its loads in one place.
//
// The wires: grids are the connected components of explicit wires (power/links.ts). `link` /
// `unlink` are player commands (logged, replayed); a newly placed pillar wires itself to the
// nearest pillar or Hearth in reach with a free slot (`placed`), a placement that replaces
// buildings carries their wires over where they still fit, and removing a building cuts its
// wires (`removed`). Generators and consumers are wired by the player.
import { GeneratorNode } from '../flow/nodes';
import type { FNode } from '../flow/node';
import { gap2, isLinkPoint, linkCheck, type LandLevel, type LinkReason } from '../power/links';
import { renewableKw, weatherAt } from '../power/network';
import { solvePower } from '../power/solve';
import type { Sim } from '../state';

export function powerTick(sim: Sim): void {
  const g = sim.graph;
  sim.netPower.length = g.nets.length;
  const w = weatherAt(sim.absEpoch(), sim.worldSeed, sim.mods);
  for (const net of g.nets) {
    const nodes = sim.nodesByNet[net.id]!;
    const D = gridDemand(nodes), F = fuelKw(nodes), R = renewableKw(net, w);
    let E = 0, cap = 0, rate = 0;
    for (const a of net.accs) { E += sim.accEnergy.get(a.ent) ?? 0; cap += a.cap; rate += a.rate; }
    const res = solvePower(D, R, F, E, cap, rate);
    sim.netPower[net.id] = { demand: D, renew: R, fuel: F, sat: res.sat };
    sim.ctx.sat[net.id] = res.sat;
    sim.ctx.dispatch[net.id] = res.dispatch;
    if (res.accDelta !== 0) spreadAcc(sim, net.accs, res.accDelta);
  }
}

/** What a grid's buildings ask for this tick (kW), from last tick's statuses. */
export function gridDemand(nodes: readonly FNode[]): number {
  let D = 0;
  for (const n of nodes) D += n.demand();
  return D;
}

/** The fuel generators' capacity on a grid (kW): those with fuel in their box. */
export function fuelKw(nodes: readonly FNode[]): number {
  let F = 0;
  for (const n of nodes) if (n instanceof GeneratorNode && n.fueled()) F += n.outKw;
  return F;
}

/** Charge (delta > 0) or drain the accumulators of a grid in id order. */
function spreadAcc(sim: Sim, accs: ReadonlyArray<{ ent: number; cap: number }>, delta: number): void {
  let rem = delta;
  for (const a of accs) {
    if (rem === 0) break;
    const e = sim.accEnergy.get(a.ent) ?? 0;
    const d = rem > 0 ? Math.min(rem, a.cap - e) : Math.max(rem, -e);
    if (d !== 0) { sim.accEnergy.set(a.ent, e + d); rem -= d; }
  }
}

// ── the wires ──────────────────────────────────────────────────────────────

/** The land's level of a tile, as the wire rule reads it (D45, D78: the ends' levels and the land between). */
export const landOf = (sim: Sim): LandLevel => (x, y) => sim.grid.level(x, y);

/** A wire command's answer: done, or why not. */
export interface LinkCheck { ok: boolean; reason: LinkReason }

/** May `a` (the end the player starts from) and `b` be wired now? */
export function canLink(sim: Sim, a: number, b: number): LinkCheck {
  const reason = linkCheck(sim.ents.get(a), sim.ents.get(b), sim.links, sim.mods, landOf(sim));
  return { ok: reason === 'ok', reason };
}

/** Command: string a wire between `a` and `b` (logged when accepted). */
export function link(sim: Sim, a: number, b: number): LinkCheck {
  const c = canLink(sim, a, b);
  if (!c.ok) return c;
  sim.links.add(a, b);
  sim.dirty = true;
  sim.log.push({ tick: sim.tick, cmd: { k: 'link', a, b } });
  return c;
}

/** Command: cut the wire between `a` and `b` (logged when there was one). */
export function unlink(sim: Sim, a: number, b: number): boolean {
  if (!sim.links.remove(a, b)) return false;
  sim.dirty = true;
  sim.log.push({ tick: sim.tick, cmd: { k: 'unlink', a, b } });
  return true;
}

/**
 * The nearest link point (pillar or Hearth) `id` may be wired to now, or 0: smallest
 * edge-to-edge distance, then the lowest id. Construction sites count (their wire waits).
 */
export function nearestPoint(sim: Sim, id: number): number {
  const e = sim.ents.get(id);
  if (!e) return 0;
  let best = 0, bestD = Infinity;
  for (const o of sim.ents.sorted()) {
    if (o.id === id || !isLinkPoint(o.def)) continue;
    if (linkCheck(e, o, sim.links, sim.mods, landOf(sim)) !== 'ok') continue;
    const d = gap2(e, o);
    if (d < bestD) { bestD = d; best = o.id; }
  }
  return best;
}

/**
 * After a placement (part of the `place` command, so a replay redoes it): the wires of what
 * it replaced move over to the new building where they still fit — link points first, then
 * buildings, each in id order; the rest are cut. Then a new pillar with no wire reaches for
 * the nearest pillar or Hearth with a free slot (one wire; the player wires the rest).
 */
export function placed(sim: Sim, id: number, replaced: readonly number[]): void {
  const e = sim.ents.get(id);
  if (!e) return;
  for (const old of replaced) {
    const ends = sim.links.drop(old).filter((o) => sim.ents.get(o));
    const order = [...ends.filter((o) => isLinkPoint(sim.ents.get(o)!.def)), ...ends.filter((o) => !isLinkPoint(sim.ents.get(o)!.def))];
    for (const o of order) if (linkCheck(e, sim.ents.get(o), sim.links, sim.mods, landOf(sim)) === 'ok') sim.links.add(id, o);
  }
  if (isLinkPoint(e.def) && sim.links.degree(id) === 0) {
    const to = nearestPoint(sim, id);
    if (to) sim.links.add(id, to);
  }
  if (sim.links.degree(id) > 0) sim.dirty = true;
}

/** After a removal (part of the `remove` command): its wires go with it. */
export function removed(sim: Sim, id: number): void {
  if (sim.links.drop(id).length) sim.dirty = true;
}
