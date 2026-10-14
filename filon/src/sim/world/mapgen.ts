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
// version 1 lacks (`ridge`, `shoulders`, `lake.onCrest`) leaves its land as it was.
import { BAL } from '@/content/balance';
import { itemIdx } from '@/content/registry';
import {
  ARCHETYPES, ARCHETYPE_IDS, COMMON_DEPOSITS, COS64, DEPOSIT_CHANCE, MAP_VERSION, MAPS, MOUNTAINS, RICH_MULT, RINGS, SHADE, SIN64,
  T3_UNIQUES, T4_UNIQUES, UNIQUE_BIOMES, type ArchetypeId, type CirqueTemplate, type MapParams, type UniqueBiomeId,
} from '@/content/world';
import { hash32 } from '@/core/hash';
import { isqrt } from '@/core/fixed';
import { makeNoise2, qfbm, type Noise2 } from '@/core/noise';
import { CENTER, CHUNK } from '../constants';
import { T } from '../types';
import { MAX_LEVEL, type TerrainSource } from './grid';

export interface Site { id: UniqueBiomeId; cx: number; cy: number; r: number; item: number }
interface Blob { cx: number; cy: number; r2: number; item: number; rich: number; onRock: boolean }
/** A disc the mountains keep off: the guaranteed copper field, a unique site and its rim, a vent. */
interface Clearing { cx: number; cy: number; r: number }

/** Biome codes written next to terrain (renderer decor; not saved). */
export const BIOME = { none: 0, cirque: 7, crown: 8 } as const;

// A tile as `classify` sees it, packed in one integer.
const LV = 7; //         bits 0–2: the raw level (0 … MAX_LEVEL)
const CROWN = 8; //      the Crown's terraces
const FLOOR = 16; //     the cirque's floor
const GROUND = 5; //     bits 5–8: the ground class (a T) of a level-0 tile, when asked for
const HEIGHT = 9; //     bits 9–16: the land's height field (outside the cirque)
const WET = 1 << 17; //  the Crown's tarn: water at its level, its class in the GROUND bits
/** How far settling reaches: a tile comes down only for a lower one at most this many steps away. */
const REACH = MAX_LEVEL - 1;

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
  /** The Crown's tarn (map 2): its centre tile and the level of its water; null on map 1 (the lake is on the floor). */
  readonly tarn: { readonly x: number; readonly y: number; readonly level: number } | null;
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
  private readonly clearings: Clearing[] = [];
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
    const arch = ARCHETYPES[this.archetype], B = ARCHETYPES[this.secondary];
    this.embedCopper = arch.copperVein;
    this.dH3 = arch.dHeight * 2 + B.dHeight;
    this.dM3 = arch.dMoist * 2 + B.dMoist;
    this.dE3 = arch.mountains * 2 + B.mountains;
    this.crownFoot = P.crownOuter[this.archetype] ?? C.crownOuter;
    this.crownOuter = C.crownOuter;
    const L = C.lake;
    const water = { cx: CENTER + L.dx, cy: CENTER + L.dy, r2: L.radius * L.radius, r2deep: L.deep * L.deep };
    this.lake = L.onCrest ? null : water;
    this.tarnAt = L.onCrest ? { ...water, rc: isqrt(L.dx * L.dx + L.dy * L.dy), mound: L.mound ?? 0 } : null;
    this.tarn = L.onCrest ? { x: water.cx, y: water.cy, level: C.crest } : null;
    // The top's outer edge is at most max(rim + lift + minCrest, foot − lift + jitter), the rim
    // and the jitter at their highest (amp − 1), plus the widest shoulder, or the tarn's mound;
    // the foot lies `climb` tiles past it (the way down from the crest, the deepest).
    const climb = (C.crest - 1) * C.terrace, lift = ((C.ridge ?? C.crest) - 1) * C.terrace;
    const S = C.shoulders, widest = S ? ((255 - S.from) * S.gain) >> 7 : 0;
    const edge = Math.max(C.floorRadius + C.rimJitter.floor + lift + C.minCrest, this.crownFoot - lift + C.rimJitter.outer) + widest;
    this.crownReach = Math.max(edge, this.tarnAt ? this.tarnAt.rc + this.tarnAt.mound : 0) + climb;
    // Cirque deposits: shared template, ±1 tile and ±20 % richness per player.
    C.deposits.forEach((d, i) => {
      const jx = (hash32(ps, 30 + i) % 3) - 1, jy = (hash32(ps, 40 + i) % 3) - 1;
      const rich = Math.floor((d.rich * (800 + (hash32(ps, 50 + i) % 401))) / 1000);
      this.cirqueBlobs.push({ cx: CENTER + d.dx + jx, cy: CENTER + d.dy + jy, r2: d.radius * d.radius, item: itemIdx(d.item), rich, onRock: false });
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
    // The mountains keep off what the land guarantees, so it stays open ground at level 0.
    const K = MOUNTAINS.clear;
    this.clearings.push({ ...this.copperField, r: K.copper });
    for (const s of this.sites) this.clearings.push({ cx: s.cx, cy: s.cy, r: s.r + K.site });
    for (const v of this.ventSites) this.clearings.push({ cx: v.x + 1, cy: v.y + 1, r: K.vent });
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
    return r < edge ? up : Math.min(up, Math.max(0, top - 1 - Math.floor((r - edge) / T)));
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

  /** The tarn's water at a tile (map 2): its class, deep at its heart; 0 off it. */
  private tarnWater(x: number, y: number): number {
    const t = this.tarnAt;
    if (!t) return 0;
    const d2 = (x - t.cx) * (x - t.cx) + (y - t.cy) * (y - t.cy);
    return d2 <= t.r2deep ? T.Deep : d2 <= t.r2 ? T.Shallow : 0;
  }

  /** The mountains' raw level at a tile outside the Crown (0: none): its elevation cut into terraces (`MOUNTAINS`). */
  private mountain(x: number, y: number, r: number, h: number): number {
    const M = MOUNTAINS;
    if (r < M.from) return 0;
    let e = this.blend(this.eW, this.eP, x, y, r, M.scale, M.octaves) + this.bias(this.dE3, r);
    if (r < M.full) e -= (M.full - r) * M.ramp;
    if (h < M.shore) e -= (M.shore - h) * M.shoreSlope;
    for (const c of this.clearings) {
      const d2 = (x - c.cx) * (x - c.cx) + (y - c.cy) * (y - c.cy);
      if (d2 < c.r * c.r) e -= (c.r - isqrt(d2)) * M.clear.slope;
    }
    const top = r < RINGS.near ? M.threshold.near : r < RINGS.reaches ? M.threshold.reaches : M.threshold.far;
    if (e < top) return 0;
    return Math.min(MAX_LEVEL, 1 + Math.floor((e - top) / M.step));
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
    if (r <= this.crownReach) {
      const c = this.crown(x, y, r);
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
    for (const v of this.ventSites) if (x >= v.x && x < v.x + 3 && y >= v.y && y < v.y + 3) return hb | (T.Vent << GROUND);
    for (const s of this.sites) {
      const sd = (x - s.cx) * (x - s.cx) + (y - s.cy) * (y - s.cy);
      if (sd > s.r * s.r) continue;
      const t = siteTerrain(s.id, h, sd, s.r);
      return hb | (t >= T.Rock1 && t <= T.Rock4 ? (UNIQUE_BIOMES[s.id].rockLevel ?? 1) : t << GROUND);
    }
    const m = this.mountain(x, y, r, h);
    if (m > 0) return hb | m;
    if (!ground) return hb;
    return hb | (plainGround(h, this.moistAt(x, y, r)) << GROUND);
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

  /** A raised tile's level once the slopes are evened out: `settle` over the window its raw level can feel. */
  private settled(x: number, y: number, raw: number): number {
    const E = raw - 1, w = 2 * E + 1;
    const lv = new Uint8Array(w * w);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) lv[j * w + i] = this.classify(x - E + i, y - E + j, false) & LV;
    settle(lv, w, x - E, y - E);
    return lv[E * w + E]!;
  }

  /** The land's level at a tile (D45), 0 … MAX_LEVEL, as `fill` writes it. Pure and integer. */
  levelAt(x: number, y: number): number {
    const raw = this.classify(x, y, false) & LV;
    return raw <= 1 ? raw : this.settled(x, y, raw); // a tile at 0 or 1 never comes down
  }

  /** Base terrain class of a tile (before deposits), as `fill` writes it. */
  terrainAt(x: number, y: number): number {
    const c = this.classify(x, y, true), raw = c & LV;
    if (raw === 0 || c & WET) return (c >> GROUND) & 15;
    return this.rockOf(c, raw <= 1 ? raw : this.settled(x, y, raw), x, y);
  }

  /** Deposit blobs that can touch chunk (cx, cy): cirque, copper field, sites, common blobs, veins. */
  private blobsNear(cx: number, cy: number): Blob[] {
    const out: Blob[] = [];
    const x0 = cx * CHUNK - 6, y0 = cy * CHUNK - 6, x1 = cx * CHUNK + CHUNK + 6, y1 = cy * CHUNK + CHUNK + 6;
    const near = (b: { cx: number; cy: number }): boolean => b.cx >= x0 && b.cx < x1 && b.cy >= y0 && b.cy < y1;
    for (const b of this.cirqueBlobs) if (near(b)) out.push(b);
    if (near(this.copperField)) out.push({ ...this.copperField, r2: 16, item: itemIdx('copper_ore'), rich: BAL.depositRich.copper_ore!, onRock: false });
    for (const s of this.sites) {
      if (near(s)) out.push({ cx: s.cx, cy: s.cy, r2: 11, item: s.item, rich: BAL.uniqueRich, onRock: s.id === 'organpeaks' });
    }
    const ps = this.playerSeed >>> 0;
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

  fill(cx: number, cy: number, terrain: Uint8Array, ore: Uint8Array, rich: Uint16Array, height?: Uint8Array, biome?: Uint8Array, level?: Uint8Array): void {
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    // The chunk and a border of REACH tiles: settling a tile reads that far, so the chunk's own
    // levels come out exactly as `levelAt` gives them, whatever the neighbouring chunks hold.
    const W = CHUNK + 2 * REACH, wx = x0 - REACH, wy = y0 - REACH;
    const cls = new Int32Array(W * W), lv = new Uint8Array(W * W);
    let steep = false;
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const inner = i >= REACH && j >= REACH && i < REACH + CHUNK && j < REACH + CHUNK;
        const c = this.classify(wx + i, wy + j, inner);
        cls[j * W + i] = c;
        lv[j * W + i] = c & LV;
        if ((c & LV) > 1) steep = true;
      }
    }
    if (steep) settle(lv, W, wx, wy);
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const w = (ly + REACH) * W + lx + REACH, k = ly * CHUNK + lx;
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
          let b: number = c & FLOOR ? BIOME.cirque : c & CROWN ? BIOME.crown : BIOME.none;
          for (const s of this.sites) {
            if ((x - s.cx) * (x - s.cx) + (y - s.cy) * (y - s.cy) <= s.r * s.r) b = UNIQUE_BIOMES[s.id].code;
          }
          biome[k] = b;
        }
      }
    }
    // Deposits.
    for (const b of this.blobsNear(cx, cy)) {
      const rr = isqrt(Math.ceil(b.r2)) + 1;
      for (let y = Math.max(y0, b.cy - rr); y <= Math.min(y0 + CHUNK - 1, b.cy + rr); y++) {
        for (let x = Math.max(x0, b.cx - rr); x <= Math.min(x0 + CHUNK - 1, b.cx + rr); x++) {
          const d2 = (x - b.cx) * (x - b.cx) + (y - b.cy) * (y - b.cy);
          if (d2 > b.r2) continue;
          const k = (y - y0) * CHUNK + (x - x0);
          const t = terrain[k]!;
          const rockTile = t >= T.Rock1 && t <= T.Rock4;
          if (b.onRock ? !rockTile && t !== T.Sand && t !== T.Hardpan : rockTile || t === T.Shallow || t === T.Deep || t === T.DuneSea || t === T.Vent) continue;
          ore[k] = b.item + 1;
          // Richer at the heart of a blob, thinner at its rim.
          rich[k] = d2 * 3 <= b.r2 ? b.rich : Math.floor((b.rich * 700) / 1000);
        }
      }
    }
  }
}

/**
 * Evens out the slopes of a window of raw levels, in place (`w` × `w` tiles, its top-left at
 * world (ox, oy)): each tile comes down until it stands at most one level above each neighbour —
 * two above its east neighbour when both lie past `MOUNTAINS.cliffFrom` (an east-facing cliff).
 * That is the highest land under the raw one keeping those steps: tile p ends at min over q of
 * raw(q) + cost(q → p), each step costing 1, or 2 for a westward step out there. A step costs 1
 * or more and levels are at most MAX_LEVEL, so a tile only feels the tiles within REACH steps:
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
