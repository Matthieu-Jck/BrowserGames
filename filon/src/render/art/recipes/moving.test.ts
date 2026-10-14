// moving.test.ts — buildings with a moving part draw their body and every phase of the part
// (in every baked rotation) without a canvas; lights on a part sit on its axis, so the night
// glow placed from the static art is right in any phase; the sand wheel never crosses its split
// plane. The silhouette context keeps solid fills only, in one colour; every building can be
// drawn as its own cast shadow.
import { describe, it, expect } from 'vitest';
import { BUILDING_IDS, isBeltDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import type { Rot } from '@/sim/types';
import { flat, type Ctx } from '../ink';
import { IsoFrame } from '../iso-shapes';
import { silhouette } from '../silhouette';
import { artOf, isoArt } from './fx';
import { drawBuildingMoving, drawBuildingShadow, isoHead, needsRotations } from './buildings';
import { drawBuildingTopMoving } from './buildings-top';
import { MOVING, SAND_WHEEL, bucketFull } from './moving';

/** A stand-in 2D context: draws nothing, counts fills and remembers the style and alpha of each. */
function recorder(): { ctx: CanvasRenderingContext2D; fills: Array<{ style: unknown; alpha: unknown }> } {
  const fills: Array<{ style: unknown; alpha: unknown }> = [];
  const t: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(t, {
    get(o, k): unknown {
      if (k === 'fill' || k === 'fillRect') return () => { fills.push({ style: o.fillStyle, alpha: o.globalAlpha }); };
      if (k in o) return o[k];
      return () => undefined;
    },
    set(o, k, v): boolean { o[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

describe('moving parts', () => {
  it('draw their body and every phase of their part, in every baked rotation, both views', () => {
    for (const [id, spec] of Object.entries(MOVING) as Array<[BuildingId, { frames: number }]>) {
      for (const rot of (needsRotations(id) ? [0, 1, 2, 3] : [0]) as Rot[]) {
        let n = 0;
        artOf((ctx) => {
          const r = drawBuildingMoving(id, rot, spec.frames, () => ({ ctx, canvas: null }));
          n = r?.parts.length ?? -1;
        });
        expect(n, `${id}:${rot}`).toBe(spec.frames);
        let m = 0;
        artOf((ctx) => { m = drawBuildingTopMoving(id, rot, spec.frames, () => ({ ctx, canvas: null }))?.parts.length ?? -1; });
        expect(m, `${id}:${rot} plan`).toBe(spec.frames);
      }
    }
    expect(drawBuildingMoving('drill', 0, 4, () => ({ ctx: recorder().ctx as unknown as Ctx, canvas: null }))).toBeNull();
  });

  it('the turbine’s red light sits on its axis: the same in the static art and in every phase', () => {
    const f = new IsoFrame(2, 2, 0, isoHead('wind_flower'));
    const all = artOf((ctx) => { drawBuildingMoving('wind_flower', 0, MOVING.wind_flower!.frames, () => ({ ctx, canvas: null })); }, f.ox, f.oy);
    const reds = all.emitters.filter((e) => e.glow === 'red');
    expect(reds.length).toBe(1);
    const still = isoArt('wind_flower', 0).emitters.filter((e) => e.glow === 'red');
    expect(still.length).toBe(1);
    expect(reds[0]!.x).toBeCloseTo(still[0]!.x, 0);
    expect(reds[0]!.y).toBeCloseTo(still[0]!.y, 0);
  });

  it('the sand wheel stays behind its split plane; buckets fill at the bottom and tip past the crest', () => {
    expect(SAND_WHEEL.cy - SAND_WHEEL.r - 0.095).toBeGreaterThanOrEqual(SAND_WHEEL.split);
    expect(bucketFull(0)).toBe(true);           // rising up the back
    expect(bucketFull(Math.PI / 2)).toBe(true); // at the crest
    expect(bucketFull(Math.PI)).toBe(false);    // coming down the front, emptied
    expect(bucketFull(-Math.PI / 2)).toBe(false); // digging at the bottom
  });
});

describe('cast shadows', () => {
  it('the silhouette keeps solid fills only, all in one colour, and follows save / restore', () => {
    const rec = recorder();
    const ctx = silhouette(rec.ctx);
    const sq: Array<[number, number]> = [[0, 0], [4, 0], [4, 4], [0, 4]];
    flat(ctx, sq, '#ec5f43', 0.2); // a baked shadow, a halo: dropped
    flat(ctx, sq, '#ec5f43');      // a solid part: kept, in white
    ctx.globalAlpha = 0.9;
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.restore();
    expect(ctx.globalAlpha).toBeCloseTo(0.9, 9);
    flat(ctx, sq, '#1b1830', 0.8);
    expect(rec.fills).toEqual([{ style: '#ffffff', alpha: 1 }, { style: '#ffffff', alpha: 1 }]);
  });

  it('every building can be drawn as its own cast shadow', () => {
    for (const id of BUILDING_IDS) {
      if (isBeltDef(id)) continue;
      for (const rot of (needsRotations(id as BuildingId) ? [0, 1] : [0]) as Rot[]) {
        const rec = recorder();
        drawBuildingShadow(id as BuildingId, rot, 0.42, 0, silhouette(rec.ctx));
        expect(rec.fills.length, `${id}:${rot}`).toBeGreaterThan(0);
      }
    }
  });
});
