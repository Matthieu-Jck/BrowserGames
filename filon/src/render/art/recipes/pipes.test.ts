// pipes.test.ts — the conduits as raised pipes in iso (D145): every piece the atlas bakes draws a
// tube and no lamp (a pipe has no lights of its own at night, like a ribbon), so does the fall down
// a terrace's wall; the run is the water ports' own tube (its axis, radius, flange, mouth), so pump
// → pipe → valve is one; the frames have room for the tallest part; and the atlas bakes every piece
// world/water-ports.ts `pipeOf` can ask for.
import { describe, it, expect } from 'vitest';
import type { Ctx } from '../ink';
import { artOf } from './fx';
import { drawFall } from './falls';
import { PIPE } from '../pipe-ports';
import { PIPE_BRANCHES, PIPE_PIECES, RUN, drawPipe, drawPipeBranch, pipeFrame } from './pipes';

/** How many fills and strokes a drawing makes (a context that only counts). */
function paints(draw: (ctx: Ctx) => void): number {
  let n = 0;
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(t, k): unknown {
      if (k === 'fill' || k === 'stroke') return () => { n++; };
      if (k in t) return t[k];
      return () => undefined;
    },
    set(t, k, v): boolean { t[k] = v; return true; },
  });
  draw(ctx as unknown as Ctx);
  return n;
}

describe('the conduit as a raised pipe (D145)', () => {
  it('every piece the atlas bakes draws its tube, and none bakes a lamp', () => {
    for (const { arms, mark } of PIPE_PIECES) {
      expect(paints((ctx) => drawPipe(ctx, pipeFrame(), arms, mark)), `${arms}${mark}`).toBeGreaterThan(20);
      expect(artOf((ctx) => drawPipe(ctx, pipeFrame(), arms, mark)).emitters, `${arms}${mark}`).toEqual([]);
    }
    for (const { side, full } of PIPE_BRANCHES) {
      expect(paints((ctx) => drawPipeBranch(ctx, pipeFrame(), side, full)), `b${side}`).toBeGreaterThan(5);
      expect(artOf((ctx) => drawPipeBranch(ctx, pipeFrame(), side, full)).emitters).toEqual([]);
    }
    for (const rot of [0, 1, 2, 3] as const) expect(artOf((ctx) => { drawFall(rot, 2, () => ({ ctx, canvas: null })); }).emitters).toEqual([]);
  });

  it('is the water ports’ own tube: their axis, radius, flange and mouth', () => {
    expect(RUN.z).toBe(PIPE.zc);
    expect(RUN.r).toBe(PIPE.r);
    expect(RUN.flange).toBe(PIPE.flange);
    expect(RUN.mouth).toBe(PIPE.tOut);
    // Raised: its underside clear of the ground, its axis about a quarter of a tile up (a level is half a tile).
    expect(RUN.z - RUN.r * 2).toBeGreaterThan(0.15);
    expect(RUN.z / 2).toBeGreaterThan(0.2);
    expect(RUN.z / 2).toBeLessThan(0.34);
    // The valve's wheel stands clear above the pipe's crown, and the frame has room for it all.
    expect(PIPE.wheelUp).toBeGreaterThan(0.2);
    expect(RUN.z + RUN.flange * 2).toBeLessThan(RUN.head);
  });

  it('the atlas bakes every piece a conduit tile can show: each straight and elbow with either end full or at a mouth, a full straight’s marks, every branch', () => {
    const keys = new Set(PIPE_PIECES.map((p) => `${p.arms}${p.mark}`));
    const pairs = [[1, 3], [0, 2], [0, 1], [1, 2], [2, 3], [0, 3]] as const;
    for (const [a, b] of pairs) for (const sa of ['1', '2']) for (const sb of ['1', '2']) {
      const arms = ['0', '0', '0', '0'];
      arms[a] = sa; arms[b] = sb;
      expect(keys.has(arms.join('')), arms.join('')).toBe(true);
    }
    for (const k of ['0101j', '0101g', '1010j', '1010g']) expect(keys.has(k)).toBe(true);
    expect(PIPE_BRANCHES.length).toBe(8);
  });
});
