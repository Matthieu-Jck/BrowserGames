// floor.ts — usable floor and ore (D94): what of the land a building can actually use, and what it can mine. A floor tile
// (`isFloor`: sand, hardpan, dug or filled ground, salt flats, vents) counts when some 2 × 2 square
// holding it is floor all through, at one level — the smallest machine's footprint. A sliver of
// floor between a cliff and a chasm, or a tile left in a river's bend, takes no machine: it is not
// usable floor. A parcel's share of it (‰ of its tiles) is the land panel's figure and the Terrain
// view's gauge, and its tiles are what the land's price pays the most for (systems/land.ts). Read
// from the grid as it is now (a dug or filled tile changes it); cached per parcel until the land
// changes (its saved diffs grow).
import { BAL } from '@/content/balance';
import { isFaceOre } from '../face';
import type { Grid } from './grid';
import { parcelRect } from './land';
import { isFloor } from '../types';

/** Is (x, y) floor at `lv`? */
const floorAt = (g: Grid, x: number, y: number, lv: number): boolean => isFloor(g.terrain(x, y)) && g.level(x, y) === lv;

/** Is tile (x, y) usable floor: floor, and one of the four 2 × 2 squares holding it floor all through at its level? */
export function usableFloor(g: Grid, x: number, y: number): boolean {
  if (!isFloor(g.terrain(x, y))) return false;
  const lv = g.level(x, y);
  for (let oy = -1; oy <= 0; oy++) {
    for (let ox = -1; ox <= 0; ox++) {
      let all = true;
      for (let j = 0; j < 2 && all; j++) for (let i = 0; i < 2 && all; i++) {
        const tx = x + ox + i, ty = y + oy + j;
        if ((tx !== x || ty !== y) && !floorAt(g, tx, ty, lv)) all = false;
      }
      if (all) return true;
    }
  }
  return false;
}

/** A parcel's usable floor: its tiles, how many are usable floor, and their share (‰); `mask`: 1 per usable tile, row by row from the parcel's corner. */
export interface ParcelFloor { readonly tiles: number; readonly usable: number; readonly permille: number; readonly mask: Uint8Array }

const cache = new WeakMap<Grid, Map<number, { key: string; v: ParcelFloor }>>();

/**
 * A parcel's usable floor, over all its tiles (as its price reads them). Cached per grid
 * and parcel until the land changes (its saved diffs only grow: a tile dug or filled stays so), so
 * the price a tip asks for every frame does not walk 529 tiles' squares each time.
 */
export function parcelFloor(g: Grid, p: number): ParcelFloor {
  const key = `${g.terrainDiff.size}:${g.levelDiff.size}`;
  let m = cache.get(g);
  if (!m) cache.set(g, (m = new Map()));
  const hit = m.get(p);
  if (hit && hit.key === key) return hit.v;
  const { x0, y0, x1, y1 } = parcelRect(p);
  const w = x1 - x0, mask = new Uint8Array(w * (y1 - y0));
  let usable = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (usableFloor(g, x, y)) { usable++; mask[(y - y0) * w + x - x0] = 1; }
  const tiles = mask.length;
  const v = { tiles, usable, permille: tiles ? Math.floor((usable * 1000) / tiles) : 0, mask };
  m.set(p, { key, v });
  return v;
}

/** A parcel's ore (D94: space or ore): its deposit tiles (a face ore left out: a wall's, D87), the ore most of them hold (−1: none), its tier (0 … 3, `BAL.land.oreTiers`). */
export interface ParcelOre { readonly tiles: number; readonly item: number; readonly tier: number }

const oreCache = new WeakMap<Grid, Map<number, { key: number; v: ParcelOre }>>();

/** A parcel's ore, over all its tiles (as its price reads them, a vein under rock too). Cached until a deposit changes (`oreDiff`). */
export function parcelOre(g: Grid, p: number): ParcelOre {
  const key = g.oreDiff.size;
  let m = oreCache.get(g);
  if (!m) oreCache.set(g, (m = new Map()));
  const hit = m.get(p);
  if (hit && hit.key === key) return hit.v;
  const { x0, y0, x1, y1 } = parcelRect(p);
  const count = new Map<number, number>();
  let tiles = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = g.ore(x, y);
    if (o < 0 || isFaceOre(o)) continue;
    tiles++;
    count.set(o, (count.get(o) ?? 0) + 1);
  }
  let item = -1, most = 0;
  for (const [o, n] of [...count].sort((a, b) => a[0] - b[0])) if (n > most) { most = n; item = o; }
  const v = { tiles, item, tier: BAL.land.oreTiers.filter((t) => tiles >= t).length };
  m.set(p, { key, v });
  return v;
}
