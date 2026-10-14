import { describe, it, expect } from 'vitest';
import { chunkIsoBounds, groundMatrix, isoToTile, screenToTile, tileToIso, visibleChunks, TW, TH } from './iso';
import { CHUNK } from '@/sim/constants';

describe('isometric projection', () => {
  it('tile → iso → tile is the identity on the ground plane', () => {
    for (const [x, y] of [[0, 0], [512.5, 511.25], [1000, 3], [7.75, 900.5]] as const) {
      const [X, Y] = tileToIso(x, y);
      const [bx, by] = isoToTile(X, Y);
      expect(bx).toBeCloseTo(x, 9);
      expect(by).toBeCloseTo(y, 9);
    }
  });

  it('a tile is a 2:1 diamond: +x goes down-right, +y down-left, z lifts', () => {
    expect(tileToIso(1, 0)).toEqual([TW / 2, TH / 2]);
    expect(tileToIso(0, 1)).toEqual([-TW / 2, TH / 2]);
    expect(tileToIso(0, 0, 2)[1]).toBeLessThan(0);
  });

  it('picks the tile under the cursor', () => {
    const [X, Y] = tileToIso(512.5, 512.5);
    const cam = { cx: X, cy: Y, zoom: 1 };
    expect(screenToTile(cam, 1440, 900, 720, 450)).toEqual([512, 512]);
    // Moving right on screen walks along +x and −y at once.
    expect(screenToTile(cam, 1440, 900, 720 + TW * 0.6, 450)).toEqual([513, 511]);
  });

  it('the ground matrix maps chunk texture corners onto the chunk diamond', () => {
    const [a, b, c, d, tx, ty] = groundMatrix(3, 5, 16);
    const map = (u: number, v: number): [number, number] => [a * u + c * v + tx, b * u + d * v + ty];
    const size = CHUNK * 16;
    expect(map(0, 0)).toEqual(tileToIso(3 * CHUNK, 5 * CHUNK));
    expect(map(size, 0)).toEqual(tileToIso(4 * CHUNK, 5 * CHUNK));
    expect(map(0, size)).toEqual(tileToIso(3 * CHUNK, 6 * CHUNK));
  });

  it('finds the chunks under the view, including the centre one', () => {
    const [X, Y] = tileToIso(512, 512);
    const vis = visibleChunks({ cx: X, cy: Y, zoom: 1 }, 1440, 900, 0);
    expect(vis.some(([cx, cy]) => cx === 16 && cy === 16)).toBe(true);
    for (const [cx, cy] of vis) {
      const [x0, , x1] = chunkIsoBounds(cx, cy);
      expect(x1).toBeGreaterThan(x0);
    }
  });
});
