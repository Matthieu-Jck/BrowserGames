// configure.ts — per-building settings: a machine's recipe and its speed modules (modules), what
// an unloader port of a store hands out, a fork's per-side filters. Each change marks the flow
// graph for recompilation and is logged as a command.
import { BUILDING_KIND, CRECIPES, buildingDef, itemIdx, recipeIdx } from '@/content/registry';
import { modulesOf, recipeOf, withFilter, withModules, withRecipe } from '../cfg';
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
  e.cfg = withRecipe(e.cfg, r);
  sim.log.push({ tick: sim.tick, cmd: { k: 'recipe', id, recipe } });
  sim.dirty = true;
  return true;
}

/**
 * What an output port of a store (waystation, skydock, trade post) hands out (null: nothing).
 * Only outputs: the Heart has none — it takes, it never gives (the owner, 2026-10-12).
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
 * sorter's, inverted sorter's or unloader's chosen item is side 0.
 */
export function setForkFilter(sim: Sim, id: number, side: Rot, item: string | null): boolean {
  const e = sim.ents.get(id);
  if (!e || BUILDING_KIND[e.def] !== 'fork') return false;
  e.cfg = withFilter(e.cfg, side, item === null ? -1 : itemIdx(item));
  sim.log.push({ tick: sim.tick, cmd: { k: 'forkFilter', id, side, item } });
  sim.dirty = true;
  return true;
}

/** Module slots every machine has (Pace: 1, Pace II: 2). */
export function moduleSlots(sim: Sim): number {
  return sim.mods.flags.has('modules2') ? 2 : sim.mods.flags.has('modules1') ? 1 : 0;
}

/** Fit a speed module from the Hearth into a machine, or take one back. */
export function setModule(sim: Sim, id: number, add: boolean): boolean {
  const e = sim.ents.get(id);
  if (!e || BUILDING_KIND[e.def] !== 'machine') return false;
  const n = modulesOf(e.cfg);
  const bell = itemIdx('pace_bell');
  if (add) {
    if (n >= moduleSlots(sim) || sim.stock[bell]! < 1000) return false;
    sim.stock[bell] = sim.stock[bell]! - 1000;
    e.cfg = withModules(e.cfg, n + 1);
  } else {
    if (n <= 0) return false;
    sim.stock[bell] = sim.stock[bell]! + 1000;
    e.cfg = withModules(e.cfg, n - 1);
  }
  sim.log.push({ tick: sim.tick, cmd: { k: 'module', id, add } });
  sim.dirty = true;
  return true;
}

