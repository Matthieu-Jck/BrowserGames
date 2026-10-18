// rock.test.ts — the mountains' art (owner, 2026-10-16: « les montagnes ne sont pas très belles »):
// the strata are one table by height, so beds carry on from tile to tile; a step's rim bites only
// inwards and is no silhouette where the step above carries its wall on (no crate seams); a column
// is cut at its real ledges only; each step wears the rock of its height; a stream up on a massif
// (D94) is a column topped by running water that falls down the wall it pours over. A recorder
// stands in for the canvas: it notes the style of every fill.
import { describe, it, expect } from 'vitest';
import { T } from '@/sim/types';
import { ledges, levelOf, MAX_LEVEL, masksAt, STEP_LEVELS } from '../relief';
import { BEDS, columnSeed, columnVariant, drawColumn, ROCK, slabTop, topColor, wallColor } from './rock';
import { BORDER, WIN, columnLook, layersOf, windowLevels, type PaintData } from './terrain';
import { depthColor } from './water-top';
import { C, rgba } from './tokens';

/** A stand-in 2D context: draws nothing, records the fill style of each fill. */
function recorder(): { ctx: CanvasRenderingContext2D; fills: string[] } {
  const fills: string[] = [];
  const t: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(t, {
    get(o, k): unknown {
      if (k === 'fill' || k === 'fillRect') return () => { fills.push(String(o.fillStyle)); };
      if (k in o) return o[k];
      return () => undefined;
    },
    set(o, k, v): boolean { o[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

const field = (rows: number[][]) => (x: number, y: number): number => rows[y]?.[x] ?? 0;
const P = (u: number, v: number, z: number): [number, number] => [(u - v) * 64, (u + v) * 32 - z * 32];

describe('the strata', () => {
  it('are one table by height: rising, uneven, up past the highest rock, a thick bed every level or two', () => {
    for (let i = 1; i < BEDS.length; i++) expect(BEDS[i]!.z).toBeGreaterThan(BEDS[i - 1]!.z);
    expect(BEDS[BEDS.length - 1]!.z).toBeGreaterThan(MAX_LEVEL);
    const gaps = BEDS.slice(1).map((b, i) => b.z - BEDS[i]!.z);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.1);
    const majors = BEDS.filter((b) => b.rank === 2);
    expect(majors.length).toBeGreaterThanOrEqual(MAX_LEVEL / 2.2);
    for (const b of BEDS) expect(Math.abs(b.tone)).toBeLessThanOrEqual(1);
  });

  it('the harder the rock, the fewer beds it shows; the soft rock shows them all', () => {
    expect(ROCK.map((r) => r.minRank)).toEqual([...ROCK.map((r) => r.minRank)].sort());
    expect(ROCK[0]!.minRank).toBe(0);
  });
});

describe('the palette', () => {
  it('tops pale with height; walls deepen with it and darken in the shade', () => {
    const lum = (h: string): number => { const p = parseInt(h.slice(1), 16); return ((p >> 16) & 255) + ((p >> 8) & 255) + (p & 255); };
    for (let c = 0; c < 4; c++) {
      expect(lum(topColor(c, 8))).toBeGreaterThan(lum(topColor(c, 2)));
      expect(lum(wallColor(c, 0, 8))).toBeLessThan(lum(wallColor(c, 0, 0)));
      expect(lum(wallColor(c, 1, 2))).toBeLessThan(lum(wallColor(c, 0, 2)));
    }
    // Harder rock is darker: hardness reads in the colour too.
    for (let c = 1; c < 4; c++) expect(lum(ROCK[c]!.lit)).toBeLessThan(lum(ROCK[c - 1]!.lit));
  });
});

describe('a step’s rim', () => {
  const lone = masksAt(field([[0, 0, 0], [0, 4, 0], [0, 0, 0]]), 1, 1);

  it('bites only inwards: the top never leaves its tile, whatever the seed', () => {
    for (let seed = 1; seed < 40; seed++) {
      for (let t = 0; t < lone.length; t++) {
        for (const p of slabTop(lone, t, seed)) {
          expect(p.u).toBeGreaterThanOrEqual(-1e-9);
          expect(p.u).toBeLessThanOrEqual(1 + 1e-9);
          expect(p.v).toBeGreaterThanOrEqual(-1e-9);
          expect(p.v).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });

  it('is no silhouette where the step above carries the wall on (no seam at a terrace’s join); the top step’s rim is', () => {
    expect(lone.length).toBe(2);
    expect(slabTop(lone, 0, 7).some((p) => p.sil)).toBe(false);
    expect(slabTop(lone, 1, 7).every((p) => p.sil)).toBe(true);
  });

  it('meets the next tile’s where a wall runs on: no bite at a side’s ends', () => {
    // A long wall along +y: tiles 0..2 of a row two levels up, the floor south of them.
    const row = masksAt(field([[2, 2, 2], [0, 0, 0]]), 1, 0);
    for (let seed = 1; seed < 20; seed++) {
      const top = slabTop(row, 0, seed);
      // The south side's ends are the tile's corners (1, 1) and (0, 1): both on the rim.
      expect(top.some((p) => Math.abs(p.u - 1) < 1e-9 && Math.abs(p.v - 1) < 1e-9)).toBe(true);
      expect(top.some((p) => Math.abs(p.u) < 1e-9 && Math.abs(p.v - 1) < 1e-9)).toBe(true);
    }
  });

  it('is the same for the sprite and the far paint: one seed from the look', () => {
    const ms = [3, 0];
    expect(columnSeed(1, ms, columnVariant(5, 9))).toBe(columnSeed(1, ms, columnVariant(5, 9)));
    expect([0, 1]).toContain(columnVariant(123, 456));
  });
});

describe('ledges', () => {
  it('a column is cut where a lower step’s top shows in front of a chamfered step above, not at a corner’s chamfer', () => {
    // A diagonal front two steps high, the step above set back (x + y ≤ 2 at level 4, ≤ 3 at 2).
    const diag = (x: number, y: number): number => (x < 0 || y < 0 ? 0 : x + y <= 2 ? 4 : x + y <= 3 ? 2 : 0);
    expect(ledges(masksAt(diag, 1, 1), 0.2)).toEqual([0, 1]);
    // A lone column: its steps nest with the same chamfers.
    expect(ledges(masksAt(field([[0, 0, 0], [0, 4, 0], [0, 0, 0]]), 1, 1), 0.2)).toEqual([1]);
  });
});

describe('the layers', () => {
  it('each step wears the rock of the land at its height round it; with none there, the rock of the step above', () => {
    // A column of H3 three steps high; a neighbour of H2 at the first step's height, none at the second's.
    const rock = new Map<string, [number, number]>([['0,0', [2, 6]], ['1,0', [1, 2]]]);
    const rockAt = (i: number, j: number): number => rock.get(`${i},${j}`)?.[0] ?? -1;
    const levelAt = (i: number, j: number): number => rock.get(`${i},${j}`)?.[1] ?? 0;
    expect(layersOf(rockAt, levelAt, 0, 0, 2, 3)).toEqual([1, 2, 2]);
  });
});

describe('a stream up on a massif (D94)', () => {
  /** A window: a massif of H2 two levels up, a stream across it running east, falling to the floor at its east end. */
  function massif(): PaintData {
    const n = WIN * WIN, B = BORDER;
    const d: PaintData = {
      cx: 4, cy: 4, terrain: new Uint8Array(n).fill(T.Sand), ore: new Uint8Array(n), rich: new Uint16Array(n),
      height: new Uint8Array(n), biome: new Uint8Array(n), level: new Uint8Array(n),
    };
    for (let j = B + 4; j < B + 10; j++) for (let i = B + 4; i < B + 10; i++) { d.terrain[j * WIN + i] = T.Rock2; d.level[j * WIN + i] = 2; }
    for (let i = B + 4; i < B + 10; i++) { const o = (B + 7) * WIN + i; d.terrain[o] = T.River; d.biome[o] = 16; }
    return d;
  }

  it('stands at its level as a column, its top running water with its way and its fall', () => {
    expect(levelOf(T.River, 2)).toBe(2 * STEP_LEVELS);
    expect(levelOf(T.River, 0)).toBe(0);
    const d = massif(), { lv } = windowLevels(d), B = BORDER;
    const mid = columnLook(d, lv, (B + 7) * WIN + B + 6), end = columnLook(d, lv, (B + 7) * WIN + B + 9);
    expect(mid.top?.kind).toBe('river');
    expect(mid.top?.flow).toBe(0);
    expect(mid.top?.fall).toBe(0);
    expect(end.top?.fall).toBe(2 * STEP_LEVELS);
  });

  it('pours down the wall it runs off: a sheet of running water on that face, its top running water', () => {
    const d = massif(), { lv, masks } = windowLevels(d), B = BORDER, o = (B + 7) * WIN + B + 9;
    const look = columnLook(d, lv, o);
    const ms: number[] = [];
    for (let t = 0; t * STEP_LEVELS < lv[o]!; t++) ms.push(masks[t]![o]!);
    const { ctx, fills } = recorder();
    drawColumn(ctx, P, look.cls, ms, { detail: 2, seed: 3, k: 1, top: look.top });
    // Its top running water (the deep middle of the ramp, water-top.ts `depthColor`), its sheet down the wall.
    expect(fills).toContain(depthColor(1.05, 1));
    expect(fills).toContain(rgba(C.river, 0.94));
    // A stream that does not fall has no sheet.
    const mid = columnLook(d, lv, o - 3), rec = recorder();
    drawColumn(rec.ctx, P, mid.cls, ms, { detail: 2, seed: 3, k: 1, top: mid.top });
    expect(rec.fills).not.toContain(rgba(C.river, 0.94));
  });

  it('where a fall lands on the stream below (D115: « the falls flowing into the next segment »), that tile knows the water pouring in: its side there no bank, its corners whole, foam on it', () => {
    // The massif's stream falls a level onto a lower run of it going on east (levels 2, then 1).
    const d = massif(), B = BORDER;
    for (let i = B + 10; i < B + 14; i++) for (let j = B + 4; j < B + 10; j++) { const o = j * WIN + i; d.terrain[o] = T.Rock2; d.level[o] = 1; }
    for (let i = B + 10; i < B + 14; i++) { const o = (B + 7) * WIN + i; d.terrain[o] = T.River; d.biome[o] = 16; }
    const { lv, masks } = windowLevels(d), o = (B + 7) * WIN + B + 10;
    const look = columnLook(d, lv, o);
    // Its west neighbour (bit 3) pours into it; the tile after it does not.
    expect(look.top?.from).toBe(1 << 3);
    expect(columnLook(d, lv, o + 1).top?.from).toBeUndefined();
    // Its banks stand at its level: its column is whole (no side drops but none), not cut at a corner.
    expect(masks[0]![o]! & 0b1111).toBe(0);
    const { ctx, fills } = recorder();
    drawColumn(ctx, P, look.cls, [masks[0]![o]!], { detail: 2, seed: 3, k: 1, top: look.top });
    expect(fills).toContain('rgba(235,248,252,0.62)');
  });
});
