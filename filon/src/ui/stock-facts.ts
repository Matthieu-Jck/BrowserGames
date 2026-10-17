// stock-facts.ts — what the HUD's Stock panel says about the Heart's items (D96; owner,
// 2026-10-16: « n'affiche plus cette barre de ressource en haut à gauche par défaut, il faut que le
// joueur clique sur un bouton Stock pour le voir »), pure (no DOM):
//   · `STOCK_GROUPS` / `groupOf`: the items by kind, the panel's sections — raw (ores, coal, water,
//     stone), materials, parts, data, the rare finds;
//   · `shortages`: which of the Heart's items the base lacks for what the Heart pays for (D33, D34:
//     the Heart pays for buildings — refunded when they come down — and for plans, for good), the
//     button's badge and the panel's marks. An item **ran out** when the Heart holds less than one
//     of it and an unlocked building or an open plan costs it: nothing that needs it can be had. It
//     is **short** when the Heart holds some but less than an open plan costs (its prerequisites
//     met, not taken; the plan waits on the item, or on CrierBelt's restart reserve, D36). The
//     smallest shortfall is the one told (the nearest need), with what it is for.
import { BUILDING_IDS, buildingDef, buildingIdx, costOf, itemDef } from '@/content/registry';
import { PLAN_IDS } from '@/content/research';
import type { ItemKind } from '@/content/types';
import { planCost } from '@/sim/systems/research';
import type { Sim } from '@/sim/state';

export type StockGroup = 'raw' | 'material' | 'part' | 'data' | 'rare';

/** The panel's sections in order: the kinds each holds and the item whose icon heads it. */
export const STOCK_GROUPS: ReadonlyArray<{ readonly id: StockGroup; readonly kinds: readonly ItemKind[]; readonly icon: string }> = [
  { id: 'raw', kinds: ['ore', 'fuel', 'fluid', 'rubble'], icon: 'iron_ore' },
  { id: 'material', kinds: ['material'], icon: 'iron_plate' },
  { id: 'part', kinds: ['part', 'energy'], icon: 'gear' },
  { id: 'data', kinds: ['science'], icon: 'journal_1' },
  { id: 'rare', kinds: ['unique'], icon: 'sporeglass' },
];

/** The section an item goes in. */
export function groupOf(item: number): StockGroup {
  const k = itemDef(item).kind;
  return STOCK_GROUPS.find((g) => g.kinds.includes(k))?.id ?? 'material';
}

/** An item the base lacks: how many milli-items short of its nearest need, and that need. */
export interface Shortage {
  readonly item: number;
  /** Less than one in the Heart, and needed: nothing that costs it can be had. */
  readonly out: boolean;
  /** Milli-items short of the nearest need. */
  readonly missing: number;
  /** The need: a plan (its id) or a building (its id). */
  readonly for: { readonly k: 'plan' | 'building'; readonly id: string };
}

/**
 * What the base lacks, by item (in item order). The open plans first: each item a plan costs
 * beyond the Heart's stock (or beyond what the restart reserve lets go); then the unlocked
 * buildings, for the items the Heart holds none of. Per item, the smallest shortfall wins.
 */
export function shortages(sim: Sim): Shortage[] {
  const best = new Map<number, Shortage>();
  const offer = (item: number, missing: number, need: Shortage['for']): void => {
    if (missing <= 0) return;
    const out = sim.stock[item]! < 1000;
    const had = best.get(item);
    if (!had || missing < had.missing) best.set(item, { item, out, missing, for: need });
  };
  for (const id of PLAN_IDS) {
    const b = sim.planBlock(id);
    if (b === 'unaffordable') {
      for (const c of planCost(id)) offer(c.item, c.mu - sim.stock[c.item]!, { k: 'plan', id });
    } else if (b === 'reserve') {
      for (const c of sim.reserveShort(planCost(id), id)) offer(c.item, c.mu, { k: 'plan', id });
    }
  }
  for (const id of BUILDING_IDS) {
    const def = buildingDef(buildingIdx(id));
    if (def.kind === 'hearth' || !sim.unlocked(def.unlock)) continue;
    for (const c of costOf(buildingIdx(id))) {
      if (sim.stock[c.item]! < 1000) offer(c.item, c.mu - sim.stock[c.item]!, { k: 'building', id });
    }
  }
  return [...best.values()].sort((a, b) => a.item - b.item);
}
