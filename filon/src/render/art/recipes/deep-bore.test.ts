// deep-bore.test.ts — the deep bore (moving.ts `BORE`; buildings.ts `boreBody` / `boreTable`): the
// drill's big brother stands far taller; its moving part (the rotary table, the kelly and the leg in
// front of them) carries no lamp in iso and only the beacon on its axis in plan, so the night lights
// and the switched-off look are right in any phase; the leg the part draws is the one exactly in
// front of the kelly, and nothing else the body draws comes near that column (the part, drawn over
// the body, would cover it); the kelly's square repeats every quarter turn, its period.
import { describe, it, expect } from 'vitest';
import type { Rot } from '@/sim/types';
import { IsoFrame } from '../iso-shapes';
import { terminalsOf } from '../terminals';
import { artOf } from './fx';
import { boreNearLeg, drawBuildingMoving, isoHead } from './buildings';
import { drawBuildingTopMoving } from './buildings-top';
import { BORE, MOVING, boreLeg, boreSquare } from './moving';

const ROTS: readonly Rot[] = [0, 1, 2, 3];
const FRAMES = MOVING.deep_bore!.frames;

/** The lights a drawing bakes (the night spy's emitters), sprite px from the anchor. */
const lights = (draw: (ctx: Parameters<Parameters<typeof artOf>[0]>[0]) => void): Array<{ x: number; y: number; glow: string }> => artOf(draw).emitters;

describe('the deep bore', () => {
  it('stands far taller than the drill it replaces', () => {
    expect(isoHead('deep_bore')).toBeGreaterThan(isoHead('drill') + 2.5);
    expect(BORE.top).toBeGreaterThan(5);
  });

  it('its part carries no lamp in iso, only the beacon on its axis in plan, in every phase and rotation', () => {
    for (const rot of ROTS) {
      const body = lights((ctx) => { drawBuildingMoving('deep_bore', rot, 0, () => ({ ctx, canvas: null })); });
      const all = lights((ctx) => { drawBuildingMoving('deep_bore', rot, FRAMES, () => ({ ctx, canvas: null })); });
      expect(body.length, `iso ${rot}`).toBeGreaterThan(6);
      expect(all.length, `iso ${rot}`).toBe(body.length);
      const top0 = lights((ctx) => { drawBuildingTopMoving('deep_bore', rot, 0, () => ({ ctx, canvas: null })); });
      const top = lights((ctx) => { drawBuildingTopMoving('deep_bore', rot, FRAMES, () => ({ ctx, canvas: null })); });
      const added = top.filter((e) => !top0.some((b) => b.x === e.x && b.y === e.y && b.glow === e.glow));
      expect(added.length, `plan ${rot}`).toBeGreaterThan(0);
      for (const e of added) {
        expect(e.glow).toBe('red');
        expect(e.x).toBeCloseTo(added[0]!.x, 1);
        expect(e.y).toBeCloseTo(added[0]!.y, 1);
      }
    }
  });

  it('the part draws the leg exactly in front of the kelly; the terminal stays clear of that column', () => {
    for (const rot of ROTS) {
      const f = new IsoFrame(3, 3, rot, isoHead('deep_bore'));
      const axis = f.p(BORE.cx, BORE.cy)[0];
      const near = boreNearLeg(f), [lx, ly] = boreLeg(near, 0);
      expect(Math.abs(f.p(lx, ly)[0] - axis), `rot ${rot}`).toBeLessThan(0.5);
      for (let k = 0; k < 4; k++) if (k !== near) { const [x, y] = boreLeg(k, 0); expect(f.depth(x, y)).toBeLessThan(f.depth(lx, ly)); }
      for (const t of terminalsOf('deep_bore')) expect(Math.abs(f.p(t.x, t.y)[0] - axis), `terminal, rot ${rot}`).toBeGreaterThan(24);
    }
  });

  it('the kelly’s square repeats every quarter turn, its period', () => {
    const key = (pts: Array<[number, number]>): string[] => pts.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).sort();
    for (const a of [0, 0.3, 1.1]) expect(key(boreSquare(a + Math.PI / 2, BORE.kelly))).toEqual(key(boreSquare(a, BORE.kelly)));
    expect(MOVING.deep_bore!.sym).toBe(4);
  });
});
