// flow-arrows.test.ts — the build ghost's flow arrows on directional routing blocks: the big
// one comes from the tile behind (opposite the block's rotation) into the block, the three small
// ones leave by the front and the sides; only the blocks that take in at the back get them.
import { describe, it, expect } from 'vitest';
import type { Rot } from '@/sim/types';
import { flowArrows, isDirectional } from './flow-arrows';

const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** An arrow polygon's tail (middle of its first and last points) and tip (its fourth point). */
const ends = (a: Array<[number, number]>): { tail: [number, number]; tip: [number, number] } => ({
  tail: [(a[0]![0] + a[6]![0]) / 2, (a[0]![1] + a[6]![1]) / 2],
  tip: a[3]!,
});
const tileOf = ([x, y]: [number, number]): [number, number] => [Math.floor(x), Math.floor(y)];

describe('flow arrows', () => {
  it('the way in comes from the tile behind into the block; the ways out leave by the front and sides', () => {
    for (const rot of [0, 1, 2, 3] as Rot[]) {
      const { into, out } = flowArrows(10, 20, rot);
      const back = DIRS[(rot + 2) & 3]!;
      const { tail, tip } = ends(into);
      expect(tileOf(tail)).toEqual([10 + back[0], 20 + back[1]]);
      expect(tileOf(tip)).toEqual([10, 20]);
      const sides = out.map((a) => { const e = ends(a); return [Math.sign(Math.round((e.tip[0] - e.tail[0]) * 100)), Math.sign(Math.round((e.tip[1] - e.tail[1]) * 100))]; });
      expect(sides).toEqual([DIRS[rot], DIRS[(rot + 1) & 3], DIRS[(rot + 3) & 3]].map((d) => [d![0], d![1]]));
      for (const a of out) expect(tileOf(ends(a).tip)).not.toEqual([10, 20]);
    }
  });

  it('only the blocks that take in at the back get them', () => {
    for (const id of ['router', 'sorter', 'inverted_sorter', 'overflow_gate', 'underflow_gate']) expect(isDirectional(id), id).toBe(true);
    for (const id of ['distributor', 'drill', 'ribbon', 'wind_flower']) expect(isDirectional(id), id).toBe(false);
  });
});
