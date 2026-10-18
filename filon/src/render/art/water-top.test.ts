// water-top.test.ts — the water up on the rock as one body (D135; owner, 2026-10-18: « cascade is
// still slightly broken here, there's a brown stripe inside the lake »; « it is also a bit broken
// when the water goes straight towards the camera like this »). Each column's sprite draws its own
// tile from the 7 × 7 round it, so the outline and the depth two neighbours compute where they meet
// must agree — for a stream running each of the eight ways, a lake and its outflow, two streams
// side by side; a straight stream keeps its width; its marks fall every third tile along it, never
// on two tiles in a row; a fall's lip spans its water, two falling side by side make one sheet; no
// bank lies across water between a lake and its outflow; in plan the floor's water and the water up
// on the rock are painted apart (the rock map between them).
import { describe, expect, it } from 'vitest';
import { T } from '@/sim/types';
import { BORDER, WIN, columnLook, waterCells, waterMark, windowLevels, type PaintData } from './terrain';
import { exitOf, paintWater } from './gaps';
import { C } from './tokens';
import { contour, depthAt, inWater, lipSpan, samples } from './water-top';

const B = BORDER;
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** A window: a massif of H2 at `level` over the middle of it. */
function massif(level = 2): PaintData {
  const n = WIN * WIN;
  const d: PaintData = {
    cx: 4, cy: 4, terrain: new Uint8Array(n).fill(T.Sand), ore: new Uint8Array(n), rich: new Uint16Array(n),
    height: new Uint8Array(n), biome: new Uint8Array(n), level: new Uint8Array(n),
  };
  for (let j = B + 1; j < B + 31; j++) for (let i = B + 1; i < B + 31; i++) { d.terrain[j * WIN + i] = T.Rock2; d.level[j * WIN + i] = level; }
  return d;
}
const river = (d: PaintData, i: number, j: number, flow: number): void => { const o = j * WIN + i; d.terrain[o] = T.River; d.biome[o] = 16 + flow; };

/** Every raised tile's look in the middle of the window. */
function looks(d: PaintData): Map<string, ReturnType<typeof columnLook>> {
  const { lv } = windowLevels(d), out = new Map<string, ReturnType<typeof columnLook>>();
  for (let j = B + 4; j < B + 28; j++) for (let i = B + 4; i < B + 28; i++) if (lv[j * WIN + i]) out.set(`${i},${j}`, columnLook(d, lv, j * WIN + i));
  return out;
}

/**
 * Where two raised tiles meet (an edge or a corner), both read the same water: the same outline
 * (in or out of it) and the same depth at points along their shared boundary; and a tile with no
 * top of its own has no water at its edges.
 */
function seamless(d: PaintData): { pairs: number } {
  const all = looks(d);
  let pairs = 0;
  const pts: Array<[number, number]> = [];
  for (let q = 0; q <= 20; q++) pts.push([q / 20, 0], [q / 20, 1], [0, q / 20], [1, q / 20]);
  for (const [key, a] of all) {
    const [i, j] = key.split(',').map(Number) as [number, number];
    const va = a.top ? samples(a.top.cells) : null;
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 0], [0, -1]] as const) {
      const b = all.get(`${i + di},${j + dj}`);
      if (!b) continue;
      const vb = b.top ? samples(b.top.cells) : null;
      for (const [u, v] of pts) {
        const ub = u - di, vb2 = v - dj;
        if (ub < 0 || ub > 1 || vb2 < 0 || vb2 > 1) continue; // not on the other tile's rim
        const wa = va ? inWater(va, u, v) : false, wb = vb ? inWater(vb, ub, vb2) : false;
        expect(wa, `water at ${key} (${u}, ${v}) / ${i + di},${j + dj}`).toBe(wb);
        if (a.top && b.top && wa) expect(Math.min(1.1, depthAt(a.top.cells, u, v))).toBeCloseTo(Math.min(1.1, depthAt(b.top.cells, ub, vb2)), 9);
        pairs++;
      }
    }
  }
  return { pairs };
}

describe('the water up on the rock as one body (D135)', () => {
  it('a stream running each of the eight ways: its tiles and the rock beside them agree where they meet, and it keeps its width', () => {
    for (let f = 0; f < 8; f++) {
      const d = massif();
      // A straight stream through the middle, 13 tiles long, running way f.
      const cs: Array<[number, number]> = [];
      for (let s = -6; s <= 6; s++) { const i = B + 16 + DX[f]! * s, j = B + 16 + DY[f]! * s; river(d, i, j, f); cs.push([i, j]); }
      expect(seamless(d).pairs).toBeGreaterThan(100);
      // Its width: the depth at each inner tile's middle (its channel's middle) the same all along.
      const { lv } = windowLevels(d);
      const mids = cs.slice(3, -3).map(([i, j]) => depthAt(columnLook(d, lv, j * WIN + i).top!.cells, 0.5, 0.5));
      for (const m of mids) expect(m).toBeCloseTo(mids[0]!, 9);
      expect(mids[0]).toBeGreaterThan(f % 2 ? 0.15 : 0.25);
    }
  });

  it('two streams side by side, a widening and a bend, and a lake with its outflow: seamless too', () => {
    const d = massif();
    // A stream east, a second lane beside it from its middle on (a widening), then a bend south-east.
    for (let i = B + 6; i <= B + 16; i++) river(d, i, B + 10, 0);
    for (let i = B + 11; i <= B + 16; i++) river(d, i, B + 11, 0);
    for (let s = 1; s <= 6; s++) river(d, B + 16 + s, B + 10 + s, 1);
    // A pool three tiles across, its stream leaving south.
    for (let j = B + 18; j <= B + 20; j++) for (let i = B + 8; i <= B + 10; i++) d.terrain[j * WIN + i] = j === B + 19 && i === B + 9 ? T.Deep : T.Shallow;
    for (let j = B + 21; j <= B + 25; j++) river(d, B + 9, j, 2);
    expect(seamless(d).pairs).toBeGreaterThan(300);
  });

  it('out of a lake (owner: « a brown stripe inside the lake »): no bank across the water from the lake\'s middle down its outflow', () => {
    const d = massif();
    for (let j = B + 10; j <= B + 12; j++) for (let i = B + 10; i <= B + 12; i++) d.terrain[j * WIN + i] = T.Shallow;
    for (let j = B + 13; j <= B + 17; j++) river(d, B + 11, j, 2);
    const { lv } = windowLevels(d);
    // Down the middle, from the lake's middle tile into the stream: in the water, never at a bank.
    for (let j = B + 11; j <= B + 16; j++) {
      const cells = columnLook(d, lv, j * WIN + B + 11).top!.cells;
      for (let q = 0; q <= 10; q++) expect(depthAt(cells, 0.5, q / 10), `tile row ${j - B}, v ${q / 10}`).toBeGreaterThan(0.12);
    }
  });

  it('a stream\'s marks: every third tile along it, never on two in a row, its lanes out of step', () => {
    for (let f = 0; f < 8; f++) {
      const marked = Array.from({ length: 30 }, (_, s) => waterMark(100 + DX[f]! * s, 200 + DY[f]! * s, f) > 0);
      expect(marked.filter(Boolean).length).toBe(10);
      for (let s = 1; s < 30; s++) expect(marked[s] && marked[s - 1]).toBe(false);
    }
    // Still water: a ripple here and there, not on every tile.
    let n = 0;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) if (waterMark(x, y, -1)) n++;
    expect(n).toBeGreaterThan(150);
    expect(n).toBeLessThan(450);
  });

  it('a fall\'s lip spans its water; two streams falling side by side make one sheet', () => {
    // Two lanes running east, falling off the massif's east edge (to the floor, a level-0 river).
    const d = massif();
    for (const j of [B + 15, B + 16]) {
      for (let i = B + 20; i <= B + 30; i++) river(d, i, j, 0);
      river(d, B + 31, j, 0);
    }
    const { lv } = windowLevels(d);
    const top = (j: number) => columnLook(d, lv, j * WIN + B + 30).top!;
    expect(top(B + 15).fall).toBeGreaterThan(0);
    // The east side, north to south: the upper lane's water runs on past its south end into the
    // lower lane's, which runs on past its north end — one lip, its outer ends at the banks.
    const a = lipSpan(top(B + 15).cells, [1, 0], [1, 1])!, b = lipSpan(top(B + 16).cells, [1, 0], [1, 1])!;
    expect(a.openB && b.openA).toBe(true);
    expect(a.openA || b.openB).toBe(false);
    expect(a.fa).toBeGreaterThan(0.05);
    expect(1 - b.fb).toBeGreaterThan(0.05);
    // A lone stream's lip: as wide as its channel, the same both sides of its middle.
    const e = massif();
    for (let i = B + 20; i <= B + 31; i++) river(e, i, B + 15, 0);
    const lone = lipSpan(columnLook(e, windowLevels(e).lv, (B + 15) * WIN + B + 30).top!.cells, [1, 0], [1, 1])!;
    expect(lone.fa).toBeCloseTo(1 - lone.fb, 6);
    expect(lone.fb - lone.fa).toBeGreaterThan(0.5);
  });

  it('the 7 × 7 a tile reads: the water at its height, the foot of its fall joined on', () => {
    const d = massif();
    for (let i = B + 20; i <= B + 30; i++) river(d, i, B + 15, 0);
    const { lv } = windowLevels(d), cells = waterCells(d, lv, (B + 15) * WIN + B + 30);
    // Its own row: the stream (way 0) to its west, the foot of its fall (on the floor) east of it.
    expect(cells.slice(21, 28)).toBe('0000x..');
    expect(contour(samples(cells)).banks.length).toBeGreaterThan(0);
  });
});

describe('where a fall lands (D135; owner: « if there\'s a waterfall, there should be water where it lands »)', () => {
  it('a river turning as it falls pours where it runs on: into the water beside its way, not onto the dry tile its way points at', () => {
    // A stream on the massif (level 2) running east to its edge; the river goes on on the floor one
    // tile north-east of its last tile (the tile east of it is dry sand).
    const d = massif();
    for (let i = B + 20; i <= B + 30; i++) river(d, i, B + 15, 0);
    for (let i = B + 31; i <= B + 35; i++) river(d, i, B + 14, 0);
    for (let i = B + 31; i <= B + 35; i++) { d.level[(B + 14) * WIN + i] = 0; }
    const o = (B + 15) * WIN + B + 30;
    expect(exitOf(d, o)).toBe((B + 14) * WIN + B + 31);
    const { lv } = windowLevels(d), top = columnLook(d, lv, o).top!;
    expect(top.flow).toBe(7);
    expect(top.fall).toBeGreaterThan(0);
    // Its sheet on the east face hangs at the face's north end, by the water it lands in.
    const east = lipSpan(top.cells, [1, 0], [1, 1])!;
    expect(east.fa).toBe(0);
    expect(east.fb).toBeLessThan(0.5);
    // The floor's water runs up to it (in plan and under the iso columns): the floor's pass takes the falling tile in.
    const fills: number[][][] = [];
    let path: number[][] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(o2, k): unknown {
        if (k === 'beginPath') return () => { path = []; };
        if (k === 'moveTo') return (x: number, y: number) => { path.push([x, y]); };
        if (k === 'lineTo') return (x: number, y: number) => { path[path.length - 1]!.push(x, y); };
        // The water's own fill (the shallows: the outline), not the foam drawn over it.
        if (k === 'fill') return () => { if (o2.fillStyle === C.shallow) fills.push(path); };
        return k in o2 ? o2[k as string] : () => undefined;
      },
      set(o2, k, v): boolean { o2[k as string] = v; return true; },
    }) as unknown as OffscreenCanvasRenderingContext2D;
    const floorOnly = (i: number, j: number): boolean => d.level[j * WIN + i] === 0 && (d.terrain[j * WIN + i] === T.River);
    // Is (x, y) px in the water painted (any fill's subpath, crossing count)?
    const wetAt = (x: number, y: number): boolean => fills.some((p) => p.some((sp) => {
      let c = false;
      for (let q = 0, r = sp.length - 2; q < sp.length; r = q, q += 2) {
        const [xi, yi, xj, yj] = [sp[q]!, sp[q + 1]!, sp[r]!, sp[r + 1]!];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    }));
    // Just inside the dry tile at the fall's foot, by the corner it pours over (the falling tile's
    // north-east corner, 31 tiles in, 15 down): dry with the floor's water alone, wet with the fall.
    const ppt = 32, fx = 31.12 * ppt, fy = 15.12 * ppt;
    paintWater(ctx, d, ppt, floorOnly);
    expect(fills.length).toBeGreaterThan(0);
    expect(wetAt(fx, fy)).toBe(false);
    fills.length = 0;
    paintWater(ctx, d, ppt, (i, j) => floorOnly(i, j) || j * WIN + i === o);
    expect(wetAt(fx, fy)).toBe(true);
  });

  it('a stream turning at its own level by a ledge does not fall over it', () => {
    // A stream east along a ledge's edge that turns south at its level: the tile east of the turn is
    // lower rock, its way (east) points at it, but the water goes on south.
    const d = massif();
    for (let j = B + 1; j < B + 31; j++) for (let i = B + 21; i < B + 31; i++) d.level[j * WIN + i] = 1;
    for (let i = B + 12; i <= B + 20; i++) river(d, i, B + 10, 0);
    for (let j = B + 11; j <= B + 16; j++) river(d, B + 20, j, 2);
    const { lv } = windowLevels(d), top = columnLook(d, lv, (B + 10) * WIN + B + 20).top!;
    expect(top.fall).toBe(0);
    expect(top.flow).toBe(2);
  });
});

describe('in plan (D135)', () => {
  it('the floor\'s water and the water up on the rock are painted apart: the floor\'s pass leaves the stream on the massif out', () => {
    const d = massif();
    for (let i = B + 6; i <= B + 20; i++) river(d, i, B + 12, 0);
    const fills: number[][][] = [];
    let path: number[][] = [], cur: number[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(o, k): unknown {
        if (k === 'beginPath') return () => { path = []; };
        if (k === 'moveTo') return (x: number, y: number) => { cur = [x, y]; path.push(cur); };
        if (k === 'lineTo') return (x: number, y: number) => { cur.push(x, y); };
        if (k === 'fill') return () => { fills.push(path); };
        return k in o ? o[k as string] : () => undefined;
      },
      set(o, k, v): boolean { o[k as string] = v; return true; },
    }) as unknown as OffscreenCanvasRenderingContext2D;
    const raised = (i: number, j: number): boolean => d.level[j * WIN + i]! > 0;
    paintWater(ctx, d, 32, (i, j) => !raised(i, j));
    expect(fills.length).toBe(0);
    paintWater(ctx, d, 32, raised);
    expect(fills.length).toBeGreaterThan(0);
  });
});
