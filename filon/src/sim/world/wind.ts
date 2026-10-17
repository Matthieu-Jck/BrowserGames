// wind.ts — the wind (D95; owner, 2026-10-16: « retirer le coefficient actuel pour le remplacer
// par réellement une simulation du vent… Il faut que cette présence soit logique, il y a plus de
// vent au sommet des collines, ou dans les grands espaces sans obstacles »). Pure and integer, like
// the sun: what a turbine catches is a function of the world clock and of where it stands, the same
// online and offline, never saved.
//
// **The time** (`windAt`): the wind over open flat ground at an absolute world epoch, ‰ of the
// reference wind — the day's curve (`BAL.wind.curve`: the Sough rises at dusk and blows through the
// night, lulls in the late morning) × the day's mood (a draw per world day from WORLD_SEED, blended
// from one day start to the next) × the gust window (`gustPermille`: one of five levels per ten
// epochs, the gust variance research narrowing it), rounded to `BAL.wind.step` so a week holds a
// few dozen distinct winds (the catch-up solves its grids once per weather). Its bearing: the
// prevailing one, drawn once from WORLD_SEED (the world's wind, every land alike), or `veer` steps
// either side of it on some days (`veerOf`).
//
// **The place** (`WindField`): a tile's exposure ‰, from the land's levels **as the world made
// them** (its `TerrainSource`, filled again into the field's own cache: a dig never moves the wind,
// and the field is a pure function of the source — offline-exact, the same after a reload). Five
// readings of the land round the tile, every one in tiles and levels (a level counts the same on
// every map, so map 4's massifs and chasms need nothing of their own):
//   · **height** — the tile's level against the mean of the box round it (`relRadius`): tops,
//     ridges, the Crown's crest windy; pits and gullies calm; plus a little per level (`levelGain`);
//   · **openness** — the share of the upwind fan (the bearing and `side` either way) clear of
//     higher ground over the whole `fetch`: wide open ground;
//   · **shelter** — the steepest higher ground upwind, levels per tile (Winstral's shelter index):
//     the lee of a mountain or a cliff, strongest close behind it, fading with distance;
//   · **basin** — the share of eight bearings that meet higher ground within the fetch: a bowl (the
//     cirque's floor) is calm even where nothing stands right upwind;
//   · **funnel** — higher ground close on both flanks and the way upwind clear: a pass between two
//     massifs, the wind funnelled through it.
// Buildings shelter nothing (a turbine's output does not change because a factory went up beside
// it). Exposures are cached per chunk and bearing (`Uint16Array`), filled on demand.
//
// **A turbine** (`turbineSite`) reads the mean exposure of its footprint for each of the day's
// three bearings; on land dug or filled since (its foot's level is not the world's) the same
// readings are taken at its real level. Its curve (content `gen.wind`) does the rest
// (power/network.ts `windKw`).
import { BAL } from '@/content/balance';
import type { WindCurve } from '@/content/types';
import { COS64, SIN64 } from '@/content/world';
import { mulDiv } from '@/core/fixed';
import { hash32 } from '@/core/hash';
import { CHUNK, CHUNKS, DAY_EPOCHS, GUST_EPOCHS, GUST_LEVELS, WORLD } from '../constants';
import type { TerrainSource } from './grid';

const W = BAL.wind;
/** Bearings: the trig tables' 64 steps, 0 east, 16 south (where the wind comes **from**). */
export const BEARINGS = 64;
/** Salts of the wind's draws (independent of the gusts', the temperature's and the market's). */
const BEARING_SALT = 0xb3a41, MOOD_SALT = 0x5c0ff, VEER_SALT = 0x7ee5;

// ── the time ───────────────────────────────────────────────────────────────

/** The prevailing bearing (0…63, where the wind comes from): one draw from the world seed. */
export const prevailing = (worldSeed: number): number => hash32(worldSeed, BEARING_SALT) % BEARINGS;

/** A world day's veer: 0 (the prevailing bearing − `veer`), 1 (the prevailing bearing) or 2 (+ `veer`). */
export function veerOf(day: number, worldSeed: number): number {
  const r = hash32(worldSeed, day, VEER_SALT) % 1000;
  return r < W.veerSide ? 0 : r >= 1000 - W.veerSide ? 2 : 1;
}

/** The bearing of a veer (0, 1, 2). */
export const bearingOf = (worldSeed: number, veer: number): number => (prevailing(worldSeed) + (veer - 1) * W.veer + BEARINGS) & (BEARINGS - 1);

/** A world day's mood ‰ (`moodLow` … `moodHigh`). */
export const moodOf = (day: number, worldSeed: number): number => W.moodLow + mulDiv(hash32(worldSeed, day, MOOD_SALT) % 1001, W.moodHigh - W.moodLow, 1000);

/** Gust level ‰ for the 10-epoch window containing absEpoch (variance ‰ scales the swing). */
export function gustPermille(absEpoch: number, worldSeed: number, variance = 1000): number {
  const w = Math.floor(absEpoch / GUST_EPOCHS);
  const lvl = GUST_LEVELS[hash32(worldSeed, w, 0x6a5) % GUST_LEVELS.length]!;
  return 1000 + mulDiv(lvl - 1000, variance, 1000);
}

/**
 * The wind over open flat ground during an epoch (‰ of the reference wind), before the gust: the
 * day's curve × the day's mood, blended from this day's start to the next one's.
 */
export function calmAt(absEpoch: number, worldSeed: number): number {
  const day = Math.floor(absEpoch / DAY_EPOCHS), de = absEpoch - day * DAY_EPOCHS;
  const mood = Math.floor((moodOf(day, worldSeed) * (DAY_EPOCHS - de) + moodOf(day + 1, worldSeed) * de) / DAY_EPOCHS);
  return mulDiv(W.curve[de]!, mood, 1000);
}

/** The wind during an epoch (‰ of the reference wind): curve × mood × gust, rounded to `step`. */
export function windAt(absEpoch: number, worldSeed: number, gustVariance = 1000): number {
  const raw = mulDiv(calmAt(absEpoch, worldSeed), gustPermille(absEpoch, worldSeed, gustVariance), 1000);
  return Math.max(0, Math.floor((raw + (W.step >> 1)) / W.step) * W.step);
}

// ── a turbine's curve ──────────────────────────────────────────────────────

/** Its share of its rating ‰ in a local wind `v` ‰ (cube of the wind from cut-in to rated). */
export function curveShare(c: WindCurve, v: number): number {
  if (v < c.cutIn) return 0;
  if (c.cutOut !== undefined && v >= c.cutOut) return 0;
  if (v >= c.rated) return 1000;
  const a = c.cutIn * c.cutIn * c.cutIn;
  return Math.floor(((v * v * v - a) * 1000) / (c.rated * c.rated * c.rated - a));
}

/** A turbine's exposure over the days ‰: its three bearings' as often as the days take them. */
export const meanExposure = (local: readonly [number, number, number]): number =>
  Math.floor((local[0] * W.veerSide + local[1] * (1000 - 2 * W.veerSide) + local[2] * W.veerSide) / 1000);

/** The local wind ‰: the weather's wind × the place's exposure. */
export const localWind = (wind: number, exposure: number): number => mulDiv(wind, exposure, 1000);

// ── the place ──────────────────────────────────────────────────────────────

/** Padding round a chunk the readings reach (the fetch is at most a chunk). */
const PAD = CHUNK;
const SPAN = CHUNK + 2 * PAD;
/** The basin's eight bearings. */
const BASIN = [0, 8, 16, 24, 32, 40, 48, 56] as const;

/** A ray's step in tiles from a bearing and a distance (rounded). */
const rx = (b: number, d: number): number => (COS64[b]! * d + 512) >> 10;
const ry = (b: number, d: number): number => (SIN64[b]! * d + 512) >> 10;
/** The rays as offsets in a patch: `RAY[b · (PAD + 1) + d]`, one add a step. */
const RAY = new Int32Array(BEARINGS * (PAD + 1));
for (let b = 0; b < BEARINGS; b++) for (let d = 0; d <= PAD; d++) RAY[b * (PAD + 1) + d] = ry(b, d) * SPAN + rx(b, d);

/** Why a tile's wind is what it is: each reading, for the inspector and the view (‰ unless said). */
export interface Exposure {
  /** The exposure ‰. */
  e: number;
  /** Level, and its height above (or under, < 0) its surroundings' mean, milli-levels. */
  level: number;
  rel: number;
  /** Share ‰ of the upwind fan clear over the fetch. */
  open: number;
  /** ‰ of shelter (the lee), and the tile it comes from (the steepest higher ground upwind; −1: none). */
  shelter: number;
  lee: number;
  /** Share ‰ of the eight bearings blocked within the fetch. */
  basin: number;
  /** A pass: higher ground on both flanks, the way upwind clear. */
  funnel: boolean;
}

/** The land's levels round a chunk, `SPAN`² from (x0 − PAD, y0 − PAD), and their box sums. */
interface Patch { x0: number; y0: number; lv: Uint8Array; sum: Int32Array }

/** Patches kept at once (a turbine's readings, a view's chunks in a row). */
const PATCHES = 24;
/** Not read yet (an exposure is never 0: `BAL.wind.min` ≥ 1; a basin share ≤ 1000). */
const UNREAD = 0, NO_BASIN = 0xffff;

export class WindField {
  /** The levels as generated, per chunk. */
  private readonly levels = new Map<number, Uint8Array>();
  /** Exposures per chunk and bearing (key chunk · 64 + bearing), read tile by tile (`UNREAD` until). */
  private readonly exposures = new Map<number, Uint16Array>();
  /** The basin's share per chunk (bearing-free; `NO_BASIN` until read). */
  private readonly basins = new Map<number, Uint16Array>();
  /** The last patches built, by chunk (oldest first). */
  private readonly patches = new Map<number, Patch>();
  private readonly scratch = { terrain: new Uint8Array(CHUNK * CHUNK), ore: new Uint8Array(CHUNK * CHUNK), rich: new Uint16Array(CHUNK * CHUNK) };

  constructor(readonly source: TerrainSource) {
    if (W.fetch > PAD || W.relRadius > PAD || W.funnelReach > PAD || W.funnelClear > PAD || W.min < 1) throw new Error('BAL.wind: the readings reach past a chunk');
  }

  /** A chunk's levels as the world made them (filled from the source once). */
  private chunkLevels(cx: number, cy: number): Uint8Array | null {
    if (cx < 0 || cy < 0 || cx >= CHUNKS || cy >= CHUNKS) return null;
    const k = cy * CHUNKS + cx;
    let lv = this.levels.get(k);
    if (!lv) {
      lv = new Uint8Array(CHUNK * CHUNK);
      const s = this.scratch;
      this.source.fill(cx, cy, s.terrain, s.ore, s.rich, undefined, undefined, lv);
      this.levels.set(k, lv);
    }
    return lv;
  }

  /** The level of a tile as the world made it (off the world: the floor's). */
  level(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) return 0;
    return this.chunkLevels(x >> 5, y >> 5)![(y & 31) * CHUNK + (x & 31)]!;
  }

  /** The levels of the 3×3 chunks round (cx, cy) and their box sums (the last `PATCHES` kept). */
  private patch(cx: number, cy: number): Patch {
    const k = cy * CHUNKS + cx;
    const kept = this.patches.get(k);
    if (kept) return kept;
    const lv = new Uint8Array(SPAN * SPAN);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const src = this.chunkLevels(cx + i, cy + j);
      if (!src) continue;
      for (let y = 0; y < CHUNK; y++) lv.set(src.subarray(y * CHUNK, y * CHUNK + CHUNK), (PAD + j * CHUNK + y) * SPAN + PAD + i * CHUNK);
    }
    const p: Patch = { x0: cx * CHUNK - PAD, y0: cy * CHUNK - PAD, lv, sum: boxSums(lv) };
    if (this.patches.size >= PATCHES) this.patches.delete(this.patches.keys().next().value!);
    this.patches.set(k, p);
    return p;
  }

  /** The exposure ‰ of a tile for a bearing (read once, then kept). */
  at(x: number, y: number, bearing: number): number {
    if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) return W.base;
    const cx = x >> 5, cy = y >> 5, i = (y & 31) * CHUNK + (x & 31);
    const arr = this.cached(cx, cy, bearing);
    if (arr[i] === UNREAD) arr[i] = this.readTile(cx, cy, i, bearing);
    return arr[i]!;
  }

  /** A chunk's exposures for a bearing, row by row (the tiles not read yet are read now). */
  chunk(cx: number, cy: number, bearing: number): Uint16Array {
    const arr = this.cached(cx, cy, bearing);
    for (let i = 0; i < CHUNK * CHUNK; i++) if (arr[i] === UNREAD) arr[i] = this.readTile(cx, cy, i, bearing);
    return arr;
  }

  /** Has this chunk been read whole for this bearing (the view paints those first)? */
  hasChunk(cx: number, cy: number, bearing: number): boolean {
    const arr = this.exposures.get((cy * CHUNKS + cx) * BEARINGS + bearing);
    return !!arr && arr.indexOf(UNREAD) < 0;
  }

  private cached(cx: number, cy: number, bearing: number): Uint16Array {
    const key = (cy * CHUNKS + cx) * BEARINGS + bearing;
    let arr = this.exposures.get(key);
    if (!arr) this.exposures.set(key, (arr = new Uint16Array(CHUNK * CHUNK)));
    return arr;
  }

  private readTile(cx: number, cy: number, i: number, bearing: number): number {
    const p = this.patch(cx, cy);
    const c = (PAD + (i >> 5)) * SPAN + PAD + (i & 31);
    const L = p.lv[c]!;
    let bs = this.basins.get(cy * CHUNKS + cx);
    if (!bs) this.basins.set(cy * CHUNKS + cx, (bs = new Uint16Array(CHUNK * CHUNK).fill(NO_BASIN)));
    if (bs[i] === NO_BASIN) bs[i] = basinShare(p.lv, c, L);
    return read(p, c, L, bearing, bs[i]!).e;
  }

  /**
   * Every reading at a tile for a bearing, with the tile at `level` (default: as the world made
   * it; a turbine on land dug or filled since passes its real level). Not kept: the inspector, a
   * turbine on changed land.
   */
  explain(x: number, y: number, bearing: number, level?: number): Exposure {
    const cx = Math.min(CHUNKS - 1, Math.max(0, x >> 5)), cy = Math.min(CHUNKS - 1, Math.max(0, y >> 5));
    const p = this.patch(cx, cy);
    const c = (y - p.y0) * SPAN + x - p.x0;
    const L = level ?? p.lv[c]!;
    const r = read(p, c, L, bearing, basinShare(p.lv, c, L));
    return { ...r, lee: r.lee < 0 ? -1 : (p.y0 + Math.floor(r.lee / SPAN)) * WORLD + p.x0 + (r.lee % SPAN) };
  }
}

/** Summed-area table of a patch's levels ((SPAN+1)², exclusive). */
function boxSums(lv: Uint8Array): Int32Array {
  const S = SPAN + 1, s = new Int32Array(S * S);
  for (let y = 0; y < SPAN; y++) {
    let row = 0;
    for (let x = 0; x < SPAN; x++) {
      row += lv[y * SPAN + x]!;
      s[(y + 1) * S + x + 1] = s[y * S + x + 1]! + row;
    }
  }
  return s;
}

/** Share ‰ of the eight bearings from patch cell `c` that meet ground higher than `L` within the fetch. */
function basinShare(lv: Uint8Array, c: number, L: number): number {
  let blocked = 0;
  for (const b of BASIN) {
    const o = b * (PAD + 1);
    for (let d = 1; d <= W.fetch; d++) if (lv[c + RAY[o + d]!]! > L) { blocked++; break; }
  }
  return Math.floor((blocked * 1000) / BASIN.length);
}

/**
 * The readings at patch cell `c` standing at level `L`, the wind from `bearing`. `lee` is the
 * patch cell of the steepest higher ground upwind (−1: none). Integers throughout.
 */
function read(p: Patch, c: number, L: number, bearing: number, basin: number): Exposure {
  const lv = p.lv;
  // Height: the tile's level against its box's mean (milli-levels).
  const r = W.relRadius, S = SPAN + 1;
  const px = c % SPAN, py = (c - px) / SPAN;
  const xa = px - r, ya = py - r, xb = px + r + 1, yb = py + r + 1;
  const box = p.sum[yb * S + xb]! - p.sum[ya * S + xb]! - p.sum[yb * S + xa]! + p.sum[ya * S + xa]!;
  const rel = L * 1000 - Math.floor((box * 1000) / ((2 * r + 1) * (2 * r + 1)));
  // The upwind fan: how far each ray runs clear of higher ground (`reach`), and the shelter index
  // (the steepest higher ground, ‰ of a level per tile) — the central ray in full, the side rays at half.
  let clearC = 0, clearS = 0, sxC = 0, sxS = 0, leeC = -1, leeS = -1;
  for (let k = 0; k < 3; k++) {
    const b = k === 0 ? bearing : k === 1 ? (bearing + W.side) & 63 : (bearing - W.side + BEARINGS) & 63, wgt = k === 0 ? 2 : 1;
    const o = b * (PAD + 1);
    let reach = W.fetch, sx = 0, lee = -1;
    for (let d = 1; d <= W.fetch; d++) {
      const at = c + RAY[o + d]!, up = lv[at]!;
      if (up <= L) continue;
      if (reach === W.fetch) reach = d - 1;
      const s = Math.floor(((up - L) * 1000 * wgt) / (2 * d));
      if (s > sx) { sx = s; lee = at; }
    }
    if (k === 0) { clearC = reach; sxC = sx; leeC = lee; } else { clearS += reach; if (sx > sxS) { sxS = sx; leeS = lee; } }
  }
  // A pass: the way upwind clear, and higher ground close on both flanks. Its walls run along the
  // wind, so they shelter nothing and close no fan: the central ray alone counts, and neither the
  // bowl nor standing low takes anything off.
  const funnel = clearC >= W.funnelClear && !openRay(lv, c, L, (bearing + 16) & 63, W.funnelReach) && !openRay(lv, c, L, (bearing + 48) & 63, W.funnelReach);
  const open = funnel ? Math.floor((clearC * 1000) / W.fetch) : Math.floor(((2 * clearC + clearS) * 1000) / (4 * W.fetch));
  const sx = funnel || sxC >= sxS ? sxC : sxS, lee = funnel || sxC >= sxS ? leeC : leeS;
  const shelter = Math.min(W.shelterMax, Math.floor((sx * W.shelterGain) / 1000));
  // Standing above the surroundings counts in full, standing below them a little (the lee and the
  // bowl say the rest).
  const height = rel > 0 ? Math.floor((rel * W.relGain) / 1000) : funnel ? 0 : -Math.floor((-rel * W.relGainLow) / 1000);
  let e = W.base + height + L * W.levelGain + Math.floor((open * W.openGain) / 1000) - (funnel ? 0 : Math.floor((basin * W.basinGain) / 1000)) + (funnel ? W.funnel : 0);
  e = Math.floor((Math.max(0, e) * (1000 - shelter)) / 1000);
  return { e: Math.max(W.min, Math.min(W.max, e)), level: L, rel, open, shelter, lee, basin, funnel };
}

/** Is the ray from patch cell `c` at `bearing` clear of ground higher than `L` for `n` tiles? */
function openRay(lv: Uint8Array, c: number, L: number, b: number, n: number): boolean {
  const o = b * (PAD + 1);
  for (let d = 1; d <= n; d++) if (lv[c + RAY[o + d]!]! > L) return false;
  return true;
}

// ── one field per land ─────────────────────────────────────────────────────

const FIELDS = new WeakMap<TerrainSource, WindField>();

/** The wind field of a land (one per terrain source, kept as long as the source lives). */
export function windField(source: TerrainSource): WindField {
  let f = FIELDS.get(source);
  if (!f) FIELDS.set(source, (f = new WindField(source)));
  return f;
}

/** What a turbine standing at (x, y) with footprint w × h catches: its exposure ‰ for each veer (0, 1, 2). */
export function turbineSite(source: TerrainSource, worldSeed: number, x: number, y: number, w: number, h: number, levelAt: (x: number, y: number) => number): [number, number, number] {
  const f = windField(source);
  const out: [number, number, number] = [0, 0, 0];
  for (let v = 0; v < 3; v++) {
    const b = bearingOf(worldSeed, v);
    let s = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const tx = x + i, ty = y + j, L = levelAt(tx, ty);
      s += L === f.level(tx, ty) ? f.at(tx, ty, b) : f.explain(tx, ty, b, L).e;
    }
    out[v] = Math.floor(s / (w * h));
  }
  return out;
}
