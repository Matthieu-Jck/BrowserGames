// face.ts — the cliff face (D87; owner, 2026-10-15: « incrusté dans la montagne […] une machine
// particulière qui le récupère et qui se pose à côté et pas au-dessus, car c'est dans une paroi »).
// An ore set in a wall (`ItemDef.face`: quartz) lies on the rock tiles of a face — the wall between
// floor ground and higher rock — and only a face cutter (`drill.face`) works it: it stands on the
// floor beside the wall, its back against the face, and cuts what the face tiles behind it hold,
// each at its tile's cap. A drill never sees a face ore, and an excavator leaves its tiles standing
// (landscape.ts), so a vein stays a wall to cut. Pure helpers over the grid, integers only: which
// tiles a cutter's back touches, its rate, which way it must turn. Read by the placement
// (build.ts: `needs_face`, the auto-turn), the compiler (compile.ts `drillRate`), the ghost and the guide.
import { buildingDef, itemDef, N_ITEMS } from '@/content/registry';
import { footprint } from './entities';
import { inWorld, type Grid } from './world/grid';
import { isRock, opposite, type Rot } from './types';

/** Face ores by item index (content `ItemDef.face`). */
const FACE_ORE: readonly boolean[] = Array.from({ length: N_ITEMS }, (_, i) => !!itemDef(i).face);

/** Is item `i` set in cliff faces (only a face cutter works it)? */
export const isFaceOre = (item: number): boolean => item >= 0 && FACE_ORE[item] === true;

/** Does a building work a face (a face cutter)? */
export const worksFace = (def: number): boolean => buildingDef(def).drill?.face === true;

/** The face ore a tile holds as seen from floor at `level`: its item when it is rock above that level carrying one, else −1. */
export function faceOreAt(grid: Grid, x: number, y: number, level: number): number {
  if (!inWorld(x, y)) return -1;
  const o = grid.ore(x, y);
  return isFaceOre(o) && isRock(grid.terrain(x, y)) && grid.level(x, y) > level ? o : -1;
}

/** The side a face cutter works: its back, the side opposite its front (its output). */
export const workSide = (rot: Rot): Rot => opposite(rot);

/** The tiles just past a footprint's back edge (the rotated footprint at (x, y)), in order along it. */
export function backRow(def: number, x: number, y: number, rot: Rot): Array<[number, number]> {
  const [w, h] = footprint(def, rot);
  const out: Array<[number, number]> = [];
  switch (workSide(rot)) {
    case 0: for (let i = 0; i < w; i++) out.push([x + i, y - 1]); break;
    case 2: for (let i = 0; i < w; i++) out.push([x + i, y + h]); break;
    case 1: for (let j = 0; j < h; j++) out.push([x + w, y + j]); break;
    case 3: for (let j = 0; j < h; j++) out.push([x - 1, y + j]); break;
  }
  return out;
}

/** The face tiles a face cutter at (x, y, rot) would touch: its back row's rock above its floor holding a face ore. */
export function faceTiles(grid: Grid, def: number, x: number, y: number, rot: Rot): Array<[number, number]> {
  const level = grid.level(x, y);
  return backRow(def, x, y, rot).filter(([tx, ty]) => faceOreAt(grid, tx, ty, level) >= 0);
}

/**
 * What a face cutter cuts and how fast at most (mu per epoch): the face ore most of its face tiles
 * hold (the lowest index on a tie), at the sum of those tiles' caps, never past its `perMin`.
 */
export function faceRate(grid: Grid, def: number, x: number, y: number, rot: Rot): { item: number; rateEp: number } {
  const level = grid.level(x, y);
  const counts = new Map<number, number>(), caps = new Map<number, number>();
  for (const [tx, ty] of backRow(def, x, y, rot)) {
    const o = faceOreAt(grid, tx, ty, level);
    if (o < 0) continue;
    counts.set(o, (counts.get(o) ?? 0) + 1);
    caps.set(o, (caps.get(o) ?? 0) + grid.capMuPerEpoch(tx, ty));
  }
  let item = -1, best = 0;
  for (const [o, n] of [...counts].sort((a, c) => a[0] - c[0])) if (n > best) { best = n; item = o; }
  if (item < 0) return { item: -1, rateEp: 0 };
  const b = buildingDef(def);
  const cap = Math.floor((caps.get(item)! * (b.drill!.capMult ?? 1000)) / 1000);
  return { item, rateEp: Math.min(b.drill!.perMin * 1000, cap) };
}

/**
 * The rotation a face cutter dropped at (x, y) takes: the one asked when its back meets a face,
 * else the first turn after it (clockwise) whose back does — it turns its back to the wall by
 * itself, as a routing block dropped on a ribbon follows it. None does: the one asked.
 */
export function faceRot(grid: Grid, def: number, x: number, y: number, rot: Rot): Rot {
  for (let k = 0; k < 4; k++) {
    const r = ((rot + k) & 3) as Rot;
    if (faceTiles(grid, def, x, y, r).length) return r;
  }
  return rot;
}
