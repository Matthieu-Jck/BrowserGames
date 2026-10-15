// readouts/production.ts — what the Production view shows (D88): each production building's state
// as its look reads it (`workOf`, systems/work.ts, D83: at work, a passing stop, stopped) and, when
// it does not work, why — one reason the view draws as an icon and its side panel lists: no power,
// no wire, inputs missing (a generator's fuel too), output backed up, no recipe (a drill on nothing
// to cut), asleep, still being built, not called on (a generator its grid does not need). Read from
// the sim, never changing it.
import { BUILDING_KIND } from '@/content/registry';
import { DrillNode, GeneratorNode, MachineNode } from '../flow/nodes';
import type { Sim } from '../state';
import { St, type Ent } from '../types';
import { looksAtWork, workOf, type Work } from '../systems/work';

/** Why a production building does not work (null: it works). */
export type StopWhy = 'power' | 'unwired' | 'inputs' | 'output' | 'recipe' | 'asleep' | 'site' | 'idle';
/** The reasons in the order the panel groups them (the hard stops first). */
export const STOP_ORDER: readonly StopWhy[] = ['unwired', 'power', 'recipe', 'inputs', 'output', 'asleep', 'site', 'idle'];

export interface ProdMark { ent: number; work: Work; why: StopWhy | null }

/** Why `e` is not at work (null when it is). */
export function stopWhy(sim: Sim, e: Ent, work: Work = workOf(sim, e)): StopWhy | null {
  if (work === 'on') return null;
  if (e.builtAt !== 0) return 'site';
  if (sim.isDormant(e)) return 'asleep';
  const g = sim.graph;
  const wired = g?.netOfEnt.has(e.id) ?? false;
  const n = g?.nodeByEnt.get(e.id);
  const st = n?.status ?? St.Ok;
  const power = (): StopWhy => (wired ? 'power' : 'unwired');
  switch (BUILDING_KIND[e.def]) {
    case 'machine':
      if (!(n instanceof MachineNode) || st === St.NoJob) return 'recipe';
      if (st === St.Starved || (st === St.Ok && !n.crafting)) return 'inputs';
      if (st === St.Blocked) return 'output';
      return power();
    case 'drill':
    case 'pump':
      if (!(n instanceof DrillNode) || st === St.NoJob) return 'recipe';
      if (st === St.Blocked) return 'output';
      return power();
    case 'generator':
      if (!(n instanceof GeneratorNode) || !wired) return 'unwired';
      return st === St.NoFuel ? 'inputs' : 'idle';
    case 'lab': {
      const p = sim.projects.find((q) => q.lab === e.id);
      if (!p) return 'recipe';
      if (work === 'pause') return 'inputs'; // its time done, the data still owed
      return power();
    }
    default:
      return power();
  }
}

/**
 * Every production building of the colony (the kinds whose look says whether they work), in id
 * order. `lit` — the renderer's look (render/world/work-look.ts `WorkLook.isLit`) — keeps a passing
 * stop 'on' for its grace, so the view never blinks between two crafts as the buildings do not.
 */
export function prodMarks(sim: Sim, lit?: (id: number) => boolean): ProdMark[] {
  const out: ProdMark[] = [];
  for (const e of sim.ents.sorted()) {
    if (!looksAtWork(e.def)) continue;
    const raw = workOf(sim, e);
    const work: Work = raw !== 'off' && lit?.(e.id) ? 'on' : raw;
    out.push({ ent: e.id, work, why: stopWhy(sim, e, work) });
  }
  return out;
}
