import { describe, it, expect } from 'vitest';
import { T } from '@/sim/types';
import { CHUNK, WORLD } from '@/sim/constants';
import { Grid, type TerrainSource } from '@/sim/world/grid';
import { facesCamera, levelOf, masksAt, MAX_LEVEL, MAX_TERRACE, SHIFT, SMOOTH, slabOutline, STEP_LEVELS, surfaceTile, tileTop, wallRuns, type OutlinePt } from './relief';
import { BORDER, buildWindow, WIN, windowLevels } from './art/terrain';
import { tileToIso } from './iso';

const area = (p: readonly OutlinePt[]): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i]!, r = p[(i + 1) % p.length]!;
    a += q.u * r.v - r.u * q.v;
  }
  return Math.abs(a) / 2;
};

/** Is (u, v) inside or on the convex, clockwise (y-down) polygon? */
const inside = (p: readonly OutlinePt[], u: number, v: number): boolean => {
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    if ((b.u - a.u) * (v - a.v) - (b.v - a.v) * (u - a.u) < -1e-9) return false;
  }
  return true;
};

/** A level field from a grid of rows (out of range = floor). */
const field = (rows: number[][]) => (x: number, y: number): number => rows[y]?.[x] ?? 0;

describe('tiered relief', () => {
  it('floor has no level; rock stands one whole terrace per level of the land (D45), at least one', () => {
    expect(levelOf(T.Sand, 3)).toBe(0);
    expect(levelOf(T.Rock2, 0)).toBe(STEP_LEVELS);
    for (let l = 1; l <= MAX_TERRACE; l++) expect(levelOf(T.Rock3, l)).toBe(l * STEP_LEVELS);
    expect(levelOf(T.Rock4, 9)).toBe(MAX_LEVEL);
  });

  it('a lone column is a chamfered block that never leaves its tile', () => {
    const lv = field([[0, 0, 0], [0, 4, 0], [0, 0, 0]]);
    const masks = masksAt(lv, 1, 1);
    expect(masks.length).toBe(4 / STEP_LEVELS);
    for (let t = 0; t < masks.length; t++) {
      const o = slabOutline(masks, t);
      for (const p of o) {
        expect(p.u).toBeGreaterThanOrEqual(-1e-9);
        expect(p.u).toBeLessThanOrEqual(1 + 1e-9);
        expect(p.v).toBeGreaterThanOrEqual(-1e-9);
        expect(p.v).toBeLessThanOrEqual(1 + 1e-9);
      }
      expect(o.length).toBe(8);
      expect(area(o)).toBeLessThan(1);
      expect(o.every((p) => p.sil)).toBe(true);
    }
  });

  it('a diagonal staircase becomes one straight wall, not teeth', () => {
    // Rock where x + y <= 3: the tiles on the diagonal x + y = 3 are the steps.
    const lv = (x: number, y: number): number => (x >= 0 && y >= 0 && x + y <= 3 ? 2 : 0);
    const o = slabOutline(masksAt(lv, 1, 2), 0);
    expect(o.length).toBe(3);
    expect(area(o)).toBeCloseTo(0.5, 9);
    // Its visible wall is the cut (1,0) → (0,1), facing the camera head-on.
    const runs = wallRuns(o);
    expect(runs.length).toBe(1);
    const run = runs[0]!.pts;
    expect([run[0]!.u, run[0]!.v, run[run.length - 1]!.u, run[run.length - 1]!.v]).toEqual([1, 0, 0, 1]);
  });

  it('terrace slabs nest: each step lies inside the one below (no overhangs)', () => {
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) / 16777216;
    for (let trial = 0; trial < 60; trial++) {
      const rows = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => Math.floor(rnd() * 5) * STEP_LEVELS));
      rows[2]![2] = MAX_LEVEL;
      const masks = masksAt(field(rows), 2, 2);
      for (let t = 1; t < masks.length; t++) {
        const lo = slabOutline(masks, t - 1), hi = slabOutline(masks, t);
        for (const p of hi) expect(inside(lo, p.u, p.v)).toBe(true);
        expect(area(hi)).toBeLessThanOrEqual(area(lo) + 1e-9);
      }
    }
  });

  it('only walls facing the camera are drawn, and each ends against open air or a neighbour', () => {
    const lv = field([[0, 0, 0], [0, 2, 0], [0, 0, 0]]);
    const o = slabOutline(masksAt(lv, 1, 1), 0);
    for (const r of wallRuns(o)) {
      expect(r.pts.length).toBeGreaterThan(1);
      for (let i = 1; i < r.pts.length; i++) expect(facesCamera(r.pts[i]!.a)).toBe(true);
      expect(r.openStart && r.openEnd).toBe(true);
    }
  });

  it('the paint window reaches every column that leans into the chunk', () => {
    expect(BORDER).toBeGreaterThanOrEqual(Math.ceil(MAX_LEVEL * SHIFT) + SMOOTH + 1);
  });
});

/** A rolling rock land: rock where a few ridges run, heights rising and falling across them (and up to the world's edge). */
class Hills implements TerrainSource {
  fill(cx: number, cy: number, terrain: Uint8Array, _ore: Uint8Array, _rich: Uint16Array, _height?: Uint8Array, _biome?: Uint8Array, level?: Uint8Array): void {
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const x = cx * CHUNK + i, y = cy * CHUNK + j, k = j * CHUNK + i;
        const rock = (x * 7 + y * 3) % 23 < 15;
        terrain[k] = rock ? T.Rock1 + ((x + y) >> 3) % 4 : T.Sand;
        if (level) level[k] = rock ? 1 + ((x * 13 + y * 29) % MAX_TERRACE) : 0;
      }
    }
  }
}

describe('the one height: tileTop', () => {
  it('is the level the relief columns are drawn at (sprites and paint read windowLevels), off-world edges too', () => {
    const grid = new Grid(new Hills());
    const last = WORLD / CHUNK - 1;
    for (const [cx, cy] of [[16, 15], [0, 0], [last, last]] as const) {
      const { lv } = windowLevels(buildWindow((x, y) => grid.chunkAt(x, y), cx, cy, WORLD));
      let rock = 0;
      for (let j = 0; j < CHUNK; j++) {
        for (let i = 0; i < CHUNK; i++) {
          const top = tileTop(grid, cx * CHUNK + i, cy * CHUNK + j);
          expect(top).toBe(lv[(j + BORDER) * WIN + i + BORDER]);
          if (top) rock++;
        }
      }
      expect(rock).toBeGreaterThan(100);
    }
  });

  it('a click ray lands on the first rock top or cliff it meets, else on the ground', () => {
    // A level-6 plateau (x, y in 100–139) on a floor, the land one height.
    const grid = new Grid({
      fill(cx, cy, terrain, _o, _r, _h, _b, level) {
        for (let k = 0; k < CHUNK * CHUNK; k++) {
          const x = cx * CHUNK + (k % CHUNK), y = cy * CHUNK + Math.floor(k / CHUNK);
          const rock = x >= 100 && x < 140 && y >= 100 && y < 140;
          terrain[k] = rock ? T.Rock2 : T.Sand;
          if (level) level[k] = rock ? 3 : 0;
        }
      },
    });
    expect(tileTop(grid, 120, 120)).toBe(6);
    // On the plateau: the ray's ground point lies 3 tiles behind the top it shows.
    for (const [px, py] of [[117.2, 116.7], [110.5, 130.25]] as const) {
      const [tx, ty] = surfaceTile(grid, px, py);
      expect([tx, ty]).toEqual([Math.floor(px + 6 * SHIFT), Math.floor(py + 6 * SHIFT)]);
      // The same screen point: the rock top it returns is drawn exactly where the ground point would be.
      const a = tileToIso(px + 6 * SHIFT, py + 6 * SHIFT, 6), b = tileToIso(px, py);
      expect(a[0]).toBeCloseTo(b[0], 9); expect(a[1]).toBeCloseTo(b[1], 9);
    }
    // Just in front of the plateau's south-east edges, the ray still meets its cliff (not the ground behind it).
    const [cx, cy] = surfaceTile(grid, 137.5, 137.5);
    expect(tileTop(grid, cx, cy)).toBe(6);
    // Far from any rock: the ground tile itself.
    expect(surfaceTile(grid, 60.4, 70.9)).toEqual([60, 70]);
  });
});
