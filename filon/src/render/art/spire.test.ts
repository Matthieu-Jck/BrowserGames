// spire.test.ts — map 6's rock spires (D147): a spire's solid never leaves its tile, its top is the
// land's level (the one height every lift reads), the sprite and the far paint draw one silhouette,
// its shade reading stands where it is drawn, and the paint windows reach every spire whose top or
// shadow lands in their chunk; the terraces round it see the floor (a spire is no column of slabs).
import { describe, it, expect } from 'vitest';
import { SPIRES } from '@/content/world';
import { BIOME } from '@/sim/world/mapgen';
import { T } from '@/sim/types';
import { levelOf, PEAK_LEVEL, PEAK_TERRACE, SHIFT, STEP_LEVELS, surfaceTile, tileTop } from '../relief';
import { drawSpire, spireHeightAt, spireSeed, spireShape, spireVariant, SPIRE_BIOME } from './spire';
import { BORDER, buildWindow, hasRock, SPIRE_GROUND, SPIRE_REACH, WIN, windowLevels, type ChunkArrays } from './terrain';

/** A stand-in 2D context recording every filled path's points (in order) and its fill style. */
function recorder(): { ctx: CanvasRenderingContext2D; paths: Array<Array<[number, number]>>; styles: string[] } {
  const paths: Array<Array<[number, number]>> = [], styles: string[] = [];
  let cur: Array<[number, number]> = [];
  const t: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(t, {
    get(o, k): unknown {
      if (k === 'beginPath') return () => { cur = []; };
      if (k === 'moveTo' || k === 'lineTo') return (x: number, y: number) => { cur.push([x, y]); };
      if (k === 'fill') return () => { paths.push(cur); styles.push(String(o.fillStyle)); };
      if (k in o) return o[k];
      return () => undefined;
    },
    set(o, k, v): boolean { o[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, paths, styles };
}

const P = (u: number, v: number, z: number): [number, number] => [(u - v) * 64, (u + v) * 32 - z * 32];
const HEIGHTS = Array.from({ length: SPIRES.levels[1] - SPIRES.levels[0] + 1 }, (_, i) => (SPIRES.levels[0] + i) * STEP_LEVELS);

describe('a spire’s solid', () => {
  it('never leaves its tile, and stands its full height: its top is the land’s level', () => {
    for (const h of HEIGHTS) {
      for (let v = 0; v < 4; v++) {
        const s = spireShape(h, spireSeed(h, v));
        let top = 0;
        for (const nd of s.needles) {
          for (const g of nd.rings) {
            for (let i = 0; i < g.r.length; i++) {
              const a = nd.ang[i]!, u = g.cu + g.r[i]! * Math.cos(a), w = g.cv + g.r[i]! * Math.sin(a);
              expect(Number.isFinite(u) && Number.isFinite(w)).toBe(true);
              expect(u).toBeGreaterThan(0.01);
              expect(u).toBeLessThan(0.99);
              expect(w).toBeGreaterThan(0.01);
              expect(w).toBeLessThan(0.99);
            }
            top = Math.max(top, g.z);
          }
        }
        expect(top).toBeCloseTo(h, 6);
      }
    }
  });

  it('is the same at every detail: the sprite covers its painted self (one silhouette)', () => {
    for (const h of [8, 18, 28]) {
      const seed = spireSeed(h, 2);
      const sil = (detail: 0 | 1 | 2): string => {
        const r = recorder();
        drawSpire(r.ctx, P, h, { detail, seed, k: 1 });
        // Every face's fill and every needle's silhouette, in order (the marks and the ink apart).
        const under = r.styles[r.paths.findIndex((p, i) => i > 0 && p.length > 12)]!;
        return JSON.stringify(r.paths.filter((p, i) => p.length === 4 || r.styles[i] === under).map((p) => p.map(([x, y]) => [Math.round(x * 100), Math.round(y * 100)])));
      };
      expect(sil(0)).toBe(sil(2));
      expect(sil(1)).toBe(sil(2));
    }
  });

  it('stands in the shade’s reading where it is drawn: tall over its middle, nothing off its foot', () => {
    for (const h of [10, 28]) {
      const seed = spireSeed(h, 1), s = spireShape(h, seed);
      const main = s.needles.reduce((a, b) => (b.rings[b.rings.length - 1]!.z > a.rings[a.rings.length - 1]!.z ? b : a));
      const g = main.rings[main.rings.length - 2]!;
      expect(spireHeightAt(h, seed, g.cu, g.cv)).toBeGreaterThan(h * 0.6);
      expect(spireHeightAt(h, seed, 0.01, 0.01)).toBe(0);
    }
  });

  it('has a few looks a height, from the world tile', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 40; x++) seen.add(spireVariant(x, 7));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('the spires’ height in the relief (D147)', () => {
  it('reads the generator’s mark and stands to the content’s tallest', () => {
    expect(SPIRE_BIOME).toBe(BIOME.spire);
    expect(SPIRE_GROUND).toBe(BIOME.spireGround);
    expect(PEAK_TERRACE).toBe(SPIRES.levels[1]);
    expect(levelOf(T.Rock3, SPIRES.levels[1])).toBe(PEAK_LEVEL);
    expect(levelOf(T.Rock3, 6)).toBe(12);
  });

  it('a click high on a spire lands on it: the ray walks down from the tallest top', () => {
    // A spire of the tallest height on the floor at (10, 10).
    const land = { terrain: (x: number, y: number): number => (x === 10 && y === 10 ? T.Rock3 : T.Sand), level: (x: number, y: number): number => (x === 10 && y === 10 ? PEAK_TERRACE : 0) };
    expect(tileTop(land, 10, 10)).toBe(PEAK_LEVEL);
    // A point near its top: its ground point lies PEAK_LEVEL·SHIFT tiles back along −x −y.
    const back = (PEAK_LEVEL - 1) * SHIFT;
    expect(surfaceTile(land, 10.5 - back, 10.5 - back)).toEqual([10, 10]);
  });
});

describe('the paint windows and the spires', () => {
  /** A world of sand with one spire at (sx, sy), `lv` levels tall. */
  const world = (sx: number, sy: number, lv: number) => (cx: number, cy: number): ChunkArrays => {
    const n = 32 * 32, c: ChunkArrays = { terrain: new Uint8Array(n).fill(T.Sand), ore: new Uint8Array(n), rich: new Uint16Array(n), height: new Uint8Array(n), biome: new Uint8Array(n), level: new Uint8Array(n) };
    if (sx >> 5 === cx && sy >> 5 === cy) { const k = (sy & 31) * 32 + (sx & 31); c.terrain[k] = T.Rock3; c.level[k] = lv; c.biome[k] = SPIRE_BIOME; }
    return c;
  };

  it('list a spire whose top leans into the chunk from SPIRE_REACH tiles in front, and its height and look', () => {
    // Chunk (4, 4) spans 128 … 159; a spire 13 tiles in front of its far corner along +x +y.
    const sx = 159 + 13, sy = 159 + 13;
    expect(SPIRE_REACH).toBeGreaterThanOrEqual(Math.ceil(PEAK_LEVEL * SHIFT));
    const d = buildWindow(world(sx, sy, PEAK_TERRACE), 4, 4, 1024);
    expect(d.spires).toEqual([sx - (128 - BORDER), sy - (128 - BORDER), PEAK_LEVEL, spireVariant(sx, sy)]);
    expect(hasRock(d)).toBe(true);
    // Its top reaches back into the chunk: PEAK_LEVEL·SHIFT tiles along −x −y.
    expect(sx - PEAK_LEVEL * SHIFT).toBeLessThan(160);
  });

  it('keep a spire out of the terraces: no column, no masks; the floor round it', () => {
    const d = buildWindow(world(140, 140, 9), 4, 4, 1024);
    const { lv, masks } = windowLevels(d);
    const o = (140 - 128 + BORDER) * WIN + (140 - 128 + BORDER);
    expect(d.level[o]).toBe(9);
    expect(lv[o]).toBe(0);
    for (const m of masks) expect(m[o]).toBe(0);
    expect(d.spires).toEqual([140 - 128 + BORDER, 140 - 128 + BORDER, 18, spireVariant(140, 140)]);
  });
});
