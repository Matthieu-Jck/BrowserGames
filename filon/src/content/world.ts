// world.ts — the shape of Ysmère: the shared Cirque de Bonne-Veine template (identical for
// everyone, lightly jittered per player) closed by the Crown's terraces, the rings beyond and
// their mountains, the five environment archetypes and the six unique biomes. Pure data;
// mapgen.ts turns it into tiles and levels (D45). A land is made by one map version (`MAPS`,
// D63): a base keeps the version it was founded on, new bases take `MAP_VERSION`.
import { BAL } from './balance';
import type { Loc } from './types';

/** Shared seed: the cirque, the weather and world events are the same for every colony. */
export const WORLD_SEED = 0x51f3a7;

/**
 * Deposit blob in the cirque, offsets from the centre (tiles). rich = cap in 10 mu/epoch per tile.
 * `shape` (map 4, D104): the seed of its patch's wobble in whole blocks (mapgen.ts `blocksOf`).
 */
export interface CirqueDeposit { item: string; dx: number; dy: number; radius: number; rich: number; shape?: number }

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
  /**
   * A spring in the tarn's place (map 4, D115; owner, 2026-10-17: « Il reste un lac vestige de ce
   * qu'on faisait avant avec l'eau, sur la couronne. Il faut l'enlever ou le remplacer »; then « make
   * it go from a higher mountain, and make it smaller… make it go from north to south, so we can
   * see the waterfall »): the tarn's peak kept (`lake`'s `mound`) but dry; a `summit` on the Crown,
   * a spring at its top, and its stream `halfWidth` quarter tiles each side of the straight line from
   * there down the Crown's terraces — a fall at each — to `pool` (offsets from the centre, radius,
   * deep heart) on the floor: running water in the starting land. Absent: the tarn (maps 2–3) or the
   * floor's lake (map 1).
   */
  readonly spring?: {
    /**
     * Where the water comes from (owner: « make it go from a higher mountain… the water cannot just
     * come from nowhere too, the bigger moutain needs to be a little plateau, and at least 6 in
     * height »): a summit on the Crown, a plateau at `level` (`MAX_LEVEL`, a level over every other
     * mountain) `top` tiles round its middle, its sides `fall` levels down a tile (a mesa: two, so
     * no ribbon climbs it — a line laid round it, never over); in its middle the spring's basin,
     * still water `basin` tiles round, `deep` in its heart.
     */
    readonly summit: { readonly dx: number; readonly dy: number; readonly level: number; readonly top: number; readonly fall: number; readonly basin: number; readonly deep: number };
    readonly halfWidth: number;
    readonly pool: { readonly dx: number; readonly dy: number; readonly radius: number; readonly deep: number };
    /**
     * A flat ledge at `level` on the Crown below the summit (offsets of its corners, inclusive), the
     * stream's column in it: the water runs level across it before its last falls, and a works
     * stands beside it (the late base's potteries, D115: a pump on the ledge draws at its level).
     */
    readonly ledge?: { readonly dx0: number; readonly dy0: number; readonly dx1: number; readonly dy1: number; readonly level: number };
  };
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
 * Map 4's cirque deposits (D104): the template's, in whole 2 × 2 blocks (`MapParams.oreBlock`):
 * 9 blocks of iron (36 tiles), 6 of coal (24), 2 of copper (8), each at most a tile off. Each is a
 * patch of its own shape (owner, 2026-10-17: « it's not the point, it still has to look natural »),
 * the same for every player: `shape` seeds its wobble, picked (scratch search) for a compact patch
 * that is no rectangle, sticks out by one block at most, its middle within 1.5 tiles of the
 * template's, and keeps, shifted a block along the Crown either way (mapgen: never towards the
 * Heart), three tiles from the others and the tutorial's distances (mapgen.test.ts: the coal and
 * the copper a pole away, a drill spot within r 18); of those, the north-west iron's lets the debug
 * bases' lines reach the most of it.
 */
const BLOCK_DEPOSITS: readonly CirqueDeposit[] = [
  { item: 'iron_ore', dx: 1, dy: -9, radius: 3.4, rich: 500, shape: 2 },
  { item: 'coal', dx: -16, dy: 1, radius: 2.9, rich: 300, shape: 3 },
  { item: 'copper_ore', dx: 4, dy: 15, radius: 1.7, rich: 75, shape: 3 },
  { item: 'iron_ore', dx: -11, dy: -11, radius: 3.4, rich: 500, shape: 25 },
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

/**
 * Map 4's cirque (D104, D115): map 2–3's, its deposits in whole blocks, the tarn's peak dry, and
 * north of the Crown a summit — a little plateau at level 6, a level over every other mountain, the
 * spring's basin in its middle —, a flat ledge below it (owner, via the lead: the late base's
 * potteries by the falls): a stream one tile wide out of the basin straight south down a column,
 * falls down the summit's side, level across the ledge (on the tile grid: no staircase in either
 * view; its falls on the walls that face south, the ones the iso camera sees), its last fall
 * straight into a small pool at the mountain's foot, the north iron five tiles off (owner:
 * « l'enlever ou le remplacer… from a higher mountain… smaller… from north to south »; « it should
 * be closer to the waterfall, next to the moutain »; « the water cannot just come from nowhere
 * too »; the lead: running water in the starting land, along an edge, clear of the deposits and the
 * tutorial's places).
 */
export const CIRQUE_V4: CirqueTemplate = {
  ...CIRQUE,
  deposits: BLOCK_DEPOSITS,
  spring: {
    summit: { dx: 12, dy: -33, level: 6, top: 3, fall: 2, basin: 1.5, deep: 0.5 },
    halfWidth: 2,
    pool: { dx: 12, dy: -17, radius: 2.3, deep: 1.2 },
    // Nine by six at the crest's level round the stream (the late base's ceramic works: oven, pump,
    // conduit), from the summit's foot (its side at 4, a level over it: the falls' last step down
    // onto it), past the Crown's foot as it must (the Crown is thin here), standing as the massifs'
    // rock does (cliffs where the land round it is lower); the Crown's terraces below it to the rim.
    ledge: { dx0: 9, dy0: -28, dx1: 17, dy1: -23, level: 3 },
  },
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

/**
 * The quartz vein a land guarantees (map 3, D87; owner, 2026-10-15: « une ressource disponible
 * uniquement en dehors du cirque de départ, mais avec un filon très proche […] incrusté dans la
 * montagne la plus proche, dans une parcelle juste à côté »): a short wall of rock — a bluff, the
 * nearest mountain past the Crown — whose face looks back at the cirque, in a parcel beside the
 * starting square. The face's rock tiles hold the ore (`item`, a face ore); a face cutter works
 * them from the floor at the wall's foot. All in tiles, measured from the centre along the
 * bluff's axis (`u`, outwards) and across it (`v`).
 */
export interface QuartzVein {
  readonly item: string;
  /**
   * The bearings it may stand at, picked per player (cardinal: 'W' or 'N' — a bluff west of the
   * cirque turns its face east, one north turns it south: the walls the iso camera sees, so the
   * crystals in the face show).
   */
  readonly sides: readonly ('W' | 'N')[];
  /** The face's distance from the centre: `face` plus 0 … `faceSpan` − 1 per player (past the Crown's farthest terrace, r 41, with room for a cutter). */
  readonly face: number;
  readonly faceSpan: number;
  /** Face tiles holding the ore, along the wall; the wall runs a tile further each way, bare. */
  readonly length: number;
  /** The wall's centre slides across the axis by −`shift` … `shift` tiles per player. */
  readonly shift: number;
  /** Rock behind the face (tiles), its raw level rising one every `climb` tiles to `top` (the land's settling makes terraces of it). */
  readonly depth: number;
  readonly climb: number;
  readonly top: number;
  /** Floor kept at the wall's foot: `apron` tiles out from the face, `apronWide` tiles past each end of the wall. */
  readonly apron: number;
  readonly apronWide: number;
  /** A floor corridor from the Crown's foot to the apron, `corridor` tiles each side of the wall's centre line: no water or rock in the way home. */
  readonly corridor: number;
}

/**
 * The land's obstacles (map 4, D94; owner, 2026-10-16: « il faut que la place soit parfois un enjeu
 * critique, donc pour ça on va rajouter des obstacles. Montagnes énormes avec falaises, précipices,
 * cours d'eau... »): massifs that rise straight to a sheer cliff, chasms and rivers across the
 * plains, and a corridor of floor kept clear from the Crown's foot to each site the land guarantees.
 * Widths are in quarter tiles: a band takes the tiles whose centre lies within `width` of its
 * line, so 4–5 make it two or three tiles wide (a skybridge pair leaps three: D73), 6–7 three or four.
 */
export interface Obstacles {
  /**
   * Massifs: an elevation of their own (the world's noise near the cirque, the player's farther
   * out, plus the archetype's `mountains` bias), rising from `from` to its full height at `full`
   * (`fade` taken off per tile short of it). Past `threshold` the land stands at `rim` at once — a
   * sheer cliff — and one level more every `step` above, up to 5. A massif's tiles never settle (its
   * cliffs stay sheer) but in its **ramps**: where a second noise (`ramps`) rises past its `from`,
   * a massif comes down to the land round it half a level a tile, terraces two tiles deep (an
   * elevator and its flat tile, D65). Kept `clear` tiles off the clearings, the corridors and the
   * quartz vein, and sunk in water like the mountains (`shore`, `shoreSlope`).
   */
  readonly massif: {
    readonly scale: number; readonly octaves: number;
    readonly from: number; readonly full: number; readonly fade: number;
    readonly threshold: number; readonly rim: number; readonly step: number;
    readonly clear: number; readonly slope: number; readonly shore: number; readonly shoreSlope: number;
    readonly ramps: { readonly scale: number; readonly from: number };
  };
  /**
   * Chasms (« précipices », crevasses: the owner, 2026-10-16: « il faut que ça ressemble à une
   * crevasse »): long narrow cracks a random walk traces across the open floor, `count` of them
   * from `r` (the first `near` from `rNear`, just past the open sand round the cirque, `desert.sand`),
   * `steps` steps of `stride` tiles (min, span), turning by up to `turn` 64ths a step. Each is
   * `width` wide (quarter tiles, min + 0 … span − 1), pinching and widening along its length by up
   * to `pinch` either way (the shared noise read along the walk: a spot here and there beyond a plain
   * skybridge's leap), its ends tapered to `taper`; from a point in `branch.chance` ‰ a side crack
   * runs off at `branch.angle` (min + 0 … span − 1, 64ths, either side) for `branch.steps`, narrowing
   * to the taper. A walk stops at raised land, water, the Crown or anything kept clear; one shorter
   * than `minSteps` is dropped.
   */
  readonly chasm: {
    readonly count: number; readonly near: number;
    readonly r: readonly [number, number]; readonly rNear: readonly [number, number];
    readonly steps: readonly [number, number]; readonly minSteps: number; readonly stride: number; readonly turn: number;
    readonly width: readonly [number, number]; readonly pinch: number; readonly taper: number;
    readonly branch: { readonly chance: number; readonly steps: readonly [number, number]; readonly angle: readonly [number, number] };
  };
  /**
   * The rivers (owner, 2026-10-16: « les rivières doivent avoir du sens : être de petits ruisseaux qui
   * partent de grandes montagnes au début, puis se rejoindre pour devenir un grand courant en bas »):
   * a drainage network, found once on a lattice a node every `grid` tiles out to `radius` (each node
   * moved up to `jitter` tiles by a hash, so the lattice does not show). A node's elevation is the
   * land's height ×4, its massif's raw level ×`massifWeight`, its mountains' ×`mountainWeight`, plus
   * `tilt` a tile of distance to the sea's coast: the land slopes to the sea. A flood from the sea in
   * (lowest first, ties by order) gives every node the neighbour it drains to, through the hollows
   * too; rain falls on each node — `rain.plain`, `rain.mountain` on raised land, `rain.massif` on a
   * massif (its springs and snowmelt) — and gathers downstream. A stream runs where `channel` has
   * gathered: so the streams begin up on the massifs. Its half width (quarter tiles) by the flow it
   * carries: `widths`, ascending [flow, half width] — a tile or two up on the massif, a broad current of
   * 5–8 tiles down in the lowlands — and it meanders by up to `meander` tiles across on flat ground. A
   * hollow `lake.depth` deep or more that a stream fills holds a lake (`lake.radius`, tiles). The network
   * keeps `keep` tiles off the Crown, the clearings and the quartz vein. On a massif a stream runs at
   * the massif's level, never climbing (a step down is a fall); off it, on the floor, at level 0.
   */
  readonly drainage: {
    readonly grid: number; readonly radius: number; readonly jitter: number;
    readonly massifWeight: number; readonly mountainWeight: number; readonly tilt: number;
    readonly rain: { readonly plain: number; readonly mountain: number; readonly massif: number };
    readonly channel: number;
    readonly widths: ReadonlyArray<readonly [number, number]>;
    readonly meander: number;
    readonly lake: { readonly depth: number; readonly radius: readonly [number, number] };
    readonly keep: number;
  };
  /**
   * The sea (owner: « il faudra rajouter une mer, loin quelque part »), the shared world's: past a
   * coast `distance` tiles from the cirque along a bearing the world seed picks (the same for every
   * claim, so all their rivers drain towards it), the coast moving in and out by up to `coast` tiles
   * (the world's noise along it, feature size `scale`): shallows `shallow` tiles out, then deep water.
   * A river meeting it widens into its mouth (`estuary` ‰ of its width). Never over a unique site.
   */
  readonly sea: { readonly distance: number; readonly coast: number; readonly scale: number; readonly shallow: number; readonly estuary: number };
  /**
   * The floor kept from the Crown's foot to each guaranteed site (the copper field, the unique
   * sites, the vents): a line `half` tiles each side, bent every `every` tiles by up to `wobble`
   * across; no massif, mountain, water, chasm or river on it, so the way to each site is floor.
   * The rivers and chasms keep `margin` tiles further off.
   */
  readonly corridor: { readonly half: number; readonly every: number; readonly wobble: number; readonly margin: number };
  /**
   * Tiles round the copper field's centre the obstacles keep off (the mountains keep `MOUNTAINS.clear.copper`),
   * and where the land is never rougher than middling (`rugged`: no lift): the first works past the Crown
   * stand there — the late debug base's Fabrique, 20 × 25 tiles, among them. The one place where ore and
   * room go together, by design.
   */
  readonly copper: number;
  /**
   * Space or ore (owner, 2026-10-16: « Dans les grandes étendues de désert, il ne devrait pas y avoir
   * beaucoup de minéraux, mais au moins il y a de la place. Alors que sur les parcelles où il y a des
   * minéraux, il faut qu'il y ait peu de place »): a slow field of the land's roughness (0..255, the
   * world's noise near the cirque and the player's farther out, as the land's height; `scale` tiles,
   * plus the archetype's `mountains` bias) lifts the massifs' and the mountains' elevation where it is
   * high and sinks it where it is low, by `gain` / 64 a unit off 128 (`mountainGain` for the
   * mountains): stretches of open desert, and broken ground. The chasms keep to ground of `chasmMin` or more.
   */
  readonly rugged: { readonly scale: number; readonly gain: number; readonly mountainGain: number; readonly chasmMin: number };
  /**
   * Open desert (owner, 2026-10-17: « la carte devrait contenir un petit peu plus de grands déserts
   * ouverts, plats, assez vides de ressources, sans eau ni crevasse ni montagne »; « le cirque
   * notamment devrait être entouré de pas mal de sable, hormis le quartz et les rares ressources aux
   * alentours »). Round the Crown the roughness is held at `low` out to `sand` tiles from the centre
   * (the two rings of parcels round the starting square), rising to the land's own by `rough`: the
   * broken ground begins past them. Wherever the roughness is under `below` lies open desert: a
   * massif's and a mountain's elevation drop `edge` and `drop` more a unit under it (none stand
   * there), no chasm (`rugged.chasmMin`) nor pond (the plains' low ground is sand there), the
   * rivers' lattice rises `riseEdge` and `rise` more a unit under it (the water goes round, a stream
   * crossing one at most where it must; none within `rough`), and a deposit is taken at `ore` ‰ of
   * its chance. Within `sand` the deposits are rare and small: `sandOre` ‰ a candidate, thin.
   */
  readonly desert: {
    readonly sand: number; readonly rough: number; readonly low: number; readonly below: number;
    readonly edge: number; readonly drop: number; readonly riseEdge: number; readonly rise: number; readonly ore: number; readonly sandOre: number;
  };
  /**
   * The common deposits past the Crown (in place of `DEPOSIT_CHANCE`'s one blob a chunk): `cells` × `cells`
   * candidates a chunk, each read for how broken the ground round it is — of 8 points on a circle of
   * `near` tiles and 8 on one of `far`, how many stand raised, in a gap or in water, each counting two —
   * and taken at `open` ‰ plus `perBroken` ‰ a broken count, at most `max`; a vein hidden in rock at the same chance.
   * On open ground (`thin` broken points or fewer) a blob is thin, `thinRadius` tenths of a tile (in
   * whole blocks, D104: one block or two, a drill's worth or two); in broken ground `radius` tenths and
   * `richRough` ‰ as rich. None in the quartz vein's parcel (its price, the tutorial's first
   * purchase, stays within the purse).
   */
  readonly ore: {
    readonly cells: number; readonly near: number; readonly far: number;
    readonly open: number; readonly perBroken: number; readonly max: number;
    readonly thin: number; readonly thinRadius: readonly [number, number]; readonly radius: readonly [number, number]; readonly richRough: number;
  };
}

/** Map 4's obstacles (D94). */
export const OBSTACLES: Obstacles = {
  massif: {
    scale: 48, octaves: 2, from: 37, full: 45, fade: 4, threshold: 140, rim: 3, step: 8,
    clear: 4, slope: 8, shore: 64, shoreSlope: 3, ramps: { scale: 11, from: 150 },
  },
  chasm: {
    count: 20, near: 12, r: [84, 150], rNear: [84, 30], steps: [10, 12], minSteps: 5, stride: 2, turn: 3,
    width: [4, 2], pinch: 3, taper: 3, branch: { chance: 140, steps: [3, 3], angle: [12, 10] },
  },
  drainage: {
    grid: 6, radius: 420, jitter: 2, massifWeight: 80, mountainWeight: 30, tilt: 3,
    rain: { plain: 1, mountain: 3, massif: 14 }, channel: 300,
    widths: [[300, 2], [600, 3], [1200, 4], [2400, 6], [4500, 9], [7500, 12], [11000, 15]], meander: 3,
    lake: { depth: 60, radius: [4, 6] }, keep: 12,
  },
  sea: { distance: 360, coast: 28, scale: 70, shallow: 4, estuary: 1600 },
  corridor: { half: 3, every: 12, wobble: 3, margin: 2 },
  copper: 26,
  rugged: { scale: 72, gain: 44, mountainGain: 36, chasmMin: 120 },
  desert: { sand: 84, rough: 116, low: 40, below: 112, edge: 40, drop: 3, riseEdge: 200, rise: 12, ore: 500, sandOre: 60 },
  // D104: `thin` 3 → 5 and `thinRadius` [15, 8] → [10, 8] (thin blobs of 5 or 9 tiles: one block or two), so whole blocks keep the desert's few and the rough ground's many apart (r −0.41 … −0.57 on lands 1–5).
  ore: { cells: 2, near: 6, far: 11, open: 15, perBroken: 32, max: 800, thin: 5, thinRadius: [10, 8], radius: [25, 21], richRough: 1250 },
};

/** What a map version reads (D63): its cirque, its Crown's foot by archetype, its mountains' hardness, its quartz vein (map 3), its obstacles (map 4). */
export interface MapParams {
  readonly cirque: CirqueTemplate;
  /** The Crown's foot (tiles from the centre) on these archetypes; the others take `cirque.crownOuter`. */
  readonly crownOuter: Readonly<Partial<Record<ArchetypeId, number>>>;
  readonly hardness: { readonly near: readonly number[]; readonly reaches: readonly number[]; readonly far: readonly number[] };
  /** The quartz vein in the nearest mountain (map 3, D87); absent: none (maps 1–2, whose bases buy quartz at the Crier). */
  readonly quartz?: QuartzVein;
  /** Massifs, chasms, rivers and the corridors to the sites (map 4, D94); absent: none (maps 1–3). */
  readonly obstacles?: Obstacles;
  /**
   * Deposits in whole `oreBlock` × `oreBlock` squares on the world's grid, the drill's footprint
   * (map 4, D104; owner, 2026-10-17: « les ressources disponibles ne sont pas des multiples de la
   * taille des machines qui les extraient »): the cirque's, the copper field, the sites' and the
   * common ones (not the quartz face, a wall), each the size and richness of its disc, so drills
   * cover a deposit with none of its tiles left over and none of theirs on sand. The cirque's
   * per-player shift moves by whole blocks too. Absent: discs tile by tile (maps 1–3).
   */
  readonly oreBlock?: number;
  /**
   * The neighbouring bases in holdings of a few parcels side by side, each a working base (map 4,
   * D110; owner, 2026-10-17: « S'il y a un endroit possédé par un PNJ, il faut qu'il y ait vraiment
   * une base »). Absent: one parcel each, scattered as the sister claims were (maps 1–3, whose bases
   * keep the land they had: a base stands on each where one fits).
   */
  readonly holdings?: boolean;
}

/**
 * Map 3's vein (D87). The face 44–46 tiles out (the starting square ends at 34, its ring of parcels
 * at 57: the bluff stands wholly in the parcel west or north of it; the start's reveal, r 44, just
 * misses it), eight tiles of quartz (two tiles a cutter: four cutters along it, 60 a minute),
 * five tiles of floor before it, a corridor of floor back to the Crown's foot.
 */
export const QUARTZ_VEIN: QuartzVein = {
  item: 'quartz', sides: ['W', 'N'], face: 44, faceSpan: 3, length: 8, shift: 3,
  depth: 7, climb: 2, top: 3, apron: 5, apronWide: 3, corridor: 3,
};

/** The map version a new base is founded on (saved as `mapV`; a save without it is on map 1). */
export const MAP_VERSION = 4;

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
  // Map 2's land with the quartz vein in the nearest mountain, a parcel away (D87).
  3: {
    cirque: CIRQUE,
    crownOuter: { closed: 31, steppe: 27 },
    hardness: MOUNTAINS.hardness,
    quartz: QUARTZ_VEIN,
  },
  // Map 3's land with obstacles beyond the Crown (D94): massifs and their cliffs, chasms, rivers;
  // the cirque, the Crown, the vein and the sites as on map 3, a floor corridor to each site; its
  // deposits in whole 2 × 2 blocks (D104).
  4: {
    cirque: CIRQUE_V4,
    crownOuter: { closed: 31, steppe: 27 },
    hardness: MOUNTAINS.hardness,
    quartz: QUARTZ_VEIN,
    obstacles: OBSTACLES,
    oreBlock: 2,
    holdings: true,
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
