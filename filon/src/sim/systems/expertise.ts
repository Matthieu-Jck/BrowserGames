// expertise.ts — the claim's expertises (D93, content/expertises.ts): feats counted, ranks earned,
// two held at a time, a réorientation paid and 24 h without.
//   · FEATS are read off the colony at every minute's boundary (`expertiseEpoch`: online from
//     `Sim.step`, offline from the catch-up — the same call, after the trade, the leases and the
//     tokens' bill): cumulative counters the engine keeps anyway (what was produced, the Crier's
//     lifetime sales and purchases, the tokens research used), what stands (generators, machines,
//     ribbons, parcels bought, tiles dug), and one counter of its own, the Core's grid held: the
//     minutes in a row it served `gridPermille` at the minute's end, and the best such run. A
//     minute's boundary is a segment's end in the catch-up, where every one of these is exact as
//     online whenever the regimes are (docs/offline.md).
//   · RANKS rise when a feat reaches a threshold, never fall. Until the Core mounts the Archive
//     (its level 3) they are earned in silence; from then each one earned is announced.
//   · SLOTS hold the expertises chosen (`choose`, into an empty slot: in place at once). Changing
//     one is a réorientation (`reorient`): paid from the purse, dearer each time, the old one gone
//     at once and the new one in place at the first boundary 24 h later (`on`). Both are commands,
//     logged and replayed.
//   · EFFECTS: the held expertises at their rank go into the Mods (research/modifiers.ts), rebuilt
//     with `Sim.rebuildDerived` — so a rank earned or a slot coming into place at a boundary
//     changes the graph there, online and in the catch-up alike (it materializes and recompiles).
//   · TIER 2 opens once both slots have been filled (`tierTwoOpen`; a claim from before the
//     expertises that already holds a Tier 2 node keeps it open).
// Integer maths; no text (the window says it: ui/screens/expertise.ts).
import { book } from '../purse';
import { BAL } from '@/content/balance';
import { EXPERTISE_IDS, expertiseDef, isExpertise, rankFor, type ExpertiseDef, type FeatKind } from '@/content/expertises';
import { BUILDING_KIND, N_ITEMS, buildingDef, itemDef } from '@/content/registry';
import { researchNode } from '@/content/research';
import { TIER2_UP_V10 } from '@/content/retired';
import type { StateHasher } from '@/core/hash';
import type { Sim } from '../state';

/** A slot's expertise and the world minute (`absEpoch`) it holds from; `on` once in place. */
export interface Slot { id: string; at: number; on: boolean }

export interface ExpertiseState {
  /** Earned ranks (1–3) by expertise; absent: none yet. Never fall. */
  ranks: Map<string, number>;
  /** The slots (`BAL.expertise.slots`), null while empty. */
  slots: Array<Slot | null>;
  /** Réorientations made: the next one's price grows with them. */
  reorients: number;
  /** The Core's grid: minutes in a row it served `gridPermille` at a minute's end, and the best run (the `grid` feat). */
  streak: number;
  best: number;
}

export const newExpertiseState = (): ExpertiseState => ({ ranks: new Map(), slots: Array.from({ length: BAL.expertise.slots }, () => null), reorients: 0, streak: 0, best: 0 });

/** Why choosing or reorienting would be refused (null: it would go through). */
export type ExpertiseBlock = 'unknown' | 'locked' | 'slot' | 'full' | 'empty' | 'unearned' | 'held' | 'funds';

/** Items whose making counts for a feat, by item kind. */
const MINED = new Set(['ore', 'fuel', 'rubble', 'unique']);
const MADE = new Set(['material', 'part']);

/** The items of each counted kind (the registry's order), cached: the boundary sums them each minute. */
let byFeat: { mined: number[]; made: number[]; data: number[] } | null = null;
function featItems(): { mined: number[]; made: number[]; data: number[] } {
  if (byFeat) return byFeat;
  const mined: number[] = [], made: number[] = [], data: number[] = [];
  for (let i = 0; i < N_ITEMS; i++) {
    const k = itemDef(i).kind;
    if (MINED.has(k)) mined.push(i);
    else if (MADE.has(k)) made.push(i);
    else if (k === 'science') data.push(i);
  }
  return (byFeat = { mined, made, data });
}

/** Whole items made of these kinds (`produced` is in milli-items). */
function madeOf(sim: Sim, items: readonly number[]): number {
  let mu = 0;
  for (const i of items) mu += sim.produced[i]!;
  return Math.floor(mu / 1000);
}

/** Σ over the building defs standing of `per(def)` (`defCounts`: cached between structural changes). */
function standing(sim: Sim, per: (def: number) => number): number {
  const counts = sim.ents.defCounts();
  let n = 0;
  for (let d = 0; d < counts.length; d++) if (counts[d]) n += counts[d]! * per(d);
  return n;
}

/** A feat's value now, in its unit (content/expertises.ts `FeatKind`). */
export function featValue(sim: Sim, kind: FeatKind): number {
  switch (kind) {
    case 'grid': return sim.expertise.best;
    case 'capacity': return standing(sim, (d) => buildingDef(d).gen?.kw ?? 0);
    case 'mined': return madeOf(sim, featItems().mined);
    case 'dug': return sim.grid.terrainDiff.size;
    case 'made': return madeOf(sim, featItems().made);
    case 'machines': return standing(sim, (d) => (BUILDING_KIND[d] === 'machine' ? 1 : 0));
    case 'sold': return Math.floor(sim.trade.earned / 100);
    case 'bought': return Math.floor(sim.trade.spent / 100);
    case 'data': return madeOf(sim, featItems().data);
    case 'tokens': return sim.tokenStats.totalUsed;
    case 'parcels': return sim.land.bought.size;
    case 'ribbons': return standing(sim, (d) => (BUILDING_KIND[d] === 'belt' ? 1 : 0));
  }
}

/** An expertise's earned rank (0: none yet). */
export const rankOf = (sim: Sim, id: string): number => sim.expertise.ranks.get(id) ?? 0;

/** Is the Archive mounted (the Core's level), so the window opens and expertises can be chosen? */
export const archiveOpen = (sim: Sim): boolean => sim.hearthLevel >= BAL.expertise.level;

/** The expertises in place now, at their rank (what the Mods take). */
export function heldExpertises(sim: Sim): Array<{ id: string; rank: number }> {
  const out: Array<{ id: string; rank: number }> = [];
  for (const s of sim.expertise.slots) if (s?.on) out.push({ id: s.id, rank: Math.max(1, rankOf(sim, s.id)) });
  return out;
}

/** Is it in a slot (in place or on its way)? */
export const inSlot = (sim: Sim, id: string): number => sim.expertise.slots.findIndex((s) => s?.id === id);

/**
 * Tier 2 is open: both slots filled once (a réorientation keeps the slot filled); or a claim from
 * before the expertises already holds a node of Tier 2 or beyond, then and now (`TIER2_UP_V10`,
 * frozen): a node the tree moved into Tier 2 later (the Sifter, the Standing Orders) or down to
 * Tier 1 (the Fast Drill, D107) opens nothing.
 */
export function tierTwoOpen(sim: Sim): boolean {
  if (sim.expertise.slots.every((s) => s !== null)) return true;
  for (const id of sim.done) if (TIER2_UP_V10.has(id) && (researchNode(id)?.tier ?? 0) >= 2) return true;
  return false;
}

/** The next réorientation's price (centi-◉): the first's, × `reorientGrowth` ‰ for each made before. */
export function reorientCost(sim: Sim): number {
  let c: number = BAL.expertise.reorientCents;
  for (let i = 0; i < sim.expertise.reorients; i++) c = Math.floor((c * BAL.expertise.reorientGrowth) / 1000);
  return c;
}

/** The checks both commands share: a known expertise, the Archive mounted, a slot that exists, earned, not in a slot already. */
function common(sim: Sim, slot: number, id: string): ExpertiseBlock | null {
  if (!isExpertise(id)) return 'unknown';
  if (!archiveOpen(sim)) return 'locked';
  if (!Number.isInteger(slot) || slot < 0 || slot >= sim.expertise.slots.length) return 'slot';
  if (rankOf(sim, id) < 1) return 'unearned';
  if (inSlot(sim, id) >= 0) return 'held';
  return null;
}

/** Why choosing `id` into an empty `slot` would be refused (null: it would go through). */
export function chooseBlock(sim: Sim, slot: number, id: string): ExpertiseBlock | null {
  const c = common(sim, slot, id);
  if (c && c !== 'held') return c;
  if (sim.expertise.slots[slot]) return 'full';
  return c;
}

/** Choose an expertise into an empty slot: in place at once, free. Logged. */
export function choose(sim: Sim, slot: number, id: string): ExpertiseBlock | null {
  const block = chooseBlock(sim, slot, id);
  if (block) return block;
  sim.expertise.slots[slot] = { id, at: sim.absEpoch(), on: true };
  sim.log.push({ tick: sim.tick, cmd: { k: 'expertise', slot, id } });
  sim.rebuildDerived();
  return null;
}

/** Why replacing what `slot` holds by `id` would be refused (null: it would go through). */
export function reorientBlock(sim: Sim, slot: number, id: string): ExpertiseBlock | null {
  const c = common(sim, slot, id);
  if (c && c !== 'held') return c;
  if (!sim.expertise.slots[slot]) return 'empty';
  if (c) return c;
  if (sim.credits < reorientCost(sim)) return 'funds';
  return null;
}

/**
 * A réorientation: the slot's expertise goes at once, the new one comes into place at the first
 * minute's boundary `gapMinutes` later; its price leaves the purse and the next one's grows. Logged.
 */
export function reorient(sim: Sim, slot: number, id: string): ExpertiseBlock | null {
  const block = reorientBlock(sim, slot, id);
  if (block) return block;
  const cost = reorientCost(sim);
  sim.credits -= cost;
  book(sim, 'reorient', -cost);
  sim.expertise.reorients++;
  sim.expertise.slots[slot] = { id, at: sim.absEpoch() + BAL.expertise.gapMinutes, on: false };
  sim.log.push({ tick: sim.tick, cmd: { k: 'reorient', slot, id } });
  sim.rebuildDerived();
  return null;
}

/**
 * A minute's boundary (online from `step`, offline from the catch-up — the same call): the Core's
 * grid's minute (`satOf`: its satisfaction ‰ as the tick or the segment just ended served it), the
 * ranks the feats now reach, the slots whose gap ends. Returns whether the Mods changed (a rank
 * rising for an expertise in place, or one coming into place): the caller's graph must be rebuilt
 * (`rebuildDerived` is called here).
 */
export function expertiseEpoch(sim: Sim, satOf: (net: number) => number): boolean {
  const x = sim.expertise;
  const net = sim.graph?.hearth?.net ?? -1;
  if (net >= 0 && satOf(net) >= BAL.expertise.gridPermille) {
    x.streak++;
    if (x.streak > x.best) x.best = x.streak;
  } else x.streak = 0;
  const loud = archiveOpen(sim);
  let changed = false;
  for (const id of EXPERTISE_IDS) {
    const d: ExpertiseDef = expertiseDef(id)!;
    const had = x.ranks.get(id) ?? 0;
    if (had >= 3) continue;
    const r = rankFor(d, featValue(sim, d.feat));
    if (r <= had) continue;
    x.ranks.set(id, r);
    if (loud) sim.events.push({ k: 'expertise', id, rank: r, what: 'earned' });
    if (x.slots.some((s) => s?.on && s.id === id)) changed = true;
  }
  const now = sim.absEpoch();
  for (const s of x.slots) {
    if (!s || s.on || now < s.at) continue;
    s.on = true;
    changed = true;
    sim.events.push({ k: 'expertise', id: s.id, rank: rankOf(sim, s.id), what: 'ready' });
  }
  if (changed) sim.rebuildDerived();
  return changed;
}

// ── save & hash ─────────────────────────────────────────────────────────────

/** As saved: ranks [id, rank], slots [id, world minute, 1 when in place] or null, réorientations, the grid's run and best. */
export interface ExpertiseSave {
  ranks: Array<[string, number]>;
  slots: Array<[string, number, number] | null>;
  reorients: number;
  streak: number;
  best: number;
}

export function saveExpertise(x: ExpertiseState): ExpertiseSave {
  return {
    ranks: [...x.ranks].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    slots: x.slots.map((s) => (s ? [s.id, s.at, s.on ? 1 : 0] : null)),
    reorients: x.reorients, streak: x.streak, best: x.best,
  };
}

/** Back from a save (absent: a claim from before the expertises, nothing earned). An expertise gone from the content is dropped, its slot emptied. */
export function loadExpertise(d: ExpertiseSave | undefined): ExpertiseState {
  const x = newExpertiseState();
  if (!d) return x;
  for (const [id, r] of d.ranks ?? []) if (isExpertise(id) && r >= 1) x.ranks.set(id, Math.min(3, Math.floor(r)));
  (d.slots ?? []).forEach((s, i) => { if (s && i < x.slots.length && isExpertise(s[0])) x.slots[i] = { id: s[0], at: s[1], on: s[2] === 1 }; });
  x.reorients = d.reorients ?? 0;
  x.streak = d.streak ?? 0;
  x.best = d.best ?? 0;
  return x;
}

export function hashExpertise(x: ExpertiseState, h: StateHasher): void {
  for (const id of EXPERTISE_IDS) h.int(x.ranks.get(id) ?? 0);
  for (const s of x.slots) { if (s) h.str(s.id).int(s.at).int(s.on ? 1 : 0); else h.int(-1); }
  h.int(x.reorients).int(x.streak).int(x.best);
}
