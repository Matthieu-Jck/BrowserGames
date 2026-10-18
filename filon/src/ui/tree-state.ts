// tree-state.ts — the tech tree's state, derived once for every view of it (the HUD's chips and the
// tree screen read it apart until 2026-10-15, and a held reconversion read « à l’arrêt » in the tree
// while the HUD, rightly, let it run on):
//   · `planState` / `researchState` / `nodeState`: a plan done, ready, poor (short of materials or
//     held back by CrierBelt's restart reserve, D36) or locked; a research done, active, ready, poor
//     (D122: the Core short of its resources, or paying them would break the restart reserve),
//     waiting (no lab or slot free) or locked (a prerequisite, the Core's level short of its tier's
//     — D118 —, Tier 2's two expertises);
//   · `readyPlans`: the plans the Heart can pay for right now and the tree offers (D101: during the
//     tutorial, those its quests have reached) — the HUD chip's badge, the screen's first selection;
//   · `projectTiming` / `projectTimings`: a running project's state (D118: no time; D122: no data —
//     its resources were paid at launch) — its tokens in as ‰ for its one bar; the tokens a minute it
//     gets now (the free flows — the Core's compute and the servers, in the order projects started —,
//     the bank's, and its bought flow, held by a purse in the red); when its tokens will be in at
//     these flows; what it waits for (its lab's power, a token flow).
// Pure (no DOM): tested in node (tree-state.test.ts).
import { PLAN_IDS } from '@/content/research';
import { EPOCH, TPS } from '@/sim/constants';
import { projectPermille, tokenPermille, type Project } from '@/sim/research/runtime';
import type { Sim } from '@/sim/state';
import { tokenEtas, tokenFlows } from '@/sim/systems/research';
import { planOffered } from '@/sim/systems/quests';

export type PlanState = 'done' | 'ready' | 'poor' | 'locked';
export type ResearchState = 'done' | 'active' | 'ready' | 'poor' | 'waiting' | 'locked';

/** A plan's state, from what blocks it (`Sim.planBlock`). */
export function planState(sim: Sim, id: string): PlanState {
  const b = sim.planBlock(id);
  // Short of materials, or of what may be spent above the restart reserve (D36): « poor » alike.
  return b === 'done' ? 'done' : b === 'prereq' ? 'locked' : b === 'unaffordable' || b === 'reserve' ? 'poor' : 'ready';
}

/** A research node's state: done, running, or what blocks it (`Sim.researchBlock`). */
export function researchState(sim: Sim, id: string): ResearchState {
  if (sim.done.has(id)) return 'done';
  if (sim.projects.some((p) => p.id === id)) return 'active';
  const block = sim.researchBlock(id);
  // The Core's level short of the tier's (D118) or Tier 2 waiting for two expertises (D93) is locked
  // like a missing prerequisite: nothing to wait out, something to do first. Its resources short
  // (D122) read as a plan's do: « poor ».
  if (block === 'prereq' || block === 'expertise' || block === 'core') return 'locked';
  if (block === 'unaffordable' || block === 'reserve') return 'poor';
  return block ? 'waiting' : 'ready';
}

/** Any node's state, a plan's or a research's (`isPlan`: the tree's own test of the id). */
export const nodeState = (sim: Sim, id: string, isPlan: boolean): PlanState | ResearchState => (isPlan ? planState(sim, id) : researchState(sim, id));

/** The plans the Heart can pay for right now, prerequisites met (in the tree's order). */
export const readyPlans = (sim: Sim): string[] => PLAN_IDS.filter((id) => planState(sim, id) === 'ready' && planOffered(sim, id));

/** A running project's state, as the HUD's chip and the tree say it (D118, D122: its tokens, no time, no data). */
export interface ProjectTiming {
  /** Its lab's grid satisfaction ‰ (1000 for a reconversion, which needs no lab); 0: no power — it takes no tokens. */
  sat: number;
  /** Tokens delivered, ‰ (1000 when it needs none: a reconversion). */
  tokens: number;
  /** It needs tokens at all (every research since D122; a save's reconversion does not). */
  usesTokens: boolean;
  /**
   * Tokens a minute it gets now: its share of the free flows — the Core's compute and the servers,
   * the oldest project first —, the bank's tokens (an older save's data, D122), its bought flow.
   */
  free: number;
  bank: number;
  bought: number;
  /** Its bought flow is held: the purse is in the red (D118). */
  held: boolean;
  /** Game seconds until its tokens are in at these flows (0: in, or none needed; Infinity: no flow reaches it). */
  tokLeft: number;
  /** Game seconds until it is done (its tokens; a reconversion's time), Infinity when nothing reaches it. */
  left: number;
  /** What it waits for now: power for its lab, a token flow (none reaches it), or nothing (its tokens coming). */
  waiting: 'power' | 'tokens' | null;
  /** Done, ‰: its tokens in (a reconversion: its time run). */
  permille: number;
}

/** Every running project's state, by id (one pass: the free flows' order needs them all). */
export function projectTimings(sim: Sim): Map<string, ProjectTiming> {
  const satOf = (net: number): number => sim.netPower[net]?.sat ?? 0;
  const flows = tokenFlows(sim, satOf);
  const etas = tokenEtas(sim, satOf);
  const held = sim.credits < 0;
  const out = new Map<string, ProjectTiming>();
  sim.projects.forEach((p, i) => {
    const net = p.lab ? sim.graph?.nodeByEnt.get(p.lab)?.net ?? -1 : -1;
    const sat = p.lab ? (net >= 0 ? sim.netPower[net]?.sat ?? 0 : 0) : 1000;
    const f = flows.get(p.id) ?? { free: 0, bank: 0, bought: 0 };
    const tokens = tokenPermille(p);
    const usesTokens = (p.tokens ?? 0) > 0;
    const tokLeft = etas[i] === Infinity ? Infinity : etas[i]! * (EPOCH / TPS);
    const respec = !p.lab;
    const left = respec ? Math.max(0, p.dur * 1000 - p.el) / 1000 / TPS : tokLeft;
    const waiting = respec ? null : sat <= 0 ? 'power' : tokens < 1000 && f.free + f.bank + f.bought <= 0 ? 'tokens' : null;
    out.set(p.id, {
      sat, tokens, usesTokens, free: f.free, bank: f.bank, bought: f.bought,
      held: held && usesTokens && tokens < 1000 && (p.buy ?? 0) > 0,
      tokLeft, left, waiting, permille: projectPermille(p),
    });
  });
  return out;
}

/** One running project's state (`projectTimings`). */
export const projectTiming = (sim: Sim, p: Project): ProjectTiming => projectTimings(sim).get(p.id)!;
