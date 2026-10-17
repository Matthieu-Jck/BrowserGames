// flow-arrows.ts — which way items go through a directional routing block, as arrows in tile
// units (pure; the build ghost draws them while a block is placed, ghost-view.ts). A router,
// a sorter, an inverted sorter and both gates take items in at their back only (the side
// opposite their rotation) and deal them out to the front and both sides: one big arrow comes
// into the back from the tile behind, three small ones leave by the ways out.
import { buildingDef, buildingIdx } from '@/content/registry';
import type { Rot } from '@/sim/types';
import { arrowPoly } from '../art/shapes';

/** Routing logics that take in at the back only (a distributor takes from every side). */
const DIRECTIONAL: ReadonlySet<string> = new Set(['router', 'sorter', 'inverted', 'overflow', 'underflow']);
/** Outward unit vectors of the sides (0 N, 1 E, 2 S, 3 W). */
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Does this building take items in at its back only? */
export function isDirectional(def: string): boolean {
  const logic = buildingDef(buildingIdx(def)).logic;
  return !!logic && DIRECTIONAL.has(logic);
}

/**
 * The flow arrows of a 1×1 directional block at (x, y) turned `rot` (tile units, polygons):
 * `into`, from the middle of the tile behind it to just inside its back edge; `out`, one per way
 * out (front, right, left), from just outside its edge to the middle of the next tile.
 */
export function flowArrows(x: number, y: number, rot: Rot): { into: Array<[number, number]>; out: Array<Array<[number, number]>> } {
  const cx = x + 0.5, cy = y + 0.5;
  const [bx, by] = DIRS[(rot + 2) & 3]!;
  const into = arrowPoly(cx + bx * 1.34, cy + by * 1.34, cx + bx * 0.34, cy + by * 0.34, 0.11, 0.27, 0.3);
  const out = [rot, (rot + 1) & 3, (rot + 3) & 3].map((d) => {
    const [vx, vy] = DIRS[d]!;
    return arrowPoly(cx + vx * 0.56, cy + vy * 0.56, cx + vx * 1.02, cy + vy * 1.02, 0.05, 0.14, 0.17);
  });
  return { into, out };
}
