// configure.ts — per-building settings: a machine's recipe (speed modules are gone, D81), what
// an output port of a store hands out, a fork's per-side filters. Each change marks the flow
// graph for recompilation and is logged as a command.
import { BUILDING_KIND, CRECIPES, buildingDef, itemIdx, recipeIdx } from '@/content/registry';
import { recipeOf, withFilter, withRecipe } from '../cfg';
import { MachineNode } from '../flow/nodes';
import { refundNode } from '../graph/compile';
import type { Rot } from '../types';
import type { Sim } from '../state';

export function setRecipe(sim: Sim, id: number, recipe: string | null): boolean {
  const e = sim.ents.get(id);
  if (!e || BUILDING_KIND[e.def] !== 'machine') return false;
  const r = recipe === null ? 0 : recipeIdx(recipe) + 1;
  if (r > 0) {
    const cr = CRECIPES[r - 1]!;
    if (!cr.machines.has(e.def) || !sim.unlocked(cr.unlock)) return false;
  }
  if (recipeOf(e.cfg) === r) return true;
  // What its node holds goes back to the Heart now, not at the next compile: a change and its undo
  // between two compiles would keep the buffers, with a compile in between refund them — and
  // looking at the sim (hash() compiles) must never change it (replay, commands.test.ts).
  const n = sim.graph?.nodeByEnt.get(id);
  if (n instanceof MachineNode) {
    refundNode(n, (it, mu) => sim.refund(it, mu));
    n.inBuf.fill(0); n.outBuf.fill(0); n.crafting = false; n.p = 0; n.carry = 0;
    n.wBuf = 0; n.wItem = -1; n.wc = 0; // its waste bin went back with the rest (D125)
  }
  e.cfg = withRecipe(e.cfg, r);
  sim.log.push({ tick: sim.tick, cmd: { k: 'recipe', id, recipe } });
  sim.dirty = true;
  return true;
}

/**
 * What an output port of a store hands out (null: nothing). Only outputs: the Heart has none — it
 * takes, it never gives (the owner, 2026-10-12) — and a trade post's exit hands out what it bought,
 * in turn (D62). The stores whose outlets were set this way, the waystation and the skydocks, are
 * retired (D60, D108): no building of today's takes it; kept for the command older logs hold.
 */
export function setPortItem(sim: Sim, id: number, port: number, item: string | null): boolean {
  const e = sim.ents.get(id);
  if (!e?.portItems || port < 0 || port >= e.portItems.length) return false;
  if (buildingDef(e.def).ports[port]?.io !== 'out') return false;
  if (BUILDING_KIND[e.def] === 'trade') return false; // its exit hands out what it bought, in turn (D62)
  e.portItems[port] = item === null ? -1 : itemIdx(item);
  sim.log.push({ tick: sim.tick, cmd: { k: 'portItem', id, port, item } });
  sim.dirty = true;
  return true;
}

/**
 * A routing block's item: a router's output filter on one side (null: anything goes); a
 * sorter's or inverted sorter's chosen item is side 0.
 */
export function setForkFilter(sim: Sim, id: number, side: Rot, item: string | null): boolean {
  const e = sim.ents.get(id);
  if (!e || BUILDING_KIND[e.def] !== 'fork') return false;
  e.cfg = withFilter(e.cfg, side, item === null ? -1 : itemIdx(item));
  sim.log.push({ tick: sim.tick, cmd: { k: 'forkFilter', id, side, item } });
  sim.dirty = true;
  return true;
}

