// research.ts — the unlock tree's desk (D33). Plans: unlocked at once by the `unlockPlan`
// command, paid from the Heart's stock (no lab, no time; never lost — a reconversion only
// touches research), never out of CrierBelt's restart reserve (D36, systems/reserve.ts: a plan
// must leave the base able to rebuild its production). Research: starting a node in an idle
// research lab (one project per lab, slots from the Mods), its resources paid from the Core at
// once as a plan's are (D122, under the same reserve), cancelling it (its resources handed back),
// queueing the next one (the Research Queue feature), and the online tick. Reconverting a family is
// retired (D107: its button left the tree); a save's reconversion under way (`respec:<family>`, no
// lab) still runs out and pays its archive notes, which the next projects spend; its family's
// buildings stand dormant until relearnt (`isDormant`).
//
// D118, D122 (owner, 2026-10-17: « on va enlever le principe de la data. Le laboratoire n'a plus
// besoin d'entrée… La monnaie pour débloquer les recherches sera uniquement les tokens »): research
// has no minimum time and no data. Each tier waits for the Core's level (`BAL.tierCoreLevel`: Tier 2
// at 3, then 4, 5), raised by the player. Every node needs a number of AI tokens (D68: never owned),
// delivered as a flow at each minute's end (`tokenEpoch`, online and offline alike) to the projects
// whose lab had power in the minute, in the order they started (the oldest first): the Core's compute
// (`Sim.coreComputeRate`, from its level 2, no power, no ribbon) and the claim's servers' output of
// the minute — what nobody needs is lost, like power, or rented back with Server Rental —, then the
// tokens banked from an older save's data (`tokenBank`), then each project's own flow bought from
// CrierBelt (`buy`, chosen at its launch, changed by `tokenBuy`), which stops by itself once the
// project has its tokens. A purse in the red holds the bought flows until it is back above zero; the
// free flows go on.
import { book } from '../purse';
import { BAL } from '@/content/balance';
import { BUILDING_KIND, buildingDef, hasResearch, itemIdx, toMu } from '@/content/registry';
import { planDef, researchNode } from '@/content/research';
import {
  advanceProject, applyNotes, def as researchDef, effectiveCost, gatesMet, prereqsMet, projectDone,
  tokensLeft, type Project, type StartBlock,
} from '../research/runtime';
import type { Ent } from '../types';
import { EPOCH } from '../constants';
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

/** The labs with a project (D122: they take nothing in; a busy lab draws its full power, an idle one its lights). */
export function busyLabs(sim: Sim): Set<number> {
  const m = new Set<number>();
  for (const p of sim.projects) if (p.lab) m.add(p.lab);
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
  // Its category waits for the categories of the tier before it builds on, finished (D128).
  if (!gatesMet(id, sim.done)) return 'gate';
  const tier = researchDef(id).tier;
  // Each tier waits for the Core's level (D118), Tier 2 also for two expertises chosen at its Archive (D93).
  if (!tierCoreOpen(sim, tier)) return 'core';
  if (tier >= 2 && !tierTwoOpen(sim)) return 'expertise';
  if (sim.projects.length >= sim.mods.slots) return 'slots';
  if (!idleLabs(sim).length) return 'no_lab';
  // Its resources (D122), paid from the Core at launch as a plan's are, and under the same reserve (D36).
  const { cost } = effectiveCost(id, sim.mods);
  if (!cost.every((c) => sim.stock[c.item]! >= c.mu)) return 'unaffordable';
  if (reserveShort(sim, cost).length) return 'reserve';
  return null;
}

/**
 * A project for a node, in a lab, buying `buy` tokens a minute (no checks but the caller's): its
 * resources leave the Core's stock now (D122) — counted as used, like a recipe's inputs.
 */
function openProject(sim: Sim, id: string, lab: number, buy = 0): Project {
  const { cost, tokens } = effectiveCost(id, sim.mods); // the expertises in place take their share off (D93)
  for (const c of cost) {
    sim.stock[c.item] = sim.stock[c.item]! - c.mu;
    sim.consumed[c.item] = sim.consumed[c.item]! + c.mu;
  }
  const p: Project = { id, lab, cost, paid: cost.map((c) => c.mu), dur: 0, el: 0, tokens, tokIn: 0, buy: Math.min(buy, tokens), lit: 0 };
  sim.notes -= applyNotes(p, sim.notes);
  sim.projects.push(p);
  sim.dirty = true;
  return p;
}

/** A bought flow a command may carry: whole tokens a minute, none below zero. */
const validBuy = (n: number): boolean => Number.isInteger(n) && n >= 0;

/**
 * Start a research node in a lab (the first idle one by default), buying `buy` tokens a minute from
 * CrierBelt for it while it needs them (D118: the launch dialog's choice, at every tier since D122).
 * A flow cannot be bought from a purse in the red (`debt`); the free flows need no purse.
 */
export function startResearch(sim: Sim, id: string, lab = 0, buy = 0): { ok: boolean; reason: StartBlock | null } {
  const block = researchBlock(sim, id);
  if (block) return { ok: false, reason: block };
  if (!validBuy(buy)) return { ok: false, reason: 'unknown' };
  if (buy > 0 && sim.credits < 0) return { ok: false, reason: 'debt' };
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
 * Stop a project: the resources it paid at launch go back to the Core (D122: nothing vanishes). The
 * tokens delivered to it are spent: compute is paid as it goes.
 */
export function cancelResearch(sim: Sim, id: string): boolean {
  const i = sim.projects.findIndex((p) => p.id === id);
  if (i < 0 || id.startsWith('respec:')) return false;
  const p = sim.projects[i]!;
  p.cost.forEach((c, j) => { const mu = p.paid[j]!; if (mu > 0) sim.refund(c.item, mu); });
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

/**
 * A lab free with a queued node that could start now (D122: a queued node waits for its resources
 * in the Core too, so the minute's end looks again, not only a project's end).
 */
export function queuedReady(sim: Sim): boolean {
  if (!sim.mods.flags.has('researchQueue') || !sim.labQueue.size) return false;
  const idle = new Set(idleLabs(sim));
  for (const [lab, id] of sim.labQueue) if (idle.has(lab) && researchBlock(sim, id) === null) return true;
  return false;
}

/**
 * Labs free with a queued node that can start now: start it (part of finishing a project, and of
 * each minute's end since D122 — not a command: a replay meets the same starts). Its resources leave
 * the Core then.
 */
export function startQueued(sim: Sim): void {
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

/**
 * Power satisfaction (‰) of a project's lab: it takes its tokens only in a minute its lab had power
 * (D122: `lit`; reconversions have no lab and always run). A purse in the red no longer holds
 * research itself (D118): only the tokens bought for it (`tokenEpoch`).
 */
export function projectSat(sim: Sim, p: Project, satOf: (net: number) => number): number {
  if (!p.lab) return 1000;
  const n = sim.graph?.nodeByEnt.get(p.lab);
  return n && n.net >= 0 ? satOf(n.net) : 0;
}

/**
 * The labs' power over `ticks` (online one tick, offline a segment): each project's `lit` (‰·ticks,
 * the same sum either way, like the servers' output), and a reconversion's time.
 */
export function labTick(sim: Sim, ticks: number, satOfProject: (p: Project) => number): void {
  for (const p of sim.projects) {
    if (!p.lab) { advanceProject(p, ticks, 1000); continue; }
    const sat = satOfProject(p);
    if (sat > 0) p.lit = (p.lit ?? 0) + sat * ticks;
  }
}

/** Online: the servers' output and the labs' power, a tick; a reconversion that has run its time ends. */
export function researchTick(sim: Sim): void {
  const satOf = (n: number): number => sim.ctx.sat[n]!;
  serverTick(sim, 1, satOf);
  if (!sim.projects.length) return;
  labTick(sim, 1, (p) => projectSat(sim, p, satOf));
  if (sim.projects.some(projectDone)) finishProjects(sim);
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

/** Tokens a minute the servers (and autonomous labs) make at their grids' satisfaction (the catch-up's rate, the HUD). */
export function serverRate(sim: Sim, satOf: (net: number) => number): number {
  let t = 0;
  for (const s of sim.graph?.servers ?? []) t += Math.floor((s.tpm * satOf(s.net)) / 1000);
  return t;
}

/** Tokens a minute research gets free now (D122): the Core's compute and the servers at their power. */
export const freeRate = (sim: Sim, satOf: (net: number) => number): number => sim.coreComputeRate() + serverRate(sim, satOf);

/** CrierBelt's price for 1 000 tokens now (centi-◉): its list price, halved under the Compute Plan. */
export function tokenPriceK(sim: Sim): number {
  return sim.tokenPlan ? Math.floor((BAL.tokenCentsPerK * BAL.tokenPlan.priceFactor) / 1000) : BAL.tokenCentsPerK;
}

/**
 * The minute boundary's tokens (D118, D122; online from step, offline from the catch-up — the same
 * call, after the trade and the leases). The free pool — the Core's compute (its rate now) first,
 * then the servers' output of the minute — goes to the projects that need tokens and whose lab had
 * power in the minute (`lit`), in the order they started (the oldest first, each to its need); then
 * the bank (an older save's data, D122) tops each up; then each project's bought flow, at most what
 * it still needs (a flow stops by itself once the project has its tokens), paid to CrierBelt from
 * the purse — none while the purse is in the red. What nobody needed is lost — the servers' share
 * sold back with Server Rental; the Compute Plan's fee each hour. A project whose tokens are now in
 * is done: the caller finishes it (`projectDone`). Returns whether the bought flows' hold changed.
 */
export function tokenEpoch(sim: Sim): boolean {
  const servers = Math.floor(sim.serverAcc / TOKEN_UNIT);
  sim.serverAcc = 0;
  const core = sim.coreComputeRate(), supply = core + servers;
  const hold = sim.credits < 0;
  let left = supply, bought = 0, banked = 0;
  for (const p of sim.projects) {
    const lit = !p.lab || (p.lit ?? 0) > 0;
    p.lit = 0;
    let need = tokensLeft(p);
    if (need <= 0 || !lit) continue;
    const s = Math.min(need, left);
    left -= s;
    need -= s;
    const k = Math.min(need, sim.tokenBank);
    sim.tokenBank -= k;
    need -= k;
    const b = hold ? 0 : Math.min(p.buy ?? 0, need);
    p.tokIn = (p.tokIn ?? 0) + s + k + b;
    bought += b;
    banked += k;
  }
  const free = supply - left, fromCore = Math.min(core, free), fromServers = free - fromCore, used = free + banked + bought;
  const cents = Math.ceil((bought * tokenPriceK(sim)) / 1000);
  sim.credits -= cents;
  book(sim, 'tokens', -cents);
  let rental = 0;
  const idle = servers - fromServers; // the Core's compute is used first: what is left of the pool is the servers'
  if (sim.mods.flags.has('serverRental') && idle > 0) {
    rental = Math.floor((idle * BAL.tokenCentsPerK * BAL.serverRental) / 1e6);
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
  st.used = used; st.fromCore = fromCore; st.fromServers = fromServers; st.fromBank = banked; st.bought = bought; st.cents = cents; st.supply = servers; st.core = core; st.rental = rental;
  st.totalUsed += used; st.totalBought += bought; st.totalCents += cents + fee - rental;
  const held = sim.credits < 0;
  if (held === sim.researchHeld) return false;
  sim.researchHeld = held;
  sim.events.push({ k: 'researchHeld', held });
  return true;
}

/** Is a project's lab powered now (a reconversion has none and always runs)? */
const litNow = (sim: Sim, p: Project, satOf: (net: number) => number): boolean => projectSat(sim, p, satOf) > 0;

/**
 * What each running project gets at the next boundary at this power (D118, D122): its share of the
 * free flows (the Core's compute and the servers, in the order of start, each to its need), the
 * bank's tokens it would take, and its bought flow (at most what it still needs; none while the
 * purse is in the red). A project whose lab has no power now gets nothing. Read-only: the HUD, the
 * tree, the launch dialog.
 */
export function tokenFlows(sim: Sim, satOf: (net: number) => number): Map<string, { free: number; bank: number; bought: number }> {
  const out = new Map<string, { free: number; bank: number; bought: number }>();
  let left = freeRate(sim, satOf), bank = sim.tokenBank;
  const hold = sim.credits < 0;
  for (const p of sim.projects) {
    const need = tokensLeft(p);
    if (!litNow(sim, p, satOf)) { out.set(p.id, { free: 0, bank: 0, bought: 0 }); continue; }
    const s = Math.min(need, left);
    left -= s;
    const k = Math.min(need - s, bank);
    bank -= k;
    out.set(p.id, { free: s, bank: k, bought: hold ? 0 : Math.min(p.buy ?? 0, need - s - k) });
  }
  return out;
}

/**
 * Minutes until each running project has its tokens at this power and these flows (D118: whole
 * minutes, the free flows going to the oldest project first, a finished one's share passing on, the
 * bank's tokens at the first boundary); Infinity for one no flow reaches (or whose lab has no power),
 * 0 for one that needs none. Read-only, for the tree and the HUD.
 */
export function tokenEtas(sim: Sim, satOf: (net: number) => number, extra?: { tokens: number; buy: number }): number[] {
  const rate = freeRate(sim, satOf), hold = sim.credits < 0;
  const lit = sim.projects.map((p) => litNow(sim, p, satOf));
  const need = sim.projects.map((p, i) => (lit[i] ? tokensLeft(p) : 0)), buy = sim.projects.map((p) => (hold ? 0 : p.buy ?? 0));
  if (extra) { need.push(extra.tokens); buy.push(hold ? 0 : extra.buy); lit.push(true); }
  const eta = need.map((n, i) => (!lit[i] ? Infinity : n > 0 ? Infinity : 0));
  // The bank pays at the first boundary, oldest first: what it covers is in then.
  let bank = sim.tokenBank;
  need.forEach((n, i) => { const k = Math.min(n, bank); bank -= k; need[i] = n - k; if (k > 0 && need[i] === 0) eta[i] = 1; });
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
    need.forEach((n, i) => { if (n <= 0 && eta[i] === Infinity && lit[i]) eta[i] = Math.max(t, 1); });
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

/** Where a new project's tokens would come from (D128's launch dialog), and when they would be in. */
export interface LaunchSources {
  /** From the bank (an older save's data turned into tokens, D122), all at the first boundary. */
  bank: number;
  /** From the free flows: the Core's compute and the claim's servers. */
  free: number;
  /** Bought from CrierBelt at its flow. */
  bought: number;
  /** Never delivered at these flows (none reaches it once the others are done). */
  short: number;
  /** Minute boundaries until its tokens are in (Infinity: never). */
  minutes: number;
}

/**
 * Where a new project's tokens would come from, appended after the running ones, as the minute's
 * boundary delivers them (`tokenEpoch`, D118, D122): the free `rate` to the projects in the order
 * they started, each to its need; then the bank's tokens, each to what it still needs; then each
 * one's bought flow, at most what it still needs. The bank pays at the first boundary — after it,
 * the bank is spent or every need met —; then stretch by stretch at fixed shares, the last minute of
 * each stepped exactly, as `tokenEtas` does. `running`: each running project's tokens still needed
 * (0 for one whose lab has no power: it takes nothing) and its flow (0 while the purse is in the red).
 * Pure: the launch dialog's bar and end, and the flow it proposes (`tokenBuyDefault`).
 */
export function launchSources(rate: number, running: ReadonlyArray<{ need: number; buy: number }>, bank: number, extra: { tokens: number; buy: number }): LaunchSources {
  const need = [...running.map((p) => Math.max(0, p.need)), Math.max(0, extra.tokens)], buy = [...running.map((p) => p.buy), extra.buy];
  const x = need.length - 1;
  const out: LaunchSources = { bank: 0, free: 0, bought: 0, short: 0, minutes: 0 };
  if (need[x]! <= 0) return out;
  // The first boundary: the free flows, then the bank, then the flows bought.
  let left = rate, bk = Math.max(0, bank);
  need.forEach((v, i) => {
    if (v <= 0) return;
    const s = Math.min(v, left); left -= s;
    const k = Math.min(v - s, bk); bk -= k;
    const b = Math.min(buy[i]!, v - s - k);
    need[i] = v - s - k - b;
    if (i === x) { out.free += s; out.bank += k; out.bought += b; }
  });
  out.minutes = 1;
  for (let guard = 0; need[x]! > 0 && guard < 64; guard++) {
    left = rate;
    const s = need.map((v) => { if (v <= 0) return 0; const g = Math.min(v, left); left -= g; return g; });
    const r = need.map((v, i) => (v <= 0 ? 0 : s[i]! + Math.min(buy[i]!, v - s[i]!)));
    let step = Infinity;
    need.forEach((v, i) => { if (v > 0 && r[i]! > 0) step = Math.min(step, Math.ceil(v / r[i]!)); });
    if (!Number.isFinite(step)) break;
    // The stretch's whole minutes before its last, at fixed shares…
    out.free += s[x]! * (step - 1);
    out.bought += (r[x]! - s[x]!) * (step - 1);
    need.forEach((v, i) => { if (v > 0) need[i] = v - r[i]! * (step - 1); });
    // …then its last minute, as the boundary delivers it.
    left = rate;
    need.forEach((v, i) => {
      if (v <= 0) return;
      const g = Math.min(v, left); left -= g;
      const bb = Math.min(buy[i]!, v - g);
      if (i === x) { out.free += g; out.bought += bb; }
      need[i] = v - g - bb;
    });
    out.minutes += step;
  }
  if (need[x]! > 0) { out.short = need[x]!; out.minutes = Infinity; }
  return out;
}

/**
 * The running projects as the next boundaries see them (D118, D122): each one's tokens still needed
 * (none while its lab has no power) and its bought flow (none while the purse is in the red), in the
 * order they started; and the free rate now (the Core's compute and the servers at their power).
 */
export function launchQueue(sim: Sim, satOf: (net: number) => number): { rate: number; running: Array<{ id: string; need: number; buy: number }> } {
  const hold = sim.credits < 0;
  return {
    rate: freeRate(sim, satOf),
    running: sim.projects.map((p) => ({ id: p.id, need: litNow(sim, p, satOf) ? tokensLeft(p) : 0, buy: hold ? 0 : p.buy ?? 0 })),
  };
}

/**
 * The flow the launch dialog proposes for a node (D118: « enough to finish in a sensible time given
 * the servers »): the first of the ladder's flows (`tokenFlowSteps`) at which its tokens are in by its
 * tier's pace (`minutes`, `effectiveCost`'s `aim`), the tokens coming as the engine delivers them
 * (`launchSources`): the free flows once the projects before it have theirs, the bank's first (D128:
 * a reserve that covers it proposes nothing to buy). 0 when the free flows and the bank suffice: at
 * Tier 1, the Core's compute alone (D122).
 */
export function tokenBuyDefault(sim: Sim, id: string, satOf: (net: number) => number = (n) => sim.netPower[n]?.sat ?? 0): number {
  if (!hasResearch(id)) return 0;
  const e = effectiveCost(id, sim.mods);
  if (e.tokens <= 0) return 0;
  const minutes = Math.max(1, Math.ceil(e.aim / EPOCH));
  const q = launchQueue(sim, satOf);
  const steps = tokenFlowSteps(e.tokens);
  return steps.find((b) => launchSources(q.rate, q.running, sim.tokenBank, { tokens: e.tokens, buy: b }).minutes <= minutes) ?? steps[steps.length - 1]!;
}

/** Subscribe to (or leave) CrierBelt's Compute Plan (cm_plan): tokens at a share of the price, for a fee each hour. Logged. */
export function setTokenPlan(sim: Sim, on: boolean): boolean {
  if (on && !sim.mods.flags.has('tokenPlan')) return false;
  if (sim.tokenPlan === on) return false;
  sim.tokenPlan = on;
  sim.log.push({ tick: sim.tick, cmd: { k: 'tokenPlan', on } });
  return true;
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
    startQueued(sim);
    sim.jobsDirty = true; // harder rock / deep water may have become workable
    sim.events.push({ k: 'structure' });
  }
  return out;
}
