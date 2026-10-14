// research.ts — the unlock tree's desk (D33). Plans: unlocked at once by the `unlockPlan`
// command, paid from the Heart's stock (no observatory, no time; never lost — a reconversion
// only touches research), never out of CrierBelt's restart reserve (D36, systems/reserve.ts: a
// plan must leave the base able to rebuild its production). Research: starting a node in an idle observatory (one project per
// observatory, slots from the Mods), cancelling it (paid science comes back), reconverting a
// branch (its nodes go at once, half their science returns as archive notes when the
// reconversion — which holds a slot — completes; buildings they unlocked stand dormant), and
// the online tick: each project pays its science under the allowance of runtime.ts, so the
// offline catch-up can drive the same projects as pseudo-flows (docs/offline.md).
import { BUILDING_KIND, buildingDef, hasResearch, itemIdx, toMu } from '@/content/registry';
import { planDef } from '@/content/research';
import { TPS } from '../constants';
import { ReservoirNode } from '../flow/nodes';
import {
  advanceProject, applyNotes, def as researchDef, effectiveCost, owedItems, prereqsMet, projectDone, respecOrder,
  respecRefund, respecTicks, type BranchId, type Project, type StartBlock,
} from '../research/runtime';
import type { Ent } from '../types';
import type { Sim } from '../state';
import { reserveShort } from './reserve';

/** Reconversion cooldown, and the grace window at the start of a colony (ticks). */
const RESPEC_COOLDOWN = 14 * 24 * 3600 * TPS;
const RESPEC_GRACE = 7 * 24 * 3600 * TPS;

export type RespecBlock = 'empty' | 'cooldown' | 'active' | 'slots';

// ── plans (D33) ─────────────────────────────────────────────────────────────

/**
 * Why a plan cannot be unlocked now: not a plan, already unlocked, a prerequisite missing, the
 * Heart short of its cost, or its cost would eat into CrierBelt's restart reserve (D36: the base
 * could no longer rebuild its production; systems/reserve.ts).
 */
export type PlanBlock = 'unknown' | 'done' | 'prereq' | 'unaffordable' | 'reserve';

/** A plan's cost in milli-items. */
export const planCost = (id: string): Array<{ item: number; mu: number }> =>
  (planDef(id)?.cost ?? []).map(([it, n]) => ({ item: itemIdx(it), mu: toMu(n) }));

/** Why a plan cannot be unlocked now (null = it can). */
export function planBlock(sim: Sim, id: string): PlanBlock | null {
  const p = planDef(id);
  if (!p) return 'unknown';
  if (sim.done.has(id)) return 'done';
  if (!p.prereq.every((q) => sim.done.has(q))) return 'prereq';
  const cost = planCost(id);
  if (!cost.every((c) => sim.stock[c.item]! >= c.mu)) return 'unaffordable';
  if (reserveShort(sim, cost, id).length) return 'reserve';
  return null;
}

/**
 * Unlock a plan (logged): its cost leaves the Heart's stock and it joins `sim.done` at once —
 * what it unlocks is buildable from this tick, and its effects (telemetry…) are in the Mods.
 */
export function unlockPlan(sim: Sim, id: string): { ok: boolean; reason: PlanBlock | null } {
  const block = planBlock(sim, id);
  if (block) return { ok: false, reason: block };
  for (const c of planCost(id)) sim.stock[c.item] = sim.stock[c.item]! - c.mu;
  sim.done.add(id);
  sim.log.push({ tick: sim.tick, cmd: { k: 'unlockPlan', id } });
  sim.rebuildDerived();
  sim.events.push({ k: 'plan', id });
  return { ok: true, reason: null };
}

/** Is this building's unlock given up (reconversion)? It stands dormant. */
export function isDormant(sim: Sim, e: Ent): boolean {
  const u = buildingDef(e.def).unlock;
  return u !== 'start' && u !== 'never' && !sim.unlocked(u);
}

/** The observatories with a project and what each takes in (the science still owed). */
export function labAccepts(sim: Sim): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const p of sim.projects) if (p.lab) m.set(p.lab, new Set(owedItems(p)));
  return m;
}

/** Observatories without a project (built, not dormant), in id order. */
export function idleLabs(sim: Sim): number[] {
  const busy = new Set(sim.projects.map((p) => p.lab));
  return sim.ents.sorted().filter((e) => BUILDING_KIND[e.def] === 'lab' && e.builtAt === 0 && !busy.has(e.id) && !isDormant(sim, e)).map((e) => e.id);
}

/** Why a node cannot start now (null = it can). */
export function researchBlock(sim: Sim, id: string): StartBlock | null {
  if (!hasResearch(id)) return 'unknown';
  if (sim.done.has(id)) return 'done';
  if (sim.projects.some((p) => p.id === id)) return 'active';
  if (!prereqsMet(id, sim.done)) return 'prereq';
  if (sim.projects.length >= sim.mods.slots) return 'slots';
  if (!idleLabs(sim).length) return 'no_lab';
  return null;
}

/** Start a research node in an observatory (the first idle one by default). */
export function startResearch(sim: Sim, id: string, lab = 0): { ok: boolean; reason: StartBlock | null } {
  const block = researchBlock(sim, id);
  if (block) return { ok: false, reason: block };
  const labs = idleLabs(sim);
  const at = lab && labs.includes(lab) ? lab : labs[0]!;
  const { cost, ticks } = effectiveCost(id, sim.done);
  const p: Project = { id, lab: at, cost, paid: cost.map(() => 0), dur: ticks, el: 0 };
  sim.notes -= applyNotes(p, sim.notes);
  sim.projects.push(p);
  sim.log.push({ tick: sim.tick, cmd: { k: 'research', id, lab: at } });
  sim.dirty = true;
  return { ok: true, reason: null };
}

/** Stop a project: the science it already paid goes back to the Hearth. */
export function cancelResearch(sim: Sim, id: string): boolean {
  const i = sim.projects.findIndex((p) => p.id === id);
  if (i < 0 || id.startsWith('respec:')) return false;
  const p = sim.projects[i]!;
  p.cost.forEach((c, j) => { if (p.paid[j]! > 0) sim.refund(c.item, p.paid[j]!); });
  sim.projects.splice(i, 1);
  sim.log.push({ tick: sim.tick, cmd: { k: 'cancelResearch', id } });
  sim.dirty = true;
  return true;
}

/** Can a branch be reconverted now? */
export function respecBlock(sim: Sim, branch: BranchId): RespecBlock | null {
  if (!respecOrder(branch, sim.done).length) return 'empty';
  if (sim.projects.some((p) => p.id === `respec:${branch}` || (!p.id.startsWith('respec:') && researchDef(p.id).branch === branch))) return 'active';
  const grace = sim.respecs === 0 && sim.tick < RESPEC_GRACE;
  if (!grace && sim.lastRespec >= 0 && sim.tick - sim.lastRespec < RESPEC_COOLDOWN) return 'cooldown';
  if (sim.projects.length >= sim.mods.slots) return 'slots';
  return null;
}

/**
 * Reconvert a branch: its nodes go at once (deepest first; buildings they unlocked stand
 * dormant), half their science comes back as archive notes once the reconversion — which
 * holds a research slot for a quarter of their durations — completes.
 */
export function respec(sim: Sim, branch: BranchId): boolean {
  if (respecBlock(sim, branch)) return false;
  const removed = respecOrder(branch, sim.done);
  const notes = respecRefund(removed, sim.done);
  const ticks = respecTicks(removed, sim.done);
  for (const id of removed) sim.done.delete(id);
  sim.projects.push({ id: `respec:${branch}`, lab: 0, cost: [], paid: [], dur: ticks, el: 0, notes });
  sim.respecs++;
  sim.lastRespec = sim.tick;
  sim.log.push({ tick: sim.tick, cmd: { k: 'respec', branch } });
  sim.rebuildDerived();
  sim.events.push({ k: 'structure' });
  return true;
}

/** The observatory store a project draws from (null for a reconversion or a missing node). */
export function projectStock(sim: Sim, p: Project): Float64Array | null {
  if (!p.lab) return null;
  const n = sim.graph?.nodeByEnt.get(p.lab);
  return n instanceof ReservoirNode ? n.stock : null;
}

/** Power satisfaction (‰) a project runs at (reconversions always run). */
export function projectSat(sim: Sim, p: Project, satOf: (net: number) => number): number {
  if (!p.lab) return 1000;
  const n = sim.graph?.nodeByEnt.get(p.lab);
  return n && n.net >= 0 ? satOf(n.net) : 0;
}

/** Online: every project advances by one tick. */
export function researchTick(sim: Sim): void {
  let finished = false, owedChanged = false;
  for (const p of sim.projects) {
    const owed = owedItems(p).length;
    const paid = advanceProject(p, projectStock(sim, p), 1, projectSat(sim, p, (n) => sim.ctx.sat[n]!));
    paid.forEach((mu, i) => { if (mu > 0) sim.consumed[p.cost[i]!.item] = sim.consumed[p.cost[i]!.item]! + mu; });
    if (owedItems(p).length !== owed) owedChanged = true;
    if (projectDone(p)) finished = true;
  }
  if (finished) finishProjects(sim);
  else if (owedChanged) sim.dirty = true; // an observatory stops accepting a science it no longer owes
}

/** Apply every finished project (shared by the online tick and the catch-up). */
export function finishProjects(sim: Sim): string[] {
  const out: string[] = [];
  for (const p of sim.projects.filter(projectDone)) {
    sim.projects.splice(sim.projects.indexOf(p), 1);
    if (p.id.startsWith('respec:')) sim.notes += p.notes ?? 0;
    else sim.done.add(p.id);
    out.push(p.id);
    sim.events.push({ k: 'research', id: p.id });
  }
  if (out.length) {
    sim.rebuildDerived();
    sim.jobsDirty = true; // harder rock / deep water may have become workable
    sim.events.push({ k: 'structure' });
  }
  return out;
}
