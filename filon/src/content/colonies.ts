// colonies.ts — the forty colonies of the Crier Ring (the other claims: « concessions » in the UI; some hold land beside the player's as neighbouring bases, D110), as content: eight profiles (design
// §6), what each supplies and needs, its unique resources, daily growth and distance band, plus
// the syllables their names are drawn from. Trade lines are weighted: 3 = the profile's staple
// from the design table, 1 = a secondary line added so that every tradable good has at least
// one NPC supplier (it can be imported) and one NPC buyer (exports have somewhere to go).
// market/colonies.ts turns this into the actual colonies from WORLD_SEED (names, sizes, places).
import type { Loc } from './types';

export type ColonyProfileId =
  | 'mining' | 'foundry' | 'glasshouse' | 'wind' | 'saltport' | 'ember' | 'scholar' | 'drifter';

/** Distance band from the player's cirque; BAL.market.delayMin gives the delivery delay. */
export type DistanceBand = 'near' | 'medium' | 'far' | 'veryFar';

export interface ColonyProfile {
  readonly name: Loc;
  /** Colonies of this profile (the forty sum up in COLONY_PROFILE_IDS order). */
  readonly count: number;
  /** Bands a colony of this profile sits in (alternating by rank when there are two). */
  readonly bands: readonly DistanceBand[];
  /** [item id, weight] — the profile's share of the NPC supply / demand of that item. */
  readonly supplies: ReadonlyArray<readonly [string, number]>;
  readonly needs: ReadonlyArray<readonly [string, number]>;
  /** Unique resources: each colony supplies ONE of these (cycled by rank), at UNIQUE_WEIGHT. */
  readonly uniques: readonly string[];
  /** Growth of the colony's supply and needs per day, counted from the player's founding. */
  readonly growth: number;
}

/** Weight of a colony's unique resource in its supply lines. */
export const UNIQUE_WEIGHT = 3;

export const COLONY_PROFILES = {
  mining: {
    name: { fr: 'Camp minier', en: 'Mining Camp' }, count: 7, bands: ['near'], growth: 0.01,
    supplies: [['iron_ore', 3], ['copper_ore', 3], ['stone', 3], ['quartz', 1], ['brick', 1]], // quartz (D87): what a land without its vein buys (Survey Data went with the data, D122)
    needs: [['coal', 3], ['circuit', 3], ['charged_cell', 3], ['steel', 3], ['gear', 1], ['pipe', 1], ['thermal_core', 1], ['robot_arm', 1], ['slag', 1], ['motor', 1]], // D123: steel for rails and props, pipes for the shafts' pumps; D125: slag to backfill the old shafts; D129: motors for the winches
    uniques: [],
  },
  foundry: {
    name: { fr: 'Fonderie', en: 'Foundry' }, count: 6, bands: ['near', 'medium'], growth: 0.015,
    supplies: [['iron_plate', 3], ['gear', 3], ['glass', 1], ['copper_wire', 1], ['oscillator', 1], ['copper_plate', 1], ['steel', 1], ['pipe', 1], ['cable', 1], ['slag', 1], ['scrap', 1], ['copper_coil', 1], ['motor', 1]], // D123: a foundry sells a little of everything metal; D125: and its slag and offcuts, cheap; D129: coils and motors
    needs: [['iron_ore', 3], ['sand', 3], ['copper_ore', 3], ['coal', 3], ['ceramic', 3], ['brick', 1], ['embersalt', 1], ['pace_bell', 1]],
    uniques: [],
  },
  glasshouse: {
    name: { fr: 'Serre', en: 'Glasshouse' }, count: 6, bands: ['medium'], growth: 0.01,
    supplies: [['coal', 3], ['sand', 3], ['brick', 3], ['lens', 1]], // D123: sand and water, the desert's bricks
    needs: [['glass', 3], ['ceramic', 3], ['charged_cell', 3], ['pipe', 3], ['empty_cell', 1], ['quartz', 1], ['copper_plate', 1]], // D123: the glasshouses' irrigation
    uniques: ['sporeglass', 'lumen_moss'],
  },
  wind: {
    name: { fr: 'Citadelle du vent', en: 'Wind Citadel' }, count: 5, bands: ['medium'], growth: 0.015,
    supplies: [['charged_cell', 3], ['empty_cell', 3]],
    needs: [['circuit', 3], ['ceramic', 3], ['salt', 3], ['cable', 3], ['copper_plate', 3], ['copper_wire', 1], ['resin_canvas', 1], ['thermal_core', 1], ['singing_quartz', 1], ['resonator', 1], ['oscillator', 1], ['copper_coil', 3]], // D123: their turbines' cable and windings; D129: the windings' coils
    uniques: ['sky_resin'],
  },
  saltport: {
    name: { fr: 'Port du sel', en: 'Salt Port' }, count: 5, bands: ['medium', 'far'], growth: 0.01,
    supplies: [['salt', 3], ['nacre_lattice', 1]],
    // Lighthouse bulbs: why Port-Écume can run short of glass (the scripted first trade).
    needs: [['stone', 3], ['iron_plate', 3], ['gear', 3], ['brick', 3], ['glass', 1], ['steel', 1], ['sky_resin', 1], ['resin_canvas', 1], ['slag', 1]], // D123: harbour walls in brick; D125: slag for the breakwaters' fill
    uniques: ['fossil_nacre'],
  },
  ember: {
    name: { fr: 'Forge de braise', en: 'Ember Forge' }, count: 5, bands: ['far'], growth: 0.02,
    supplies: [['thermal_core', 3], ['steel', 3], ['ceramic', 1], ['pipe', 1], ['pace_bell', 1], ['robot_arm', 1]], // D123: the Ember Forges' steel
    needs: [['circuit', 3], ['glass', 3], ['oscillator', 1], ['fossil_nacre', 1], ['scrap', 1]], // oscillators where Mechanics Data was (D122); D125: scrap for their remelt
    uniques: ['embersalt'],
  },
  scholar: {
    name: { fr: 'Flèche savante', en: 'Scholar Spire' }, count: 4, bands: ['far'], growth: 0.025,
    // Its atlases, codices and data went with the data (D122): it reads through lenses and lattices now.
    supplies: [['circuit', 1], ['oscillator', 1], ['resonator', 1]],
    needs: [['lens', 3], ['nacre_lattice', 3], ['cable', 1], ['thermal_core', 1], ['sporeglass', 1], ['lumen_moss', 1]],
    uniques: ['singing_quartz'],
  },
  drifter: {
    name: { fr: 'Guilde des dirigeables', en: 'Drifter Guild' }, count: 2, bands: ['veryFar'], growth: 0.01,
    supplies: [['resin_canvas', 3], ['nacre_lattice', 1]], // atlases and codices until D122
    needs: [['lens', 3], ['ceramic', 3], ['cable', 1], ['steel', 1], ['sporeglass', 1], ['nacre_lattice', 1]],
    uniques: ['sky_resin'],
  },
} as const satisfies Record<ColonyProfileId, ColonyProfile>;

export const COLONY_PROFILE_IDS = Object.keys(COLONY_PROFILES) as ColonyProfileId[];

/**
 * Colonies with a fixed name (and band): the design names them, and Port-Écume hosts every new
 * colony's scripted first trade (BAL.market.firstTrade). `rank` = position within its profile.
 */
export const PINNED_COLONIES: ReadonlyArray<{ readonly key: string; readonly profile: ColonyProfileId; readonly rank: number; readonly band: DistanceBand; readonly name: Loc }> = [
  { key: 'port_ecume', profile: 'saltport', rank: 0, band: 'medium', name: { fr: 'Port-Écume', en: 'Foam Harbor' } },
  { key: 'sept_cornes', profile: 'mining', rank: 0, band: 'near', name: { fr: 'Sept-Cornes', en: 'Seven Horns' } },
  { key: 'hameau_lilas', profile: 'glasshouse', rank: 0, band: 'medium', name: { fr: 'Hameau-Lilas', en: 'Lilac Hamlet' } },
];

/**
 * Name heads: French head + '-' + tail (« Port-Écume »); English pattern with '{}' for the tail
 * (« Foam Harbor »). Numeral heads take the tail's plural (« Sept-Cornes » / « Seven Horns »).
 */
export const NAME_HEADS: ReadonlyArray<{ readonly fr: string; readonly en: string; readonly plural?: boolean }> = [
  { fr: 'Port', en: '{} Harbor' }, { fr: 'Hameau', en: '{} Hamlet' }, { fr: 'Val', en: '{} Vale' },
  { fr: 'Mont', en: 'Mount {}' }, { fr: 'Roche', en: '{} Rock' }, { fr: 'Puits', en: '{} Well' },
  { fr: 'Gué', en: '{} Ford' }, { fr: 'Anse', en: '{} Cove' }, { fr: 'Fort', en: 'Fort {}' },
  { fr: 'Col', en: '{} Pass' }, { fr: 'Cap', en: 'Cape {}' }, { fr: 'Clos', en: '{} Close' },
  { fr: 'Pic', en: '{} Peak' }, { fr: 'Croix', en: '{} Cross' }, { fr: 'Bourg', en: '{} Burgh' },
  { fr: 'Combe', en: '{} Combe' }, { fr: 'Lande', en: '{} Heath' },
  { fr: 'Sept', en: 'Seven {}', plural: true }, { fr: 'Trois', en: 'Three {}', plural: true },
  { fr: 'Cent', en: 'Hundred {}', plural: true },
];

/** Name tails: singular and plural, in both languages. */
export const NAME_TAILS: ReadonlyArray<{ readonly fr: string; readonly en: string; readonly frPl: string; readonly enPl: string }> = [
  { fr: 'Écume', en: 'Foam', frPl: 'Écumes', enPl: 'Foams' },
  { fr: 'Corne', en: 'Horn', frPl: 'Cornes', enPl: 'Horns' },
  { fr: 'Lilas', en: 'Lilac', frPl: 'Lilas', enPl: 'Lilacs' },
  { fr: 'Braise', en: 'Ember', frPl: 'Braises', enPl: 'Embers' },
  { fr: 'Sel', en: 'Salt', frPl: 'Sels', enPl: 'Salts' },
  { fr: 'Vent', en: 'Wind', frPl: 'Vents', enPl: 'Winds' },
  { fr: 'Ocre', en: 'Ochre', frPl: 'Ocres', enPl: 'Ochres' },
  { fr: 'Givre', en: 'Rime', frPl: 'Givres', enPl: 'Rimes' },
  { fr: 'Nacre', en: 'Nacre', frPl: 'Nacres', enPl: 'Nacres' },
  { fr: 'Cendre', en: 'Ash', frPl: 'Cendres', enPl: 'Ashes' },
  { fr: 'Ambre', en: 'Amber', frPl: 'Ambres', enPl: 'Ambers' },
  { fr: 'Ronce', en: 'Bramble', frPl: 'Ronces', enPl: 'Brambles' },
  { fr: 'Plume', en: 'Feather', frPl: 'Plumes', enPl: 'Feathers' },
  { fr: 'Rouille', en: 'Rust', frPl: 'Rouilles', enPl: 'Rusts' },
  { fr: 'Lune', en: 'Moon', frPl: 'Lunes', enPl: 'Moons' },
  { fr: 'Dune', en: 'Dune', frPl: 'Dunes', enPl: 'Dunes' },
  { fr: 'Écho', en: 'Echo', frPl: 'Échos', enPl: 'Echoes' },
  { fr: 'Orage', en: 'Storm', frPl: 'Orages', enPl: 'Storms' },
  { fr: 'Source', en: 'Spring', frPl: 'Sources', enPl: 'Springs' },
  { fr: 'Pierre', en: 'Stone', frPl: 'Pierres', enPl: 'Stones' },
  { fr: 'Cloche', en: 'Bell', frPl: 'Cloches', enPl: 'Bells' },
  { fr: 'Voile', en: 'Sail', frPl: 'Voiles', enPl: 'Sails' },
  { fr: 'Ancre', en: 'Anchor', frPl: 'Ancres', enPl: 'Anchors' },
  { fr: 'Mirage', en: 'Mirage', frPl: 'Mirages', enPl: 'Mirages' },
  { fr: 'Aiguille', en: 'Needle', frPl: 'Aiguilles', enPl: 'Needles' },
  { fr: 'Fumée', en: 'Smoke', frPl: 'Fumées', enPl: 'Smokes' },
  { fr: 'Sauge', en: 'Sage', frPl: 'Sauges', enPl: 'Sages' },
  { fr: 'Souffle', en: 'Sough', frPl: 'Souffles', enPl: 'Soughs' },
  { fr: 'Opale', en: 'Opal', frPl: 'Opales', enPl: 'Opals' },
  { fr: 'Rivage', en: 'Shore', frPl: 'Rivages', enPl: 'Shores' },
  { fr: 'Étoile', en: 'Star', frPl: 'Étoiles', enPl: 'Stars' },
];

/** Where the Cirque de Bonne-Veine sits on Ysmère (degrees) — the centre of the orbital view. */
export const HOME_POSITION = { lat: 18, lon: 0 } as const;

/** Great-circle distance from the cirque (degrees) of each band, as a [min, max] range. */
export const BAND_ARC: Record<DistanceBand, readonly [number, number]> = {
  near: [6, 20],
  medium: [25, 55],
  far: [60, 110],
  veryFar: [115, 165],
};

/** Relative size of a colony (scales its share of its profile's trade), as a [min, max] range. */
export const COLONY_SIZE = [0.7, 1.3] as const;
