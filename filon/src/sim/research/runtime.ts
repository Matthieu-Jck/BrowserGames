// runtime.ts — research as the engine runs it. A project sits in a research lab (one per lab,
// as many as the research slots allow). Its resources were paid from the Core when it was launched
// (D122: `cost`, all paid at once — no data, no ribbon; owner, 2026-10-17: « le laboratoire n'a plus
// besoin d'entrée »), and it needs its AI tokens (D68), at every tier: delivered at each minute's end
// (systems/research.ts `tokenEpoch`) while its lab had power in the minute — the Core's compute and
// the claim's servers first, the tokens banked from an older save's data, then the flow bought from
// CrierBelt for it (`buy`, tokens a minute). Done = its tokens in (D118: no minimum time). It runs
// the same online and in the catch-up: the tokens at the minute's boundary, which the catch-up runs
// as online, the lab's power summed over the minute (`lit`) like a server's output. A node costs what
// its table says, whatever else the claim owns (D72); an expertise in place takes its share off (D93).
// A save's reconversion under way (`respec:<family>`, D107) still runs out its time (`dur`, `el`).
// Integer maths throughout.
import { FAMILY_IDS, RESEARCH, researchNode, type ResearchId } from '@/content/research';
import { BAL } from '@/content/balance';
import { itemIdx } from '@/content/registry';
import type { FamilyId, ResearchDef } from '@/content/types';
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
  /** Its resources (D122), paid from the Core at launch — so `paid` is `cost` from the start; a cancel hands them back. Empty for a project from before. */
  cost: Array<{ item: number; mu: number }>;
  paid: number[];
  /** A reconversion's wait, in ticks (0 for research since D118: no minimum time). */
  dur: number;
  /** A reconversion's elapsed time, milli-ticks (+ satisfaction ‰ per tick; research leaves it at 0). */
  el: number;
  /** Reconversion: archive notes granted when it completes. */
  notes?: number;
  /** AI tokens the project needs (D68, D122: at every tier), and those delivered so far. */
  tokens?: number;
  tokIn?: number;
  /** Tokens a minute bought from CrierBelt for it while it needs them (D118: a standing flow; 0: the free flows alone). */
  buy?: number;
  /**
   * Its lab's power since the minute began (D122), ‰·ticks — summed like a server's output, online a
   * tick at a time, offline a segment at a time: a project whose lab had none in the minute takes no
   * tokens at its end (and buys none). Reset at each boundary; absent: 0.
   */
  lit?: number;
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
 * A node's resources (milli-items, whole items), AI tokens and the pace the launch dialog aims at
 * (`aim`, ticks: D118, not a minimum): its table's, whatever else the claim owns (D72) — less what
 * an expertise in place takes off its family's research (D93: `mods.fam`, ‰ of each; whole items, at
 * least one of each kind). Research has no time since D118, so an expertise of research time takes
 * its share off what the time now follows: the tokens. Without `mods`, the table's alone (a save's
 * rebase). A project keeps what it started at.
 */
export function effectiveCost(id: string, mods?: Pick<Mods, 'fam'>): { cost: Array<{ item: number; mu: number }>; tokens: number; aim: number } {
  const r = def(id);
  const aim = r.minutes * 60 * TPS;
  const f = mods && r.branch !== 'trunk' ? mods.fam[r.branch] : null;
  if (!f) return { cost: r.cost.map(([it, q]) => ({ item: itemIdx(it), mu: q * 1000 })), tokens: r.tokens, aim };
  const tokens = Math.floor((f.tokens * f.time) / 1000);
  return {
    cost: r.cost.map(([it, q]) => ({ item: itemIdx(it), mu: Math.max(1, Math.ceil((q * f.resources) / 1000)) * 1000 })),
    tokens: Math.floor((r.tokens * tokens) / 1000),
    aim,
  };
}

/** Tokens a project still needs (D118). */
export const tokensLeft = (p: Project): number => Math.max(0, (p.tokens ?? 0) - (p.tokIn ?? 0));

/**
 * Why a node cannot start right now (null = it can): `core`, the Core's level short of its tier's
 * (D118); `unaffordable`, the Core short of its resources, `reserve`, they would eat into CrierBelt's
 * restart reserve (D122, as a plan: D36); `debt`, a bought flow asked for from a purse in the red.
 */
export type StartBlock = 'done' | 'active' | 'prereq' | 'core' | 'expertise' | 'slots' | 'no_lab' | 'unaffordable' | 'reserve' | 'unknown' | 'debt';

export function prereqsMet(id: string, done: ReadonlySet<string>): boolean {
  return def(id).prereq.every((p) => done.has(p));
}

/**
 * Apply archive notes (a save's old reconversion, D107) to a fresh project: they pay its tokens at
 * CrierBelt's list price (D122: its resources are the Core's at launch; the notes once pre-paid
 * its data, value for value). Returns the notes spent.
 */
export function applyNotes(p: Project, notes: number): number {
  const need = tokensLeft(p);
  if (notes <= 0 || need <= 0) return 0;
  const tokens = Math.min(need, Math.floor((notes * 1000) / BAL.tokenCentsPerK));
  if (tokens <= 0) return 0;
  p.tokIn = (p.tokIn ?? 0) + tokens;
  return Math.min(notes, Math.ceil((tokens * BAL.tokenCentsPerK) / 1000));
}

/** A reconversion's wait (no lab, `dur` > 0): its time runs at `sat` ‰ for `ticks`. Research has no time (D118). */
export function advanceProject(p: Project, ticks: number, sat: number): void {
  if (p.dur > 0) p.el += sat * ticks;
}

/** Its tokens in (D118, D122: its resources were paid at launch), and a reconversion's time run. */
export const projectDone = (p: Project): boolean => p.el >= p.dur * 1000 && tokensLeft(p) === 0;

/** Tokens delivered, ‰ of those it needs (1000 when it needs none: a reconversion). */
export const tokenPermille = (p: Project): number => ((p.tokens ?? 0) > 0 ? Math.min(1000, Math.floor(((p.tokIn ?? 0) * 1000) / p.tokens!)) : 1000);

/** Fraction (‰) of a project: its tokens in (D122), or a reconversion's time run. */
export function projectPermille(p: Project): number {
  const time = p.dur > 0 ? Math.min(1000, Math.floor(p.el / p.dur)) : 1000;
  return Math.min(time, tokenPermille(p));
}

