// mapgen.ts — Ysmère's terrain as a pure TerrainSource. Two seeds: WORLD_SEED (shared — the
// cirque looks the same for everyone) and the player's seed, blended in with distance (integer
// weight 0 at r ≤ 56, 128 at r ≥ 240). The player's seed also picks an environment archetype
// that shapes the near belt, and places the unique biomes. Every value is quantised to
// integers at once; geometry uses d² and an integer trig table — identical on every engine.
//
// The land has levels (D45), 0 … MAX_LEVEL: the cirque's floor at 0, closed all round by the
// Crown's terraces (one level up every `terrace` tiles to its top, then down the same way), and
// mountains up to 5 beyond. A level comes in two steps. `classify` gives the raw level the shapes
// say; `settle` then evens the slopes out, lowering a tile until it stands at most one level above
// each neighbour (two above its east neighbour far out: an east-facing cliff). Settling only
// lowers, and never to 0, so it changes neither what is rock nor the floor's rim: the ring stays
// closed, and every line or wire can climb the Crown anywhere, one level a step. Rock stands above
// level 0, and the one water up there, the Crown's tarn (map 2); rock's hardness follows its level.
//
// Map versions (D63): a land is made by the parameters of one version (content `MAPS`: the cirque
// template, the archetypes' Crown foot, the mountains' hardness), passed in and saved with the
// base (`mapV`), so a base reopens on the land it was founded on. Version 1 is the Crown of D45
// (three levels all round, the lake on the floor); version 2 a thinner ridge rising into a few
// peaks, one holding the tarn. Code shared by both reads only the template's fields, and a field
// version 1 lacks (`ridge`, `shoulders`, `lake.onCrest`) leaves its land as it was. Version 3 is
// version 2 with the quartz vein (D87): a bluff in the parcel west or north of the starting
// square, its face looking back at the cirque, quartz in the face's rock, floor at its foot and a
// corridor of floor back to the Crown (`vein`).
//
// Version 4 (D94) is version 3 with obstacles beyond the Crown (content `OBSTACLES`): massifs that
// rise straight from the floor to a sheer cliff three levels high and on up to 5, coming down in
// ramps of single steps here and there (`massif`, settled by `settle4`: a massif's cliff never
// comes down, its ramps half a level a tile); chasms and rivers, traced once in the constructor
// from the seeds (obstacles.ts), nothing to stand on: the rivers a drainage network down to a
// shared sea (`drainage`), streams up on the massifs at their level, lakes in the hollows they fill;
// and a corridor of floor from the Crown's foot to each site the land guarantees.
//
// Version 5 (D136) is version 4 with a few short quartz faces farther out (content `QUARTZ_FACES`):
// in some cells of the rough ground, the longest straight wall looking east or south with floor at
// its foot takes 2–6 tiles of face ore (`faceOf`), laid over each chunk as it was made (`fill`):
// only ore on rock the land already had.
//
// Version 6 (D147) is version 5 with a field of rock spires (content `SPIRES`): in one wedge of the
// open sand round the Crown, on the lower half of the iso screen and out of the wind's way (the
// Crown's turbines keep theirs), many needles of hard rock a tile at the foot (some two), their level
// their height — 4 to 14, far over `MAX_LEVEL` —, tallest and thickest in the field's core, never two
// side by side (in the core they may touch at a corner), a lane or two across. Each needle is a
// square of tiles' candidate (`spireCand`), standing unless a stronger one is too close
// (`spireStands`): local, so a chunk's needles never depend on which chunk was made first. Laid over
// each chunk as made (`fill`), as the faces are, the field's floor marked badlands for the renderer
// (`BIOME.spireGround`): `made` (and the faces, the neighbouring bases' sampling) stays map 5's land
// but the spring's summit and its ledge, and the pure accessors read the needles too (`spireAt`). Its
// summit is a natural massif (content `CIRQUE_V6`, `massifPeak`) never above map 4's (the Crown keeps
// its wind): bays in its plateau's edge by bearing, sides falling two or three a tile on its north and
// west, map 4's own on its east and south (its stream, the floor the bases' lines run down); its ledge
// eroded east of the stream (`ledgeAt`: bites a level or two down, a spur), its west as it was.
import { BAL } from '@/content/balance';
import { itemIdx } from '@/content/registry';
import {
  ARCHETYPES, ARCHETYPE_IDS, COMMON_DEPOSITS, COS64, DEPOSIT_CHANCE, MAP_VERSION, MAPS, MOUNTAINS, RICH_MULT, RINGS, SHADE, SIN64,
  T3_UNIQUES, T4_UNIQUES, UNIQUE_BIOMES, type ArchetypeId, type CirqueTemplate, type MapParams, type Obstacles, type QuartzFaces, type QuartzVein, type SpireField, type SummitShape, type UniqueBiomeId,
} from '@/content/world';
import { hash32 } from '@/core/hash';
import { isqrt } from '@/core/fixed';
import { makeNoise2, qfbm, type Noise2 } from '@/core/noise';
import { CENTER, CHUNK, WORLD } from '../constants';
import { isFloor, T } from '../types';
import { MAX_LEVEL, MOUNTAIN_LEVEL, type TerrainSource, type VeinSite } from './grid';
import { PARCEL, parcelAt, parcelRect, ringOf } from './land';
import { ahead, eighth, headingOf, LineKind, quarter, SegIndex, tileOf, within, type Hits, type LinePt, type Seg, type Walker } from './obstacles';

export interface Site { id: UniqueBiomeId; cx: number; cy: number; r: number; item: number }
interface Blob {
  cx: number; cy: number; r2: number; item: number; rich: number; onRock: boolean;
  /** Its tiles in whole blocks (map 4, D104; `blocksOf`), found once; `salt` its shape's (default: from its centre). */
  tiles?: readonly number[];
  salt?: number;
}
/** A disc the mountains keep off: the guaranteed copper field, a unique site and its rim, a vent. */
interface Clearing { cx: number; cy: number; r: number }
/**
 * A needle of map 6's spire field (D147): its footprint's corners (inclusive: one tile, or a twin's
 * two), its level and its shoulder's (a twin's second tile; 0: none), the field's shape where it
 * stands, its priority and its square's key (the tie-break: a total order).
 */
interface Spire { x0: number; y0: number; x1: number; y1: number; lv: number; lv2: number; sh: number; pri: number; key: number }
/** A chunk's spire map (`spireChunk`): a needle's tile holds its level (1 … 254); a floor tile of the field's badlands, this. */
const SPIRE_GROUND = 255;
/** `spireElev`'s flags: the tile is the field's badlands (within `outline.ground` of its outline), in a lane. */
const SP_GROUND = 1 << 28, SP_LANE = 1 << 29;
/**
 * Map 6's spire field in its frame (D147): its content; its middle's unit (×1024: COS64, SIN64) and
 * its half width's sine and cosine (the wedge: |across| · cos ≤ along · sin); the box its ground lies
 * in (inclusive, clipped to its rings); its rings as the Chebyshev distances from the centre their
 * square spans, `c0` … `c1`; its lanes' draws across it (‰ of its half width); its main crest's
 * radius (quarter tiles) and its branch (null: none) — where across it leaves the main crest (×1024
 * tiles), which way along the arc (±1) and which way out (±1), how far it goes (quarter tiles) over how
 * many tiles; its noises (the outline, the lanes, the crests).
 */
interface SpireFrame {
  S: SpireField; ux: number; uy: number; sn: number; cs: number;
  bx0: number; by0: number; bx1: number; by1: number; c0: number; c1: number;
  lanes: readonly number[]; crest: number;
  branch: { v: number; side: number; out: number; off: number; run: number } | null;
  oN: Noise2; lN: Noise2; cN: Noise2;
}
/**
 * The quartz vein's bluff in its own frame (D87): `west` (else north) of the cirque, the face `u0`
 * tiles out along the axis, its ore on `va … vb` across it, `vc` the wall's centre line.
 */
interface Bluff { west: boolean; u0: number; va: number; vb: number; vc: number; Q: QuartzVein }

/**
 * Biome codes written next to terrain (renderer decor; not saved). A river's tile (map 4, D94) holds
 * `river` + the way it flows there (0 … 7: eighths of a turn from east, clockwise), for its ripples;
 * the sea's (`sea`), for its surf; a needle of map 6's spire field (D147), `spire`, and the plain
 * floor of its ground (lanes and all; a tile with no other code), `spireGround`: badlands.
 */
export const BIOME = { none: 0, cirque: 7, crown: 8, river: 16, sea: 24, spire: 32, spireGround: 33 } as const;

// A tile as `classify` sees it, packed in one integer.
const LV = 7; //         bits 0–2: the raw level (0 … MAX_LEVEL)
const CROWN = 8; //      the Crown's terraces
const FLOOR = 16; //     the cirque's floor
const GROUND = 5; //     bits 5–8: the ground class (a T) of a level-0 tile, when asked for
const HEIGHT = 9; //     bits 9–16: the land's height field (outside the cirque)
const WET = 1 << 17; //  the Crown's tarn: water at its level, its class in the GROUND bits
const MASSIF = 1 << 18; // a massif's rock (map 4): its cliffs never settle…
const RAMP = 1 << 19; //   …but in its ramps, half a level a tile
const FLOW = 20; //        bits 20–22: a river's way (eighths of a turn), its class in the GROUND bits
const SEAF = 1 << 23; //   the sea (map 4): its class in the GROUND bits
const FIXED = 1 << 24; //  a stream up on a massif: its level is the water's, it never settles
/** How far settling reaches: a tile comes down only for a lower one at most this many steps away (maps 1–3: no land above the mountains'). */
const REACH = MOUNTAIN_LEVEL - 1;
/** Map 4's reach (`settle4`): a ramp comes down half a level a tile, so twice as far — from its spring's summit, the land's highest (D115). */
const REACH4 = 2 * MAX_LEVEL;
/** `settle4`'s flags per tile: a massif's cliff (never comes down), a massif's ramp (half a level a tile), a stream's water up on a massif (never comes down, nor counts as a lone spike). */
const F_CLIFF = 1, F_RAMP = 2, F_FIXED = 3;

/**
 * Map 4's lines and lakes by land (corridors, rivers, chasms: a pure function of the seeds and the
 * version), kept for the next MapGen of the same land — the tests found many — at most `NETS_KEPT`.
 */
const NETS = new Map<string, SegIndex>();
const NETS_KEPT = 24;

/**
 * The chunks made, by land and chunk (a pure function of the seeds and the version, as the lines
 * above), kept for the next MapGen of the same land: a base reopened, the forecast's copy, the debug
 * bases built one after another (the scenario test builds six levels on each land, the late one in
 * a time limit, and a third of its build was the land made again). Copies go out — a grid digs and
 * fills its own arrays —; at most `MADE_KEPT` chunks (about 7 KB each), the oldest dropped first.
 */
const MADE = new Map<string, { terrain: Uint8Array; ore: Uint8Array; rich: Uint16Array; height: Uint8Array; biome: Uint8Array; level: Uint8Array }>();
const MADE_KEPT = 4096;

/** How far a deposit's blocks wobble off the round (D104: added to a block's doubled distance², squared; the next ring is 32–64 further): enough for the patch to bulge and notch, not to wander off. */
const WOBBLE = 80;
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

export class MapGen implements TerrainSource {
  readonly archetype: ArchetypeId;
  /** Chance (‰) that a dug rock tile holds copper ore (the archetype's `copperVein`). */
  readonly embedCopper: number;
  readonly secondary: ArchetypeId;
  readonly sites: Site[] = [];
  readonly ventSites: Array<{ x: number; y: number }> = [];
  readonly copperField: { cx: number; cy: number };
  /** The Crown's foot on this land (the archetype's `crownOuter`) and the farthest radius its terraces can reach. */
  readonly crownFoot: number;
  readonly crownReach: number;
  /** The cirque template's own Crown foot, whatever the archetype (the cirque's wind shelter, D44). */
  readonly crownOuter: number;
  /** The Crown's tarn (map 2): its centre tile and the level of its water; null on map 1 (the lake is on the floor) and on map 4 (its spring instead). */
  readonly tarn: { readonly x: number; readonly y: number; readonly level: number } | null;
  /** The Crown's spring (map 4, D115): its head tile up on the tarn's old peak and the level of its water; null on maps 1–3. */
  readonly spring: { readonly x: number; readonly y: number; readonly level: number } | null;
  /** The spring's stream (map 4, D115): the line from its head to its pool on the floor, in quarter tiles. */
  private readonly springSeg: Seg | null;
  /**
   * The spring's summit (map 4, D115): its middle, its plateau's level and radius, the levels its
   * sides fall a tile, its basin's squared radii (water, deep), and the square of its reach (where
   * its sides run out; past the Crown's reach on its outer side — the land round it, the rivers and
   * the deposits keep to that reach as before); on map 6 its shape (D147: a natural massif) and the
   * plateau it keeps round the basin whatever the shape (quarter tiles from its middle).
   */
  private readonly summit: {
    readonly x: number; readonly y: number; readonly level: number; readonly top: number; readonly fall: number; readonly b2: number; readonly b2deep: number; readonly reach2: number;
    readonly shape: SummitShape | null; readonly rimQ: number;
  } | null;
  /** The quartz vein in the nearest mountain (map 3, D87): its face tiles; null on maps 1–2. */
  readonly quartzVein: VeinSite | null;
  /** The vein's bluff in its own frame (null: no vein). */
  private readonly bluff: Bluff | null;
  /** Map 4's obstacles (D94; null on maps 1–3): their content, and the lines traced (corridors, chasms, rivers, lakes). */
  private readonly O: Obstacles | null;
  readonly lines: SegIndex;
  /** The sea's bearing (64ths of a turn, map 4): the shared world's. */
  private readonly seaDir: number;
  private readonly sW: Noise2;
  private readonly sP: Noise2;
  private readonly rW: Noise2;
  private readonly rP: Noise2;
  /** Map 4's roughness (space or ore, D94): the world's and the player's noise. */
  private readonly gW: Noise2;
  private readonly gP: Noise2;
  /** Map 4's common deposits by chunk (a pure function of the seeds, kept once read). */
  private readonly oreCells = new Map<number, Blob[]>();
  /** Map 5's quartz faces (D136; null on maps 1–4), each cell's wall and each wedge's face once found (null: none). */
  private readonly F: QuartzFaces | null;
  private readonly faceCells = new Map<number, VeinSite | null>();
  private readonly sectorFaces = new Map<number, { cell: number; face: VeinSite } | null>();
  /**
   * Map 6's field of rock spires (D147; null on maps 1–5): its middle tile, its middle's bearing (64ths
   * of a turn clockwise from east) and its radii (tiles from the centre).
   */
  readonly spireField: { readonly x: number; readonly y: number; readonly bearing: number; readonly r0: number; readonly r1: number } | null;
  /** The field in its frame (null: none); each square's candidate needle and each chunk's needles' levels (null: none there), kept once found. */
  private readonly spf: SpireFrame | null;
  private readonly spireCands = new Map<number, Spire | null>();
  /** Each square's needle's rounds (`spireStands`), kept once read: bit 1 its first round read, 2 standing from it; 4 its block read, 8 blocked. */
  private readonly spireRounds = new Map<number, number>();
  private readonly spireChunks = new Map<number, Uint8Array | null>();
  /** `lines.hits`' answer, reused tile after tile. */
  private readonly hitBuf: Hits = [null, null, null, null];
  /** The cirque template and the mountains' hardness of this map version. */
  private readonly C: CirqueTemplate;
  private readonly hard: MapParams['hardness'];
  private readonly hW: Noise2;
  private readonly hP: Noise2;
  private readonly mW: Noise2;
  private readonly mP: Noise2;
  private readonly eW: Noise2;
  private readonly eP: Noise2;
  private readonly jit: Noise2;
  private readonly cirqueBlobs: Blob[] = [];
  /** The deposits' blocks (map 4, D104: content `MapParams.oreBlock`): 1, tile by tile. */
  readonly oreBlock: number;
  /** The neighbouring bases in holdings of a few parcels (map 4, D110: content `MapParams.holdings`). */
  readonly holdings: boolean;
  /** The copper field's and the sites' deposits, made on first need. */
  private fixedBlobs: Blob[] | null = null;
  private readonly clearings: Clearing[] = [];
  /** What map 4's obstacles keep off (D94): the clearings, the copper field's wider (`Obstacles.copper`). */
  private readonly keep: Clearing[] = [];
  /** The cirque's water: the floor's lake (map 1) or the tarn up on the crest (map 2, with its centre's radius and mound). */
  private readonly lake: { cx: number; cy: number; r2: number; r2deep: number } | null;
  private readonly tarnAt: { cx: number; cy: number; r2: number; r2deep: number; rc: number; mound: number } | null;
  /** The archetypes' biases ×3 (primary twice, secondary once), faded by `fade`. */
  private readonly dH3: number;
  private readonly dM3: number;
  private readonly dE3: number;

  /** `mapV`: the map version (content `MAPS`); a new base takes today's, a saved one its own. */
  constructor(readonly worldSeed: number, readonly playerSeed: number, readonly mapV: number = MAP_VERSION) {
    const P = MAPS[mapV];
    // A version this build does not know is a newer build's land: never open it on another.
    if (!P) throw new Error(`Ocelle: map version ${mapV} is unknown to this build`);
    const C = (this.C = P.cirque);
    this.hard = P.hardness;
    const ps = playerSeed >>> 0;
    this.archetype = ARCHETYPE_IDS[hash32(ps, 1) % ARCHETYPE_IDS.length]!;
    let sec = ARCHETYPE_IDS[hash32(ps, 2) % ARCHETYPE_IDS.length]!;
    if (sec === this.archetype) sec = ARCHETYPE_IDS[(ARCHETYPE_IDS.indexOf(sec) + 1) % ARCHETYPE_IDS.length]!;
    this.secondary = sec;
    this.hW = makeNoise2(hash32(worldSeed, 11));
    this.hP = makeNoise2(hash32(ps, 11));
    this.mW = makeNoise2(hash32(worldSeed, 12));
    this.mP = makeNoise2(hash32(ps, 12));
    this.jit = makeNoise2(hash32(worldSeed, 13));
    this.eW = makeNoise2(hash32(worldSeed, 14));
    this.eP = makeNoise2(hash32(ps, 14));
    // Map 4's massifs and their ramps (D94): noises of their own, so maps 1–3 read none of them.
    this.sW = makeNoise2(hash32(worldSeed, 15));
    this.sP = makeNoise2(hash32(ps, 15));
    this.rW = makeNoise2(hash32(worldSeed, 16));
    this.rP = makeNoise2(hash32(ps, 16));
    this.gW = makeNoise2(hash32(worldSeed, 17));
    this.gP = makeNoise2(hash32(ps, 17));
    const arch = ARCHETYPES[this.archetype], B = ARCHETYPES[this.secondary];
    this.embedCopper = arch.copperVein;
    this.dH3 = arch.dHeight * 2 + B.dHeight;
    this.dM3 = arch.dMoist * 2 + B.dMoist;
    this.dE3 = arch.mountains * 2 + B.mountains;
    this.crownFoot = P.crownOuter[this.archetype] ?? C.crownOuter;
    this.crownOuter = C.crownOuter;
    const L = C.lake;
    const water = { cx: CENTER + L.dx, cy: CENTER + L.dy, r2: L.radius * L.radius, r2deep: L.deep * L.deep };
    // Map 4 (D115): the tarn's peak kept (its mound) but dry, a spring at its top, its stream down
    // the terraces to a pool on the floor (`floorGround` reads it as map 1 reads its lake).
    const SP = C.spring, pool = SP ? { cx: CENTER + SP.pool.dx, cy: CENTER + SP.pool.dy, r2: SP.pool.radius * SP.pool.radius, r2deep: SP.pool.deep * SP.pool.deep } : null;
    this.lake = L.onCrest ? pool : water;
    this.tarnAt = L.onCrest ? { ...water, rc: isqrt(L.dx * L.dx + L.dy * L.dy), mound: L.mound ?? 0 } : null;
    this.tarn = L.onCrest && !SP ? { x: water.cx, y: water.cy, level: C.crest } : null;
    // The spring's summit (D115: « from a higher mountain… from north to south… a little plateau, and
    // at least 6 in height »): its stream from the basin on its plateau straight down to the pool.
    const SU = SP?.summit;
    // Map 6 (D147): a natural massif within map 4's summit (never above it), so within its reach.
    const SH = SU?.shape ?? null;
    this.summit = SU ? {
      x: CENTER + SU.dx, y: CENTER + SU.dy, level: SU.level, top: SU.top, fall: SU.fall, b2: SU.basin * SU.basin, b2deep: SU.deep * SU.deep,
      reach2: (SU.top + Math.ceil(SU.level / SU.fall)) ** 2,
      shape: SH, rimQ: SH ? Math.ceil(4 * SU.basin) + SH.rim : 0,
    } : null;
    const head = this.summit;
    this.springSeg = head && pool ? { ax: 4 * head.x + 2, ay: 4 * head.y + 2, bx: 4 * pool.cx + 2, by: 4 * pool.cy + 2, hw: SP!.halfWidth, kind: LineKind.River, dir: eighth(pool.cx - head.x, pool.cy - head.y) } : null;
    // The top's outer edge is at most max(rim + lift + minCrest, foot − lift + jitter), the rim
    // and the jitter at their highest (amp − 1), plus the widest shoulder, or the tarn's mound;
    // the foot lies `climb` tiles past it (the way down from the crest, the deepest).
    const climb = (C.crest - 1) * C.terrace, lift = ((C.ridge ?? C.crest) - 1) * C.terrace;
    const S = C.shoulders, widest = S ? ((255 - S.from) * S.gain) >> 7 : 0;
    const edge = Math.max(C.floorRadius + C.rimJitter.floor + lift + C.minCrest, this.crownFoot - lift + C.rimJitter.outer) + widest;
    this.crownReach = Math.max(edge, this.tarnAt ? this.tarnAt.rc + this.tarnAt.mound : 0) + climb;
    // The spring in its basin on the plateau, at the plateau's level.
    this.spring = head ? { x: head.x, y: head.y, level: this.crown(head.x, head.y, isqrt((head.x - CENTER) ** 2 + (head.y - CENTER) ** 2)) } : null;
    // Cirque deposits: shared template, ±1 tile and ±20 % richness per player. Map 4 (D104): a
    // whole block or none, along the Crown (across the deposit's bearing from the Heart, to the
    // nearest eighth), never towards the Heart: its distance from it, the tutorial's, is everyone's.
    this.holdings = !!P.holdings;
    this.F = P.faces && P.obstacles ? P.faces : null;
    const OB = (this.oreBlock = P.oreBlock ?? 1);
    C.deposits.forEach((d, i) => {
      let jx = (hash32(ps, 30 + i) % 3) - 1, jy = (hash32(ps, 40 + i) % 3) - 1;
      if (OB > 1) {
        const [ux, uy] = across(d.dx, d.dy);
        jy = jx * uy * OB;
        jx = jx * ux * OB;
      }
      const rich = Math.floor((d.rich * (800 + (hash32(ps, 50 + i) % 401))) / 1000);
      // Its shape in blocks from the template (`shape`), not the player (D104): shifted, the same patch.
      this.cirqueBlobs.push({ cx: CENTER + d.dx + jx, cy: CENTER + d.dy + jy, r2: d.radius * d.radius, item: itemIdx(d.item), rich, onRock: false, salt: d.shape ?? hash32(0x104, i) });
    });
    // Guaranteed copper field in the near belt.
    const cd = hash32(ps, 60) % 64, cr = 70 + (hash32(ps, 61) % 41);
    this.copperField = { cx: CENTER + ((COS64[cd]! * cr) >> 10), cy: CENTER + ((SIN64[cd]! * cr) >> 10) };
    // Unique biomes: one T3 at r 180–280, one T4 at r 340–460, maybe a second of each.
    const t3 = this.archetype === 'embers' ? 'emberfields' : T3_UNIQUES[hash32(ps, 70) % 3]!;
    this.addSite(t3, 180, 100, 71);
    this.addSite(T4_UNIQUES[hash32(ps, 80) % 3]!, 340, 120, 81);
    if (hash32(ps, 90) % 1000 < 400) {
      const other = T3_UNIQUES.filter((u) => u !== t3)[hash32(ps, 91) % 2]!;
      this.addSite(other, 190, 110, 92);
    }
    if (hash32(ps, 100) % 1000 < 250) {
      const first = this.sites[1]!.id;
      const other = T4_UNIQUES.filter((u) => u !== first)[hash32(ps, 101) % 2]!;
      this.addSite(other, 350, 110, 102);
    }
    // Ember Fields: vent sites (3×3 each) across the near belt.
    if (this.archetype === 'embers' || this.secondary === 'embers') {
      const n = this.archetype === 'embers' ? 5 + (hash32(ps, 110) % 4) : 2;
      for (let i = 0; i < n; i++) {
        const d = hash32(ps, 111, i) % 64, r = 70 + (hash32(ps, 112, i) % 80);
        this.ventSites.push({ x: CENTER + ((COS64[d]! * r) >> 10) - 1, y: CENTER + ((SIN64[d]! * r) >> 10) - 1 });
      }
    }
    // The quartz vein (map 3, D87): which side, how far out, where along.
    const Q = P.quartz;
    if (Q) {
      const west = Q.sides[hash32(ps, 120) % Q.sides.length] === 'W';
      const u0 = Q.face + (hash32(ps, 121) % Q.faceSpan);
      const vc = (hash32(ps, 122) % (2 * Q.shift + 1)) - Q.shift;
      const va = vc - (Q.length >> 1), vb = va + Q.length - 1;
      this.bluff = { west, u0, va, vb, vc, Q };
      // West: the face at x = centre − u0, down from y = centre + va, looking east; north: at y = centre − u0, along x, looking south.
      this.quartzVein = west
        ? { x: CENTER - u0, y: CENTER + va, dx: 0, dy: 1, n: Q.length, look: 1, item: itemIdx(Q.item) }
        : { x: CENTER + va, y: CENTER - u0, dx: 1, dy: 0, n: Q.length, look: 2, item: itemIdx(Q.item) };
    } else {
      this.bluff = null;
      this.quartzVein = null;
    }
    // The mountains keep off what the land guarantees, so it stays open ground at level 0.
    const K = MOUNTAINS.clear;
    this.clearings.push({ ...this.copperField, r: K.copper });
    for (const s of this.sites) this.clearings.push({ cx: s.cx, cy: s.cy, r: s.r + K.site });
    for (const v of this.ventSites) this.clearings.push({ cx: v.x + 1, cy: v.y + 1, r: K.vent });
    // Map 4 (D94): the corridors to the sites first (everything else keeps off them), then the
    // rivers, then the chasms (which keep off the rivers); found once per land, kept for the next.
    this.O = P.obstacles ?? null;
    this.seaDir = hash32(worldSeed, 320) % 64;
    const key = `${worldSeed}:${ps}:${mapV}`, kept = this.O ? NETS.get(key) : undefined;
    this.lines = kept ?? new SegIndex();
    if (this.O) {
      const copper = this.O.copper;
      this.keep.push(...this.clearings.map((c, i) => (i === 0 ? { ...c, r: Math.max(c.r, copper) } : c)));
      if (!kept) {
        this.corridors(this.O);
        this.drainage(this.O);
        this.chasms(this.O);
        if (NETS.size >= NETS_KEPT) NETS.delete(NETS.keys().next().value!);
        NETS.set(key, this.lines);
      }
    }
    // Map 6's field of spires (D147): its wedge's middle the land's draw among the bearings, never in
    // the wind's way (any day's: the Crown's turbines keep their wind; a bearing in it is taken only if
    // every one is), the one least in the way of the copper field (its keep and its corridor run along
    // its bearing), of the quartz vein's side and of the vents (their corridors too); its box; its
    // lanes across it.
    const SPI = P.spires && this.O ? P.spires : null;
    if (SPI) {
      const A = SPI.avoid, apart = (a: number, b: number): number => { const d = (a - b) & 63; return Math.min(d, 64 - d); };
      const winds = [SPI.wind.from - SPI.wind.veer, SPI.wind.from, SPI.wind.from + SPI.wind.veer];
      const cb = headingOf(this.copperField.cx - CENTER, this.copperField.cy - CENTER);
      const vb = this.ventSites.map((v) => headingOf(v.x + 1 - CENTER, v.y + 1 - CENTER));
      const qb = this.bluff ? (this.bluff.west ? 32 : 48) : -1;
      const b = SPI.bearings
        .map((d) => ({
          d: d & 63,
          windy: winds.some((w) => apart(d, w) < A.wind) ? 1 : 0,
          cost: 4 * Math.max(0, A.copper - apart(d, cb)) + (qb < 0 ? 0 : 4 * Math.max(0, A.vein - apart(d, qb))) + vb.reduce((t, v) => t + Math.max(0, A.vent - apart(d, v)), 0),
          draw: hash32(ps, 330, d & 63),
        }))
        .sort((p, q) => p.windy - q.windy || p.cost - q.cost || p.draw - q.draw || p.d - q.d)[0]!.d;
      const [r0, r1] = SPI.r, H = SPI.half;
      // The box: the wedge's arcs sampled a 64th apart (2 tiles to spare), cut to its rings' square.
      let bx0 = WORLD, by0 = WORLD, bx1 = -1, by1 = -1;
      for (let k = b - H; k <= b + H; k++) for (const r of [r0, r1]) {
        const x = CENTER + ((COS64[k & 63]! * r) >> 10), y = CENTER + ((SIN64[k & 63]! * r) >> 10);
        bx0 = Math.min(bx0, x - 2); by0 = Math.min(by0, y - 2); bx1 = Math.max(bx1, x + 2); by1 = Math.max(by1, y + 2);
      }
      const home = parcelRect(parcelAt(CENTER, CENTER)), R = SPI.rings[1] * PARCEL;
      bx0 = Math.max(bx0, home.x0 - R); by0 = Math.max(by0, home.y0 - R); bx1 = Math.min(bx1, home.x1 - 1 + R); by1 = Math.min(by1, home.y1 - 1 + R);
      // The rings' square: the Heart's parcel's half (its edges round the Heart's tile) and a parcel a ring.
      const hp = Math.min(CENTER - home.x0, home.x1 - 1 - CENTER, CENTER - home.y0, home.y1 - 1 - CENTER);
      const c0 = hp + 1 + (SPI.rings[0] - 1) * PARCEL, c1 = hp + R;
      // The lanes, off the middle either side (one: a side by the draw), each at a draw.
      const L = SPI.lanes, n = L.count[0] + (hash32(ps, 331) % (L.count[1] - L.count[0] + 1)), side = hash32(ps, 333) & 1 ? 1 : -1;
      const lanes = Array.from({ length: n }, (_, k) => (n === 1 ? side : k ? 1 : -1) * (L.at[0] + (hash32(ps, 332, k) % (L.at[1] - L.at[0] + 1))));
      // The crests: the main one round the cirque at a radius of the draw, and a branch leaving it at
      // a point across the field, running off one way along the arc, drifting in or out.
      const CR = SPI.crests, crest = 4 * (CR.r[0] + (hash32(ps, 334) % (CR.r[1] - CR.r[0] + 1)));
      const B = CR.branch, hb = hash32(ps, 335);
      const branch = CR.count[0] + (hb % (CR.count[1] - CR.count[0] + 1)) > 1
        ? {
          v: Math.floor(((B.at[0] + (hash32(ps, 336) % (B.at[1] - B.at[0] + 1))) * (crest >> 2) * 1024 * SIN64[H]!) / (1000 * COS64[H]!)),
          side: (hb >>> 8) & 1 ? 1 : -1, out: (hb >>> 9) & 1 ? 1 : -1,
          off: 4 * (B.off[0] + (hash32(ps, 337) % (B.off[1] - B.off[0] + 1))), run: B.run,
        }
        : null;
      this.spf = {
        S: SPI, ux: COS64[b]!, uy: SIN64[b]!, sn: SIN64[H]!, cs: COS64[H]!, bx0, by0, bx1, by1, c0, c1, lanes, crest, branch,
        oN: makeNoise2(hash32(ps, 18)), lN: makeNoise2(hash32(ps, 19)), cN: makeNoise2(hash32(ps, 20)),
      };
      const rm = (r0 + r1) >> 1;
      this.spireField = { x: CENTER + ((COS64[b]! * rm) >> 10), y: CENTER + ((SIN64[b]! * rm) >> 10), bearing: b, r0, r1 };
    } else {
      this.spf = null;
      this.spireField = null;
    }
  }

  private addSite(id: UniqueBiomeId, rMin: number, rSpan: number, salt: number): void {
    const ps = this.playerSeed >>> 0;
    const d = hash32(ps, salt) % 64, r = rMin + (hash32(ps, salt, 1) % rSpan);
    const cx = CENTER + ((COS64[d]! * r) >> 10), cy = CENTER + ((SIN64[d]! * r) >> 10);
    this.sites.push({ id, cx, cy, r: 10 + (hash32(ps, salt, 2) % 7), item: itemIdx(UNIQUE_BIOMES[id].item) });
  }

  /** A field of the world's noise near the cirque and the player's farther out (0..255). */
  private blend(w: Noise2, p: Noise2, x: number, y: number, r: number, scale: number, oct = 4): number {
    const a = r <= RINGS.blendFrom ? 0 : r >= RINGS.blendTo ? 128 : Math.floor(((r - RINGS.blendFrom) * 128) / (RINGS.blendTo - RINGS.blendFrom));
    if (a === 0) return qfbm(w, x, y, scale, oct); // = (q·128 + …·0) >> 7: one noise is enough
    if (a === 128) return qfbm(p, x, y, scale, oct);
    return (qfbm(w, x, y, scale, oct) * (128 - a) + qfbm(p, x, y, scale, oct) * a) >> 7;
  }

  /** The archetypes' bias (given ×3), whole from the Crown out to RINGS.blendFrom, then fading to nothing at r 200. */
  private bias(b3: number, r: number): number {
    if (r >= 200) return 0;
    const f = Math.min(128, Math.floor(((200 - r) * 128) / (200 - RINGS.blendFrom)));
    return Math.floor((b3 * f) / 3) >> 7;
  }

  private heightAt(x: number, y: number, r: number): number {
    return clamp255(this.blend(this.hW, this.hP, x, y, r, 48) + this.bias(this.dH3, r));
  }

  private moistAt(x: number, y: number, r: number): number {
    return clamp255(this.blend(this.mW, this.mP, x, y, r, 64) + this.bias(this.dM3, r));
  }

  /** Height and moisture (0..255) at a tile, with the per-player blend and archetype bias. */
  fields(x: number, y: number, r: number): [number, number] {
    return [this.heightAt(x, y, r), this.moistAt(x, y, r)];
  }

  /** The shared wobble, −amp … amp − 1, of feature size `scale` tiles. */
  private jitter(x: number, y: number, amp: number, scale = 6): number {
    return ((qfbm(this.jit, x, y, scale, 2) - 128) * amp) >> 7;
  }

  /**
   * The Crown at a tile: −1 on the cirque's floor, 0 past its foot, else its raw level — one more
   * every `terrace` tiles from the floor's rim up to its top, which runs out at least `minCrest`
   * tiles to the foot less the way down, then one less every `terrace` tiles. The rim and the
   * top's outer edge wobble with the shared noise. Its top is the `ridge` (map 2; map 1: the
   * crest), the crest wherever the edge leaves it room for
   * `minCrest` tiles: on the shoulders (`shoulder`), round the tarn (its `mound`, a tile lower a
   * tile away), all round a Closed Cirque. Every tile between r = rim and the foot is at 1 or
   * more, and the rim is at most floorRadius + 1 while the foot is at least (ridge − 1) × terrace
   * × 2 + `minCrest` tiles past it: no level-0 path crosses the ring.
   */
  private crown(x: number, y: number, r: number): number {
    const C = this.C, T = C.terrace;
    // The shared noise at the tile (map 1), or at its bearing on the `jitterAt` circle (map 2) —
    // the point itself, not a tile, so a ray out of the cirque reads one value all along (the
    // noise takes any point; IEEE division is the same on every engine).
    const B = C.jitterAt;
    const [jx, jy] = B && r > 0 ? this.bearing(x, y, r, B.radius) : [x, y];
    const rim = C.floorRadius + this.jitter(jx, jy, C.rimJitter.floor, B ? B.scale : 6);
    if (r < rim) return -1;
    const ridge = C.ridge ?? C.crest, lift = (ridge - 1) * T;
    // The outer edge wobbles twice as slowly as the rim: a step of one tile at most, so the way
    // down never leaves a lone rock tile past the foot.
    const s = this.shoulder(x, y, r);
    let edge = Math.max(rim + lift + C.minCrest, this.crownFoot - lift + this.jitter(jx + 97, jy - 31, C.rimJitter.outer, 12)) + s;
    const t = this.tarnAt;
    let mound = 0;
    if (t && r > 0) {
      // Round the tarn: its bearing's point on the tarn's circle, so the mound is a function of the
      // bearing too (a top's edge that sank outwards would squeeze the way down into one-tile steps).
      const [px, py] = this.bearing(x, y, r, t.rc);
      const d2 = Math.floor((px - t.cx) * (px - t.cx) + (py - t.cy) * (py - t.cy));
      if (d2 < 16 * t.mound * t.mound) edge = Math.max(edge, (mound = t.rc + t.mound - Math.max(0, isqrt(d2) - t.mound)));
    }
    // A peak where the top's edge for the template's own rim leaves the crest room: decided by
    // the bearing (the shoulder, the archetype's foot, the tarn), not the tile's rim, so a peak's
    // outline is clean; its crest then keeps `minCrest` tiles past this tile's rim.
    let top = ridge;
    if (ridge < C.crest && Math.max(Math.max(C.floorRadius + lift + C.minCrest, this.crownFoot - lift) + s, mound) - C.floorRadius - (C.crest - 1) * T >= C.minCrest) {
      top = C.crest;
      edge = Math.max(edge, rim + (C.crest - 1) * T + C.minCrest);
    }
    const up = Math.min(top, 1 + Math.floor((r - rim) / T));
    const lv = r < edge ? up : Math.min(up, Math.max(0, top - 1 - Math.floor((r - edge) / T)));
    // The spring's summit (map 4, D115): a plateau over the Crown's outer side, past its foot too.
    const S = this.summit;
    if (!S) return lv;
    // The ledge below it: flat at its level, past the Crown's foot too (the stream runs level across
    // it; a works stands by it); settling makes terraces of its edges, so it is reached a level a step.
    const G = this.ledgeAt(x, y);
    if (G >= 0) return G;
    // The summit: never lower than the Crown it stands on.
    return Math.max(lv, this.peak(x, y));
  }

  /**
   * The spring's summit at a tile (map 4, D115), 0 off it: flat at its level `top` tiles round its
   * middle (the basin's rock rim), `fall` levels a tile down from there (a mesa, compact: no ribbon
   * climbs its sides), never on the quartz vein's ground (its corridor home stays open).
   */
  private peak(x: number, y: number): number {
    const S = this.summit;
    if (!S) return 0;
    const dx = x - S.x, dy = y - S.y, d2 = dx * dx + dy * dy, d = isqrt(d2), H = S.shape;
    let up = S.level - S.fall * Math.max(0, d - S.top);
    if (H && d2 > 0 && d2 < S.reach2) up = this.massifPeak(S, H, dx, dy, d2, d, up);
    return up > 0 && !this.inVeinZone(x, y, 1) ? up : 0;
  }

  /**
   * Map 6's summit at a tile `dx`, `dy` off its middle (D147: a natural massif; content
   * `SummitShape`), given map 4's level there (`flat`): never above it — a summit no taller nor wider
   * anywhere shelters no Crown tile more than map 4's did (D95: the Crown's turbines keep their wind).
   * Its rings counted from its plateau's edge as map 4 counts them (a tile's whole distance past
   * `top`), that edge eaten in by bays — the shared noise read on a circle round its middle at the
   * tile's bearing, up to `amp` quarter tiles —, never within the basin's rim; a ring down `falls`
   * levels by bearing. On its `keep` arc (east and south: the stream, the ledge, the floor the bases'
   * lines run down), none of it (map 4's summit), coming in over `blend` 64ths.
   */
  private massifPeak(S: NonNullable<MapGen['summit']>, H: SummitShape, dx: number, dy: number, d2: number, d: number, flat: number): number {
    // Map 4's on the `keep` arc (clockwise from its first bearing to its second); the shape comes in over `blend` 64ths past it.
    const b = headingOf(dx, dy), [k0, k1] = H.keep;
    const k = ((b - k0) & 63) <= ((k1 - k0) & 63) ? 0 : Math.min(H.blend, (k0 - b) & 63, (b - k1) & 63);
    if (k <= 0) return flat;
    const dq = isqrt(16 * d2);
    if (dq <= S.rimQ) return flat;
    // The point of the tile's bearing on the circle of `ring` (not a tile: any point, as `bearing`).
    const px = S.x + (dx * H.ring) / d, py = S.y + (dy * H.ring) / d;
    const bay = Math.trunc((Math.floor((Math.max(0, qfbm(this.jit, px + 401, py - 263, H.scale, 2) - 112) * H.amp) / 143) * k) / H.blend);
    const ring = Math.floor((dq + bay) / 4) - S.top;
    if (ring <= 0) return flat;
    const f = k < H.blend ? S.fall : qfbm(this.jit, px - 517, py + 389, H.fallScale, 2) < 128 ? H.falls[0] : H.falls[1];
    return Math.min(flat, S.level - f * ring);
  }


  /**
   * How far the Crown's top shoulders out at a tile (tiles, 0 on map 1): the shared noise read on
   * a circle round the cirque at the tile's bearing, past `shoulders.from`. A function of the
   * bearing alone, so a shoulder spans the Crown from its rim to its foot.
   */
  private shoulder(x: number, y: number, r: number): number {
    const S = this.C.shoulders;
    if (!S || r <= 0) return 0;
    const [bx, by] = this.bearing(x, y, r, S.radius);
    const n = qfbm(this.jit, bx + 211, by - 157, S.scale, 2);
    return n > S.from ? ((n - S.from) * S.gain) >> 7 : 0;
  }

  /** The point of a tile's bearing on the circle of `radius` round the cirque (r > 0: the tile's own radius): not a tile, any point. */
  private bearing(x: number, y: number, r: number, radius: number): [number, number] {
    return [CENTER + ((x - CENTER) * radius) / r, CENTER + ((y - CENTER) * radius) / r];
  }

  /** Is (x, y) on the spring's ledge (map 4, D115; its bites too, map 6)? */
  private onLedge(x: number, y: number): boolean {
    return this.ledgeAt(x, y) >= 0;
  }

  /**
   * The spring's ledge at (x, y) (map 4, D115): its level, −1 off it. Map 6 (D147) erodes it: a bite
   * lowers a tile of it (its own level), a spur adds one past it at its level.
   */
  private ledgeAt(x: number, y: number): number {
    const G = this.C.spring?.ledge;
    if (!G) return -1;
    const dx = x - CENTER, dy = y - CENTER;
    if (dx >= G.dx0 && dx <= G.dx1 && dy >= G.dy0 && dy <= G.dy1) {
      for (const [bx, by, bl] of G.bites ?? []) if (bx === dx && by === dy) return bl;
      return G.level;
    }
    for (const [sx, sy] of G.spurs ?? []) if (sx === dx && sy === dy) return G.level;
    return -1;
  }


  /**
   * The spring's water at a tile of its stream (map 4, D115): the lowest the Crown stands along the
   * stream's line from its head to that tile (tile by tile), so the water only ever falls — cutting
   * into the rock where the Crown under it rises again — and steps down a terrace in a fall.
   */
  private springLevel(x: number, y: number): number {
    const S = this.summit!, P = this.lake!;
    const dx = P.cx - S.x, dy = P.cy - S.y, len = Math.max(Math.abs(dx), Math.abs(dy)), l2 = dx * dx + dy * dy;
    if (!len) return 0;
    const k = Math.max(0, Math.min(len, Math.round((((x - S.x) * dx + (y - S.y) * dy) * len) / l2)));
    let lv = MAX_LEVEL;
    for (let j = 0; j <= k; j++) {
      const px = S.x + Math.round((dx * j) / len), py = S.y + Math.round((dy * j) / len);
      lv = Math.min(lv, Math.max(0, this.crown(px, py, isqrt((px - CENTER) * (px - CENTER) + (py - CENTER) * (py - CENTER)))));
    }
    return lv;
  }

  /** The tarn's water at a tile (map 2): its class, deep at its heart; 0 off it (and on map 4: a spring instead, D115). */
  private tarnWater(x: number, y: number): number {
    const t = this.tarnAt;
    if (!t || this.spring) return 0;
    const d2 = (x - t.cx) * (x - t.cx) + (y - t.cy) * (y - t.cy);
    return d2 <= t.r2deep ? T.Deep : d2 <= t.r2 ? T.Shallow : 0;
  }

  /**
   * The quartz vein's bluff at a tile past the Crown (D87): its rock's raw level (1 at the face, one
   * more every `climb` tiles back, to `top`), −1 on the floor it keeps (the apron at the wall's foot,
   * the corridor home to the Crown), 0 elsewhere. In the bluff's frame: `u` out along its axis, `v` across.
   */
  private vein(x: number, y: number): number {
    const B = this.bluff;
    if (!B) return 0;
    const Q = B.Q;
    const u = B.west ? CENTER - x : CENTER - y, v = B.west ? y - CENTER : x - CENTER;
    if (u < 0 || u >= B.u0 + Q.depth) return 0;
    if (u >= B.u0) {
      // A rounded massif behind a straight face: the face row runs the wall's whole length (its ore
      // and a bare tile each end), the rock narrowing towards the back (`d²/depth` a side) with a
      // wobble of the shared noise on its flanks; its level rises with the distance from the face
      // and from the flanks, so settling makes terraces of a dome, not of a box. Doubled
      // coordinates across (the wall's centre falls between two tiles).
      const d = u - B.u0, dv2 = Math.abs(2 * v - (B.va + B.vb));
      const edge = Q.length + 1 - 2 * Math.floor((d * d) / Q.depth) + (d > 0 ? 2 * this.jitter(x * 2, y * 2, 2, 4) : 0);
      if (dv2 > edge) return 0;
      return Math.min(Q.top, 1 + Math.floor(Math.min(d, (edge - dv2) >> 1) / Q.climb));
    }
    if (u >= B.u0 - Q.apron && v >= B.va - Q.apronWide && v <= B.vb + Q.apronWide) return -1;
    return v >= B.vc - Q.corridor && v <= B.vc + Q.corridor ? -1 : 0;
  }

  /**
   * The mountains' raw level at a tile outside the Crown (0: none): its elevation cut into terraces
   * (`MOUNTAINS`); `lift` added to it (map 4's roughness, `mountainLift`; 0 on maps 1–3).
   */
  private mountain(x: number, y: number, r: number, h: number, lift = 0): number {
    const M = MOUNTAINS;
    if (r < M.from) return 0;
    let e = this.blend(this.eW, this.eP, x, y, r, M.scale, M.octaves) + this.bias(this.dE3, r) + lift;
    if (r < M.full) e -= (M.full - r) * M.ramp;
    if (h < M.shore) e -= (M.shore - h) * M.shoreSlope;
    for (const c of this.clearings) {
      const d2 = (x - c.cx) * (x - c.cx) + (y - c.cy) * (y - c.cy);
      if (d2 < c.r * c.r) e -= (c.r - isqrt(d2)) * M.clear.slope;
    }
    const top = r < RINGS.near ? M.threshold.near : r < RINGS.reaches ? M.threshold.reaches : M.threshold.far;
    if (e < top) return 0;
    return Math.min(MOUNTAIN_LEVEL, 1 + Math.floor((e - top) / M.step));
  }

  /**
   * A tile before its slopes are evened out, packed: its raw level (`LV`), the `CROWN` and
   * `FLOOR` flags, the ground class of a level-0 tile (from bit `GROUND`, only when `ground` is
   * asked: it costs the moisture field) and the land's height field outside the cirque (from bit
   * `HEIGHT`). Pure: a function of the seeds and (x, y).
   */
  private classify(x: number, y: number, ground: boolean): number {
    const dx = x - CENTER, dy = y - CENTER;
    const r = isqrt(dx * dx + dy * dy);
    if (r > RINGS.playable) return (this.heightAt(x, y, r) << HEIGHT) | (T.DuneSea << GROUND);
    const su = this.summit;
    if (r <= this.crownReach || (su && (x - su.x) * (x - su.x) + (y - su.y) * (y - su.y) < su.reach2)) {
      const c = this.crown(x, y, r);
      // The spring's stream (map 4, D115): down the terraces at their level (a fixed level, a fall at
      // each step; the Crown's levels only fall towards the floor), then across the floor's edge
      // into its pool.
      const sp = this.springSeg, S = this.summit;
      // Its basin on the summit's plateau (owner: « the water cannot just come from nowhere »): still
      // water at the plateau's level, deep in its middle, where the stream starts.
      if (S && c === S.level) {
        const b2 = (x - S.x) * (x - S.x) + (y - S.y) * (y - S.y);
        if (b2 <= S.b2) return c | CROWN | WET | FIXED | ((b2 <= S.b2deep ? T.Deep : T.Shallow) << GROUND);
      }
      // (the pool takes over on the floor only: up on the Crown the stream runs on into it)
      if (sp && within(sp, 4 * x + 2, 4 * y + 2) && (c > 0 || this.floorGround(x, y) === T.Sand)) {
        const flow = (T.River << GROUND) | (sp.dir << FLOW), w = c > 0 ? this.springLevel(x, y) : 0;
        return w > 0 ? w | CROWN | WET | FIXED | flow : FLOOR | flow;
      }
      // Its banks and its ledge stand as the massifs' rock does (owner: « the waterfall… looks like
      // it's levitating »): never settled lower, and a bank never below the water beside it (raised to
      // it where the Crown or the floor there lies lower; owner, of a fall whose water was lost at its
      // foot: « the visuals are still a little bit broken »), so the water runs in a channel between
      // walls at least its height — no column of it standing over lower land, cut at the corner by the
      // relief's chamfers — and steps down only along its way; the ledge stays flat.
      if (sp && within(sp, 4 * x + 2, 4 * y + 2, sp.hw + 4)) {
        const w = this.springLevel(x, y);
        if (c > 0 || w > 0) return Math.max(c, w) | CROWN | MASSIF;
      }
      if (sp && c > 0 && this.onLedge(x, y)) return c | CROWN | MASSIF;
      // So does the summit (« a little plateau »): its plateau whole round the basin wherever the
      // land beside it lies lower (the vein's corridor: a cliff there, not its top worn away).
      if (S && c > 0 && this.peak(x, y) === c) return c | CROWN | MASSIF;
      if (c < 0) return FLOOR | (ground ? this.floorGround(x, y) << GROUND : 0);
      if (c > 0) {
        // A mountain at the Crown's foot (a Closed Cirque's) may rise over its outer terraces.
        const m = r >= MOUNTAINS.from ? this.mountain(x, y, r, this.heightAt(x, y, r)) : 0;
        if (m > c) return m;
        // The tarn: water at the crest's level (its class whether or not `ground` is asked: it is cheap).
        const w = c === this.C.crest ? this.tarnWater(x, y) : 0;
        return w ? c | CROWN | WET | (w << GROUND) : c | CROWN;
      }
    }
    const h = this.heightAt(x, y, r), hb = h << HEIGHT;
    // The quartz vein's bluff (map 3): its rock (a mountain behind it may stand higher), the floor
    // at its foot and the corridor home, kept dry and open whatever the land would put there.
    const q = this.vein(x, y);
    if (q < 0) return hb | (T.Sand << GROUND);
    if (q > 0) return hb | Math.max(q, this.mountain(x, y, r, h));
    for (const v of this.ventSites) if (x >= v.x && x < v.x + 3 && y >= v.y && y < v.y + 3) return hb | (T.Vent << GROUND);
    for (const s of this.sites) {
      const sd = (x - s.cx) * (x - s.cx) + (y - s.cy) * (y - s.cy);
      if (sd > s.r * s.r) continue;
      const t = siteTerrain(s.id, h, sd, s.r);
      return hb | (t >= T.Rock1 && t <= T.Rock4 ? (UNIQUE_BIOMES[s.id].rockLevel ?? 1) : t << GROUND);
    }
    if (this.O) {
      // The sea (the shared world's; a corridor to a site crosses it on a causeway), then the obstacles.
      const sea = this.seaAt(x, y);
      return sea && !this.lines.hit(x, y, LineKind.Corridor) ? hb | SEAF | (sea << GROUND) : this.obstacle(x, y, r, h, ground);
    }
    const m = this.mountain(x, y, r, h);
    if (m > 0) return hb | m;
    if (!ground) return hb;
    return hb | (plainGround(h, this.moistAt(x, y, r)) << GROUND);
  }

  /**
   * Map 4's land past the Crown, the vein, the vents and the sites (D94), packed as `classify`
   * gives it: a corridor's floor (no water on it), a chasm, a river (its way in the FLOW bits), a
   * pond, then the higher of the mountains and the massifs (a massif's tile flagged, and its ramp),
   * else the plain ground.
   */
  private obstacle(x: number, y: number, r: number, h: number, ground: boolean): number {
    const hb = h << HEIGHT, [corridor, chasm, rv, lake] = this.lines.hits(x, y, this.hitBuf);
    const g = this.rough(x, y, r), lift = this.liftOf(g);
    if (corridor) {
      // A river across it: a ford (still shallows: a backfiller fills them, a skybridge leaps them).
      if (rv) return hb | (T.Shallow << GROUND);
      // The mountains of maps 1–3 stay (they climb, a level a step); the water goes.
      const m = this.mountain(x, y, r, h, lift);
      if (m > 0) return hb | m;
      if (!ground) return hb;
      const g = plainGround(h, this.moistAt(x, y, r));
      return hb | ((g === T.Shallow || g === T.Deep ? T.Sand : g) << GROUND);
    }
    if (chasm) return hb | (T.Chasm << GROUND);
    if (rv) {
      // Up on a massif the stream's water stands at its level along it (a fixed level: it never
      // settles; where two streams meet, the lower); on the floor at 0, where a lake of the plains
      // takes it in.
      const low = rv.lv ? this.lines.lowestRiver(x, y)! : { seg: rv, level: 0 };
      if (low.level > 0) return hb | low.level | WET | FIXED | (T.River << GROUND) | (low.seg.dir << FLOW);
      if (h >= 52) return hb | (T.River << GROUND) | (low.seg.dir << FLOW);
    }
    if (lake) {
      // A lake (a hollow the rivers fill): deep at its heart.
      const dx = 4 * x + 2 - lake.ax, dy = 4 * y + 2 - lake.ay;
      return hb | ((4 * (dx * dx + dy * dy) <= lake.hw * lake.hw ? T.Deep : T.Shallow) << GROUND);
    }
    const m = this.mountain(x, y, r, h, lift), s = this.massif(x, y, r, h, g);
    if (s > 0 && s >= m) return hb | s | MASSIF | (this.ramp(x, y, r) ? RAMP : 0);
    if (m > 0) return hb | m;
    if (!ground) return hb;
    // The open desert holds no pond: its low ground is sand (D94, 2026-10-17).
    const pg = plainGround(h, this.moistAt(x, y, r));
    return hb | ((g < this.O!.desert.below && (pg === T.Shallow || pg === T.Deep) ? T.Sand : pg) << GROUND);
  }

  /**
   * A massif's raw level at a tile past the Crown (map 4, D94; 0: none): its elevation past the
   * threshold stands at the rim's level at once — the cliff — and one more every `step` above.
   * Faded in from `from` to `full`, sunk in water, kept off the clearings (a slope), the corridors
   * and the vein (`clear` tiles, outright).
   */
  private massif(x: number, y: number, r: number, h: number, g = this.rough(x, y, r)): number {
    const M = this.O!.massif;
    if (r < M.from) return 0;
    let e = this.blend(this.sW, this.sP, x, y, r, M.scale, M.octaves) + this.bias(this.dE3, r) + (((g - 128) * this.O!.rugged.gain) >> 6) - this.desertDrop(g);
    if (r < M.full) e -= (M.full - r) * M.fade;
    if (h < M.shore) e -= (M.shore - h) * M.shoreSlope;
    if (e < M.threshold) return 0;
    for (const c of this.keep) {
      const k = c.r + M.clear, d2 = (x - c.cx) * (x - c.cx) + (y - c.cy) * (y - c.cy);
      if (d2 < k * k) e -= (k - isqrt(d2)) * M.slope;
    }
    if (e < M.threshold || this.inVeinZone(x, y, M.clear) || this.lines.hit(x, y, LineKind.Keep)) return 0;
    return Math.min(MOUNTAIN_LEVEL, M.rim + Math.floor((e - M.threshold) / M.step));
  }

  /**
   * The land's roughness at a tile (map 4, D94: space or ore), 0..255: the world's noise near the
   * cirque, the player's farther out. High: broken ground, where the massifs and mountains crowd and
   * the ore lies; low: open desert.
   */
  private rough(x: number, y: number, r: number): number {
    let g = this.blend(this.gW, this.gP, x, y, r, this.O!.rugged.scale, 2);
    // Round the Crown the open sand (D94, 2026-10-17): held low out to `sand`, rising to the land's own by `rough`.
    const D = this.O!.desert;
    if (r < D.rough) g = Math.min(g, r <= D.sand ? D.low : D.low + Math.floor(((255 - D.low) * (r - D.sand)) / (D.rough - D.sand)));
    // Round the copper field never rougher than middling: the first works past the Crown stand there.
    const c = this.copperField, k = this.O!.copper;
    return g > 128 && (x - c.cx) * (x - c.cx) + (y - c.cy) * (y - c.cy) < k * k ? 128 : g;
  }

  /** What the roughness adds to the mountains' elevation at a tile (map 4; 0 on maps 1–3). */
  private mountainLift(x: number, y: number, r: number): number {
    return this.O ? this.liftOf(this.rough(x, y, r)) : 0;
  }

  /** What a roughness `g` adds to the mountains' elevation (map 4): up where the ground is broken, down where it is open, none in the open desert. */
  private liftOf(g: number): number {
    return (((g - 128) * this.O!.rugged.mountainGain) >> 6) - this.desertDrop(g);
  }

  /** How far a roughness `g` sinks the massifs and the mountains (map 4, D94): under the open desert's `below`, `edge` and `drop` more a unit; 0 above. */
  private desertDrop(g: number): number {
    const D = this.O!.desert;
    return g < D.below ? D.edge + (D.below - g) * D.drop : 0;
  }

  /** Does a massif come down in a ramp at this tile (map 4: a second noise past its `from`)? */
  private ramp(x: number, y: number, r: number): boolean {
    const R = this.O!.massif.ramps;
    return this.blend(this.rW, this.rP, x, y, r, R.scale, 2) > R.from;
  }

  /**
   * Is a tile within `m` tiles of the quartz vein's ground (map 3+, D87: its bluff, the floor at its
   * foot, the corridor home)? The obstacles keep off it.
   */
  private inVeinZone(x: number, y: number, m: number): boolean {
    const B = this.bluff;
    if (!B) return false;
    const Q = B.Q, u = B.west ? CENTER - x : CENTER - y, v = B.west ? y - CENTER : x - CENTER;
    if (u >= B.u0 - Q.apron - m && u < B.u0 + Q.depth + m && v >= B.va - Q.apronWide - m && v <= B.vb + Q.apronWide + m) return true;
    return u >= -m && u < B.u0 && v >= B.vc - Q.corridor - m && v <= B.vc + Q.corridor + m;
  }

  /**
   * May a river or a chasm pass through a tile, `m` tiles to spare (map 4)? Not on the Crown (its
   * reach and 4 more), not by the dune sea, nor within `m` of a clearing, a corridor or the vein.
   */
  private blocked(x: number, y: number, m: number): boolean {
    const dx = x - CENTER, dy = y - CENTER, r2 = dx * dx + dy * dy, inner = this.crownReach + 4 + m, outer = RINGS.playable - 8 - m;
    if (r2 <= inner * inner || r2 >= outer * outer) return true;
    for (const c of this.keep) {
      const k = c.r + m;
      if ((x - c.cx) * (x - c.cx) + (y - c.cy) * (y - c.cy) <= k * k) return true;
    }
    return this.inVeinZone(x, y, m) || this.lines.near(x, y, LineKind.Corridor, 4 * m);
  }

  /** The land's raised level at a tile past the Crown before its slopes are evened, mountains or massif (map 4: what a chasm stops at, what a river avoids). */
  private raised(x: number, y: number, r: number, h: number): number {
    return Math.max(this.mountain(x, y, r, h, this.mountainLift(x, y, r)), this.massif(x, y, r, h));
  }

  /**
   * The corridors of floor (map 4, D94): from the Crown's foot towards each site the land
   * guarantees — the copper field, the unique sites, the vents — to its middle, a polyline bent
   * every `every` tiles by up to `wobble` across (the player's seed), `half` tiles each side.
   */
  private corridors(O: Obstacles): void {
    const C = O.corridor, ps = this.playerSeed >>> 0;
    const goals: Array<[number, number]> = [[this.copperField.cx, this.copperField.cy]];
    for (const s of this.sites) goals.push([s.cx, s.cy]);
    for (const v of this.ventSites) goals.push([v.x + 1, v.y + 1]);
    goals.forEach(([gx, gy], i) => {
      const dx = gx - CENTER, dy = gy - CENTER, len = isqrt(dx * dx + dy * dy);
      if (len <= this.crownReach) return;
      const r0 = this.crownReach + 1, n = Math.max(1, Math.floor((len - r0) / C.every));
      const pts: LinePt[] = [];
      for (let k = 0; k <= n; k++) {
        // Along the bearing from the foot (r0) to the goal, bent across between the ends.
        const along = r0 + Math.floor(((len - r0) * k) / n);
        const off = k === 0 || k === n ? 0 : (hash32(ps, 150, i, k) % (2 * C.wobble + 1)) - C.wobble;
        const x = CENTER + Math.floor((dx * along - dy * off) / len), y = CENTER + Math.floor((dy * along + dx * off) / len);
        pts.push({ x: 4 * x + 2, y: 4 * y + 2, hw: 4 * C.half + 2 });
      }
      pts[n] = { x: 4 * gx + 2, y: 4 * gy + 2, hw: 4 * C.half + 2 };
      this.lines.addLine(pts, LineKind.Corridor);
      // The same line grown by what the massifs keep off it: one lookup for them.
      this.lines.addLine(pts.map((p) => ({ ...p, hw: p.hw + 4 * O.massif.clear })), LineKind.Keep);
    });
  }

  /**
   * The sea at a tile (map 4, D94; content `OBSTACLES.sea`): 0 inland, else its class — shallows
   * near the coast, deep water beyond. The coast lies `distance` tiles out along the world seed's
   * bearing (`seaDir`), moved in and out by the world's noise read along it: the same for every claim.
   */
  seaAt(x: number, y: number): number {
    const S = this.O!.sea, d = this.seaDir, dx = x - CENTER, dy = y - CENTER;
    const p = (dx * COS64[d]! + dy * SIN64[d]!) >> 10;
    if (p < S.distance - S.coast) return 0;
    const into = p - this.coast(dx, dy);
    return into < 0 ? 0 : into < S.shallow ? T.Shallow : T.Deep;
  }

  /** How far out the coast lies (tiles along the sea's bearing) across from a tile (offsets from the centre). */
  private coast(dx: number, dy: number): number {
    const S = this.O!.sea, d = this.seaDir;
    const q = (dy * COS64[d]! - dx * SIN64[d]!) >> 10;
    return S.distance + (((qfbm(this.jit, q + 20_000, 7_777, S.scale, 3) - 128) * S.coast) >> 7);
  }

  /** A point on the coast, straight out along the sea's bearing (map 4: the debug handle's jump there); null off map 4. */
  seaPoint(): [number, number] | null {
    if (!this.O) return null;
    const d = this.seaDir, c = this.coast(0, 0);
    return [CENTER + ((COS64[d]! * c) >> 10), CENTER + ((SIN64[d]! * c) >> 10)];
  }

  /**
   * The rivers (map 4, D94; content `OBSTACLES.drainage`): a drainage network found once on a lattice.
   *
   * 1. Each node (a node every `grid` tiles, moved by a hash) has an elevation: the land's height, its
   *    massif's and mountains' raw levels weighted, and a tilt to the sea's coast. Nodes off the
   *    network's reach, on the Crown, by a clearing or the vein are out; nodes in the sea are its outlets.
   * 2. A flood from the sea in, lowest spill first (ties by order): each land node drains to the
   *    neighbour it was reached from, through the hollows too. Every node so drains to the sea.
   * 3. Rain falls on each node (more on raised land, most on a massif) and gathers downstream; a
   *    stream runs from a node where `channel` has gathered, to the node it drains to, its width by
   *    the flow; it meanders on the floor.
   * 4. Its water's level: on a massif (not its ramps) the massif's level, never above what flows into
   *    it, step by step along the stream (a step down is a fall); off it, the floor's. A hollow deep
   *    enough on the floor that a stream fills holds a lake.
   */
  private drainage(O: Obstacles): void {
    const D = O.drainage, G = D.grid, J = D.jitter, ps = this.playerSeed >>> 0;
    const n = Math.floor((2 * D.radius) / G) + 1, o = CENTER - Math.floor(((n - 1) * G) / 2), N = n * n;
    const px = new Int32Array(N), py = new Int32Array(N), E = new Int32Array(N), kind = new Uint8Array(N);
    const rain = new Int32Array(N), land = new Uint8Array(N);
    const levelOn = (x: number, y: number): number => {
      const dx = x - CENTER, dy = y - CENTER, r = isqrt(dx * dx + dy * dy), h = this.heightAt(x, y, r), s = this.massif(x, y, r, h);
      return s > 0 && !this.ramp(x, y, r) ? s : 0;
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = o + i * G + (hash32(ps, 300, i, j) % (2 * J + 1)) - J, y = o + j * G + (hash32(ps, 301, i, j) % (2 * J + 1)) - J;
        px[k] = x; py[k] = y;
        const dx = x - CENTER, dy = y - CENTER, r = isqrt(dx * dx + dy * dy);
        if (r > D.radius) continue;
        if (this.seaAt(x, y)) { kind[k] = 2; continue; }
        // None round the Crown out to the open sand's edge (D94), nor by the vein or a clearing.
        if (r <= Math.max(this.crownReach + D.keep, O.desert.rough) || this.inVeinZone(x, y, D.keep) || this.keep.some((c) => (x - c.cx) * (x - c.cx) + (y - c.cy) * (y - c.cy) <= (c.r + D.keep) * (c.r + D.keep))) continue;
        kind[k] = 1;
        const h = this.heightAt(x, y, r), g = this.rough(x, y, r);
        const m = this.mountain(x, y, r, h, this.liftOf(g)), sm = this.massif(x, y, r, h, g);
        const inland = Math.max(0, this.coast(dx, dy) - ((dx * COS64[this.seaDir]! + dy * SIN64[this.seaDir]!) >> 10));
        // The open desert stands a little high for the water (D94): the streams go round it.
        const dry = g < O.desert.below ? O.desert.riseEdge + (O.desert.below - g) * O.desert.rise : 0;
        E[k] = 4 * h + D.massifWeight * sm + D.mountainWeight * m + D.tilt * inland + dry;
        rain[k] = sm > 0 ? D.rain.massif : m > 0 ? D.rain.mountain : D.rain.plain;
        land[k] = sm > 0 && !this.ramp(x, y, r) ? sm : 0;
      }
    }
    // The flood: a binary heap on (spill, order), both integers: a total order.
    const recv = new Int32Array(N).fill(-1), F = new Int32Array(N), seen = new Uint8Array(N), order: number[] = [];
    const hk: number[] = [], hs: number[] = [], hn: number[] = [];
    let seq = 0;
    const less = (a: number, b: number): boolean => hk[a]! < hk[b]! || (hk[a] === hk[b] && hs[a]! < hs[b]!);
    const swap = (a: number, b: number): void => { [hk[a], hk[b]] = [hk[b]!, hk[a]!]; [hs[a], hs[b]] = [hs[b]!, hs[a]!]; [hn[a], hn[b]] = [hn[b]!, hn[a]!]; };
    const push = (key: number, node: number): void => {
      let c = hk.length;
      hk.push(key); hs.push(seq++); hn.push(node);
      while (c > 0) { const p = (c - 1) >> 1; if (!less(c, p)) break; swap(c, p); c = p; }
    };
    const pop = (): number => {
      const top = hn[0]!, last = hk.length - 1;
      swap(0, last); hk.pop(); hs.pop(); hn.pop();
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < hk.length && less(l, m)) m = l;
        if (r < hk.length && less(r, m)) m = r;
        if (m === c) break;
        swap(c, m); c = m;
      }
      return top;
    };
    for (let k = 0; k < N; k++) if (kind[k] === 2) { seen[k] = 1; push(0, k); }
    const NB = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
    while (hk.length) {
      const k = pop(), i = k % n, j = (k - i) / n;
      if (kind[k] === 1) order.push(k);
      for (const [di, dj] of NB) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const m = b * n + a;
        if (seen[m] || kind[m] !== 1) continue;
        seen[m] = 1;
        F[m] = Math.max(E[m]!, F[k]!);
        recv[m] = k;
        push(F[m]!, m);
      }
    }
    // The rain gathered downstream (upstream nodes first: the reverse of the flood's order), and the
    // water's level: up on a massif, a stream's level a tile along its way to the node it drains to,
    // never rising (`profile`); the node it reaches is no higher than the water arriving there.
    const acc = Int32Array.from(rain), W = Uint8Array.from(land), profile = new Map<number, Uint8Array>();
    for (let q = order.length - 1; q >= 0; q--) {
      const k = order[q]!, r = recv[k]!;
      if (r < 0 || kind[r] !== 1) continue;
      acc[r]! += acc[k]!;
      if (acc[k]! < D.channel) continue;
      let level = W[k]!;
      if (level > 0) {
        const x0 = px[k]!, y0 = py[k]!, x1 = px[r]!, y1 = py[r]!;
        const steps = Math.max(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
        const lv = new Uint8Array(steps + 1);
        for (let t = 0; t <= steps; t++) {
          level = Math.min(level, levelOn(x0 + Math.trunc(((x1 - x0) * t) / steps), y0 + Math.trunc(((y1 - y0) * t) / steps)));
          lv[t] = level;
        }
        profile.set(k, lv);
      }
      if (level < W[r]!) W[r] = level;
    }
    const width = (f: number): number => { let hw = D.widths[0]![1]; for (const [at, w] of D.widths) if (f >= at) hw = w; return hw; };
    // A hollow the rivers fill: at its bottom (a node below the spill by `lake.depth` or more, lower
    // than every neighbour, on the floor, carrying a stream) a lake, deep at its heart, wider the
    // deeper the hollow; the streams run in and out of it.
    for (const k of order) {
      if (acc[k]! < D.channel || land[k] || F[k]! - E[k]! < D.lake.depth) continue;
      const i = k % n, j = (k - i) / n;
      let bottom = true;
      for (const [di, dj] of NB) {
        const a = i + di, b = j + dj;
        if (a >= 0 && b >= 0 && a < n && b < n && kind[b * n + a] === 1 && E[b * n + a]! < E[k]!) bottom = false;
      }
      if (!bottom) continue;
      const r = Math.min(D.lake.radius[0] + D.lake.radius[1], D.lake.radius[0] + Math.floor((F[k]! - E[k]! - D.lake.depth) / D.lake.depth));
      this.lines.add({ ax: 4 * px[k]! + 2, ay: 4 * py[k]! + 2, bx: 4 * px[k]! + 2, by: 4 * py[k]! + 2, hw: 4 * r, kind: LineKind.Lake, dir: 0 });
    }
    for (const k of order) {
      if (acc[k]! < D.channel) continue;
      const r = recv[k]!;
      const sea = kind[r] === 2;
      const hw = sea ? Math.floor((width(acc[k]!) * O.sea.estuary) / 1000) : width(acc[k]!);
      // The stream from node k to the node it drains to: on the floor it meanders (a bent midpoint).
      const ax = px[k]!, ay = py[k]!, bx = px[r]!, by = py[r]!;
      let pts: Array<[number, number]> = [[ax, ay], [bx, by]];
      if (!W[k] && D.meander > 0) {
        const len = Math.max(1, isqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)));
        const m = (hash32(ps, 303, k) % (2 * D.meander + 1)) - D.meander;
        pts = [[ax, ay], [((ax + bx) >> 1) - Math.trunc(((by - ay) * m) / len), ((ay + by) >> 1) + Math.trunc(((bx - ax) * m) / len)], [bx, by]];
      }
      // Up on a massif the stretch runs straight with its level profile; on the floor it meanders, at 0.
      const lv = profile.get(k);
      for (let p = 1; p < pts.length; p++) {
        const [x0, y0] = pts[p - 1]!, [x1, y1] = pts[p]!;
        const seg: Seg = { ax: 4 * x0 + 2, ay: 4 * y0 + 2, bx: 4 * x1 + 2, by: 4 * y1 + 2, hw, kind: LineKind.River, dir: eighth(x1 - x0, y1 - y0), ...(lv ? { lv } : {}) };
        this.lines.add(seg);
      }
    }
  }

  /**
   * The chasms (map 4, D94): random walks across the open floor from points round the cirque (the
   * first `near` in the rings of parcels just past the starting square), a heading that wanders by
   * up to `turn` 64ths a step, a tile wider here and there, tapered at both ends. A walk turns aside
   * from raised land, water, a river and what is kept clear, and stops where it cannot.
   */
  private chasms(O: Obstacles): void {
    const C = O.chasm, ps = this.playerSeed >>> 0;
    const room = Math.ceil((C.width[0] + C.width[1] + C.pinch + 4) / 4) + O.corridor.margin;
    const open = (x: number, y: number): boolean => {
      if (this.blocked(x, y, room) || this.lines.near(x, y, LineKind.River, 4 * room)) return false;
      const dx = x - CENTER, dy = y - CENTER, r = isqrt(dx * dx + dy * dy), h = this.heightAt(x, y, r);
      return h >= 52 && this.rough(x, y, r) >= O.rugged.chasmMin && this.raised(x, y, r, h) === 0;
    };
    /** A walk of `steps` from `w`, its heading wandering by up to `turn` (hash salt `salt`), never back over itself nor into another chasm; its points, the first `w`'s. */
    const walk = (w0: Walker, steps: number, hw: (s: number) => number, salt: number): LinePt[] => {
      let w = w0;
      const pts: LinePt[] = [{ x: w.fx >> 8, y: w.fy >> 8, hw: hw(0) }];
      for (let s = 0; s < steps; s++) {
        const turn = (hash32(ps, salt, s) % (2 * C.turn + 1)) - C.turn;
        let next: Walker | null = null;
        for (const dd of [turn, turn + 6, turn - 6, turn + 12, turn - 12]) {
          const c = ahead(w, w.d + dd, C.stride), [x, y] = tileOf(c), [qx, qy] = quarter(c);
          // Never back over its own course (a knot of chasm with islands of sand in it), nor into another chasm.
          let back = false;
          for (let k = 0; k + 3 < pts.length && !back; k++) { const p = pts[k]!; back = (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy) < 4 * (hw(s) + 8) * (hw(s) + 8); }
          if (!back && open(x, y) && !this.lines.near(x, y, LineKind.Chasm, 2 * hw(s) + 8)) { next = c; break; }
        }
        if (!next) break;
        w = next;
        const [qx, qy] = quarter(w);
        pts.push({ x: qx, y: qy, hw: hw(s + 1) });
      }
      return pts;
    };
    for (let i = 0; i < C.count; i++) {
      const [r0, rs] = i < C.near ? C.rNear : C.r;
      let w: Walker | null = null;
      for (let t = 0; t < 6 && !w; t++) {
        const d = hash32(ps, 170, i, t) % 64, rr = r0 + (hash32(ps, 171, i, t) % rs);
        const x = CENTER + ((COS64[d]! * rr) >> 10), y = CENTER + ((SIN64[d]! * rr) >> 10);
        // Across the bearing out more often than along it: a chasm that cuts the way out.
        if (open(x, y)) w = { fx: x * 1024 + 512, fy: y * 1024 + 512, d: (d + 16 + (hash32(ps, 172, i) % 2) * 32 + (hash32(ps, 173, i) % 17) - 8) & 63 };
      }
      if (!w) continue;
      const steps = C.steps[0] + (hash32(ps, 174, i) % C.steps[1]);
      const hw0 = C.width[0] + (hash32(ps, 175, i) % C.width[1]);
      // It pinches and widens along its length: the shared noise read along the walk.
      const hw = (s: number): number => Math.max(C.taper, hw0 + this.jitter(i * 131 + s * 2, 977 + i * 7, C.pinch + 1, 6));
      const pts = walk(w, steps, hw, 1760 + i);
      if (pts.length - 1 < C.minSteps) continue;
      pts[0]!.hw = pts[pts.length - 1]!.hw = C.taper;
      // Side cracks: from a point here and there, off to one side, narrowing to the taper.
      const branches: LinePt[][] = [];
      for (let s = 2; s + 2 < pts.length; s++) {
        if (hash32(ps, 178, i, s) % 1000 >= C.branch.chance) continue;
        const a = pts[s - 1]!, b = pts[s + 1]!, dir = headingOf(b.x - a.x, b.y - a.y);
        const side = hash32(ps, 179, i, s) % 2 ? 1 : -1, off = C.branch.angle[0] + (hash32(ps, 180, i, s) % C.branch.angle[1]);
        const n = C.branch.steps[0] + (hash32(ps, 181, i, s) % C.branch.steps[1]);
        const p = pts[s]!, start: Walker = { fx: p.x << 8, fy: p.y << 8, d: (dir + side * off) & 63 };
        const hb = Math.max(C.taper, p.hw - 2);
        const arm = walk(start, n, (k) => Math.max(C.taper, hb - Math.floor((k * (hb - C.taper)) / n)), 1900 + i * 64 + s);
        if (arm.length >= 3) { arm[arm.length - 1]!.hw = C.taper; branches.push(arm); }
      }
      this.lines.addLine(pts, LineKind.Chasm);
      for (const arm of branches) this.lines.addLine(arm, LineKind.Chasm);
    }
  }


  /** The cirque's floor: the lake (map 1), else sand. */
  private floorGround(x: number, y: number): number {
    const L = this.lake;
    if (!L) return T.Sand;
    const ld = (x - L.cx) * (x - L.cx) + (y - L.cy) * (y - L.cy);
    return ld <= L.r2deep ? T.Deep : ld <= L.r2 ? T.Shallow : T.Sand;
  }

  /** The rock class of a raised tile: its hardness follows its level (the Crown's table on the Crown, the ring's beyond, by map version). */
  private rockOf(c: number, level: number, x: number, y: number): number {
    let hard: number;
    const C = this.C;
    if (c & CROWN) hard = C.hardness[Math.min(level, C.hardness.length) - 1]!;
    else {
      const dx = x - CENTER, dy = y - CENTER, r2 = dx * dx + dy * dy;
      const H = this.hard;
      hard = (r2 < RINGS.near * RINGS.near ? H.near : r2 < RINGS.reaches * RINGS.reaches ? H.reaches : H.far)[level - 1]!;
    }
    return T.Rock1 + hard - 1;
  }

  /**
   * A raised tile's level once the slopes are evened out: `settle` over the window its raw level can
   * feel (map 4: `settle4` over twice that, a ramp coming down half a level a tile; a massif's cliff
   * never comes down at all).
   */
  private settled(x: number, y: number, c: number): number {
    const raw = c & LV;
    const E = this.O ? 2 * raw - 2 : raw - 1, w = 2 * E + 1;
    const lv = new Uint8Array(w * w), fl = this.O ? new Uint8Array(w * w) : null;
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = this.classify(x - E + i, y - E + j, false);
      lv[j * w + i] = k & LV;
      if (fl) fl[j * w + i] = flagsOf(k);
    }
    if (fl) settle4(lv, fl, w, x - E, y - E);
    else settle(lv, w, x - E, y - E);
    return lv[E * w + E]!;
  }

  /** The land's level at a tile (D45), 0 … MAX_LEVEL (a needle of map 6's spire field: its height), as `fill` writes it. Pure and integer. */
  levelAt(x: number, y: number): number {
    const sp = this.spireAt(x, y);
    if (sp) return sp;
    const c = this.classify(x, y, false), raw = c & LV;
    return raw <= 1 ? raw : this.settled(x, y, c); // a tile at 0 or 1 never comes down
  }

  /** What `takesOre` reads of a tile, as `fill` writes it, without settling: any rock as Rock1 (rock or not does not depend on settling), else its ground. */
  private groundAt(x: number, y: number): number {
    const c = this.classify(x, y, true);
    return (c & LV) > 0 && !(c & WET) ? T.Rock1 : (c >> GROUND) & 15;
  }

  /**
   * Is tile (x, y) open floor at level 0, as `fill` writes it (D110: where a neighbouring base may
   * stand, sampled without making a chunk — but on map 6's spire field, D147, whose needles are read
   * off the chunks there: no neighbouring base stands so near)? A tile raw at level 0 is never raised
   * by the settling.
   */
  floorAt(x: number, y: number): boolean {
    if (this.spireAt(x, y)) return false;
    const c = this.classify(x, y, true);
    return (c & LV) === 0 && !(c & WET) && isFloor((c >> GROUND) & 15);
  }

  /**
   * Does the tile rect [x0, x1) × [y0, y1) hold what the land guarantees the claim (D110): the copper
   * field, a unique site or a vent (their clearings), the quartz vein (map 3), a corridor of floor to
   * a site (map 4, sampled every other tile), the ground of the spire field (map 6, D147)? No
   * neighbouring base takes such a parcel.
   */
  keepsClear(x0: number, y0: number, x1: number, y1: number): boolean {
    const disc = (cx: number, cy: number, r: number): boolean => {
      const dx = Math.max(x0, Math.min(x1 - 1, cx)) - cx, dy = Math.max(y0, Math.min(y1 - 1, cy)) - cy;
      return dx * dx + dy * dy <= r * r;
    };
    for (const c of this.clearings) if (disc(c.cx, c.cy, c.r)) return true;
    const v = this.quartzVein;
    if (v) for (let k = 0; k < v.n; k++) if (disc(v.x + k * v.dx, v.y + k * v.dy, 8)) return true;
    if (this.O) for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (this.lines.hit(x, y, LineKind.Corridor)) return true;
    const F = this.spf;
    if (F) for (let y = Math.max(y0, F.by0); y < Math.min(y1, F.by1 + 1); y++) for (let x = Math.max(x0, F.bx0); x < Math.min(x1, F.bx1 + 1); x++) if (this.spireElev(x, y) !== -1) return true;
    return false;
  }

  /**
   * The deposits whose blob centres lie in the tile rect [x0, x1) × [y0, y1), drillable ones only
   * (not a cliff face's), sampled without making a chunk (D110: a neighbouring base set on the ore of
   * its square, so that it mines what it makes): item, centre, radius². Its tiles take ore only where
   * the ground does: a centre on rock gives little.
   */
  depositsIn(x0: number, y0: number, x1: number, y1: number): Array<{ item: number; cx: number; cy: number; r2: number }> {
    const out: Array<{ item: number; cx: number; cy: number; r2: number }> = [], seen = new Set<Blob>();
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor((y1 - 1) / CHUNK); cy++) for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor((x1 - 1) / CHUNK); cx++) {
      for (const b of this.blobsNear(cx, cy)) {
        if (seen.has(b)) continue;
        seen.add(b);
        if (!b.onRock && b.cx >= x0 && b.cx < x1 && b.cy >= y0 && b.cy < y1) out.push({ item: b.item, cx: b.cx, cy: b.cy, r2: b.r2 });
      }
    }
    return out.sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.item - b.item);
  }

  /** Base terrain class of a tile (before deposits), as `fill` writes it. */
  terrainAt(x: number, y: number): number {
    if (this.spireAt(x, y)) return T.Rock1 + this.spf!.S.hardness - 1;
    const c = this.classify(x, y, true), raw = c & LV;
    if (raw === 0 || c & WET) return (c >> GROUND) & 15;
    return this.rockOf(c, raw <= 1 ? raw : this.settled(x, y, c), x, y);
  }

  /** Deposit blobs that can touch chunk (cx, cy): cirque, copper field, sites, common blobs, veins. */
  private blobsNear(cx: number, cy: number): Blob[] {
    const out: Blob[] = [];
    // How far past the chunk a blob's centre may lie and still reach into it: a disc's radius is
    // under 5; its blocks (D104) reach a block farther.
    const M = this.oreBlock > 1 ? 8 : 6;
    const x0 = cx * CHUNK - M, y0 = cy * CHUNK - M, x1 = cx * CHUNK + CHUNK + M, y1 = cy * CHUNK + CHUNK + M;
    const near = (b: { cx: number; cy: number }): boolean => b.cx >= x0 && b.cx < x1 && b.cy >= y0 && b.cy < y1;
    for (const b of this.cirqueBlobs) if (near(b)) out.push(b);
    this.fixedBlobs ??= [
      { ...this.copperField, r2: 16, item: itemIdx('copper_ore'), rich: BAL.depositRich.copper_ore!, onRock: false },
      ...this.sites.map((s) => ({ cx: s.cx, cy: s.cy, r2: 11, item: s.item, rich: BAL.uniqueRich, onRock: s.id === 'organpeaks' })),
    ];
    for (const b of this.fixedBlobs) if (near(b)) out.push(b);
    const ps = this.playerSeed >>> 0;
    if (this.O) {
      // Map 4 (D94): the deposits follow the broken ground.
      for (let ny = cy - 1; ny <= cy + 1; ny++) for (let nx = cx - 1; nx <= cx + 1; nx++) for (const b of this.oreCell(nx, ny)) if (near(b)) out.push(b);
      return out;
    }
    for (let ny = cy - 1; ny <= cy + 1; ny++) {
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        const bx = nx * CHUNK + 8 + (hash32(ps, nx, ny, 1) % 16), by = ny * CHUNK + 8 + (hash32(ps, nx, ny, 2) % 16);
        const dx = bx - CENTER, dy = by - CENTER;
        const r = isqrt(dx * dx + dy * dy);
        if (r <= this.C.crownOuter + 4 || r > RINGS.far) continue; // the cirque's deposits are the template's
        const ring = r < RINGS.near ? 'near' : r < RINGS.reaches ? 'reaches' : 'far';
        const roll = hash32(ps, nx, ny, 3) % 1000;
        const c = this.classify(bx, by, true); // rock or not does not depend on settling
        const radius = 2.5 + (hash32(ps, nx, ny, 4) % 20) / 10;
        if ((c & LV) > 0) {
          // Veins hidden in rock: revealed (and minable) once dug out.
          if (roll < 80) {
            const vein = roll < 30 ? 'copper_ore' : 'iron_ore';
            out.push({ cx: bx, cy: by, r2: radius * radius * 0.6, item: itemIdx(vein), rich: Math.floor((BAL.depositRich[vein]! * RICH_MULT[ring]) / 1000), onRock: true });
          }
          continue;
        }
        if (roll >= DEPOSIT_CHANCE[ring]) continue;
        const t = (c >> GROUND) & 15;
        let item = pickWeighted(hash32(ps, nx, ny, 5));
        if (item === 'salt' && t !== T.Salt) continue; // salt lies on salt flats; the sand is the ground
        if (t === T.Salt) item = 'salt';
        const base = BAL.depositRich[item] ?? BAL.depositRich.iron_ore!;
        out.push({ cx: bx, cy: by, r2: radius * radius, item: itemIdx(item), rich: Math.floor((base * RICH_MULT[ring]) / 1000), onRock: false });
      }
    }
    return out;
  }

  /**
   * Map 4's common deposits round chunk (nx, ny) (D94: space or ore; content `OBSTACLES.ore`): a
   * candidate in each of `cells` × `cells` cells, read for how broken the ground round it is — of 8
   * points on a circle of `near` tiles and 8 on one of `far` (each counting two), how many stand raised (before
   * settling: rock or not does not depend on it), in a chasm or a river, or in water — and taken at
   * `open` ‰ plus `perBroken` ‰ a broken point, at most `max`; in rock, a hidden vein at the same
   * chance. On open ground a thin blob; in broken ground a full one, richer. None by the quartz vein.
   * A pure function of the seeds: kept once read.
   */
  private oreCell(nx: number, ny: number): Blob[] {
    const key = ny * 64 + nx;
    const hit = this.oreCells.get(key);
    if (hit) return hit;
    const O = this.O!.ore, ps = this.playerSeed >>> 0, out: Blob[] = [];
    const size = CHUNK / O.cells;
    const broken = (x: number, y: number): boolean => {
      const c = this.classify(x, y, false), g = (c >> GROUND) & 15;
      // A river on the floor is no broken ground (the big ones cross the open desert); a stream up on a massif stands raised.
      return (c & LV) > 0 || g === T.Chasm || ((c & (FLOOR | SEAF)) === 0 && g !== T.River && ((c >> HEIGHT) & 255) < 52);
    };
    for (let b = 0; b < O.cells; b++) {
      for (let a = 0; a < O.cells; a++) {
        const k = b * O.cells + a;
        const bx = nx * CHUNK + a * size + 3 + (hash32(ps, nx, ny, 180 + k) % (size - 6));
        const by = ny * CHUNK + b * size + 3 + (hash32(ps, nx, ny, 190 + k) % (size - 6));
        const dx = bx - CENTER, dy = by - CENTER, r = isqrt(dx * dx + dy * dy);
        if (r <= this.C.crownOuter + 4 || r > RINGS.far || this.inVeinZone(bx, by, 10)) continue;
        let n = 0;
        for (let q = 0; q < 8; q++) {
          if (broken(bx + ((COS64[q * 8]! * O.near) >> 10), by + ((SIN64[q * 8]! * O.near) >> 10))) n += 2;
          if (broken(bx + ((COS64[q * 8 + 4]! * O.far) >> 10), by + ((SIN64[q * 8 + 4]! * O.far) >> 10))) n += 2;
        }
        // The open sand round the Crown: rare, small deposits; the open desert: fewer (D94).
        const Ds = this.O!.desert, sand = r <= Ds.sand, g = this.rough(bx, by, r);
        const chance = sand ? Ds.sandOre : Math.floor((Math.min(O.max, O.open + O.perBroken * n) * (g < Ds.below ? Ds.ore : 1000)) / 1000), roll = hash32(ps, nx, ny, 200 + k) % 1000;
        const ring = r < RINGS.near ? 'near' : r < RINGS.reaches ? 'reaches' : 'far';
        const rough = !sand && n > O.thin;
        const [r0, rs] = rough ? O.radius : O.thinRadius;
        const radius = (r0 + (hash32(ps, nx, ny, 210 + k) % rs)) / 10;
        const c = this.classify(bx, by, true);
        if ((c & LV) > 0) {
          // A vein hidden in rock: revealed (and minable) once dug out.
          if (roll < chance) {
            const vein = hash32(ps, nx, ny, 220 + k) % 1000 < 375 ? 'copper_ore' : 'iron_ore';
            out.push({ cx: bx, cy: by, r2: radius * radius * 0.6, item: itemIdx(vein), rich: Math.floor((BAL.depositRich[vein]! * RICH_MULT[ring]) / 1000), onRock: true });
          }
          continue;
        }
        if (roll >= chance) continue;
        const t = (c >> GROUND) & 15;
        if (t === T.Shallow || t === T.Deep || t === T.Chasm || t === T.River || t === T.DuneSea || t === T.Vent) continue;
        let item = pickWeighted(hash32(ps, nx, ny, 230 + k));
        if (item === 'salt' && t !== T.Salt) continue; // salt lies on salt flats; the sand is the ground
        if (t === T.Salt) item = 'salt';
        const base = BAL.depositRich[item] ?? BAL.depositRich.iron_ore!;
        const rich = Math.floor((Math.floor((base * RICH_MULT[ring]) / 1000) * (rough ? O.richRough : 1000)) / 1000);
        out.push({ cx: bx, cy: by, r2: radius * radius, item: itemIdx(item), rich, onRock: false });
      }
    }
    this.oreCells.set(key, out);
    return out;
  }

  fill(cx: number, cy: number, terrain: Uint8Array, ore: Uint8Array, rich: Uint16Array, height?: Uint8Array, biome?: Uint8Array, level?: Uint8Array): void {
    const m = this.made(cx, cy);
    terrain.set(m.terrain);
    ore.set(m.ore);
    rich.set(m.rich);
    height?.set(m.height);
    biome?.set(m.biome);
    level?.set(m.level);
    // Map 5's quartz faces (D136): found on the land as made, their ore laid over it (a face lies in one cell).
    const F = this.F, f = F ? this.faceOf(Math.floor(cx / F.cell), Math.floor(cy / F.cell)) : null;
    if (f) {
      const rich0 = BAL.depositRich[F!.item] ?? BAL.depositRich.iron_ore!;
      for (let i = 0; i < f.n; i++) {
        const x = f.x + i * f.dx, y = f.y + i * f.dy;
        if (x >> 5 !== cx || y >> 5 !== cy) continue;
        const k = (y & 31) * CHUNK + (x & 31);
        ore[k] = f.item + 1;
        rich[k] = rich0;
      }
    }
    // Map 6's field of spires (D147): its needles laid over the land as made, rock at their height;
    // the plain floor of its ground with no biome code of its own marked badlands.
    const sp = this.spf ? this.spireChunk(cx, cy) : null;
    if (sp) {
      const rock = T.Rock1 + this.spf!.S.hardness - 1;
      for (let k = 0; k < CHUNK * CHUNK; k++) {
        const L = sp[k]!;
        if (!L) continue;
        if (L === SPIRE_GROUND) {
          const t = terrain[k]!;
          if (biome && biome[k] === BIOME.none && m.level[k] === 0 && (t === T.Sand || t === T.Hardpan || t === T.Salt)) biome[k] = BIOME.spireGround;
          continue;
        }
        terrain[k] = rock;
        ore[k] = 0;
        rich[k] = 0;
        if (level) level[k] = L;
        if (height) height[k] = clamp255(SHADE.rock + SHADE.perLevel * L);
        if (biome) biome[k] = BIOME.spire;
      }
    }
  }

  /** A chunk as `make` gives it (map 5's faces and map 6's spires not laid on it yet), kept for the land (`MADE`). */
  private made(cx: number, cy: number): { terrain: Uint8Array; ore: Uint8Array; rich: Uint16Array; height: Uint8Array; biome: Uint8Array; level: Uint8Array } {
    const key = `${this.worldSeed}:${this.playerSeed >>> 0}:${this.mapV}:${cx}:${cy}`;
    let m = MADE.get(key);
    if (!m) {
      const n = CHUNK * CHUNK;
      m = { terrain: new Uint8Array(n), ore: new Uint8Array(n), rich: new Uint16Array(n), height: new Uint8Array(n), biome: new Uint8Array(n), level: new Uint8Array(n) };
      this.make(cx, cy, m.terrain, m.ore, m.rich, m.height, m.biome, m.level);
      if (MADE.size >= MADE_KEPT) MADE.delete(MADE.keys().next().value!);
      MADE.set(key, m);
    }
    return m;
  }

  /**
   * The quartz faces (map 5, D136) meeting the tile rect [x0, x1) × [y0, y1), wedge by wedge (each
   * wedge's cells are read to find its face; none on maps 1–4).
   */
  facesIn(x0: number, y0: number, x1: number, y1: number): VeinSite[] {
    const F = this.F, out: VeinSite[] = [];
    for (let k = 0; F && k < F.sectors; k++) {
      const f = this.sectorFace(k)?.face;
      if (f && f.x + (f.n - 1) * f.dx >= x0 && f.x < x1 && f.y + (f.n - 1) * f.dy >= y0 && f.y < y1) out.push(f);
    }
    return out;
  }

  /** Cell (a, b)'s quartz face (map 5, D136): its wedge's, when the wedge took it from this cell; else null. */
  private faceOf(a: number, b: number): VeinSite | null {
    const k = this.sectorOf(a, b), f = k >= 0 ? this.sectorFace(k) : null;
    return f && f.cell === b * 1024 + a ? f.face : null;
  }

  /** The wedge round the cirque (0 … `sectors` − 1, by bearing from the east, clockwise) of a cell within reach of the faces' ring; −1 out of it. */
  private sectorOf(a: number, b: number): number {
    const F = this.F!, S = F.cell * CHUNK, dx = a * S + (S >> 1) - CENTER, dy = b * S + (S >> 1) - CENTER;
    const mid = isqrt(dx * dx + dy * dy), reach = isqrt(2 * (S >> 1) * (S >> 1)) + 1;
    if (mid + reach < F.from || mid - reach > F.to) return -1;
    return Math.floor((((headingOf(dx, dy) + Math.floor(32 / F.sectors)) & 63) * F.sectors) / 64);
  }

  /**
   * Wedge `k`'s quartz face (map 5, D136), or null: at its `chance`, the wall (`wallIn`) of the first
   * of its cells, in the land's order (a hash of the cell), that has one; with the cell it took it
   * from. Its cells' chunks are made to look (a wedge holds a few dozen cells; the first with broken
   * ground mostly has one). Kept once found.
   */
  private sectorFace(k: number): { cell: number; face: VeinSite } | null {
    const kept = this.sectorFaces.get(k);
    if (kept !== undefined) return kept;
    const F = this.F!, S = F.cell * CHUNK, n = WORLD / S, ps = this.playerSeed >>> 0;
    let found: { cell: number; face: VeinSite } | null = null;
    if (hash32(ps, k, 302) % 1000 < F.chance) {
      const cells: Array<[number, number, number]> = [];
      for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) if (this.sectorOf(a, b) === k) cells.push([hash32(ps, a, b, 300), a, b]);
      cells.sort((p, q) => p[0] - q[0] || p[2] - q[2] || p[1] - q[1]);
      for (const [, a, b] of cells) {
        const face = this.wallIn(a, b);
        if (face) { found = { cell: b * 1024 + a, face }; break; }
      }
    }
    this.sectorFaces.set(k, found);
    return found;
  }

  /**
   * Cell (a, b)'s wall for a quartz face (map 5, D136; content `QUARTZ_FACES`), or null: where some
   * of the cell is broken ground, the longest straight wall in it looking east or south whose every
   * tile is rock above `apron` tiles of floor at one level (a face cutter's footprint and its outlet),
   * past the open sand and the first rings; its `length`, the land's draw, in its middle. Read off the
   * cell's chunks as made (`made`): a pure function of the seeds, kept once found.
   */
  private wallIn(a: number, b: number): VeinSite | null {
    const F = this.F!, key = b * 1024 + a;
    const kept = this.faceCells.get(key);
    if (kept !== undefined) return kept;
    const S = F.cell * CHUNK, x0 = a * S, y0 = b * S, ps = this.playerSeed >>> 0;
    const far = (x: number, y: number): number => isqrt((x - CENTER) * (x - CENTER) + (y - CENTER) * (y - CENTER));
    // Broken ground somewhere in it: its middle or a quarter point past the open desert's roughness.
    const QP = [[2, 2], [1, 1], [3, 1], [1, 3], [3, 3]] as const;
    const broken = QP.some(([i, j]) => { const x = x0 + ((i * S) >> 2), y = y0 + ((j * S) >> 2); return this.rough(x, y, far(x, y)) >= this.O!.desert.below; });
    let face: VeinSite | null = null;
    if (broken) {
      const lv = (x: number, y: number): number => this.made(x >> 5, y >> 5).level[(y & 31) * CHUNK + (x & 31)]!;
      const tr = (x: number, y: number): number => this.made(x >> 5, y >> 5).terrain[(y & 31) * CHUNK + (x & 31)]!;
      // A wall tile looking (fx, fy): rock above `apron` tiles of floor at one level (that level), else −1.
      const foot = (x: number, y: number, fx: number, fy: number): number => {
        const d = far(x, y), t = tr(x, y);
        if (d < F.from || d > F.to || t < T.Rock1 || t > T.Rock4 || ringOf(parcelAt(x, y)) < F.ring) return -1;
        const L = lv(x + fx, y + fy);
        if (L >= lv(x, y)) return -1;
        for (let k = 1; k <= F.apron; k++) {
          const u = x + k * fx, v = y + k * fy, g = tr(u, v);
          if (!isFloor(g) || g === T.Vent || lv(u, v) !== L) return -1;
        }
        return L;
      };
      // The face and its floor within [lo, hi) of the cell: `w` across the wall (its floor at w + 1…),
      // `s` along it; looking east the wall runs down a column, looking south along a row.
      const lo = F.margin, hi = S - F.margin;
      let best: { x: number; y: number; dx: number; dy: number; n: number; look: 1 | 2 } | null = null;
      for (const look of [1, 2] as const) {
        const fx = look === 1 ? 1 : 0, fy = 1 - fx;
        for (let w = lo; w < hi - F.apron; w++) {
          let start = -1, L0 = -1;
          for (let s = lo; s <= hi; s++) {
            // One past the end closes the last run; a run is one floor level all along.
            const L = s < hi ? foot(x0 + (fx ? w : s), y0 + (fx ? s : w), fx, fy) : -1;
            if (L >= 0 && start >= 0 && L === L0) continue;
            if (start >= 0 && s - start >= F.length[0] && (!best || s - start > best.n)) {
              best = { x: x0 + (fx ? w : start), y: y0 + (fx ? start : w), dx: fy, dy: fx, n: s - start, look };
            }
            start = L >= 0 ? s : -1;
            L0 = L;
          }
        }
      }
      if (best) {
        const n = Math.min(best.n, F.length[0] + (hash32(ps, a, b, 301) % (F.length[1] - F.length[0] + 1))), k = (best.n - n) >> 1;
        face = { x: best.x + k * best.dx, y: best.y + k * best.dy, dx: best.dx, dy: best.dy, n, look: best.look, item: itemIdx(F.item) };
      }
    }
    this.faceCells.set(key, face);
    return face;
  }

  /**
   * The spire field at a tile (map 6, D147): −1 off its ground (out of its wedge, its radii or its
   * rings); else its flags (`SP_GROUND`: its badlands; `SP_LANE`: in a lane) and, inside its outline
   * and off the lanes, its body (0 … 255, `<< 16`) and its height (‰, the low bits).
   * - Its outline: how far in from the ground's nearest edge the tile lies (its wedge's sides, its
   *   radii, its rings' square), less `outline.inset`, plus a wobble of the land's noise (± `wobble`
   *   tiles), less its bays (a slower noise, up to `bays.depth` tiles in): ragged, with bays and
   *   outlying clusters, never along the wedge's straight edges. Its body thickens
   *   from there to whole `outline.body` tiles in; its badlands reach `outline.ground` tiles out.
   * - Its height: the body times the crests' (one round the cirque at its radius, wandering with the
   *   noise along the arc, a branch maybe): whole `top` tiles either side of a crest's line, `flank` ‰ `width` tiles off it,
   *   `low` ‰ `far` tiles farther; along a crest the noise lowers it into saddles (by `saddle` ‰ of
   *   its rise above the flanks) between its summits.
   */
  private spireElev(x: number, y: number): number {
    const F = this.spf!;
    if (x < F.bx0 || x > F.bx1 || y < F.by0 || y > F.by1) return -1;
    const S = F.S, dx = x - CENTER, dy = y - CENTER;
    // Along its middle and across it (×1024 tiles; across: clockwise of the middle positive).
    const U = dx * F.ux + dy * F.uy, V = dy * F.ux - dx * F.uy, AV = Math.abs(V);
    if (U <= 0 || AV * F.cs > U * F.sn) return -1;
    const r2 = dx * dx + dy * dy, [r0, r1] = S.r;
    if (r2 < r0 * r0 || r2 > r1 * r1) return -1;
    const ring = ringOf(parcelAt(x, y));
    if (ring < S.rings[0] || ring > S.rings[1]) return -1;
    // The outline (×1024 tiles): in from the nearest edge, less the inset, plus the wobble.
    const O = S.outline, r = isqrt(r2), c = Math.max(Math.abs(dx), Math.abs(dy));
    const inward = Math.min(1024 * Math.min(r - r0, r1 - r, c - F.c0, F.c1 - c), Math.floor((U * F.sn - AV * F.cs) / 1024));
    const bay = Math.max(0, qfbm(F.oN, x + 7777, y - 3333, O.bays.scale, 2) - 128) * O.bays.depth * 8;
    const mask = inward - 1024 * O.inset + (qfbm(F.oN, x, y, O.scale, O.octaves) - 128) * O.wobble * 8 - bay;
    const flags = mask >= -1024 * O.ground ? SP_GROUND : 0;
    // A lane: its line `s` ‰ of the half width across, meandering by the noise read along it.
    const L = S.lanes;
    for (let k = 0; k < F.lanes.length; k++) {
      const m = (qfbm(F.lN, U >> 10, 1000 * k + 500, L.scale, 2) - 128) * L.meander * 8;
      const VL = Math.floor((F.lanes[k]! * U * F.sn) / (1000 * F.cs)) + m;
      if (4 * Math.abs(V - VL) <= L.half * 1024) return flags | SP_LANE;
    }
    if (mask <= 0) return flags;
    const body = Math.max(1, Math.min(255, Math.floor((mask * 255) / (1024 * O.body))));
    // The crests (quarter tiles): the main one's radius here, wandering; the branch's off it.
    const CR = S.crests, rq = isqrt(16 * r2), vt = V >> 10, Bc = F.branch;
    const main = F.crest + (((qfbm(F.cN, vt, 300, CR.scale, 2) - 128) * CR.meander * 4) >> 7);
    let d = Math.abs(rq - main);
    if (Bc) {
      const t = Bc.side * (V - Bc.v);
      if (t >= 0) d = Math.min(d, Math.abs(rq - main - Math.floor((Bc.out * Bc.off * Math.min(t, 1024 * Bc.run)) / (1024 * Bc.run))));
    }
    const t = 4 * CR.top, w = 4 * CR.width;
    let crest = d <= t ? 1000 : d <= w ? 1000 - Math.floor(((1000 - CR.flank) * (d - t)) / (w - t)) : CR.flank - Math.floor(((CR.flank - CR.low) * Math.min(d - w, 4 * CR.far)) / (4 * CR.far));
    if (crest > CR.flank) crest = CR.flank + Math.floor(((crest - CR.flank) * (1000 - Math.floor((CR.saddle * qfbm(F.cN, vt, 900, CR.peaks, 2)) / 255))) / 1000);
    return flags | (body << 16) | Math.floor((body * crest) / 255);
  }

  /**
   * May a needle of the spire field stand on tile (x, y) (map 6, D147)? The land as made (`made`)
   * plain floor there at level 0 with no ore, `clear` tiles off a clearing, the quartz vein's ground
   * and a corridor to a site.
   */
  private spireFits(x: number, y: number): boolean {
    const m = this.made(x >> 5, y >> 5), k = (y & 31) * CHUNK + (x & 31), t = m.terrain[k]!;
    if (m.level[k] !== 0 || m.ore[k] !== 0 || !isFloor(t) || t === T.Vent) return false;
    const c = this.spf!.S.clear;
    for (const d of this.keep) {
      const r = d.r + c;
      if ((x - d.cx) * (x - d.cx) + (y - d.cy) * (y - d.cy) < r * r) return false;
    }
    return !this.inVeinZone(x, y, c) && !this.lines.near(x, y, LineKind.Corridor, 4 * c);
  }

  /**
   * Square (a, b)'s candidate needle (map 6, D147; `cell` × `cell` tiles from (cell·a, cell·b)), or
   * null: at a tile of it the hash picks, inside the field's outline and off its lanes, at its
   * `density` there (by its body: whole from `dense` in), where it fits; its height by the field's
   * there ± the hash's jitter; a twin at its `twin` ‰ there (by its body too), its shoulder on the
   * tile east or south (where that fits too) `shoulder` levels lower. Kept once found.
   */
  private spireCand(a: number, b: number): Spire | null {
    const key = b * 1024 + a, kept = this.spireCands.get(key);
    if (kept !== undefined) return kept;
    const S = this.spf!.S, C = S.cell, ps = this.playerSeed >>> 0, h = hash32(ps, a, b, 340);
    const x = a * C + (h % C), y = b * C + ((h >>> 8) % C), v = this.spireElev(x, y), body = v < 0 || v & SP_LANE ? 0 : (v >> 16) & 255;
    let sp: Spire | null = null;
    const [d0, d1] = S.density, [L0, L1] = S.levels;
    if (body > 0 && (h >>> 16) % 1000 < d0 + Math.floor(((d1 - d0) * Math.min(body, S.dense)) / S.dense) && this.spireFits(x, y)) {
      const g = hash32(ps, a, b, 341), J = S.jitter;
      // ± J levels, the middle likelier (the sum of two draws).
      const jit = (g % (J + 1)) + ((g >>> 4) % (J + 1)) - J;
      const lv = Math.max(L0, Math.min(L1, L0 + Math.floor(((L1 - L0) * (v & 0xffff) + 500) / 1000) + jit));
      let x1 = x, y1 = y, lv2 = 0;
      const [t0, t1] = S.twin;
      if (lv > L0 && (g >>> 8) % 1000 < t0 + Math.floor(((t1 - t0) * body) / 255)) {
        const east = (g >>> 20) & 1, tx = x + east, ty = y + 1 - east, w = this.spireElev(tx, ty);
        if (w >= 0 && !(w & SP_LANE) && (w >> 16) & 255 && this.spireFits(tx, ty)) {
          x1 = tx; y1 = ty;
          lv2 = Math.max(L0, lv - S.shoulder[0] - ((g >>> 21) % (S.shoulder[1] - S.shoulder[0] + 1)));
        }
      }
      sp = { x0: x, y0: y, x1, y1, lv, lv2, sh: body, pri: hash32(ps, a, b, 342), key };
    }
    this.spireCands.set(key, sp);
    return sp;
  }

  /**
   * Are two needles too close (map 6, D147), footprint to footprint: beside each other (sharing a
   * side, or overlapping), or at a corner unless both stand where the field's body is `touch` or
   * more? Two needles never stand side by side; in the fringe a floor tile at least between them.
   */
  private spireClash(s: Spire, o: Spire): boolean {
    const gx = Math.max(o.x0 - s.x1, s.x0 - o.x1), gy = Math.max(o.y0 - s.y1, s.y0 - o.y1), touch = this.spf!.S.touch;
    return gx <= 1 && gy <= 1 && !(gx === 1 && gy === 1 && s.sh >= touch && o.sh >= touch);
  }

  /** Does needle `o` come before needle `s` (its priority, then its square's key: a total order)? */
  private static before(o: Spire, s: Spire): boolean {
    return o.pri > s.pri || (o.pri === s.pri && o.key > s.key);
  }

  /** Square (a, b)'s needle in the first round (map 6, D147): no needle too close to it comes before it. */
  private spireFirst(a: number, b: number): boolean {
    const key = b * 1024 + a, k = this.spireRounds.get(key) ?? 0;
    if (k & 1) return (k & 2) !== 0;
    const s = this.spireCand(a, b);
    let up = !!s;
    for (let j = -1; j <= 1 && up; j++) for (let i = -1; i <= 1 && up; i++) {
      const o = i || j ? this.spireCand(a + i, b + j) : null;
      if (o && this.spireClash(s!, o) && MapGen.before(o, s!)) up = false;
    }
    this.spireRounds.set(key, this.spireRounds.get(key)! | 1 | (up ? 2 : 0));
    return up;
  }

  /** Is square (a, b)'s needle out after the first round (map 6, D147): one too close to it stands from it? */
  private spireBlocked(a: number, b: number): boolean {
    const key = b * 1024 + a, k = this.spireRounds.get(key) ?? 0;
    if (k & 4) return (k & 8) !== 0;
    const s = this.spireCand(a, b);
    let out = false;
    for (let j = -1; j <= 1 && !out && s; j++) for (let i = -1; i <= 1 && !out; i++) {
      const o = i || j ? this.spireCand(a + i, b + j) : null;
      if (o && this.spireClash(s, o) && this.spireFirst(a + i, b + j)) out = true;
    }
    this.spireRounds.set(key, (this.spireRounds.get(key) ?? 0) | 4 | (out ? 8 : 0));
    return out;
  }

  /**
   * Does square (a, b)'s needle `s` stand (map 6, D147)? Two rounds of the same rule among the squares
   * round it (none farther can come too close: a needle keeps to its square and the tile past it):
   * it stands if no needle too close to it comes before it; else, unless one of those stands, if none
   * of the needles left too close to it (neither standing nor out after the first round) comes before
   * it. No two needles standing are too close (`spireClash`), and the answer is read off the squares
   * within three of it: the same whichever chunk is made first.
   */
  private spireStands(s: Spire, a: number, b: number): boolean {
    if (this.spireFirst(a, b)) return true;
    if (this.spireBlocked(a, b)) return false;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const o = i || j ? this.spireCand(a + i, b + j) : null;
      if (o && this.spireClash(s, o) && MapGen.before(o, s) && !this.spireFirst(a + i, b + j) && !this.spireBlocked(a + i, b + j)) return false;
    }
    return true;
  }

  /**
   * Chunk (cx, cy)'s spire map (map 6, D147): a needle's tile its level, a tile of the field's ground
   * `SPIRE_GROUND`, 0 off it; null where the field has no ground. Kept once found.
   */
  private spireChunk(cx: number, cy: number): Uint8Array | null {
    const key = cy * 64 + cx, kept = this.spireChunks.get(key);
    if (kept !== undefined) return kept;
    const F = this.spf!, C = F.S.cell, x0 = cx * CHUNK, y0 = cy * CHUNK;
    let out: Uint8Array | null = null;
    if (x0 + CHUNK > F.bx0 && x0 <= F.bx1 && y0 + CHUNK > F.by0 && y0 <= F.by1) {
      // Its badlands, lanes and all: its ground within `outline.ground` of its outline.
      for (let y = Math.max(y0, F.by0); y < Math.min(y0 + CHUNK, F.by1 + 1); y++) for (let x = Math.max(x0, F.bx0); x < Math.min(x0 + CHUNK, F.bx1 + 1); x++) {
        const v = this.spireElev(x, y);
        if (v < 0 || !(v & SP_GROUND)) continue;
        out ??= new Uint8Array(CHUNK * CHUNK);
        out[(y - y0) * CHUNK + (x - x0)] = SPIRE_GROUND;
      }
      // The squares whose needle may reach into the chunk: a needle lies in its square or a tile past it.
      const a0 = Math.floor((x0 - C) / C), a1 = Math.floor((x0 + CHUNK - 1) / C), b0 = Math.floor((y0 - C) / C), b1 = Math.floor((y0 + CHUNK - 1) / C);
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
        const s = this.spireCand(a, b);
        if (!s || !this.spireStands(s, a, b)) continue;
        for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) {
          if (x < x0 || y < y0 || x >= x0 + CHUNK || y >= y0 + CHUNK) continue;
          out ??= new Uint8Array(CHUNK * CHUNK);
          out[(y - y0) * CHUNK + (x - x0)] = x === s.x0 && y === s.y0 ? s.lv : s.lv2;
        }
      }
    }
    this.spireChunks.set(key, out);
    return out;
  }

  /** A needle's level at a tile (map 6, D147), 0 off them (and on maps 1–5): its chunk's needles, read once. */
  private spireAt(x: number, y: number): number {
    const F = this.spf;
    if (!F || x < F.bx0 || x > F.bx1 || y < F.by0 || y > F.by1) return 0;
    const v = this.spireChunk(x >> 5, y >> 5)?.[(y & 31) * CHUNK + (x & 31)] ?? 0;
    return v === SPIRE_GROUND ? 0 : v;
  }

  /** The needles of the spire field (map 6, D147) on the tile rect [x0, x1) × [y0, y1): each tile and its level, row by row; none on maps 1–5. */
  spiresIn(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number; level: number }> {
    const F = this.spf, out: Array<{ x: number; y: number; level: number }> = [];
    if (!F) return out;
    const ax = Math.max(x0, F.bx0), ay = Math.max(y0, F.by0), bx = Math.min(x1 - 1, F.bx1), by = Math.min(y1 - 1, F.by1);
    for (let cy = ay >> 5; ay <= by && cy <= by >> 5; cy++) for (let cx = ax >> 5; ax <= bx && cx <= bx >> 5; cx++) {
      const sp = this.spireChunk(cx, cy);
      if (!sp) continue;
      for (let k = 0; k < CHUNK * CHUNK; k++) {
        const x = cx * CHUNK + (k & 31), y = cy * CHUNK + (k >> 5);
        if (sp[k] && sp[k] !== SPIRE_GROUND && x >= ax && x <= bx && y >= ay && y <= by) out.push({ x, y, level: sp[k]! });
      }
    }
    return out.sort((p, q) => p.y - q.y || p.x - q.x);
  }

  /** One chunk as the land makes it (`fill`'s, which keeps it). */
  private make(cx: number, cy: number, terrain: Uint8Array, ore: Uint8Array, rich: Uint16Array, height: Uint8Array, biome: Uint8Array, level: Uint8Array): void {
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    // The chunk and a border of REACH tiles (map 4: REACH4): settling a tile reads that far, so the
    // chunk's own levels come out exactly as `levelAt` gives them, whatever the neighbouring chunks hold.
    const RR = this.O ? REACH4 : REACH;
    const W = CHUNK + 2 * RR, wx = x0 - RR, wy = y0 - RR;
    const cls = new Int32Array(W * W), lv = new Uint8Array(W * W), fl = this.O ? new Uint8Array(W * W) : null;
    let steep = false;
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const inner = i >= RR && j >= RR && i < RR + CHUNK && j < RR + CHUNK;
        const c = this.classify(wx + i, wy + j, inner);
        cls[j * W + i] = c;
        lv[j * W + i] = c & LV;
        if (fl) fl[j * W + i] = flagsOf(c);
        if ((c & LV) > 1) steep = true;
      }
    }
    if (steep) { if (fl) settle4(lv, fl, W, wx, wy); else settle(lv, W, wx, wy); }
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const w = (ly + RR) * W + lx + RR, k = ly * CHUNK + lx;
        const c = cls[w]!, L = lv[w]!;
        const x = x0 + lx, y = y0 + ly;
        terrain[k] = L > 0 && !(c & WET) ? this.rockOf(c, L, x, y) : (c >> GROUND) & 15;
        if (level) level[k] = L;
        if (height) {
          // Shading height: rock by its level, the floor low, the land outside by its height field.
          const base = L > 0 ? SHADE.rock + SHADE.perLevel * L : c & FLOOR ? SHADE.floor : (c >> HEIGHT) & 255;
          height[k] = clamp255(base + this.jitter(x * 3, y * 3, SHADE.jitter));
        }
        if (biome) {
          // A river's tile its way first (the Crown's spring runs on the floor and the terraces, D115).
          let b: number = ((c >> GROUND) & 15) === T.River ? BIOME.river + ((c >> FLOW) & 7) : c & FLOOR ? BIOME.cirque : c & CROWN ? BIOME.crown : c & SEAF ? BIOME.sea : BIOME.none;
          for (const s of this.sites) {
            if ((x - s.cx) * (x - s.cx) + (y - s.cy) * (y - s.cy) <= s.r * s.r) b = UNIQUE_BIOMES[s.id].code;
          }
          biome[k] = b;
        }
      }
    }
    // Deposits.
    const OB = this.oreBlock;
    for (const b of this.blobsNear(cx, cy)) {
      if (OB > 1) {
        // In whole blocks (D104): a block lies in one chunk (CHUNK is a multiple of OB), and is
        // ore only where every tile of it takes ore — never part of a block.
        const tl = (b.tiles ??= blocksOf(b, OB, (x, y) => takesOre(b.onRock, this.groundAt(x, y)))), per = 3 * OB * OB;
        for (let q = 0; q < tl.length; q += per) {
          if (tl[q]! < x0 || tl[q + 1]! < y0 || tl[q]! >= x0 + CHUNK || tl[q + 1]! >= y0 + CHUNK) continue;
          let all = true;
          for (let t = q; t < q + per && all; t += 3) all = takesOre(b.onRock, terrain[(tl[t + 1]! - y0) * CHUNK + tl[t]! - x0]!);
          if (!all) continue;
          for (let t = q; t < q + per; t += 3) {
            const k = (tl[t + 1]! - y0) * CHUNK + tl[t]! - x0;
            ore[k] = b.item + 1;
            rich[k] = tl[t + 2]!;
          }
        }
        continue;
      }
      const rr = isqrt(Math.ceil(b.r2)) + 1;
      for (let y = Math.max(y0, b.cy - rr); y <= Math.min(y0 + CHUNK - 1, b.cy + rr); y++) {
        for (let x = Math.max(x0, b.cx - rr); x <= Math.min(x0 + CHUNK - 1, b.cx + rr); x++) {
          const d2 = (x - b.cx) * (x - b.cx) + (y - b.cy) * (y - b.cy);
          if (d2 > b.r2) continue;
          const k = (y - y0) * CHUNK + (x - x0);
          if (!takesOre(b.onRock, terrain[k]!)) continue;
          ore[k] = b.item + 1;
          // Richer at the heart of a blob, thinner at its rim.
          rich[k] = d2 * 3 <= b.r2 ? b.rich : Math.floor((b.rich * 700) / 1000);
        }
      }
    }
    // The quartz vein's face (D87): its ore on the face's rock, at the face ore's cap (last: it
    // wins over a hidden vein there).
    const V = this.quartzVein;
    if (V) {
      const rich0 = BAL.depositRich[this.bluff!.Q.item] ?? BAL.depositRich.iron_ore!;
      for (let i = 0; i < V.n; i++) {
        const x = V.x + i * V.dx, y = V.y + i * V.dy;
        if (x < x0 || y < y0 || x >= x0 + CHUNK || y >= y0 + CHUNK) continue;
        const k = (y - y0) * CHUNK + (x - x0), t = terrain[k]!;
        if (t < T.Rock1 || t > T.Rock4) continue;
        ore[k] = V.item + 1;
        rich[k] = rich0;
      }
    }
  }
}

/** The way across a bearing (dx, dy) from the Heart, to the nearest eighth of a turn: each of x, y −1, 0 or 1. */
export function across(dx: number, dy: number): [number, number] {
  const tx = -dy, ty = dx, ax = Math.abs(tx), ay = Math.abs(ty);
  return [5 * ax >= 2 * ay ? Math.sign(tx) : 0, 5 * ay >= 2 * ax ? Math.sign(ty) : 0];
}

/** Does a tile of this ground take a deposit's ore: a vein's (`onRock`) rock, sand or hardpan; else open ground, not water, dunes, a vent or a gap. */
function takesOre(onRock: boolean, t: number): boolean {
  const rock = t >= T.Rock1 && t <= T.Rock4;
  if (onRock) return rock || t === T.Sand || t === T.Hardpan;
  return !rock && t !== T.Shallow && t !== T.Deep && t !== T.DuneSea && t !== T.Vent && t !== T.Chasm && t !== T.River;
}

/**
 * A deposit's disc in whole `B` × `B` blocks on the world's grid (map 4, D104; owner, 2026-10-17:
 * « les ressources disponibles ne sont pas des multiples de la taille des machines qui les
 * extraient » — and then: « it's not the point, it still has to look natural »): as many blocks as
 * the disc holds tiles (rounded, at least one), so drills cover it with none left over, grown as one
 * irregular patch rather than a square. From the block nearest its centre (taken at its tile's
 * corner; doubled offsets, squared; then y, x) it takes, one at a time, the block beside the patch
 * whose distance plus a hashed wobble (`WOBBLE`, from `salt` and the block's offset from the centre,
 * so a shifted deposit keeps its shape) is least: a blob that bulges and notches, its size and place
 * the disc's. A block one of whose tiles takes no ore (`fits`) is passed over, so a deposit in
 * broken ground keeps its size where it can. Its richness is the disc's to the unit (`rich` within
 * a third of its radius², 70 % past it), spread over its blocks — those whose middle lies in that
 * heart weighing 1000, the rest 700 —, a block's tiles alike (the units the rounding leaves go one
 * a tile, from the first block on); a patch that found fewer blocks than it should keeps their share
 * only. Flat, block after block, row by row: x, y and richness of each tile.
 */
export function blocksOf(b: { cx: number; cy: number; r2: number; rich: number; salt?: number }, B: number, fits: (x: number, y: number) => boolean = () => true): number[] {
  const rr = isqrt(Math.ceil(b.r2)) + 1, rim = Math.floor((b.rich * 700) / 1000), BB = B * B;
  let n = 0, total = 0;
  for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 > b.r2) continue;
    n++;
    total += d2 * 3 <= b.r2 ? b.rich : rim;
  }
  const m = Math.max(1, Math.floor((2 * n + BB) / (2 * BB)));
  const salt = b.salt ?? hash32(b.cx, b.cy, 0x104);
  // The blocks in reach: their distance (doubled offsets, squared) and its wobble; whether they
  // fit is read only for those the patch looks at (the ground costs a classify a tile).
  type Cand = { D: number; cost: number; bx: number; by: number; ok?: boolean };
  const cand = new Map<number, Cand>();
  const lo = (v: number): number => Math.floor((v - rr - 2 * B) / B) * B;
  for (let by = lo(b.cy); by <= b.cy + rr + 2 * B; by += B) for (let bx = lo(b.cx); bx <= b.cx + rr + 2 * B; bx += B) {
    const ex = 2 * bx + B - 2 * b.cx, ey = 2 * by + B - 2 * b.cy, D = ex * ex + ey * ey;
    cand.set(by * 2048 + bx, { D, cost: D + (hash32(salt, ex + 512, ey + 512) % WOBBLE), bx, by });
  }
  const fit = (c: Cand): boolean => {
    if (c.ok === undefined) {
      c.ok = true;
      for (let j = 0; j < B && c.ok; j++) for (let k = 0; k < B && c.ok; k++) c.ok = fits(c.bx + k, c.by + j);
    }
    return c.ok;
  };
  const before = (p: { by: number; bx: number }, q: { by: number; bx: number }): boolean => p.by < q.by || (p.by === q.by && p.bx < q.bx);
  const first = [...cand.values()].sort((p, q) => p.D - q.D || (before(p, q) ? -1 : before(q, p) ? 1 : 0)).find(fit) ?? null;
  const pick: Array<{ D: number; bx: number; by: number }> = [];
  if (first) {
    const taken = new Set<number>([first.by * 2048 + first.bx]);
    pick.push(first);
    while (pick.length < m) {
      let best: Cand | null = null;
      for (const p of pick) {
        for (const [dx, dy] of [[B, 0], [-B, 0], [0, B], [0, -B]] as const) {
          const k = (p.by + dy) * 2048 + p.bx + dx, c = cand.get(k);
          if (!c || taken.has(k) || !fit(c)) continue;
          if (!best || c.cost < best.cost || (c.cost === best.cost && before(c, best))) best = c;
        }
      }
      if (!best) break;
      taken.add(best.by * 2048 + best.bx);
      pick.push(best);
    }
  }
  const got = pick.length === m ? total : Math.floor((total * pick.length) / m);
  const weight = pick.map(({ D }) => (3 * D <= 4 * b.r2 ? 1000 : 700));
  const W = weight.reduce((a, w) => a + w, 0);
  const each = weight.map((w) => Math.floor((got * w) / (BB * W)));
  let rest = got - BB * each.reduce((a, v) => a + v, 0);
  const out: number[] = [];
  pick.forEach(({ bx, by }, i) => {
    for (let j = 0; j < B; j++) for (let k = 0; k < B; k++) {
      const extra = rest > 0 ? 1 : 0;
      rest -= extra;
      out.push(bx + k, by + j, each[i]! + extra);
    }
  });
  return out;
}

/**
 * Evens out the slopes of a window of raw levels, in place (`w` × `w` tiles, its top-left at
 * world (ox, oy)): each tile comes down until it stands at most one level above each neighbour —
 * two above its east neighbour when both lie past `MOUNTAINS.cliffFrom` (an east-facing cliff).
 * That is the highest land under the raw one keeping those steps: tile p ends at min over q of
 * raw(q) + cost(q → p), each step costing 1, or 2 for a westward step out there. A step costs 1
 * or more and levels are at most MOUNTAIN_LEVEL, so a tile only feels the tiles within REACH steps:
 * those that far inside the window come out exact. Levels 0 and 1 never move (nothing is below
 * 0), so what is rock and where the floor ends do not change.
 */
function settle(lv: Uint8Array, w: number, ox: number, oy: number): void {
  const c2 = MOUNTAINS.cliffFrom * MOUNTAINS.cliffFrom;
  // Bellman–Ford in sweeps: after n sweeps every path of n steps has been tried; REACH are enough.
  for (let sweep = 0; sweep < REACH; sweep++) {
    let moved = false;
    for (let j = 0; j < w; j++) {
      const dy = oy + j - CENTER;
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        let v = lv[k]!;
        if (v <= 1) continue;
        if (i > 0 && lv[k - 1]! + 1 < v) v = lv[k - 1]! + 1;
        if (j > 0 && lv[k - w]! + 1 < v) v = lv[k - w]! + 1;
        if (j < w - 1 && lv[k + w]! + 1 < v) v = lv[k + w]! + 1;
        if (i < w - 1) {
          const dx = ox + i - CENTER;
          const cliff = dx * dx + dy * dy >= c2 && (dx + 1) * (dx + 1) + dy * dy >= c2;
          const e = lv[k + 1]! + (cliff ? 2 : 1);
          if (e < v) v = e;
        }
        if (v !== lv[k]) { lv[k] = v; moved = true; }
      }
    }
    if (!moved) return;
  }
}

/** `settle4`'s flags of a packed tile: a massif's cliff, or its ramp (0: the rest, which settles as on maps 1–3). */
const flagsOf = (c: number): number => (c & FIXED ? F_FIXED : c & MASSIF ? (c & RAMP ? F_RAMP : F_CLIFF) : 0);

/**
 * Map 4's settling (D94), in place, on half levels: as `settle`, each tile coming down until it
 * stands at most one level above each neighbour (two above its east neighbour past
 * `MOUNTAINS.cliffFrom`) — but a massif's cliff (`F_CLIFF`) never comes down, and a massif's ramp
 * (`F_RAMP`) comes down to half a level above each neighbour, so a ramp climbs a level every two
 * tiles: terraces two deep, room for an elevator and its flat tile (D65). Nothing raised comes
 * below level 1, so what is rock does not change. A path of `REACH4` steps at most can lower a
 * tile, so as many sweeps are enough and the tiles that far inside the window come out exact.
 */
function settle4(lv: Uint8Array, flags: Uint8Array, w: number, ox: number, oy: number): void {
  const c2 = MOUNTAINS.cliffFrom * MOUNTAINS.cliffFrom, n = lv.length;
  const hl = new Uint8Array(n);
  for (let k = 0; k < n; k++) hl[k] = lv[k]! * 2;
  // A lone spike of massif (a cliff tile with fewer than two massif tiles beside it: a chimney three
  // levels tall at a massif's ragged edge) settles as the mountains do. Off the window counts as
  // massif; such a tile lies REACH4 from the tiles the window is for, past where its level reaches.
  const fl = flags.slice();
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (flags[k] !== F_CLIFF) continue;
    const m = (a: number, b: number, kk: number): number => (a < 0 || b < 0 || a >= w || b >= w || flags[kk]! ? 1 : 0);
    if (m(i - 1, j, k - 1) + m(i + 1, j, k + 1) + m(i, j - 1, k - w) + m(i, j + 1, k + w) < 2) fl[k] = 0;
  }
  for (let sweep = 0; sweep < REACH4; sweep++) {
    let moved = false;
    for (let j = 0; j < w; j++) {
      const dy = oy + j - CENTER;
      for (let i = 0; i < w; i++) {
        const k = j * w + i, f = fl[k]!;
        let v = hl[k]!;
        if (v <= 2 || f === F_CLIFF || f === F_FIXED) continue;
        const K = f === F_RAMP ? 1 : 2;
        if (i > 0 && hl[k - 1]! + K < v) v = hl[k - 1]! + K;
        if (j > 0 && hl[k - w]! + K < v) v = hl[k - w]! + K;
        if (j < w - 1 && hl[k + w]! + K < v) v = hl[k + w]! + K;
        if (i < w - 1) {
          const dx = ox + i - CENTER;
          const cliff = K === 2 && dx * dx + dy * dy >= c2 && (dx + 1) * (dx + 1) + dy * dy >= c2;
          const e = hl[k + 1]! + (cliff ? 4 : K);
          if (e < v) v = e;
        }
        if (v < 2) v = 2;
        if (v !== hl[k]) { hl[k] = v; moved = true; }
      }
    }
    if (!moved) break;
  }
  for (let k = 0; k < n; k++) lv[k] = hl[k]! >> 1;
}

/** The ground of the plains outside the cirque, from the land's height and moisture. */
function plainGround(h: number, m: number): number {
  if (h < 52) return h < 36 ? T.Deep : T.Shallow;
  if (m < 70 && h < 100) return T.Salt;
  if (h > 150) return T.Hardpan;
  return T.Sand;
}

function siteTerrain(id: UniqueBiomeId, h: number, d2: number, r: number): number {
  const inner = d2 * 4 <= r * r;
  switch (id) {
    case 'glassgrove': return T.Sand;
    case 'resincliffs': return inner ? T.Hardpan : h > 170 ? T.Rock3 : T.Hardpan;
    case 'emberfields': return T.Hardpan;
    case 'inkmarsh': return !inner && (d2 & 3) === 0 ? T.Shallow : T.Sand;
    case 'nacresea': return T.Salt;
    case 'organpeaks': return inner ? T.Hardpan : T.Rock3;
  }
}

function pickWeighted(h: number): string {
  let total = 0;
  for (const [, w] of COMMON_DEPOSITS) total += w;
  let roll = h % total;
  for (const [it, w] of COMMON_DEPOSITS) { if (roll < w) return it; roll -= w; }
  return COMMON_DEPOSITS[0]![0];
}
