// world.ts — the shape of Ysmère: the shared Cirque de Bonne-Veine template (identical for
// everyone, lightly jittered per player) closed by the Crown's terraces, the rings beyond and
// their mountains, the five environment archetypes and the six unique biomes. Pure data;
// mapgen.ts turns it into tiles and levels (D45). A land is made by one map version (`MAPS`,
// D63): a base keeps the version it was founded on, new bases take `MAP_VERSION`.
import { BAL } from './balance';
import type { Loc } from './types';

/** Shared seed: the cirque, the weather and world events are the same for every colony. */
export const WORLD_SEED = 0x51f3a7;

/** Deposit blob in the cirque, offsets from the centre (tiles). rich = cap in 10 mu/epoch per tile. */
export interface CirqueDeposit { item: string; dx: number; dy: number; radius: number; rich: number }

/**
 * A cirque template (D40, D45, D63): the floor, the Crown's terraces round it, its deposits and
 * its water. Every land is made from one; which one is the land's map version (`MAPS`).
 */
export interface CirqueTemplate {
  /** The floor (level 0) ends here, give or take the rim's jitter. */
  readonly floorRadius: number;
  /**
   * The Crown (D45), a closed ring of terraces with no pass: from the floor's rim it climbs one
   * level every `terrace` tiles up to its top, runs along it at least `minCrest` tiles, then
   * comes down the same way to its foot, the archetype's (`MapParams.crownOuter`, this one for
   * the others; the outer edge wobbles by `rimJitter.outer`). A line or a wire crosses it
   * anywhere, one level per step; nothing at level 0 leads out.
   */
  readonly terrace: number;
  /** The Crown's highest level: all round on a map without `ridge`, else on its peaks only. */
  readonly crest: number;
  /**
   * The level the Crown keeps all round (map 2, D63; absent: `crest`). It rises to `crest` where
   * its top is wide enough to carry `minCrest` tiles of it: on the shoulders, round the tarn, and
   * all round a Closed Cirque.
   */
  readonly ridge?: number;
  readonly minCrest: number;
  readonly crownOuter: number;
  /**
   * The shoulders (map 2, D63): the Crown's top widened by the shared noise read round a circle
   * of `radius` tiles (feature size `scale`), so the same for every player: past `from` (0..255),
   * by `gain`/128 of a tile per unit — a peak where that leaves room for the crest.
   */
  readonly shoulders?: { readonly radius: number; readonly scale: number; readonly from: number; readonly gain: number };
  /** Rock hardness (H1–H4) on the Crown by level (1 … crest): digging and the wind (D44) read it. */
  readonly hardness: readonly number[];
  /** Amplitude of the shared noise on the floor's rim and on the crest's outer edge (tiles; the noise gives −amp … amp−1). */
  readonly rimJitter: { readonly floor: number; readonly outer: number };
  /**
   * Where that noise is read (map 2, D63): at the tile's bearing on a circle of `radius`, the rim's
   * of feature size `scale` (map 1: 6), so the rim, the edge and every terrace between them are
   * functions of the bearing — rings `terrace` tiles deep along a line out of the cirque. Absent
   * (map 1): at the tile itself, so the rim wobbles across the Crown's width too, and a terrace
   * comes out a tile deep here and there.
   */
  readonly jitterAt?: { readonly radius: number; readonly scale: number };
  readonly deposits: readonly CirqueDeposit[];
  /**
   * The cirque's water, offsets from the centre: water within `radius`, deep within `deep`. On
   * the floor (map 1), or a tarn up on the Crown (`onCrest`, map 2: the owner, 2026-10-14: "put
   * the lake at the top of the moutain"), its water at the crest's level, the crest kept at least
   * `mound` tiles past its centre (a tile less per tile away from it) so rock of that level rings it.
   */
  readonly lake: { readonly dx: number; readonly dy: number; readonly radius: number; readonly deep: number; readonly onCrest?: boolean; readonly mound?: number };
}

/**
 * The cirque's deposits, the same on every map. The tutorial's wires did not shrink with the
 * cirque (D40), so two things hold the layout rather than the scale: the coal stays just beyond
 * the Heart's 8-tile wire for every player (quest 3 lays a pole to it), and the drills of the coal
 * and of the tired vein stay within 18 tiles (the Heart's old level-1 zone; land is parcels since
 * D60, the starting square holding the cirque, D74). mapgen.test.ts checks both on the real map.
 */
const CIRQUE_DEPOSITS: readonly CirqueDeposit[] = [
  { item: 'iron_ore', dx: 0, dy: -10, radius: 3.4, rich: 500 }, // north: its near half is within the Heart's own wires
  { item: 'coal', dx: -16, dy: 1, radius: 2.9, rich: 300 }, // west, a 5×5 block: 9 tiles or more past the Heart's footprint (quest 3's pole)
  { item: 'copper_ore', dx: 4, dy: 15, radius: 1.7, rich: 75 }, // « le filon fatigué », south: a pole away too
  { item: 'iron_ore', dx: -12, dy: -12, radius: 3.4, rich: 500 }, // north-west, 18 tiles out (the Heart's old level-1 reach)
];

/**
 * The cirque of map 1 (D40: a third of its first area, radii × 0.58; D45: closed all round): the
 * Crown three levels high all round, two tiles a terrace, its crest H2 (lilac) out to r 30 or so,
 * its foot at r 34; the lake on the floor. Bases founded before D63 keep it: a land never changes
 * under a base (saves are sacred).
 */
export const CIRQUE_V1: CirqueTemplate = {
  floorRadius: 23,
  terrace: 2,
  crest: 3,
  minCrest: 2,
  crownOuter: 34,
  hardness: [1, 1, 2],
  rimJitter: { floor: 2, outer: 2 },
  deposits: CIRQUE_DEPOSITS,
  lake: { dx: 14, dy: 8, radius: 3.5, deep: 1.9 },
};

/**
 * Today's cirque (map 2, D63; owner, 2026-10-14: "the circus moutain is too large, the purple part
 * shouldn't be so large everywhere. also put the lake at the top of the moutain"). The floor (to
 * r 23, its rim within the same ±2) and its deposits are map 1's. The Crown is a ridge two levels
 * high, 6–8 tiles from the rim to the foot in most places (map 1: 10–11), still two tiles a
 * terrace (a traction ribbon's elevator needs a flat tile in front of it), its top two or three
 * tiles wide, all sandstone; in a few places, from the shared noise, it shoulders out into a peak
 * of the crest's level, 11–17 tiles across, the lilac rock (H2) its top, and the cirque's water is a small tarn up in one of them,
 * east-south-east (where the floor's lake was), five tiles across at level 3.
 */
export const CIRQUE: CirqueTemplate = {
  floorRadius: 23,
  terrace: 2,
  crest: 3,
  ridge: 2,
  // Two: with the noise read by bearing (`jitterAt`) a top comes out two tiles deep on most lines
  // over it, room for an elevator's flat tile; three would widen the whole ring by a tile.
  minCrest: 2,
  crownOuter: 29,
  // At most (255 − 150) × 8 / 128 = 6 tiles: the Crown's farthest terrace stays within r 40. The
  // starting square (3×3 parcels of 23 tiles, D74) spans ±34 tiles: the whole Crown but the crest
  // of the tarn's peak, which reaches 36 east.
  shoulders: { radius: 28, scale: 10, from: 150, gain: 8 },
  // The lilac rock on the peaks only, the ridge sandstone (a one-tile lilac spine along it was
  // tried: on the tile grid it reads as a dotted zigzag).
  hardness: [1, 1, 2],
  rimJitter: { floor: 2, outer: 2 },
  jitterAt: { radius: 23, scale: 12 },
  deposits: CIRQUE_DEPOSITS,
  // 21 tiles, 9 of them deep; the crest's rim reaches r 33 round it (mound: its edge at r 34).
  lake: { dx: 27, dy: 13, radius: 2.3, deep: 1.5, onCrest: true, mound: 5 },
};

export const RINGS = {
  near: 160,   // Proche couronne: from the Crown's foot (r 29; r 34 on map 1) to 160
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
 * above level 0 out here (the Crown's tarn is the one water up high, D63).
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
  /**
   * Rock hardness (H1–H4) by ring and level (1 … 5): the higher, the harder, so the windier (D44).
   * Map 2 (D63) reads the level first: sandstone on the lower terraces everywhere, the lilac rock
   * (basalt, obsidian) on the high tops, heartrock only on the far summits. Map 1's tables are in `MAPS`.
   */
  hardness: {
    near: [1, 1, 2, 2, 3] as readonly number[],
    reaches: [1, 1, 2, 3, 3] as readonly number[],
    far: [1, 2, 3, 3, 4] as readonly number[],
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
    dHeight: 30, dMoist: 0, mountains: 12, copperVein: 150,
  },
  steppe: {
    name: { fr: 'Grande Steppe', en: 'Wide Steppe' },
    desc: { fr: 'Une Couronne mince, des plaines immenses et des gisements épars.', en: 'A thin Crown, vast plains and scattered deposits.' },
    dHeight: -18, dMoist: -10, mountains: -8, copperVein: 80,
  },
  lagoons: {
    name: { fr: 'Lagunes de sel', en: 'Salt Lagoons' },
    desc: { fr: 'Eaux basses et salines : du sel en abondance, de la terre à gagner au remblai.', en: 'Shallows and salt flats: plenty of salt, land to reclaim by backfill.' },
    dHeight: -40, dMoist: 25, mountains: -4, copperVein: 80,
  },
  mesas: {
    name: { fr: 'Mesas sifflantes', en: 'Whistling Mesas' },
    desc: { fr: 'Des plateaux battus par le Souffle : l’éolien y rend double.', en: 'Plateaus swept by the Sough: wind yields double.' },
    dHeight: 22, dMoist: -15, mountains: 8, copperVein: 80,
  },
  embers: {
    name: { fr: 'Champs de braise', en: 'Ember Fields' },
    desc: { fr: 'Des évents fument dans la plaine : la géothermie et le sel de braise sont proches.', en: 'Vents smoke across the plain: geothermal power and embersalt are close.' },
    dHeight: 0, dMoist: -20, mountains: 0, copperVein: 80,
  },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

/** What a map version reads (D63): its cirque, its Crown's foot by archetype, its mountains' hardness. */
export interface MapParams {
  readonly cirque: CirqueTemplate;
  /** The Crown's foot (tiles from the centre) on these archetypes; the others take `cirque.crownOuter`. */
  readonly crownOuter: Readonly<Partial<Record<ArchetypeId, number>>>;
  readonly hardness: { readonly near: readonly number[]; readonly reaches: readonly number[]; readonly far: readonly number[] };
}

/** The map version a new base is founded on (saved as `mapV`; a save without it is on map 1). */
export const MAP_VERSION = 2;

/**
 * Every map version, kept for the bases founded on it: a land never changes under a base. A new
 * version is a new entry (and `MAP_VERSION`), never an edit of an old one.
 */
export const MAPS: Readonly<Record<number, MapParams>> = {
  1: {
    cirque: CIRQUE_V1,
    crownOuter: { closed: 44, steppe: 32 },
    hardness: { near: [2, 2, 2, 3, 3], reaches: [3, 3, 3, 4, 4], far: [3, 3, 4, 4, 4] },
  },
  2: {
    cirque: CIRQUE,
    // Map 1's widths past the rim scaled to the thinner Crown (11 → 6): a Closed Cirque's is three
    // levels high all round, a Wide Steppe's the bare ridge.
    crownOuter: { closed: 31, steppe: 27 },
    hardness: MOUNTAINS.hardness,
  },
};

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
