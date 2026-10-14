// registry.ts — compiles the string-keyed content tables into dense numeric indices for the
// engine (items, buildings, recipes, research), with milli-item quantities and tick cycles
// precomputed. Unknown ids throw: content mistakes fail loudly at startup and in tests.
import { ITEMS } from './items';
import { RECIPES } from './recipes';
import { BUILDINGS } from './buildings';
import { RESEARCH } from './research';
import type { BuildingDef, BuildingKind, ItemDef, RecipeDef, ResearchDef } from './types';

export const ITEM_IDS = Object.keys(ITEMS) as Array<keyof typeof ITEMS>;
export const RECIPE_IDS = Object.keys(RECIPES) as Array<keyof typeof RECIPES>;
export const BUILDING_IDS = Object.keys(BUILDINGS) as Array<keyof typeof BUILDINGS>;
export const RESEARCH_IDS = Object.keys(RESEARCH) as Array<keyof typeof RESEARCH>;

const itemIndex = new Map<string, number>(ITEM_IDS.map((id, i) => [id, i]));
const recipeIndex = new Map<string, number>(RECIPE_IDS.map((id, i) => [id, i]));
const buildingIndex = new Map<string, number>(BUILDING_IDS.map((id, i) => [id, i]));
const researchIndex = new Map<string, number>(RESEARCH_IDS.map((id, i) => [id, i]));

export const N_ITEMS = ITEM_IDS.length;

export function itemIdx(id: string): number {
  const i = itemIndex.get(id);
  if (i === undefined) throw new Error(`unknown item ${id}`);
  return i;
}
export function recipeIdx(id: string): number {
  const i = recipeIndex.get(id);
  if (i === undefined) throw new Error(`unknown recipe ${id}`);
  return i;
}
export function buildingIdx(id: string): number {
  const i = buildingIndex.get(id);
  if (i === undefined) throw new Error(`unknown building ${id}`);
  return i;
}
export function researchIdx(id: string): number {
  const i = researchIndex.get(id);
  if (i === undefined) throw new Error(`unknown research ${id}`);
  return i;
}
export const hasItem = (id: string): boolean => itemIndex.has(id);
export const hasBuilding = (id: string): boolean => buildingIndex.has(id);
export const hasResearch = (id: string): boolean => researchIndex.has(id);
export const hasRecipe = (id: string): boolean => recipeIndex.has(id);

export const itemDef = (i: number): ItemDef => ITEMS[ITEM_IDS[i]!] as ItemDef;
export const buildingDef = (i: number): BuildingDef => BUILDINGS[BUILDING_IDS[i]!] as BuildingDef;
export const recipeDef = (i: number): RecipeDef => RECIPES[RECIPE_IDS[i]!] as RecipeDef;
export const researchDef = (i: number): ResearchDef => RESEARCH[RESEARCH_IDS[i]!] as ResearchDef;

/** Items → milli-items (exact for content quantities with ≤ 3 decimals). */
export const toMu = (items: number): number => Math.round(items * 1000);

/** A recipe compiled for the engine. */
export interface CRecipe {
  idx: number;
  id: string;
  /** Cycle length in ticks at speed 1000‰. */
  ticks: number;
  ins: Array<{ item: number; mu: number }>;
  outs: Array<{ item: number; mu: number }>;
  /** Extra electrical energy per craft in kW·tick. */
  energyKwTicks: number;
  machines: Set<number>;
  unlock: string;
}

export const CRECIPES: readonly CRecipe[] = RECIPE_IDS.map((id, idx) => {
  const r = RECIPES[id] as RecipeDef;
  return {
    idx,
    id,
    ticks: Math.round(r.seconds * 10),
    ins: r.ins.map(([it, q]) => ({ item: itemIdx(it), mu: toMu(q) })),
    outs: r.outs.map(([it, q]) => ({ item: itemIdx(it), mu: toMu(q) })),
    energyKwTicks: Math.round((r.energyKwMin ?? 0) * 600),
    machines: new Set(r.machines.map((m) => buildingIdx(m))),
    unlock: r.unlock,
  };
});

/** Recipes runnable by a building (by building index). */
export function recipesFor(building: number): CRecipe[] {
  return CRECIPES.filter((r) => r.machines.has(building));
}

/** Cost of a building as [itemIdx, mu] pairs. */
export function costOf(building: number): Array<{ item: number; mu: number }> {
  return buildingDef(building).cost.map(([it, q]) => ({ item: itemIdx(it), mu: toMu(q) }));
}

/** Content-wide lookup tables built once. */
export const BUILDING_KIND: readonly BuildingKind[] = BUILDING_IDS.map((id) => (BUILDINGS[id] as BuildingDef).kind);

/** Is a building id a ribbon-like line (ribbons, conduits) — laid by dragging, drawn as belt pieces? (What may replace what: `replaceGroup`.) */
export const isBeltDef = (def: string): boolean => {
  const k = BUILDING_KIND[buildingIdx(def)];
  return k === 'belt' || k === 'conduit';
};
