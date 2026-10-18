// neighbour-goods.test.ts — a neighbouring base's goods ride its drawn lines (D110; owner,
// 2026-10-17: « a ribbon from a PNJ base disappears »): on the real bases of map 4's lands 1–3, every
// good at any moment stands on a tile of its own line (the very tile `goodAt` names), and the line's
// stretches (`ribbonRuns`) cover its tiles once each, in order, each stretch in one culling square,
// so a line in the view is drawn wherever its goods are.
import { describe, it, expect } from 'vitest';
import { WORLD_SEED } from '@/content/world';
import { Sim } from '@/sim/state';
import { MapGen } from '@/sim/world/mapgen';
import { PARCEL_COLS } from '@/sim/world/land';
import type { NLayout } from '@/sim/world/neighbours';
import { goodAt, goodsOn, ribbonRuns } from './neighbour-goods';

const bucketOf = (x: number, y: number): number => Math.floor(y / 16) * 64 + Math.floor(x / 16);

function layouts(ps: number): NLayout[] {
  const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: ps, source: new MapGen(WORLD_SEED, ps, 4), foundingEpoch: 29453760 });
  const out = new Map<number, NLayout>();
  for (let p = 0; p < PARCEL_COLS * PARCEL_COLS && out.size < 8; p++) {
    const h = sim.neighbours.holdingOf(p);
    if (h && !out.has(h.hub)) out.set(h.hub, sim.neighbours.layout(h));
  }
  return [...out.values()];
}

describe('neighbouring bases: goods on drawn lines (D110)', () => {
  it.each([1, 2, 3])('land %i: every good stands on a tile of its line, at any moment; a line is drawn in stretches of one culling square', (ps) => {
    let lines = 0, goods = 0;
    for (const L of layouts(ps)) for (const r of L.ribbons) {
      lines++;
      const len = r.tiles.length / 3;
      const tiles = new Set<number>();
      for (let i = 0; i < len; i++) tiles.add(r.tiles[i * 3 + 1]! * 1024 + r.tiles[i * 3]!);
      // Its stretches: each tile once, in order, each stretch within one square.
      const runs = ribbonRuns(r.tiles, bucketOf);
      expect(runs[0]!.from).toBe(0);
      expect(runs[runs.length - 1]!.to).toBe(len);
      for (let k = 0; k < runs.length; k++) {
        const run = runs[k]!;
        if (k) expect(run.from).toBe(runs[k - 1]!.to);
        for (let t = run.from; t < run.to; t++) expect(bucketOf(r.tiles[t * 3]!, r.tiles[t * 3 + 1]!)).toBe(run.bucket);
      }
      // Its goods, sampled over a minute: on the tile `goodAt` names, a tile of the line.
      const n = goodsOn(len, 1.6);
      for (let s = 0; s < 60; s += 0.37) for (let k = 0; k < n; k++) {
        const g = goodAt(r.tiles, 0.41, k, n, s, 1.1)!;
        const tx = Math.floor(g.x), ty = Math.floor(g.y);
        expect(tiles.has(ty * 1024 + tx)).toBe(true);
        expect([tx, ty]).toEqual([r.tiles[g.tile * 3], r.tiles[g.tile * 3 + 1]]);
        goods++;
      }
    }
    expect(lines).toBeGreaterThan(5);
    expect(goods).toBeGreaterThan(1000);
  });
});
