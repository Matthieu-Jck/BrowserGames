// neighbours.ts — what a neighbouring base is built of (D110; owner, 2026-10-17: « S'il y a un
// endroit possédé par un PNJ, il faut qu'il y ait vraiment une base », then « leurs bases sont
// vraiment nulles, il n'y a rien qui marche, même pas de câble électrique pour relier les
// installations »). A neighbouring base is another claim of the Crier (a colony of
// content/colonies.ts) holding parcels beside the player's: a small working base, run by its own
// drones, laid out as a chain that fits its trade — what it extracts, the machines the goods go
// through, the store, then CrierBelt's lift pad, where it sells — and powered: its own sources and
// masts, wired by the claim's own rule of reach. sim/world/neighbours.ts lays it out from the seeds;
// nothing of it is saved.
import type { BuildingId } from './buildings';
import type { ColonyProfileId } from './colonies';

export interface NeighbourKit {
  /** What heads the chain: a drill stands on a deposit (else a sand collector stands in), a collector anywhere; `extractN` of them. */
  readonly extract: BuildingId;
  readonly extractN: number;
  /** The machines the goods go through, in order, the last into the store. */
  readonly makers: readonly BuildingId[];
  /** The store the chain hands to the Core through. */
  readonly store: BuildingId;
  /** Its power: generators, turbines, panels. */
  readonly power: readonly BuildingId[];
  /** Buildings beside the chain, on its grid (a lab's servers…). */
  readonly extra: readonly BuildingId[];
  /** What rides each stage's ribbons (item ids): what leaves the extractors (a drill on a deposit carries its ore), then each maker. */
  readonly carries: readonly string[];
  /** Covered depots (canvas dome tents) round the hub: its drones' stores. */
  readonly tents: number;
}

/**
 * Every base's Core (owner, 2026-10-17: « ils devraient avoir un cœur, juste pas le même que le mien
 * », « leur cœur devrait être plus petit aussi »): at its hub's middle, its chain's end and its grid's
 * start — a modest 3 × 3 outpost centre beside the claim's 5 × 5 Core, drawn by the render in the
 * colony's own style (art/recipes/neighbour-dress.ts). The sim lays it as this 3 × 3 def's footprint
 * (`NLayout.core` marks it); the render never draws that def there.
 */
export const NEIGHBOUR_CORE: BuildingId = 'big_silo';

/** The Core's top piece by trade: what crowns it (its wires hang from it). */
export const NEIGHBOUR_CORE_TOP: Readonly<Record<ColonyProfileId, 'mast' | 'chimney' | 'lantern' | 'dish'>> = {
  mining: 'mast', drifter: 'mast', foundry: 'chimney', ember: 'chimney', glasshouse: 'lantern', saltport: 'lantern', wind: 'dish', scholar: 'dish',
};

/** CrierBelt's lift pad, set beside the Core: what goes into the Core leaves for the Crier from it. */
export const NEIGHBOUR_PAD: BuildingId = 'trade_post';

/** The mast that carries a base's wires (its range and slots are the claim's own: content `pole`). */
export const NEIGHBOUR_MAST: BuildingId = 'mast';

/** A covered depot's footprint (tiles a side): the dome tent the render draws there. */
export const NEIGHBOUR_TENT = 2;

/** Boundary cairns along a holding's outer edge, one every so many tiles. */
export const NEIGHBOUR_CAIRN_STEP = 5;

export const NEIGHBOUR_KITS: Readonly<Record<ColonyProfileId, NeighbourKit>> = {
  // A mining camp: drills on its deposits into a store, sold at the pad.
  mining: { extract: 'drill', extractN: 3, makers: [], store: 'silo', power: ['wind_flower', 'wind_flower'], extra: [], carries: ['iron_ore'], tents: 2 },
  // A foundry: ore smelted, plates pressed into gears.
  foundry: { extract: 'drill', extractN: 2, makers: ['kiln', 'press'], store: 'silo', power: ['brazier', 'wind_flower'], extra: [], carries: ['iron_ore', 'iron_plate', 'gear'], tents: 1 },
  // A glasshouse: sand to glass to lenses, on the sun.
  glasshouse: { extract: 'sand_collector', extractN: 2, makers: ['kiln', 'optics_workshop'], store: 'silo', power: ['solar_farm', 'sun_bulb'], extra: [], carries: ['sand', 'glass', 'lens'], tents: 1 },
  // A wind citadel: turbines charging batteries.
  wind: { extract: 'drill', extractN: 1, makers: ['wire_mill_double', 'cell_charger'], store: 'silo', power: ['big_turbine', 'pitch_turbine', 'wind_flower'], extra: ['accumulator'], carries: ['copper_ore', 'copper_wire', 'charged_cell'], tents: 1 },
  // A salt port: salt dug and sifted, stored in bulk.
  saltport: { extract: 'drill', extractN: 2, makers: ['sifter'], store: 'big_silo', power: ['wind_flower', 'wind_flower'], extra: [], carries: ['salt', 'salt'], tents: 2 },
  // An ember forge: arc furnaces and ovens on coal fire.
  ember: { extract: 'drill', extractN: 2, makers: ['arc_furnace', 'ceramic_oven'], store: 'silo', power: ['brazier', 'brazier'], extra: [], carries: ['iron_ore', 'iron_plate', 'ceramic'], tents: 1 },
  // A scholar spire: data collected into its lab, its servers beside.
  scholar: { extract: 'data_collector', extractN: 2, makers: ['observatory'], store: 'silo', power: ['solar_farm', 'wind_flower'], extra: ['server'], carries: ['journal_1', 'circuit'], tents: 1 },
  // A drifter guild's yard: sand into glass, glass into its workshops' parts.
  drifter: { extract: 'sand_collector', extractN: 2, makers: ['kiln', 'workshop'], store: 'silo', power: ['wind_flower', 'wind_flower'], extra: [], carries: ['sand', 'glass', 'gear'], tents: 2 },
};
