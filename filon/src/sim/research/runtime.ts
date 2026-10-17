// runtime.ts — research as the engine runs it. A project sits in a research lab (one per lab,
// as many as the research slots allow); data files reach the lab by ribbon, and while the lab has
// power the project takes what it still owes out of the lab's store at once (D118: no minimum
// time, no allowance — owner, 2026-10-17: « le temps pour débloquer la recherche dépend uniquement
// du temps pour acheminer la data au labo, et pour avoir le nombre de tokens requis »). From Tier 2
// it also needs its AI tokens (D68): delivered at each minute's end (systems/research.ts
// `tokenEpoch`), the claim's servers' output first, then the flow bought from CrierBelt for it
// (`buy`, tokens a minute). Done = its data paid and its tokens in. Both run the same online and in
// the catch-up: the data as it arrives (a function of the store alone), the tokens at the minute's
// boundary, which the catch-up runs as online. A node costs what its table says, whatever else the
// claim owns (D72); an expertise in place takes its share off (D93). A save's reconversion under
// way (`respec:<family>`, D107) still runs out its time (`dur`, `el`). Integer maths throughout.
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
  /** A reconversion's wait, in ticks (0 for research since D118: no minimum time). */
  dur: number;
  /** A reconversion's elapsed time, milli-ticks (+ satisfaction ‰ per tick; research leaves it at 0). */
  el: number;
  /** Reconversion: archive notes granted when it completes. */
  notes?: number;
  /** AI tokens the project needs (D68, D118: 0 at Tier 1), and those delivered so far. */
  tokens?: number;
  tokIn?: number;
  /** Tokens a minute bought from CrierBelt for it while it needs them (D118: a standing flow; 0: the servers' alone). */
  buy?: number;
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
 * A node's cost (milli-items, whole items), AI tokens and the pace the launch dialog aims at
 * (`aim`, ticks: D118, not a minimum): its table's, whatever else the claim owns (D72) — less what
 * an expertise in place takes off its family's research (D93: `mods.fam`, ‰ of each; whole items, at
 * least one of each kind). Research has no time since D118, so an expertise of research time takes
 * its share off what the time now follows: the data and the tokens. Without `mods`, the table's
 * alone (a save's rebase). A project keeps what it started at.
 */
export function effectiveCost(id: string, mods?: Pick<Mods, 'fam'>): { cost: Array<{ item: number; mu: number }>; tokens: number; aim: number } {
  const r = def(id);
  const aim = r.minutes * 60 * TPS;
  const f = mods && r.branch !== 'trunk' ? mods.fam[r.branch] : null;
  if (!f) return { cost: r.cost.map(([it, q]) => ({ item: itemIdx(it), mu: q * 1000 })), tokens: r.tokens, aim };
  const data = Math.floor((f.data * f.time) / 1000), tokens = Math.floor((f.tokens * f.time) / 1000);
  return {
    cost: r.cost.map(([it, q]) => ({ item: itemIdx(it), mu: Math.max(1, Math.ceil((q * data) / 1000)) * 1000 })),
    tokens: Math.floor((r.tokens * tokens) / 1000),
    aim,
  };
}

/** Tokens a project still needs (D118). */
export const tokensLeft = (p: Project): number => Math.max(0, (p.tokens ?? 0) - (p.tokIn ?? 0));

/** Why a node cannot start right now (null = it can): `core`, the Core's level short of its tier's (D118). */
export type StartBlock = 'done' | 'active' | 'prereq' | 'core' | 'expertise' | 'slots' | 'no_lab' | 'unknown' | 'debt';

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
 * Advance a project by `ticks` at its lab's satisfaction `sat` (‰): while the lab has power it
 * takes what it still owes of each item out of `stock` at once (D118: no allowance). Returns
 * milli-items paid per cost entry. A function of the store alone: the same whether the data came
 * in a tick at a time or over a catch-up segment. A reconversion (no lab, `dur` > 0) runs its time.
 */
export function advanceProject(p: Project, stock: Float64Array | null, ticks: number, sat: number): number[] {
  if (p.dur > 0) p.el += sat * ticks;
  const cap = p.dur * 1000;
  const out = p.cost.map(() => 0);
  if (!stock || sat <= 0) return out;
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

/** Its data paid (and a reconversion's time run) and its tokens in (D118). */
export const projectDone = (p: Project): boolean => p.el >= p.dur * 1000 && p.cost.every((c, i) => p.paid[i]! >= c.mu) && tokensLeft(p) === 0;

/**
 * Data paid, ‰ of its whole cost — every kind together, so a bar moves with each file in (1000 only
 * once every kind is paid; a reconversion: its time run, or a project from before D118: the lesser
 * of its time and its data, as its rebase reads it).
 */
export function dataPermille(p: Project): number {
  if (!p.cost.length) return p.dur > 0 ? Math.min(1000, Math.floor(p.el / p.dur)) : 1000;
  let paid = 0, cost = 0;
  p.cost.forEach((c, i) => { paid += Math.min(c.mu, p.paid[i]!); cost += c.mu; });
  const share = cost > 0 ? Math.floor((paid * 1000) / cost) : 1000;
  const all = p.cost.every((c, i) => p.paid[i]! >= c.mu);
  const data = all ? 1000 : Math.min(999, share);
  return p.dur > 0 ? Math.min(data, Math.min(1000, Math.floor(p.el / p.dur))) : data;
}

/** Tokens delivered, ‰ of those it needs (1000 when it needs none: Tier 1). */
export const tokenPermille = (p: Project): number => ((p.tokens ?? 0) > 0 ? Math.min(1000, Math.floor(((p.tokIn ?? 0) * 1000) / p.tokens!)) : 1000);

/** Fraction (‰) of a project: the lesser of its data and its tokens. */
export const projectPermille = (p: Project): number => Math.min(dataPermille(p), tokenPermille(p));

/** Science items an observatory should accept for its project (those still owed). */
export function owedItems(p: Project): number[] {
  return p.cost.filter((c, i) => p.paid[i]! < c.mu).map((c) => c.item);
}

