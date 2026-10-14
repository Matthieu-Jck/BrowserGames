// runtime.ts — research as the engine runs it. A project sits in an observatory (one per
// observatory, as many as the research slots allow); journals reach the observatory by
// ribbon and pile up in its store; the project draws from that store under an ALLOWANCE:
// by elapsed powered time e (milli-ticks), it may have paid at most ⌊cost·e / (dur·1000)⌋ of
// each science item. So it can never finish before its minimum duration, takes longer when
// science runs short, and — being a function of e only — pays exactly the same online and in
// the offline catch-up whenever science is plentiful. Costs follow the specialisation rule:
//   cost = ⌈base × (1 + 0.12·N_others) × (1 − 0.04·min(n_branch, 8))⌉
//   time = D × (1 + 0.05·N_others) × (0.85 if n_branch ≥ 6)
// (the trunk escapes both). Integer maths throughout.
import { BAL } from '@/content/balance';
import { RESEARCH, type ResearchId } from '@/content/research';
import { RESEARCH_IDS, itemDef, itemIdx } from '@/content/registry';
import type { ResearchDef } from '@/content/types';
import { ceilDiv, mulDiv } from '@/core/fixed';
import { TPS } from '../constants';

export type BranchId = 'ex' | 'xp' | 'dn' | 'en' | 'cm';
export const BRANCHES: readonly BranchId[] = ['ex', 'xp', 'dn', 'en', 'cm'];

export interface Project {
  /** Research id, or `respec:<branch>` for a reconversion in progress. */
  id: string;
  /** Observatory entity (0 for a reconversion: it holds a slot but no observatory). */
  lab: number;
  cost: Array<{ item: number; mu: number }>;
  paid: number[];
  /** Minimum duration in ticks. */
  dur: number;
  /** Elapsed powered time, milli-ticks (+ satisfaction ‰ per tick). */
  el: number;
  /** Reconversion: archive notes granted when it completes. */
  notes?: number;
}

export const def = (id: string): ResearchDef => RESEARCH[id as ResearchId] as ResearchDef;

/** Nodes owned per branch (trunk excluded). */
export function branchCounts(done: ReadonlySet<string>): Record<BranchId, number> {
  const c: Record<BranchId, number> = { ex: 0, xp: 0, dn: 0, en: 0, cm: 0 };
  for (const id of done) {
    const r = RESEARCH[id as ResearchId] as ResearchDef | undefined;
    if (r && r.branch !== 'trunk') c[r.branch] += 1;
  }
  return c;
}

/** Cost multiplier (‰) and duration multiplier (‰) for a node given what is owned. */
export function penalty(id: string, done: ReadonlySet<string>): { cost: number; time: number } {
  const r = def(id);
  if (r.branch === 'trunk') return { cost: 1000, time: 1000 };
  const counts = branchCounts(done);
  const nb = counts[r.branch];
  let others = 0;
  for (const b of BRANCHES) if (b !== r.branch) others += counts[b];
  const cost = Math.floor(((1000 + BAL.spreadCostPerNode * others) * (1000 - BAL.depthDiscountPerNode * Math.min(nb, 8))) / 1000);
  let time = 1000 + BAL.spreadTimePerNode * others;
  if (nb >= 6) time = Math.floor((time * BAL.masterTimeFactor) / 1000);
  return { cost, time };
}

/** Effective cost (milli-items, whole items) and minimum duration (ticks) of a node. */
export function effectiveCost(id: string, done: ReadonlySet<string>): { cost: Array<{ item: number; mu: number }>; ticks: number } {
  const r = def(id);
  const p = penalty(id, done);
  const cost = r.cost.map(([it, q]) => ({ item: itemIdx(it), mu: ceilDiv(q * p.cost, 1000) * 1000 }));
  const ticks = mulDiv(r.minutes * 60 * TPS, p.time, 1000);
  return { cost, ticks };
}

/** Why a node cannot start right now (null = it can). */
export type StartBlock = 'done' | 'active' | 'prereq' | 'slots' | 'no_lab' | 'unknown';

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

/** The deepest owned nodes of a branch, deepest first (the order a reconversion removes them). */
export function respecOrder(branch: BranchId, done: ReadonlySet<string>): string[] {
  return RESEARCH_IDS.filter((id) => done.has(id) && def(id).branch === branch).sort((a, b) => def(b).depth - def(a).depth);
}

/** Ticks a reconversion holds a slot: 25 % of the removed nodes' durations, at most 48 h. */
export function respecTicks(removed: readonly string[], done: ReadonlySet<string>): number {
  let t = 0;
  const after = new Set(done);
  for (const id of removed) { after.delete(id); t += effectiveCost(id, after).ticks; }
  return Math.min(Math.floor(t / 4), 48 * 3600 * TPS);
}

/** Archive notes refunded for removed nodes: 50 % of their science value (25 % keystones). */
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
