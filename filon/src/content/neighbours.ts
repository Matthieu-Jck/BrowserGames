// neighbours.ts — what a neighbouring base is built of (D110; owner, 2026-10-17: « S'il y a un
// endroit possédé par un PNJ, il faut qu'il y ait vraiment une base », then « leurs bases sont
// vraiment nulles, il n'y a rien qui marche, même pas de câble électrique pour relier les
// installations »). A neighbouring base is another claim of the Crier (a colony of
// content/colonies.ts) holding parcels beside the player's: a small working base, run by its own
// drones, laid out as a chain of its trade made from the recipes — what it extracts or buys, the
// machines the goods go through, the store, then CrierBelt's trade post, where it sells and buys —
// and powered: its own sources and masts, wired by the claim's own rule of reach.
// sim/world/neighbours.ts lays it out from the seeds; nothing of it is saved.
import type { BuildingId } from './buildings';
import type { ColonyProfileId } from './colonies';

/**
 * What a base stands beside its chain, by trade. The chain itself (its extractors, machines, store,
 * depots) comes from its trade's goods and the recipes (sim/world/neighbour-chain.ts, fifth pass of
 * D110; owner: « Du charbon rentre dans des fileuses »): no kit names its machines any more.
 */
export interface NeighbourKit {
  /** Its power: generators, turbines, panels. */
  readonly power: readonly BuildingId[];
  /** Buildings beside the chain, on its grid (a lab's servers…). */
  readonly extra: readonly BuildingId[];
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

/**
 * What each trade leans to beyond what its colony supplies at the Crier, the first first (D134;
 * owner, 2026-10-18: « Elle commande de la pierre, la transforme en minerai de fer et la revend ? Ça
 * n'a pas trop de sens »): a base makes the best of these its own land gives it, mined there and
 * worked up step by step (sim/world/neighbour-chain.ts); raw goods only a mining camp (or a salt port)
 * sells as they are, and only from a deposit that holds a real mine.
 */
export const NEIGHBOUR_LEANS: Readonly<Record<ColonyProfileId, readonly string[]>> = {
  mining: ['iron_ore', 'copper_ore', 'coal', 'salt', 'stone'],
  foundry: ['gear', 'steel', 'motor', 'iron_plate', 'copper_plate', 'pipe'],
  glasshouse: ['glass', 'circuit'],
  wind: ['motor', 'copper_coil', 'cable', 'copper_wire', 'copper_plate'],
  saltport: ['salt', 'glass'],
  ember: ['pipe', 'steel', 'gear', 'iron_plate'],
  scholar: ['circuit', 'glass', 'cable', 'copper_wire'],
  drifter: ['gear', 'glass', 'cable', 'iron_plate'],
};

/**
 * What a base is, by the good its main line ends in: the word its card and its band put before what
 * it does (D134: « Fonderie » over « minerai de fer → plaque de fer → engrenage »). A good not
 * listed: « Atelier ».
 */
export const NEIGHBOUR_TRADES: Readonly<Record<string, { readonly fr: string; readonly en: string }>> = {
  iron_ore: { fr: 'Mine', en: 'Mine' },
  copper_ore: { fr: 'Mine', en: 'Mine' },
  coal: { fr: 'Mine', en: 'Mine' },
  salt: { fr: 'Saline', en: 'Salt works' },
  stone: { fr: 'Carrière', en: 'Quarry' },
  sand: { fr: 'Sablière', en: 'Sand pit' },
  iron_plate: { fr: 'Fonderie', en: 'Foundry' },
  copper_plate: { fr: 'Fonderie', en: 'Foundry' },
  gear: { fr: 'Fonderie', en: 'Foundry' },
  steel: { fr: 'Aciérie', en: 'Steelworks' },
  pipe: { fr: 'Forge', en: 'Forge' },
  glass: { fr: 'Verrerie', en: 'Glassworks' },
  copper_wire: { fr: 'Tréfilerie', en: 'Wire works' },
  cable: { fr: 'Tréfilerie', en: 'Wire works' },
  copper_coil: { fr: 'Bobinerie', en: 'Coil works' },
  motor: { fr: 'Atelier de moteurs', en: 'Motor works' },
  circuit: { fr: 'Atelier d’électronique', en: 'Electronics works' },
};
export const NEIGHBOUR_TRADE_OTHER = { fr: 'Atelier', en: 'Workshop' } as const;

export const NEIGHBOUR_KITS: Readonly<Record<ColonyProfileId, NeighbourKit>> = {
  mining: { power: ['wind_flower', 'wind_flower'], extra: [], tents: 2 },
  // A foundry and an ember forge smelt: an incinerator beside the hub, where their slag goes (D125, for the look).
  foundry: { power: ['brazier', 'wind_flower'], extra: ['incinerator'], tents: 1 },
  glasshouse: { power: ['solar_farm', 'sun_bulb'], extra: [], tents: 1 },
  // A wind citadel: turbines for its chargers, an accumulator beside.
  wind: { power: ['big_turbine', 'pitch_turbine', 'wind_flower'], extra: ['accumulator'], tents: 1 },
  saltport: { power: ['wind_flower', 'wind_flower'], extra: [], tents: 2 },
  ember: { power: ['brazier', 'brazier'], extra: ['incinerator'], tents: 1 },
  // A scholar spire, its servers beside.
  scholar: { power: ['solar_farm', 'wind_flower'], extra: ['server'], tents: 1 },
  drifter: { power: ['wind_flower', 'wind_flower'], extra: [], tents: 2 },
};
