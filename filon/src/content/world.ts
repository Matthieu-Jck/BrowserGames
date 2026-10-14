// world.ts — the shape of Ysmère: the shared Cirque de Bonne-Veine template (identical for
// everyone, lightly jittered per player) closed by the Crown's terraces, the rings beyond and
// their mountains, the five environment archetypes and the six unique biomes. Pure data;
// mapgen.ts turns it into tiles and levels (D45).
import { BAL } from './balance';
import type { Loc } from './types';

/** Shared seed: the cirque, the weather and world events are the same for every colony. */
export const WORLD_SEED = 0x51f3a7;

/** Deposit blob in the cirque, offsets from the centre (tiles). rich = cap in 10 mu/epoch per tile. */
export interface CirqueDeposit { item: string; dx: number; dy: number; radius: number; rich: number }

/**
 * The cirque, a third of its first area (D40: radii × 0.58; the floor was 40, the Crown 40–56),
 * closed all round since D45. The tutorial's wires did not shrink, so two things hold the layout
 * rather than the scale: the coal stays just beyond the Heart's 8-tile wire for every player
 * (quest 3 lays a pole to it), and the drills of the coal and of the tired vein stay within
 * 18 tiles (the Heart's old level-1 zone; land is parcels since D60, the starting square holding
 * the whole Crown). mapgen.test.ts checks both on the real map.
 */
export const CIRQUE = {
  /** The floor (level 0) ends here, give or take the rim's jitter. */
  floorRadius: 23,
  /**
   * The Crown (D45), a closed ring of terraces with no pass: from the floor's rim it climbs one
   * level every `terrace` tiles up to the `crest`, runs along it at least `minCrest` tiles, then
   * comes down the same way to its foot, the archetype's `crownOuter` (this one for most lands;
   * the outer edge wobbles by `rimJitter.outer`). A line or a wire crosses it anywhere, one level
   * per step; nothing at level 0 leads out.
   */
  terrace: 2,
  crest: 3,
  minCrest: 2,
  crownOuter: 34,
  /** Rock hardness (H1–H4) on the Crown by level (1 … crest): soft on its lower terraces, H2 on the crest. Digging and the wind (D44) read it. */
  hardness: [1, 1, 2] as readonly number[],
  /** Amplitude of the shared noise on the floor's rim and on the crest's outer edge (tiles; the noise gives −amp … amp−1). */
  rimJitter: { floor: 2, outer: 2 },
  deposits: [
    { item: 'iron_ore', dx: 0, dy: -10, radius: 3.4, rich: 500 }, // north: its near half is within the Heart's own wires
    { item: 'coal', dx: -16, dy: 1, radius: 2.9, rich: 300 }, // west, a 5×5 block: 9 tiles or more past the Heart's footprint (quest 3's pole)
    { item: 'copper_ore', dx: 4, dy: 15, radius: 1.7, rich: 75 }, // « le filon fatigué », south: a pole away too
    { item: 'iron_ore', dx: -12, dy: -12, radius: 3.4, rich: 500 }, // north-west, 18 tiles out (the Heart's old level-1 reach)
  ] as readonly CirqueDeposit[],
  lake: { dx: 14, dy: 8, radius: 3.5 },
} as const;

export const RINGS = {
  near: 160,   // Proche couronne: from the Crown's foot (r 34) to 160
  reaches: 320, // Les Étendues: 160–320
  far: 480,    // Les Lointains: 320–480
  playable: 500, // beyond: Mer de dunes
  /** Per-player noise blends in from here to blendTo (integer weight 0..128); the archetype's bias is whole out to here. */
  blendFrom: 56,
  blendTo: 240,
} as const;

/**
 * The mountains around the cirque (D45). An elevation (0..255: the world's noise near the cirque,
 * the player's farther out, blended like the land's height, plus the archetype's `mountains`
 * bias) is cut into terraces: level 1 from the ring's `threshold`, one more every `step`, up to
 * `MAX_LEVEL` (5). They rise from `from` (none at the Crown's foot) to their full height at
 * `full`, and sink in the water (below land height `shore`) and inside the clearings kept around
 * the guaranteed copper field, each unique site's rim and each vent. Rock and only rock stands
 * above level 0.
 */
export const MOUNTAINS = {
  /** Feature size of the elevation noise (tiles) and its octaves (fewer: smoother outlines, fewer one-tile bumps). */
  scale: 32,
  octaves: 3,
  from: 38,
  full: 50,
  /** Elevation taken off per tile short of `full`. */
  ramp: 4,
  threshold: { near: 168, reaches: 164, far: 160 },
  step: 7,
  /** Under this land height (water lies under 52) the elevation sinks by `shoreSlope` per unit. */
  shore: 64,
  shoreSlope: 3,
  /** Clearings: tiles kept around the copper field's centre, past a unique site's rim, around a vent; the elevation sinks by `slope` per tile inside. */
  clear: { copper: 10, site: 6, vent: 5, slope: 8 },
  /** Rock hardness (H1–H4) by ring and level (1 … 5): the higher, the harder, so the windier (D44). */
  hardness: {
    near: [2, 2, 2, 3, 3] as readonly number[],
    reaches: [3, 3, 3, 4, 4] as readonly number[],
    far: [3, 3, 4, 4, 4] as readonly number[],
  },
  /**
   * From this radius (tiles), a tile may stand two levels above its east neighbour: an
   * east-facing cliff, the side the camera sees. Every other step, and every step closer in
   * (the Crown and the mountains at its foot), is one level at most, so every mountain can be
   * climbed from its north and south, one level per step.
   */
  cliffFrom: 56,
} as const;

/**
 * Renderer-only shading heights (0..255) MapGen writes next to the levels: the floor, rock at
 * `rock + perLevel × level` (relief.ts turns 158 + 20 per terrace into its terraces, so they
 * match the levels until it reads `level` itself), and a jitter of ±`jitter`. The land outside
 * the cirque is shaded by its own height field.
 */
export const SHADE = { floor: 40, rock: 148, perLevel: 20, jitter: 10 } as const;

export type ArchetypeId = 'closed' | 'steppe' | 'lagoons' | 'mesas' | 'embers';

export interface Archetype {
  name: Loc;
  desc: Loc;
  /** The Crown's foot (tiles from the centre): where its terraces come down to the land outside. */
  crownOuter: number;
  /** Bias added to height / moisture in the near belt (fades out by r 200). */
  dHeight: number;
  dMoist: number;
  /** Bias added to the mountains' elevation in the near belt (fades out by r 200, like `dHeight`): more or fewer mountains around the cirque. */
  mountains: number;
  /** ‰ of crown tiles hiding an embedded copper vein. */
  copperVein: number;
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  closed: {
    name: { fr: 'Cirque fermé', en: 'Closed Cirque' },
    desc: { fr: 'Une Couronne épaisse, des montagnes serrées, du minerai enchâssé : on creuse.', en: 'A thick Crown, crowded mountains, embedded ore: you dig.' },
    crownOuter: 44, dHeight: 30, dMoist: 0, mountains: 12, copperVein: 150,
  },
  steppe: {
    name: { fr: 'Grande Steppe', en: 'Wide Steppe' },
    desc: { fr: 'Une Couronne mince, des plaines immenses et des gisements épars.', en: 'A thin Crown, vast plains and scattered deposits.' },
    crownOuter: 32, dHeight: -18, dMoist: -10, mountains: -8, copperVein: 80,
  },
  lagoons: {
    name: { fr: 'Lagunes de sel', en: 'Salt Lagoons' },
    desc: { fr: 'Eaux basses et salines : du sel en abondance, de la terre à gagner au remblai.', en: 'Shallows and salt flats: plenty of salt, land to reclaim by backfill.' },
    crownOuter: CIRQUE.crownOuter, dHeight: -40, dMoist: 25, mountains: -4, copperVein: 80,
  },
  mesas: {
    name: { fr: 'Mesas sifflantes', en: 'Whistling Mesas' },
    desc: { fr: 'Des plateaux battus par le Souffle : l’éolien y rend double.', en: 'Plateaus swept by the Sough: wind yields double.' },
    crownOuter: CIRQUE.crownOuter, dHeight: 22, dMoist: -15, mountains: 8, copperVein: 80,
  },
  embers: {
    name: { fr: 'Champs de braise', en: 'Ember Fields' },
    desc: { fr: 'Des évents fument dans la plaine : la géothermie et le sel de braise sont proches.', en: 'Vents smoke across the plain: geothermal power and embersalt are close.' },
    crownOuter: CIRQUE.crownOuter, dHeight: 0, dMoist: -20, mountains: 0, copperVein: 80,
  },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

export type UniqueBiomeId = 'glassgrove' | 'resincliffs' | 'emberfields' | 'inkmarsh' | 'nacresea' | 'organpeaks';

export interface UniqueBiome {
  name: Loc;
  tier: 3 | 4;
  item: string;
  /** Biome id written to chunks (painter decor). */
  code: number;
  /** The level its rock stands at, for a site with rock (D45). */
  rockLevel?: number;
}

export const UNIQUE_BIOMES: Record<UniqueBiomeId, UniqueBiome> = {
  glassgrove: { name: { fr: 'Bosquet de verre', en: 'Glassgrove' }, tier: 3, item: 'sporeglass', code: 1 },
  resincliffs: { name: { fr: 'Falaises à résine', en: 'Resin Cliffs' }, tier: 3, item: 'sky_resin', code: 2, rockLevel: 3 },
  emberfields: { name: { fr: 'Champs de braise', en: 'Ember Fields' }, tier: 3, item: 'embersalt', code: 3 },
  inkmarsh: { name: { fr: "Marais d'encre", en: 'Inkmarsh' }, tier: 4, item: 'lumen_moss', code: 4 },
  nacresea: { name: { fr: 'Mer de nacre', en: 'Nacre Seabed' }, tier: 4, item: 'fossil_nacre', code: 5 },
  organpeaks: { name: { fr: 'Les Orgues', en: 'Organ Peaks' }, tier: 4, item: 'singing_quartz', code: 6, rockLevel: 4 },
};

export const T3_UNIQUES: readonly UniqueBiomeId[] = ['glassgrove', 'resincliffs', 'emberfields'];
export const T4_UNIQUES: readonly UniqueBiomeId[] = ['inkmarsh', 'nacresea', 'organpeaks'];

/** Common deposit blobs beyond the Crown: weights per item, and spawn chance per chunk (‰). */
export const COMMON_DEPOSITS: ReadonlyArray<readonly [string, number]> = [
  ['iron_ore', 30], ['coal', 20], ['copper_ore', 12], ['salt', 13], // no sand: it is the ground itself (a collector takes it anywhere)
];
export const DEPOSIT_CHANCE = { near: 350, reaches: 420, far: 480 } as const;
export const RICH_MULT = { near: 1000, reaches: 1300, far: 1600 } as const;

/** 64-step integer trig table (×1024), index 0 = east, 16 = south (screen y down). */
export const COS64: readonly number[] = [1024, 1019, 1004, 980, 946, 903, 851, 792, 724, 650, 569, 483, 392, 297, 200, 100, 0, -100, -200, -297, -392, -483, -569, -650, -724, -792, -851, -903, -946, -980, -1004, -1019, -1024, -1019, -1004, -980, -946, -903, -851, -792, -724, -650, -569, -483, -392, -297, -200, -100, 0, 100, 200, 297, 392, 483, 569, 650, 724, 792, 851, 903, 946, 980, 1004, 1019];
export const SIN64: readonly number[] = [0, 100, 200, 297, 392, 483, 569, 650, 724, 792, 851, 903, 946, 980, 1004, 1019, 1024, 1019, 1004, 980, 946, 903, 851, 792, 724, 650, 569, 483, 392, 297, 200, 100, 0, -100, -200, -297, -392, -483, -569, -650, -724, -792, -851, -903, -946, -980, -1004, -1019, -1024, -1019, -1004, -980, -946, -903, -851, -792, -724, -650, -569, -483, -392, -297, -200, -100];

/** Items per minute one deposit tile gives a drill, by raw item: the procedural fields and the uniques (for the market's board). */
export function tileCapsPerMin(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [item, rich] of Object.entries(BAL.depositRich)) out[item] = rich / 100;
  for (const u of Object.values(UNIQUE_BIOMES)) out[u.item] = BAL.uniqueRich / 100;
  return out;
}
