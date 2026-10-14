// research.ts — the unlock tree's desk (D33). Plans: unlocked at once by the `unlockPlan`
// command, paid from the Heart's stock (no lab, no time; never lost — a reconversion only
// touches research), never out of CrierBelt's restart reserve (D36, systems/reserve.ts: a plan
// must leave the base able to rebuild its production). Research: starting a node in an idle
// research lab (one project per lab, slots from the Mods), cancelling it (the data it paid stays
// in its lab), queueing the next one (the Research Queue feature), reconverting a family (its
// nodes go at once, half their data returns as archive notes when the reconversion — which
// holds a slot — completes; buildings they unlocked stand dormant), and the online tick: each
// project pays its data under the allowance of runtime.ts, so the offline catch-up can drive the
// same projects as pseudo-flows (docs/offline.md).
//
// AI tokens (D68) are never owned: a project uses them as it runs (the same allowance), and each
// minute boundary bills what was used (`tokenEpoch`, online and offline alike) — the claim's
// servers first (what they made in the minute and nobody used is lost, like power), CrierBelt's
// servers the rest, from the purse. A purse in the red holds every research until it is back
// above zero. Data files also come out of the Heart (the Analytics research) and out of the
// autonomous labs: steady sim-level inflows into a store (`dataTick`), exact offline.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, buildingDef, hasResearch, itemIdx, toMu } from '@/content/registry';
import { planDef } from '@/content/research';
import { TPS } from '../constants';
import { ReservoirNode } from '../flow/nodes';
import {
  advanceProject, applyNotes, def as researchDef, effectiveCost, owedItems, prereqsMet, projectDone, respecOrder,
  respecRefund, respecTicks, takeTokens, type BranchId, type Project, type StartBlock,
} from '../research/runtime';
import type { Ent } from '../types';
import { EPOCH } from '../constants';
import { LAB_CAP } from '../graph/compile';
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

/** The labs with a project and what each takes in (the data still owed). */
export function labAccepts(sim: Sim): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const p of sim.projects) if (p.lab) m.set(p.lab, new Set(owedItems(p)));
  return m;
}

/** Research labs without a project (built, not dormant), in id order. */
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
  if (sim.credits < 0) return 'debt';
  return null;
}

/** A project for a node, in a lab (no checks). */
function openProject(sim: Sim, id: string, lab: number): Project {
  const { cost, tokens, ticks } = effectiveCost(id, sim.done);
  const p: Project = { id, lab, cost, paid: cost.map(() => 0), dur: ticks, el: 0, tokens, tokUsed: 0 };
  sim.notes -= applyNotes(p, sim.notes);
  sim.projects.push(p);
  sim.dirty = true;
  return p;
}

/** Start a research node in a lab (the first idle one by default). */
export function startResearch(sim: Sim, id: string, lab = 0): { ok: boolean; reason: StartBlock | null } {
  const block = researchBlock(sim, id);
  if (block) return { ok: false, reason: block };
  const labs = idleLabs(sim);
  const at = lab && labs.includes(lab) ? lab : labs[0]!;
  openProject(sim, id, at);
  sim.log.push({ tick: sim.tick, cmd: { k: 'research', id, lab: at } });
  return { ok: true, reason: null };
}

/**
 * Stop a project: the data files it already paid stay in its lab (for the next project; the Heart
 * takes them if the lab has no room). The tokens it used are spent: compute is paid as it goes.
 */
export function cancelResearch(sim: Sim, id: string): boolean {
  const i = sim.projects.findIndex((p) => p.id === id);
  if (i < 0 || id.startsWith('respec:')) return false;
  const p = sim.projects[i]!;
  sim.tokenUse += takeTokens(p);
  const st = sim.stores.get(p.lab);
  p.cost.forEach((c, j) => {
    const mu = p.paid[j]!;
    if (mu <= 0) return;
    const room = st ? Math.max(0, LAB_CAP - st[c.item]!) : 0;
    const keep = Math.min(mu, room);
    if (st && keep > 0) st[c.item] = st[c.item]! + keep;
    if (mu > keep) sim.refund(c.item, mu - keep);
  });
  sim.projects.splice(i, 1);
  sim.log.push({ tick: sim.tick, cmd: { k: 'cancelResearch', id } });
  sim.dirty = true;
  return true;
}

// ── the Research Queue (an_queue, D70) ──────────────────────────────────────

/** Why a node cannot be queued in a lab (null = it can): the feature, the lab, the node. */
export function queueBlock(sim: Sim, lab: number, id: string): 'feature' | 'lab' | 'unknown' | 'done' | null {
  if (!sim.mods.flags.has('researchQueue')) return 'feature';
  const e = sim.ents.get(lab);
  if (!e || BUILDING_KIND[e.def] !== 'lab') return 'lab';
  if (!hasResearch(id)) return 'unknown';
  if (sim.done.has(id)) return 'done';
  return null;
}

/** Queue the node a lab starts once its project is done (null: clear its queue). Logged. */
export function queueResearch(sim: Sim, lab: number, id: string | null): boolean {
  if (id === null) {
    if (!sim.labQueue.delete(lab)) return false;
  } else {
    if (queueBlock(sim, lab, id)) return false;
    sim.labQueue.set(lab, id);
  }
  sim.log.push({ tick: sim.tick, cmd: { k: 'queueResearch', lab, id } });
  return true;
}

/** Labs free with a queued node that can start now: start it (part of finishing a project, not a command). */
function startQueued(sim: Sim): void {
  if (!sim.mods.flags.has('researchQueue') || !sim.labQueue.size) return;
  const idle = new Set(idleLabs(sim));
  for (const [lab, id] of [...sim.labQueue].sort((a, b) => a[0] - b[0])) {
    if (!idle.has(lab)) continue;
    const block = researchBlock(sim, id);
    if (block === 'done' || block === 'unknown') { sim.labQueue.delete(lab); continue; }
    if (block) continue; // waits: a prerequisite, a slot, the purse
    sim.labQueue.delete(lab);
    openProject(sim, id, lab);
    idle.delete(lab);
    sim.events.push({ k: 'researchQueued', id });
  }
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

/** Power satisfaction (‰) a project runs at (reconversions always run; research holds while the purse is in the red, D68). */
export function projectSat(sim: Sim, p: Project, satOf: (net: number) => number): number {
  if (!p.lab) return 1000;
  if (sim.researchHeld) return 0;
  const n = sim.graph?.nodeByEnt.get(p.lab);
  return n && n.net >= 0 ? satOf(n.net) : 0;
}

/** Online: every project advances by one tick; the servers' output and the data generators run. */
export function researchTick(sim: Sim): void {
  const satOf = (n: number): number => sim.ctx.sat[n]!;
  serverTick(sim, 1, satOf);
  dataTick(sim, 1, (p) => projectSat(sim, p, satOf));
  if (!sim.projects.length) return;
  let finished = false, owedChanged = false;
  for (const p of sim.projects) {
    const owed = owedItems(p).length;
    const paid = advanceProject(p, projectStock(sim, p), 1, projectSat(sim, p, satOf));
    paid.forEach((mu, i) => { if (mu > 0) sim.consumed[p.cost[i]!.item] = sim.consumed[p.cost[i]!.item]! + mu; });
    sim.tokenUse += takeTokens(p);
    if (owedItems(p).length !== owed) owedChanged = true;
    if (projectDone(p)) finished = true;
  }
  if (finished) finishProjects(sim);
  else if (owedChanged) sim.dirty = true; // a lab stops accepting data it no longer owes
}

// ── AI tokens (D68) ─────────────────────────────────────────────────────────

/** Ticks × ‰ in a minute: a server making `tpm` tokens a minute adds tpm × sat to `serverAcc` each tick. */
const TOKEN_UNIT = EPOCH * 1000;

/** The servers' output over `ticks` at their grids' satisfaction (online: one tick; offline: a segment). */
export function serverTick(sim: Sim, ticks: number, satOf: (net: number) => number): void {
  for (const s of sim.graph?.servers ?? []) {
    const sat = satOf(s.net);
    if (sat > 0) sim.serverAcc += s.tpm * sat * ticks;
  }
}

/** Tokens a minute the servers make at their grids' satisfaction (the catch-up's rate, the HUD). */
export function serverRate(sim: Sim, satOf: (net: number) => number): number {
  let t = 0;
  for (const s of sim.graph?.servers ?? []) t += Math.floor((s.tpm * satOf(s.net)) / 1000);
  return t;
}

/** CrierBelt's price for 1 000 tokens now (centi-◉): its list price, halved under the Compute Plan. */
export function tokenPriceK(sim: Sim): number {
  return sim.tokenPlan ? Math.floor((BAL.tokenCentsPerK * BAL.tokenPlan.priceFactor) / 1000) : BAL.tokenCentsPerK;
}

/**
 * The minute boundary's bill (online from step, offline from the catch-up — the same call, after
 * the trade and the leases): the tokens research used this minute, the claim's servers' output
 * first, the rest bought from CrierBelt (the purse may dip below zero: research then holds); the
 * servers' unused output is lost, or sold back with Server Rental; the Compute Plan's fee each
 * hour. Returns whether research's hold changed.
 */
export function tokenEpoch(sim: Sim): boolean {
  const supply = Math.floor(sim.serverAcc / TOKEN_UNIT);
  sim.serverAcc = 0;
  const used = sim.tokenUse;
  sim.tokenUse = 0;
  const fromServers = Math.min(used, supply);
  const bought = used - fromServers;
  const cents = Math.ceil((bought * tokenPriceK(sim)) / 1000);
  sim.credits -= cents;
  let rental = 0;
  if (sim.mods.flags.has('serverRental') && supply > fromServers) {
    rental = Math.floor(((supply - fromServers) * BAL.tokenCentsPerK * BAL.serverRental) / 1e6);
    sim.credits += rental;
  }
  let fee = 0;
  if (sim.tokenPlan && sim.absEpoch() % 60 === 0) {
    fee = BAL.tokenPlan.feeCentsPerHour;
    sim.credits -= fee;
  }
  const st = sim.tokenStats;
  st.used = used; st.fromServers = fromServers; st.bought = bought; st.cents = cents; st.supply = supply; st.rental = rental;
  st.totalUsed += used; st.totalBought += bought; st.totalCents += cents + fee - rental;
  const held = sim.credits < 0;
  if (held === sim.researchHeld) return false;
  sim.researchHeld = held;
  sim.events.push({ k: 'researchHeld', held });
  return true;
}

/** Subscribe to (or leave) CrierBelt's Compute Plan (cm_plan): tokens at a share of the price, for a fee each hour. Logged. */
export function setTokenPlan(sim: Sim, on: boolean): boolean {
  if (on && !sim.mods.flags.has('tokenPlan')) return false;
  if (sim.tokenPlan === on) return false;
  sim.tokenPlan = on;
  sim.log.push({ tick: sim.tick, cmd: { k: 'tokenPlan', on } });
  return true;
}

// ── data files out of the Heart and the autonomous labs (D68, D70) ──────────

/** The data makers now: the Heart (Analytics, no power needed), and every autonomous lab whose project still owes data (at its power). */
export function dataMakers(sim: Sim, satOfProject: (p: Project) => number): Array<{ ent: number; stock: Float64Array; rate: number; sat: number }> {
  const out: Array<{ ent: number; stock: Float64Array; rate: number; sat: number }> = [];
  if (sim.mods.heartData > 0 && sim.hearthId) out.push({ ent: sim.hearthId, stock: sim.stock, rate: sim.mods.heartData, sat: 1000 });
  const data = DATA_IDX();
  for (const p of sim.projects) {
    if (!p.lab || !owedItems(p).includes(data)) continue;
    const e = sim.ents.get(p.lab);
    const per = e ? buildingDef(e.def).lab?.dataPerMin ?? 0 : 0;
    const st = sim.stores.get(p.lab);
    if (per > 0 && st) out.push({ ent: p.lab, stock: st, rate: per * 1000, sat: satOfProject(p) });
  }
  return out;
}

/** The data makers over `ticks`: whole milli-items, the remainder carried (path-independent: the same online and over a catch-up segment). */
export function dataTick(sim: Sim, ticks: number, satOfProject: (p: Project) => number): void {
  const data = DATA_IDX();
  for (const m of dataMakers(sim, satOfProject)) {
    if (m.sat <= 0) continue;
    const w = (sim.dataAcc.get(m.ent) ?? 0) + m.rate * m.sat * ticks;
    const made = Math.floor(w / TOKEN_UNIT);
    sim.dataAcc.set(m.ent, w - made * TOKEN_UNIT);
    if (made <= 0) continue;
    m.stock[data] = m.stock[data]! + made;
    sim.produced[data] = sim.produced[data]! + made;
  }
}
const DATA_IDX = (): number => itemIdx('data_file');

/** Apply every finished project (shared by the online tick and the catch-up). */
export function finishProjects(sim: Sim): string[] {
  const out: string[] = [];
  for (const p of sim.projects.filter(projectDone)) {
    sim.tokenUse += takeTokens(p); // its last tokens, billed at the boundary like the rest
    sim.projects.splice(sim.projects.indexOf(p), 1);
    if (p.id.startsWith('respec:')) sim.notes += p.notes ?? 0;
    else sim.done.add(p.id);
    out.push(p.id);
    sim.events.push({ k: 'research', id: p.id });
  }
  if (out.length) {
    sim.rebuildDerived();
    startQueued(sim);
    sim.jobsDirty = true; // harder rock / deep water may have become workable
    sim.events.push({ k: 'structure' });
  }
  return out;
}
