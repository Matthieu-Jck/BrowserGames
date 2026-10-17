// research.ts — the unlock tree's desk (D33). Plans: unlocked at once by the `unlockPlan`
// command, paid from the Heart's stock (no lab, no time; never lost — a reconversion only
// touches research), never out of CrierBelt's restart reserve (D36, systems/reserve.ts: a plan
// must leave the base able to rebuild its production). Research: starting a node in an idle
// research lab (one project per lab, slots from the Mods), cancelling it (the data it paid stays
// in its lab), queueing the next one (the Research Queue feature), and the online tick: each
// project pays its data under the allowance of runtime.ts, so the offline catch-up can drive the
// same projects as pseudo-flows (docs/offline.md). Reconverting a family is retired (D107: its
// button left the tree); a save's reconversion under way (`respec:<family>`, no lab) still runs
// out and pays its archive notes, which the next projects spend; its family's buildings stand
// dormant until relearnt (`isDormant`).
//
// D118 (owner, 2026-10-17): research has no minimum time. A project takes its data as it reaches the
// lab; Tier 1 needs nothing else. Each tier waits for the Core's level (`BAL.tierCoreLevel`: Tier 2
// at 3, then 4, 5), raised by the player. From Tier 2 a node also needs a number of AI tokens (D68:
// never owned), delivered as a flow at each minute's end (`tokenEpoch`, online and offline alike):
// the claim's servers' output of the minute, to the projects in the order they started (the oldest
// first; what nobody needs is lost, like power, or rented back with Server Rental), then each
// project's own flow bought from CrierBelt (`buy`, chosen at its launch, changed by `tokenBuy`),
// which stops by itself once the project has its tokens. A purse in the red holds the bought flows
// until it is back above zero; data and the servers' tokens go on. Data files also come out of the
// Heart (the Analytics research) and out of the autonomous labs: steady sim-level inflows into a
// store (`dataTick`), exact offline.
import { book } from '../purse';
import { BAL } from '@/content/balance';
import { BUILDING_KIND, buildingDef, hasResearch, itemIdx, toMu } from '@/content/registry';
import { planDef, researchNode } from '@/content/research';
import { ReservoirNode } from '../flow/nodes';
import {
  advanceProject, applyNotes, def as researchDef, effectiveCost, owedItems, prereqsMet, projectDone,
  tokensLeft, type Project, type StartBlock,
} from '../research/runtime';
import type { Ent } from '../types';
import { EPOCH } from '../constants';
import { LAB_CAP } from '../graph/compile';
import type { Sim } from '../state';
import { reserveShort } from './reserve';
import { tierTwoOpen } from './expertise';


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

/** The Core's level a tier needs (D118: `BAL.tierCoreLevel`; Tier 1 none past the first). */
export const coreLevelFor = (tier: number): number => BAL.tierCoreLevel[Math.max(1, Math.min(BAL.tierCoreLevel.length, tier)) - 1]!;

/**
 * Whether the Core's level opens a tier (D118; owner, 2026-10-17: « il faut que le Tier 2 soit
 * montré comme bloqué tant que le core n'est pas niveau 3, etc. »): the Core at the tier's level, or
 * a node of that tier already held — learnt or running —, so no claim from before loses a tier it
 * had opened (a level never falls, so for a claim since D118 this is the level alone).
 */
export function tierCoreOpen(sim: Sim, tier: number): boolean {
  if (sim.hearthLevel >= coreLevelFor(tier)) return true;
  for (const id of sim.done) if (researchNode(id)?.tier === tier) return true;
  return sim.projects.some((p) => researchNode(p.id)?.tier === tier);
}

/** Why a node cannot start now (null = it can). */
export function researchBlock(sim: Sim, id: string): StartBlock | null {
  if (!hasResearch(id)) return 'unknown';
  if (sim.done.has(id)) return 'done';
  if (sim.projects.some((p) => p.id === id)) return 'active';
  if (!prereqsMet(id, sim.done)) return 'prereq';
  const tier = researchDef(id).tier;
  // Each tier waits for the Core's level (D118), Tier 2 also for two expertises chosen at its Archive (D93).
  if (!tierCoreOpen(sim, tier)) return 'core';
  if (tier >= 2 && !tierTwoOpen(sim)) return 'expertise';
  if (sim.projects.length >= sim.mods.slots) return 'slots';
  if (!idleLabs(sim).length) return 'no_lab';
  // A node that takes tokens may buy them: not from a purse in the red (Tier 1's data costs nothing).
  if (tier >= 2 && sim.credits < 0) return 'debt';
  return null;
}

/** A project for a node, in a lab, buying `buy` tokens a minute (no checks). */
function openProject(sim: Sim, id: string, lab: number, buy = 0): Project {
  const { cost, tokens } = effectiveCost(id, sim.mods); // the expertises in place take their share off (D93)
  const p: Project = { id, lab, cost, paid: cost.map(() => 0), dur: 0, el: 0, tokens, tokIn: 0, buy: tokens > 0 ? Math.min(buy, tokens) : 0 };
  sim.notes -= applyNotes(p, sim.notes);
  sim.projects.push(p);
  sim.dirty = true;
  return p;
}

/** A bought flow a command may carry: whole tokens a minute, none below zero. */
const validBuy = (n: number): boolean => Number.isInteger(n) && n >= 0;

/**
 * Start a research node in a lab (the first idle one by default), buying `buy` tokens a minute from
 * CrierBelt for it while it needs them (D118: the launch dialog's choice; ignored at Tier 1).
 */
export function startResearch(sim: Sim, id: string, lab = 0, buy = 0): { ok: boolean; reason: StartBlock | null } {
  const block = researchBlock(sim, id);
  if (block) return { ok: false, reason: block };
  if (!validBuy(buy)) return { ok: false, reason: 'unknown' };
  const labs = idleLabs(sim);
  const at = lab && labs.includes(lab) ? lab : labs[0]!;
  const p = openProject(sim, id, at, buy);
  sim.log.push({ tick: sim.tick, cmd: { k: 'research', id, lab: at, ...(p.buy ? { buy: p.buy } : {}) } });
  return { ok: true, reason: null };
}

/**
 * Change the flow a running project buys (D118: tokens a minute, 0 to stop buying), logged. Only a
 * project that still needs tokens; capped at what it needs in all.
 */
export function setTokenBuy(sim: Sim, id: string, perMin: number): boolean {
  const p = sim.projects.find((q) => q.id === id);
  if (!p || !validBuy(perMin) || tokensLeft(p) <= 0) return false;
  const buy = Math.min(perMin, p.tokens ?? 0);
  if ((p.buy ?? 0) === buy) return false;
  p.buy = buy;
  sim.log.push({ tick: sim.tick, cmd: { k: 'tokenBuy', id, perMin: buy } });
  return true;
}

/**
 * Stop a project: the data files it already paid stay in its lab (for the next project; the Heart
 * takes them if the lab has no room). The tokens delivered to it are spent: compute is paid as it goes.
 */
export function cancelResearch(sim: Sim, id: string): boolean {
  const i = sim.projects.findIndex((p) => p.id === id);
  if (i < 0 || id.startsWith('respec:')) return false;
  const p = sim.projects[i]!;
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

/** The observatory store a project draws from (null for a reconversion or a missing node). */
export function projectStock(sim: Sim, p: Project): Float64Array | null {
  if (!p.lab) return null;
  const n = sim.graph?.nodeByEnt.get(p.lab);
  return n instanceof ReservoirNode ? n.stock : null;
}

/**
 * Power satisfaction (‰) of a project's lab: it takes its data only while powered (reconversions
 * have no lab and always run). A purse in the red no longer holds research itself (D118): only the
 * tokens bought for it (`tokenEpoch`).
 */
export function projectSat(sim: Sim, p: Project, satOf: (net: number) => number): number {
  if (!p.lab) return 1000;
  const n = sim.graph?.nodeByEnt.get(p.lab);
  return n && n.net >= 0 ? satOf(n.net) : 0;
}

/** Online: every project takes the data in its lab; the servers' output and the data generators run. */
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
    if (owedItems(p).length !== owed) owedChanged = true;
    if (projectDone(p)) finished = true;
  }
  if (finished) finishProjects(sim);
  else if (owedChanged) sim.dirty = true; // a lab stops accepting data it no longer owes
}

// ── AI tokens (D68, D118: a flow delivered at each minute's end) ────────────

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
 * The minute boundary's tokens (D118; online from step, offline from the catch-up — the same call,
 * after the trade and the leases): the claim's servers' output of the minute goes to the projects
 * that need tokens in the order they started (the oldest first, each to its need); then each
 * project's bought flow tops it up, at most what it still needs (a flow stops by itself once the
 * project has its tokens), paid to CrierBelt from the purse — none while the purse is in the red.
 * The servers' output nobody needed is lost, or sold back with Server Rental; the Compute Plan's fee
 * each hour. A project whose tokens are now in may be done: the caller finishes it (`projectDone`).
 * Returns whether the bought flows' hold changed.
 */
export function tokenEpoch(sim: Sim): boolean {
  const supply = Math.floor(sim.serverAcc / TOKEN_UNIT);
  sim.serverAcc = 0;
  const hold = sim.credits < 0;
  let left = supply, bought = 0;
  for (const p of sim.projects) {
    let need = tokensLeft(p);
    if (need <= 0) continue;
    const s = Math.min(need, left);
    left -= s;
    need -= s;
    const b = hold ? 0 : Math.min(p.buy ?? 0, need);
    p.tokIn = (p.tokIn ?? 0) + s + b;
    bought += b;
  }
  const fromServers = supply - left, used = fromServers + bought;
  const cents = Math.ceil((bought * tokenPriceK(sim)) / 1000);
  sim.credits -= cents;
  book(sim, 'tokens', -cents);
  let rental = 0;
  if (sim.mods.flags.has('serverRental') && left > 0) {
    rental = Math.floor((left * BAL.tokenCentsPerK * BAL.serverRental) / 1e6);
    sim.credits += rental;
    book(sim, 'rental', rental);
  }
  let fee = 0;
  if (sim.tokenPlan && sim.absEpoch() % 60 === 0) {
    fee = BAL.tokenPlan.feeCentsPerHour;
    sim.credits -= fee;
    book(sim, 'fee', -fee);
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

/**
 * What each running project gets a minute now (D118), as the next boundary would deliver it at this
 * power: its share of the servers' rate (in the order of start, each to its need) and its bought
 * flow (at most what it still needs; none while the purse is in the red). Read-only: the HUD, the
 * tree, the launch dialog.
 */
export function tokenFlows(sim: Sim, satOf: (net: number) => number): Map<string, { servers: number; bought: number }> {
  const out = new Map<string, { servers: number; bought: number }>();
  let left = serverRate(sim, satOf);
  const hold = sim.credits < 0;
  for (const p of sim.projects) {
    const need = tokensLeft(p);
    const s = Math.min(need, left);
    left -= s;
    out.set(p.id, { servers: s, bought: hold ? 0 : Math.min(p.buy ?? 0, need - s) });
  }
  return out;
}

/**
 * Minutes until each running project has its tokens at this power and these flows (D118: whole
 * minutes, the servers going to the oldest project first, a finished one's share passing on);
 * Infinity for one no flow reaches, 0 for one that needs none. Read-only, for the tree and the HUD.
 */
export function tokenEtas(sim: Sim, satOf: (net: number) => number, extra?: { tokens: number; buy: number }): number[] {
  const rate = serverRate(sim, satOf), hold = sim.credits < 0;
  const need = sim.projects.map((p) => tokensLeft(p)), buy = sim.projects.map((p) => (hold ? 0 : p.buy ?? 0));
  if (extra) { need.push(extra.tokens); buy.push(hold ? 0 : extra.buy); }
  const eta = need.map((n) => (n > 0 ? Infinity : 0));
  // From one project's end to the next: each stretch at fixed shares, its last minute stepped exactly.
  for (let t = 0, guard = 0; need.some((n, i) => n > 0 && eta[i] === Infinity) && guard < 64; guard++) {
    let left = rate;
    const r = need.map((n, i) => { if (n <= 0) return 0; const s = Math.min(n, left); left -= s; return s + Math.min(buy[i]!, n - s); });
    let step = Infinity;
    need.forEach((n, i) => { if (n > 0 && r[i]! > 0) step = Math.min(step, Math.ceil(n / r[i]!)); });
    if (!Number.isFinite(step)) break;
    // The stretch's whole minutes before its last, then the last one as the boundary delivers it.
    need.forEach((n, i) => { if (n > 0) need[i] = n - r[i]! * (step - 1); });
    t += step - 1;
    left = rate;
    need.forEach((n, i) => {
      if (n <= 0) return;
      const s = Math.min(n, left); left -= s;
      need[i] = n - s - Math.min(buy[i]!, n - s);
    });
    t += 1;
    need.forEach((n, i) => { if (n <= 0 && eta[i] === Infinity) eta[i] = t; });
  }
  return eta;
}

/** The flows the launch dialog offers (tokens a minute, `BAL.tokenFlow`): 0, then the ladder up to the first that reaches `max`. */
export function tokenFlowSteps(max: number): number[] {
  const out = [0];
  if (max <= 0) return out;
  for (let k = 1; k <= 1e9; k *= 10) {
    for (const m of BAL.tokenFlow.steps) {
      const v = m * k;
      if (v < BAL.tokenFlow.min) continue;
      out.push(v);
      if (v >= max) return out;
    }
  }
  return out;
}

/** The ladder's first flow at least `n` (0 for nothing to buy). */
export const flowStepAtLeast = (n: number): number => (n <= 0 ? 0 : tokenFlowSteps(n).at(-1)!);

/**
 * The flow the launch dialog proposes for a node (D118: « enough to finish in a sensible time given
 * the servers »): its tokens over its tier's pace (`minutes`, `effectiveCost`'s `aim`), less the
 * servers' rate it would get now — all of it unless a running project still takes it, as they go in
 * order of start —, up to the ladder's next step. 0 at Tier 1, or when the servers suffice.
 */
export function tokenBuyDefault(sim: Sim, id: string, satOf: (net: number) => number = (n) => sim.netPower[n]?.sat ?? 0): number {
  if (!hasResearch(id) || researchDef(id).tier < 2) return 0;
  const e = effectiveCost(id, sim.mods);
  if (e.tokens <= 0) return 0;
  const minutes = Math.max(1, Math.ceil(e.aim / EPOCH));
  const free = sim.projects.some((p) => tokensLeft(p) > 0) ? 0 : serverRate(sim, satOf);
  return flowStepAtLeast(Math.ceil(e.tokens / minutes) - free);
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

/** The data makers now: the Heart (Analytics, from the level that mounts its outlet, D86; no power needed), and every autonomous lab whose project still owes data (at its power). */
export function dataMakers(sim: Sim, satOfProject: (p: Project) => number): Array<{ ent: number; stock: Float64Array; rate: number; sat: number; cap?: number }> {
  const out: Array<{ ent: number; stock: Float64Array; rate: number; sat: number; cap?: number }> = [];
  const heart = sim.heartDataRate();
  const data = DATA_IDX();
  // The Core makes its files into its own stock up to its data cap (D118: `BAL.hearthDataCap`).
  if (heart > 0 && sim.hearthId) out.push({ ent: sim.hearthId, stock: sim.stock, rate: heart, sat: 1000, cap: sim.hearthCapOf(data) });
  for (const p of sim.projects) {
    if (!p.lab || !owedItems(p).includes(data)) continue;
    const e = sim.ents.get(p.lab);
    const per = e ? buildingDef(e.def).lab?.dataPerMin ?? 0 : 0;
    const st = sim.stores.get(p.lab);
    if (per > 0 && st) out.push({ ent: p.lab, stock: st, rate: Math.floor((per * 1000 * sim.mods.dataRate) / 1000), sat: satOfProject(p) });
  }
  return out;
}

/**
 * The data makers over `ticks`: whole milli-items, the remainder carried (path-independent: the same
 * online and over a catch-up segment). The Core makes no more than its data cap has room for (D118):
 * what it would make past it is not made — the level only rises while it makes more than leaves, so
 * capping at a segment's end is capping along the way, the same as tick by tick.
 */
export function dataTick(sim: Sim, ticks: number, satOfProject: (p: Project) => number): void {
  const data = DATA_IDX();
  for (const m of dataMakers(sim, satOfProject)) {
    if (m.sat <= 0) continue;
    const w = (sim.dataAcc.get(m.ent) ?? 0) + m.rate * m.sat * ticks;
    const whole = Math.floor(w / TOKEN_UNIT);
    sim.dataAcc.set(m.ent, w - whole * TOKEN_UNIT);
    const made = m.cap === undefined ? whole : Math.min(whole, Math.max(0, Math.floor(m.cap - m.stock[data]!)));
    if (made <= 0) continue;
    m.stock[data] = m.stock[data]! + made;
    sim.produced[data] = sim.produced[data]! + made;
  }
}
const DATA_IDX = (): number => itemIdx('journal_1');

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
    startQueued(sim);
    sim.jobsDirty = true; // harder rock / deep water may have become workable
    sim.events.push({ k: 'structure' });
  }
  return out;
}
