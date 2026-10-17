// tree-state.ts — the tech tree's state, derived once for every view of it (the HUD's chips and the
// tree screen read it apart until 2026-10-15, and a held reconversion read « à l’arrêt » in the tree
// while the HUD, rightly, let it run on):
//   · `planState` / `researchState` / `nodeState`: a plan done, ready, poor (short of materials or
//     held back by CrierBelt's restart reserve, D36) or locked; a research done, active, ready,
//     waiting (no lab or slot free, the purse in the red) or locked;
//   · `readyPlans`: the plans the Heart can pay for right now and the tree offers (D101: during the
//     tutorial, those its quests have reached) — the HUD chip's badge, the screen's first selection;
//   · `projectTiming`: a running project's clock — held by a purse in the red (a reconversion has
//     no lab and runs on: `projectSat`), its grid's power, the game seconds left at that power, its
//     time done with data still owed.
// Pure (no DOM): tested in node (tree-state.test.ts).
import { PLAN_IDS } from '@/content/research';
import { TPS } from '@/sim/constants';
import { projectPermille, type Project } from '@/sim/research/runtime';
import type { Sim } from '@/sim/state';
import { planOffered } from '@/sim/systems/quests';

export type PlanState = 'done' | 'ready' | 'poor' | 'locked';
export type ResearchState = 'done' | 'active' | 'ready' | 'waiting' | 'locked';

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
  // Tier 2 waiting for two expertises (D93) is locked like a missing prerequisite: nothing to wait out.
  return block === 'prereq' || block === 'expertise' ? 'locked' : block ? 'waiting' : 'ready';
}

/** Any node's state, a plan's or a research's (`isPlan`: the tree's own test of the id). */
export const nodeState = (sim: Sim, id: string, isPlan: boolean): PlanState | ResearchState => (isPlan ? planState(sim, id) : researchState(sim, id));

/** The plans the Heart can pay for right now, prerequisites met (in the tree's order). */
export const readyPlans = (sim: Sim): string[] => PLAN_IDS.filter((id) => planState(sim, id) === 'ready' && planOffered(sim, id));

/** A running project's clock, as the HUD's chip and the tree say it. */
export interface ProjectTiming {
  /** Held: the purse is in the red and it needs a lab (a reconversion runs on). */
  held: boolean;
  /** Its grid's satisfaction ‰ (1000 for a reconversion, which needs no lab); 0: no power. */
  sat: number;
  /** Game seconds left at that power (Infinity without power). */
  left: number;
  /** Its minimum time is run, its data still owed. */
  short: boolean;
  /** Done, ‰: the lesser of the time and the data paid. */
  permille: number;
}

export function projectTiming(sim: Sim, p: Project): ProjectTiming {
  const net = p.lab ? sim.graph?.nodeByEnt.get(p.lab)?.net ?? -1 : -1;
  const sat = p.lab ? (net >= 0 ? sim.netPower[net]?.sat ?? 0 : 0) : 1000;
  const permille = projectPermille(p);
  return {
    held: sim.researchHeld && p.lab !== 0,
    sat,
    left: sat > 0 ? Math.max(0, p.dur * 1000 - p.el) / sat / TPS : Infinity,
    short: p.el >= p.dur * 1000 && permille < 1000,
    permille,
  };
}
