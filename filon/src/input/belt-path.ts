// belt-path.ts — the ribbon a drag lays down: an L from the press tile to the release tile,
// along x first then y (or y first once flipped with R). Every tile points at the next one;
// the last keeps the direction of the last leg (a single tile keeps the tool's rotation).
import type { Rot } from '@/sim/types';

/** Rotation pointing from a tile to its orthogonal neighbour (dx, dy). */
export const dirTo = (dx: number, dy: number): Rot => (dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0);

export function beltPath(ax: number, ay: number, bx: number, by: number, flip: boolean, rot: Rot): Array<[number, number, Rot]> {
  if (ax === bx && ay === by) return [[ax, ay, rot]];
  const pts: Array<[number, number]> = [[ax, ay]];
  let x = ax, y = ay;
  const legX = (): void => { while (x !== bx) { x += Math.sign(bx - x); pts.push([x, y]); } };
  const legY = (): void => { while (y !== by) { y += Math.sign(by - y); pts.push([x, y]); } };
  if (flip) { legY(); legX(); } else { legX(); legY(); }
  return pts.map(([px, py], i) => {
    const nx = pts[i + 1];
    if (nx) return [px, py, dirTo(nx[0] - px, nx[1] - py)];
    const pv = pts[i - 1]!;
    return [px, py, dirTo(px - pv[0], py - pv[1])];
  });
}
