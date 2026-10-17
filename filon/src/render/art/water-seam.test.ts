// water-seam.test.ts — where a river meets its lake, and where a chunk ends (D94; owner,
// 2026-10-17: « les rivières sont un peu cassées des fois, à la frontière entre eau bleue claire et
// foncée »). No canvas in the test runner: a stand-in context records every fill — its colour, its
// alpha, its path, the clips in force — and `pixel` composites them at a point, as the canvas
// would (nonzero, source-over). Two chunks either side of a seam paint the same colours at the
// seam; along a river into its lake the water is unbroken (no ground between them) and its colour
// runs from the river's into the lake's without a step.
import { describe, expect, it } from 'vitest';
import { T } from '@/sim/types';
import { BORDER, WIN, type PaintData } from './paint-kit';
import { paintWater, RIVER_BIOME } from './gaps';
import { C } from './tokens';

type Path = number[][];
interface Fill { rgb: [number, number, number]; a: number; path: Path; clips: Path[] }

function parse(c: string): [number, number, number, number] {
  if (c.startsWith('#')) return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1];
  const m = c.match(/rgba?\(([^)]+)\)/)!;
  const p = m[1]!.split(',').map(Number);
  return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
}

/** A stand-in 2D context that records fills, and the paths stroked in each colour. */
function recorder(): { ctx: CanvasRenderingContext2D; fills: Fill[]; strokes: Array<{ color: string; path: Path }> } {
  const fills: Fill[] = [], strokes: Array<{ color: string; path: Path }> = [];
  let path: Path = [], cur: number[] = [];
  const st = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, clips: [] as Path[] };
  const stack: Array<typeof st> = [];
  const ctx: Record<string, unknown> = {
    save: () => { stack.push({ ...st, clips: [...st.clips] }); },
    restore: () => { Object.assign(st, stack.pop()!); },
    beginPath: () => { path = []; cur = []; },
    moveTo: (x: number, y: number) => { cur = [x, y]; path.push(cur); },
    lineTo: (x: number, y: number) => { cur.push(x, y); },
    closePath: () => {},
    clip: () => { st.clips.push(path); },
    fill: () => { const [r, g, b, a] = parse(String(st.fillStyle)); fills.push({ rgb: [r, g, b], a: a * st.globalAlpha, path, clips: [...st.clips] }); },
    stroke: () => { strokes.push({ color: String(st.strokeStyle), path }); },
  };
  const proxy = new Proxy(ctx, {
    get(o, k): unknown {
      if (k === 'fillStyle') return st.fillStyle;
      if (k === 'strokeStyle') return st.strokeStyle;
      if (k === 'globalAlpha') return st.globalAlpha;
      return k in o ? o[k as string] : () => undefined;
    },
    set(o, k, v): boolean {
      if (k === 'fillStyle') st.fillStyle = v; else if (k === 'strokeStyle') st.strokeStyle = v; else if (k === 'globalAlpha') st.globalAlpha = v; else o[k as string] = v;
      return true;
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, fills, strokes };
}

/** Is (x, y) inside a path (nonzero winding over its subpaths)? */
function inside(path: Path, x: number, y: number): boolean {
  let w = 0;
  for (const p of path) {
    for (let k = 0; k < p.length; k += 2) {
      const ax = p[k]!, ay = p[k + 1]!, bx = p[(k + 2) % p.length]!, by = p[(k + 3) % p.length]!;
      if (ay <= y) { if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++; }
      else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
    }
  }
  return w !== 0;
}

/** The fills composited at chunk px (x, y) over transparent ground: colour and coverage (0: no water). */
function pixel(fills: readonly Fill[], x: number, y: number): { rgb: [number, number, number]; a: number } {
  let rgb: [number, number, number] = [0, 0, 0], a = 0;
  for (const f of fills) {
    if (!f.clips.every((c) => inside(c, x, y)) || !inside(f.path, x, y)) continue;
    rgb = [0, 1, 2].map((i) => rgb[i]! * (1 - f.a) + f.rgb[i]! * f.a) as [number, number, number];
    a = a + f.a * (1 - a);
  }
  return { rgb, a };
}

/**
 * A world of sand with a lake (a disc of radius 8 round (161, 141), deep within 3) straddling the
 * seam between chunks (4, 4) and (5, 4) at x = 160, and a river three tiles wide flowing east into
 * it from x 140. The paint window of chunk (cx, 4).
 */
function world(cx: number): PaintData {
  const n = WIN * WIN, B = BORDER;
  const d: PaintData = {
    cx, cy: 4, terrain: new Uint8Array(n), ore: new Uint8Array(n), rich: new Uint16Array(n),
    height: new Uint8Array(n), biome: new Uint8Array(n), level: new Uint8Array(n),
  };
  for (let j = 0; j < WIN; j++) for (let i = 0; i < WIN; i++) {
    const x = cx * 32 - B + i, y = 4 * 32 - B + j, o = j * WIN + i;
    const r2 = (x - 161) ** 2 + (y - 141) ** 2;
    let t: number = T.Sand;
    if (r2 <= 64) t = r2 <= 9 ? T.Deep : T.Shallow;
    else if (x >= 140 && x < 161 && y >= 139 && y <= 141) { t = T.River; d.biome[o] = RIVER_BIOME; }
    d.terrain[o] = t;
  }
  return d;
}

/**
 * Two lakes (x 141 … 156 and 164 … 174, y 136 … 145) joined across the same seam by a strait one
 * tile wide (y 140), a river flowing into the first from x 120: the river lies in chunk (4, 4)'s
 * paint window, not in chunk (5, 4)'s. A thin strait is where keeping tiles in moves the outline.
 */
function longLake(cx: number): PaintData {
  const d = world(cx), B = BORDER;
  for (let j = 0; j < WIN; j++) for (let i = 0; i < WIN; i++) {
    const x = cx * 32 - B + i, y = 4 * 32 - B + j, o = j * WIN + i;
    let t: number = T.Sand;
    d.biome[o] = 0;
    if (((x >= 141 && x <= 156) || (x >= 164 && x <= 174)) && y >= 136 && y <= 145) t = T.Shallow;
    else if (x > 156 && x < 164 && y === 140) t = T.Shallow;
    else if (x >= 120 && x < 141 && y >= 139 && y <= 141) { t = T.River; d.biome[o] = RIVER_BIOME; }
    d.terrain[o] = t;
  }
  return d;
}

/** Where the ink paths stroked in `color` cross the vertical line at chunk px `x` (their y, rounded to a hundredth of a pixel). */
function crossings(strokes: ReadonlyArray<{ color: string; path: Path }>, color: string, x: number): number[] {
  const out: number[] = [];
  for (const s of strokes) {
    if (s.color !== color) continue;
    for (const p of s.path) for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k]!, ay = p[k + 1]!, bx = p[k + 2]!, by = p[k + 3]!;
      if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
      out.push(Math.round((ay + ((x - ax) * (by - ay)) / (bx - ax)) * 100) / 100);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

const PPT = 32;
const near = (p: [number, number, number], q: [number, number, number], tol: number): boolean => p.every((v, i) => Math.abs(v - q[i]!) <= tol);

describe('water where a river meets its lake, and across a chunk seam (D94)', () => {
  it('both chunks paint the same water at their seam', () => {
    const a = recorder(), b = recorder();
    paintWater(a.ctx, world(4), PPT);
    paintWater(b.ctx, world(5), PPT);
    let wet = 0;
    for (let y = 130; y < 152; y += 0.25) {
      const py = (y - 128) * PPT;
      // World x 160 is chunk 4's right edge (px 32·ppt) and chunk 5's left (px 0); each chunk's
      // paths reach a little past its edge, so both are read at the same points, a hair either side.
      for (const dx of [-0.25, 0.25]) {
        const pa = pixel(a.fills, 32 * PPT + dx, py), pb = pixel(b.fills, dx, py);
        expect(Math.abs(pa.a - pb.a), `coverage at y ${y}`).toBeLessThan(0.02);
        if (pa.a > 0.5) { wet++; expect(near(pa.rgb, pb.rgb, 3), `colour at y ${y}: ${pa.rgb} / ${pb.rgb}`).toBe(true); }
      }
    }
    expect(wet).toBeGreaterThan(30);
  });

  it('a strait across the seam: the same water and shore in both chunks, a river in one window only', () => {
    // Before: a window with a river drew the shore round all the water with every tile kept in,
    // one without it without — the lake's edge moved at the seam.
    const a = recorder(), b = recorder();
    paintWater(a.ctx, longLake(4), PPT);
    paintWater(b.ctx, longLake(5), PPT);
    const ca = crossings(a.strokes, C.ink, 32 * PPT), cb = crossings(b.strokes, C.ink, 0);
    expect(ca).toEqual(cb);
    for (let y = 138; y < 143; y += 0.05) for (const dx of [-0.25, 0.25]) {
      const pa = pixel(a.fills, 32 * PPT + dx, (y - 128) * PPT), pb = pixel(b.fills, dx, (y - 128) * PPT);
      expect(Math.abs(pa.a - pb.a), `coverage at y ${y}`).toBeLessThan(0.02);
      if (pa.a > 0.5) expect(near(pa.rgb, pb.rgb, 3), `colour at y ${y}`).toBe(true);
    }
  });

  it('a river runs into its lake unbroken: water all the way, its colour going from the river\'s to the shallows\' without a step', () => {
    const a = recorder();
    paintWater(a.ctx, world(4), PPT);
    const river = parse(C.river), shallow = parse(C.shallow);
    let last: [number, number, number] | null = null, step = 0;
    for (let x = 146; x < 157; x += 0.1) {
      const p = pixel(a.fills, (x - 128) * PPT, (140.5 - 128) * PPT);
      expect(p.a, `water at x ${x.toFixed(1)}`).toBeGreaterThan(0.99);
      if (last) step = Math.max(step, ...p.rgb.map((v, i) => Math.abs(v - last![i]!)));
      last = p.rgb;
    }
    // Up the river its own blue (its middle a little deeper, D115: no longer the shallows'); at the
    // lake's edge the shallows' (the deep heart further in).
    const up = pixel(a.fills, (146 - 128) * PPT, 12.5 * PPT).rgb;
    expect(near(up, [shallow[0], shallow[1], shallow[2]], 30), `the river's blue ${up}`).toBe(false);
    expect(up[2] >= up[0] + 60, `the river's blue ${up} against ${river}`).toBe(true);
    // The lake's turquoise, between its shallows and its middle (D115's depth bands).
    expect(near(pixel(a.fills, (155.5 - 128) * PPT, 12.5 * PPT).rgb, [shallow[0], shallow[1], shallow[2]], 40)).toBe(true);
    // A tenth of a tile never changes it by more than a band's worth (the old seam: the whole gap
    // between the two colours at once, and ground between them).
    expect(step, 'the largest step between neighbouring samples').toBeLessThan(24);
  });
});
