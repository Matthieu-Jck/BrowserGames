import { describe, it, expect } from 'vitest';
import { apply, compose, ease, invert, ISO_LIN, isoToView, proj, screenTile, TOP, visibleChunksP } from './projection';
import { tileToIso } from './iso';

const close = (a: readonly number[], b: readonly number[], eps = 1e-9): void => a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(eps));

describe('view projection (iso ⇄ plan morph)', () => {
  it('t = 0 is the 2:1 isometric grid of iso.ts, t = 1 the axis-aligned plan at TOP px per tile', () => {
    for (const [x, y] of [[0, 0], [3, 7], [-5, 2], [512.5, 511.25]] as const) close(apply(proj(0), x, y), tileToIso(x, y), 1e-6);
    const P = proj(1);
    close([P.a, P.b, P.c, P.d], [TOP, 0, 0, TOP], 1e-9);
  });

  it('every intermediate projection is invertible and round-trips tiles exactly', () => {
    for (const t of [0, 0.1, 0.35, 0.5, 0.8, 1]) {
      const P = proj(t), I = invert(P);
      for (const [x, y] of [[0, 0], [12.25, -3.5], [700, 300]] as const) close(apply(I, ...apply(P, x, y)), [x, y], 1e-6);
      close(Object.values(compose(I, P)), [1, 0, 0, 1], 1e-12);
    }
  });

  it('isoToView maps iso pixels onto the view: identity in iso, the plan in plan', () => {
    close(Object.values(isoToView(ISO_LIN)), [1, 0, 0, 1], 1e-12);
    const M = isoToView(proj(1));
    close(apply(M, ...tileToIso(4, 9)), apply(proj(1), 4, 9), 1e-6);
  });

  it('the ease is a smoothstep: fixed ends, symmetric, monotone', () => {
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1); expect(ease(0.5)).toBe(0.5);
    expect(ease(-1)).toBe(0); expect(ease(2)).toBe(1);
    for (let t = 0; t < 1; t += 0.05) expect(ease(t + 0.05)).toBeGreaterThanOrEqual(ease(t));
    expect(ease(0.2) + ease(0.8)).toBeCloseTo(1, 12);
  });

  it('screenTile inverts the camera + projection: a tile centre on screen picks that tile', () => {
    const W = 1440, H = 900;
    for (const t of [0, 0.5, 1]) {
      const P = proj(t);
      for (const zoom of [0.25, 1, 2]) {
        const [cx, cy] = apply(P, 512.5, 512.5);
        const cam = { cx, cy, zoom };
        for (const [tx, ty] of [[512, 512], [520, 505], [498, 530]] as const) {
          const [X, Y] = apply(P, tx + 0.5, ty + 0.5);
          const sx = (X - cam.cx) * zoom + W / 2, sy = (Y - cam.cy) * zoom + H / 2;
          const [gx, gy] = screenTile(P, cam, W, H, sx, sy);
          expect([Math.floor(gx), Math.floor(gy)]).toEqual([tx, ty]);
        }
      }
    }
  });

  it('visible chunks cover the chunk under the camera centre in every view', () => {
    for (const t of [0, 0.5, 1]) {
      const P = proj(t);
      const [cx, cy] = apply(P, 640, 320);
      const chunks = visibleChunksP(P, { cx, cy, zoom: 1 }, 1440, 900);
      expect(chunks.some(([x, y]) => x === 20 && y === 10)).toBe(true);
    }
  });
});
