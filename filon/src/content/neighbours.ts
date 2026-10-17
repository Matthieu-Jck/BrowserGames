// neighbours.ts — what a neighbouring base is built of (D110; owner, 2026-10-17: « S'il y a un
// endroit possédé par un PNJ, il faut qu'il y ait vraiment une base »). A neighbouring base is
// another claim of the Crier (a colony of content/colonies.ts) holding parcels beside the player's:
// a small working base drawn with the same buildings the player builds, run by its own drones.
// Its kit follows its trade (the colony's profile): a mining camp's drills on the deposits, a
// foundry's furnaces, a wind citadel's turbines… The hub — the CrierBelt lift pad every claim
// trades through, a silo and a mast, the claim's flag beside the pad — stands on its first parcel;
// the trade's buildings fill the hub and the other parcels, two or three a parcel, in this order
// (cycled), linked by ribbons carrying what the claim sells (`carries`). sim/world/neighbours.ts
// lays them out from the seeds; nothing of it is saved.
import type { BuildingId } from './buildings';
import type { ColonyProfileId } from './colonies';

export interface NeighbourKit {
  /** The trade's buildings, in the order the parcels take them (cycled). A drill stands on a deposit, or gives way to a sand collector. */
  readonly works: readonly BuildingId[];
  /** What its ribbons carry (item ids: the profile's staples), line after line. */
  readonly carries: readonly string[];
}

/** Every base's hub, on its first parcel: CrierBelt's lift pad, a silo beside it, a link mast. */
export const NEIGHBOUR_HUB: readonly BuildingId[] = ['trade_post', 'silo', 'mast'];

/** The trade's buildings beside the hub, on its first parcel; on each other parcel. */
export const NEIGHBOUR_PER_PARCEL = { hub: 2, other: 3 } as const;

export const NEIGHBOUR_KITS: Readonly<Record<ColonyProfileId, NeighbourKit>> = {
  mining: { works: ['fast_drill', 'drill', 'wind_flower', 'drill', 'kiln', 'fast_drill'], carries: ['iron_ore', 'copper_ore', 'stone'] },
  foundry: { works: ['kiln', 'electric_smelter', 'press', 'wind_flower', 'wire_mill_double', 'arc_furnace'], carries: ['iron_plate', 'gear'] },
  glasshouse: { works: ['sand_collector', 'kiln', 'sun_bulb', 'sand_collector', 'optics_workshop', 'kiln'], carries: ['sand', 'glass', 'lens'] },
  wind: { works: ['big_turbine', 'accumulator', 'pitch_turbine', 'cell_charger', 'wind_flower', 'heavy_accumulator'], carries: ['charged_cell', 'empty_cell'] },
  saltport: { works: ['sifter', 'big_silo', 'wind_flower', 'sand_collector', 'press', 'silo'], carries: ['salt', 'sand'] },
  ember: { works: ['arc_furnace', 'ceramic_oven', 'brazier', 'forge_press', 'wind_flower', 'kiln'], carries: ['ceramic', 'iron_plate'] },
  scholar: { works: ['observatory', 'data_collector', 'server', 'wind_flower', 'scriptorium', 'server'], carries: ['circuit', 'journal_1'] },
  drifter: { works: ['great_workshop', 'sun_bulb', 'tower_workshop', 'wind_flower', 'silo', 'workshop'], carries: ['resin_canvas', 'gear'] },
};
