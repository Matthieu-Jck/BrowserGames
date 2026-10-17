// runtime.ts — research as the engine runs it. A project sits in a research lab (one per lab,
// as many as the research slots allow); data files reach the lab by ribbon and pile up in its
// store; the project draws from that store under an ALLOWANCE: by elapsed powered time e
// (milli-ticks), it may have paid at most ⌊cost·e / (dur·1000)⌋ of each item. So it can never
// finish before its minimum duration, takes longer when data runs short, and — being a function
// of e only — pays exactly the same online and in the offline catch-up whenever data is
// plentiful. Its AI tokens follow the same allowance (D68): ⌊tokens·e / (dur·1000)⌋ are used by
// e, billed at each minute boundary (systems/research.ts `tokenEpoch`) — the claim's servers
// first, CrierBelt's the rest. A node costs what its table says, whatever else the claim owns:
// the spread penalty and the lineage discount of D69 are gone (owner, 2026-10-15, D72), so no
// family is dearer for researching another. Integer maths throughout.
import { FAMILY_IDS, RESEARCH, researchNode, type ResearchId } from '@/content/research';
import { itemDef, itemIdx } from '@/content/registry';
import type { FamilyId, ResearchDef } from '@/content/types';
import { mulDiv } from '@/core/fixed';
import { TPS } from '../constants';
import type { Mods } from './modifiers';

/** A research family (D69); `BranchId` is its old name, kept for the reconversion's logged command (a no-op since D107). */
export type BranchId = FamilyId;
export const BRANCHES: readonly BranchId[] = FAMILY_IDS;

export interface Project {
  /** Research id, or `respec:<family>` for a reconversion in progress (a save's from before D107: none starts now). */
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
 * A node's cost (milli-items, whole items), AI tokens and minimum duration (ticks): its table's,
 * whatever else the claim owns (D72) — less what an expertise in place takes off its family's
 * research (D93: `mods.fam`, ‰ of each; whole items, at least one of each kind). Without `mods`, the
 * table's alone (a save's rebase). A project keeps what it started at.
 */
export function effectiveCost(id: string, mods?: Pick<Mods, 'fam'>): { cost: Array<{ item: number; mu: number }>; tokens: number; ticks: number } {
  const r = def(id);
  const f = mods && r.branch !== 'trunk' ? mods.fam[r.branch] : null;
  if (!f) return { cost: r.cost.map(([it, q]) => ({ item: itemIdx(it), mu: q * 1000 })), tokens: r.tokens, ticks: r.minutes * 60 * TPS };
  return {
    cost: r.cost.map(([it, q]) => ({ item: itemIdx(it), mu: Math.max(1, Math.ceil((q * f.data) / 1000)) * 1000 })),
    tokens: Math.floor((r.tokens * f.tokens) / 1000),
    ticks: Math.max(1, Math.floor((r.minutes * 60 * TPS * f.time) / 1000)),
  };
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
export type StartBlock = 'done' | 'active' | 'prereq' | 'expertise' | 'slots' | 'no_lab' | 'unknown' | 'debt';

export function prereqsMet(id: string, done: ReadonlySet<string>): boolean {
  return def(id).prereq.every((p) => done.has(p));
}

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

