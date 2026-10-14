// runtime.ts — research as the engine runs it. A project sits in a research lab (one per lab,
// as many as the research slots allow); data files reach the lab by ribbon and pile up in its
// store; the project draws from that store under an ALLOWANCE: by elapsed powered time e
// (milli-ticks), it may have paid at most ⌊cost·e / (dur·1000)⌋ of each item. So it can never
// finish before its minimum duration, takes longer when data runs short, and — being a function
// of e only — pays exactly the same online and in the offline catch-up whenever data is
// plentiful. Its AI tokens follow the same allowance (D68): ⌊tokens·e / (dur·1000)⌋ are used by
// e, billed at each minute boundary (systems/research.ts `tokenEpoch`) — the claim's servers
// first, CrierBelt's the rest. A node's cost and duration grow with the nodes owned elsewhere
// (another family, or the sibling speciality once the family has split), the more so the higher
// its tier (D69):
//   cost = ⌈base × (1 + spread[tier]·N_elsewhere) × (1 − 0.04·min(n_lineage, 8))⌉
//   time = D × (1 + spreadTime[tier]·N_elsewhere) × (0.85 if n_lineage ≥ 6)
// (the trunk escapes both). Integer maths throughout.
import { BAL } from '@/content/balance';
import { FAMILY_IDS, RESEARCH, researchNode, type ResearchId } from '@/content/research';
import { RESEARCH_IDS, itemDef, itemIdx } from '@/content/registry';
import type { FamilyId, ResearchDef } from '@/content/types';
import { ceilDiv, mulDiv } from '@/core/fixed';
import { TPS } from '../constants';

/** A research family (D69); `BranchId` is its old name, kept for the reconversion's command. */
export type BranchId = FamilyId;
export const BRANCHES: readonly BranchId[] = FAMILY_IDS;

export interface Project {
  /** Research id, or `respec:<family>` for a reconversion in progress. */
  id: string;
  /** Lab entity (0 for a reconversion: it holds a slot but no lab). */
  lab: number;
  cost: Array<{ item: number; mu: number }>;
  paid: number[];
  /** Minimum duration in ticks. */
  dur: number;
  /** Elapsed powered time, milli-ticks (+ satisfaction ‰ per tick). */
  el: number;
  /** Reconversion: archive notes granted when it completes. */
  notes?: number;
  /** AI tokens the whole project uses (D68), and those already counted as used (billed at the minute). */
  tokens?: number;
  tokUsed?: number;
}

export const def = (id: string): ResearchDef => RESEARCH[id as ResearchId] as ResearchDef;

/** Nodes owned per family (trunk excluded). */
export function branchCounts(done: ReadonlySet<string>): Record<BranchId, number> {
  const c: Record<BranchId, number> = { en: 0, ex: 0, dn: 0, cm: 0, an: 0, xp: 0 };
  for (const id of done) {
    const r = researchNode(id);
    if (r && r.branch !== 'trunk') c[r.branch] += 1;
  }
  return c;
}

/**
 * For a node: how many owned nodes stand elsewhere (other families, and the sibling speciality
 * once its family has split) and how many in its own lineage (its family's shared nodes and its
 * own speciality). Iteration order does not matter: they are counts.
 */
export function lineage(id: string, done: ReadonlySet<string>): { elsewhere: number; own: number } {
  const r = def(id);
  let elsewhere = 0, own = 0;
  if (r.branch === 'trunk') return { elsewhere, own };
  for (const d of done) {
    if (d === id) continue;
    const o = researchNode(d);
    if (!o || o.branch === 'trunk') continue;
    if (o.branch !== r.branch) elsewhere++;
    else if (r.spec && o.spec && o.spec !== r.spec) elsewhere++;
    else own++;
  }
  return { elsewhere, own };
}

/** Cost multiplier (‰) and duration multiplier (‰) for a node given what is owned. */
export function penalty(id: string, done: ReadonlySet<string>): { cost: number; time: number } {
  const r = def(id);
  if (r.branch === 'trunk') return { cost: 1000, time: 1000 };
  const { elsewhere, own } = lineage(id, done);
  const t = r.tier - 1;
  const spread = BAL.spreadCostByTier[t] ?? BAL.spreadCostByTier[BAL.spreadCostByTier.length - 1]!;
  const spreadT = BAL.spreadTimeByTier[t] ?? BAL.spreadTimeByTier[BAL.spreadTimeByTier.length - 1]!;
  const cost = Math.floor(((1000 + spread * elsewhere) * (1000 - BAL.depthDiscountPerNode * Math.min(own, 8))) / 1000);
  let time = 1000 + spreadT * elsewhere;
  if (own >= 6) time = Math.floor((time * BAL.masterTimeFactor) / 1000);
  return { cost, time };
}

/** Effective cost (milli-items, whole items), AI tokens and minimum duration (ticks) of a node. */
export function effectiveCost(id: string, done: ReadonlySet<string>): { cost: Array<{ item: number; mu: number }>; tokens: number; ticks: number } {
  const r = def(id);
  const p = penalty(id, done);
  const cost = r.cost.map(([it, q]) => ({ item: itemIdx(it), mu: ceilDiv(q * p.cost, 1000) * 1000 }));
  const tokens = ceilDiv(r.tokens * p.cost, 1000);
  const ticks = mulDiv(r.minutes * 60 * TPS, p.time, 1000);
  return { cost, tokens, ticks };
}

/** AI tokens a project has used by its elapsed time (the allowance, D68). */
export function tokensDue(p: Project): number {
  const t = p.tokens ?? 0;
  const cap = p.dur * 1000;
  if (t <= 0) return 0;
  if (cap <= 0) return t;
  return mulDiv(t, Math.min(p.el, cap), cap);
}

/** Tokens used since they were last counted (and counts them): what the minute's bill takes. */
export function takeTokens(p: Project): number {
  const due = tokensDue(p);
  const d = due - (p.tokUsed ?? 0);
  p.tokUsed = due;
  return d > 0 ? d : 0;
}

/** Why a node cannot start right now (null = it can). */
export type StartBlock = 'done' | 'active' | 'prereq' | 'slots' | 'no_lab' | 'unknown' | 'debt';

export function prereqsMet(id: string, done: ReadonlySet<string>): boolean {
  return def(id).prereq.every((p) => done.has(p));
}

/** Science value (centi-◉) of milli-items of an item — the unit of archive notes. */
export const noteValue = (item: number, mu: number): number => Math.floor((mu * Math.round((itemDef(item).value ?? 0) * 100)) / 1000);

/**
 * Apply archive notes to a fresh project: each cost entry is pre-paid as far as the notes
 * go (value for value). Returns the notes spent.
 */
export function applyNotes(p: Project, notes: number): number {
  let left = notes;
  p.cost.forEach((c, i) => {
    const per = Math.round((itemDef(c.item).value ?? 0) * 100); // centi-◉ per item
    if (per <= 0 || left <= 0) return;
    const items = Math.min(c.mu / 1000 - p.paid[i]! / 1000, Math.floor(left / per));
    if (items <= 0) return;
    p.paid[i] = p.paid[i]! + items * 1000;
    left -= items * per;
  });
  return notes - left;
}

/**
 * Advance a project by `ticks` at satisfaction `sat` (‰), paying from `stock` under the
 * allowance. Returns milli-items paid per cost entry. Path-independent: the paid total
 * after any split of the same ticks is the same when the stock suffices.
 */
export function advanceProject(p: Project, stock: Float64Array | null, ticks: number, sat: number): number[] {
  p.el += sat * ticks;
  const cap = p.dur * 1000;
  const out = p.cost.map(() => 0);
  if (!stock) return out;
  const el = Math.min(p.el, cap);
  p.cost.forEach((c, i) => {
    const allowed = cap > 0 ? mulDiv(c.mu, el, cap) : c.mu;
    const due = allowed - p.paid[i]!;
    if (due <= 0) return;
    const pay = Math.min(due, Math.floor(stock[c.item]!));
    if (pay <= 0) return;
    stock[c.item] = stock[c.item]! - pay;
    p.paid[i] = p.paid[i]! + pay;
    out[i] = pay;
  });
  return out;
}

export const projectDone = (p: Project): boolean => p.el >= p.dur * 1000 && p.cost.every((c, i) => p.paid[i]! >= c.mu);

/** Fraction (‰) of a project: the slower of time and payment. */
export function projectPermille(p: Project): number {
  const t = p.dur > 0 ? Math.min(1000, Math.floor(p.el / p.dur)) : 1000;
  let pay = 1000;
  p.cost.forEach((c, i) => { pay = Math.min(pay, c.mu > 0 ? Math.floor((p.paid[i]! * 1000) / c.mu) : 1000); });
  return Math.min(t, pay);
}

/** Science items an observatory should accept for its project (those still owed). */
export function owedItems(p: Project): number[] {
  return p.cost.filter((c, i) => p.paid[i]! < c.mu).map((c) => c.item);
}

/** The deepest owned nodes of a family, deepest first (the order a reconversion removes them). */
export function respecOrder(branch: BranchId, done: ReadonlySet<string>): string[] {
  return RESEARCH_IDS.filter((id) => done.has(id) && def(id).branch === branch).sort((a, b) => def(b).depth - def(a).depth || (a < b ? 1 : a > b ? -1 : 0));
}

/** Ticks a reconversion holds a slot: 25 % of the removed nodes' durations, at most 48 h. */
export function respecTicks(removed: readonly string[], done: ReadonlySet<string>): number {
  let t = 0;
  const after = new Set(done);
  for (const id of removed) { after.delete(id); t += effectiveCost(id, after).ticks; }
  return Math.min(Math.floor(t / 4), 48 * 3600 * TPS);
}

/** Archive notes refunded for removed nodes: 50 % of their data files' value (25 % keystones); tokens are spent compute, never refunded. */
export function respecRefund(removed: readonly string[], done: ReadonlySet<string>): number {
  let notes = 0;
  const after = new Set(done);
  for (const id of removed) {
    after.delete(id);
    const share = def(id).depth === 9 ? BAL.respecRefund / 2 : BAL.respecRefund;
    for (const c of effectiveCost(id, after).cost) notes += Math.floor((noteValue(c.item, c.mu) * share) / 1000);
  }
  return notes;
}
