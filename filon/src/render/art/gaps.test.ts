// gaps.test.ts — map 4's gaps painted (D94): a chasm's tiles get a crevasse (its lit far wall, its depths, a near-black strip), a
// river's its running water and the strokes along its way; the painter's river code is the
// generator's. A recorder stands in for the canvas: it notes the style of every fill and stroke.
import { describe, it, expect } from 'vitest';
import { BIOME } from '@/sim/world/mapgen';
import { T } from '@/sim/types';
import { C } from './tokens';
import { BORDER, RIVER_BIOME, WIN, paintChunk, type PaintData } from './terrain';
import { CREVASSE, SEA_BIOME } from './gaps';

/** A stand-in 2D context: draws nothing, records the style of each fill and stroke. */
function recorder(): { ctx: CanvasRenderingContext2D; fills: string[]; strokes: string[] } {
  const fills: string[] = [], strokes: string[] = [];
  const t: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(t, {
    get(o, k): unknown {
      if (k === 'fill' || k === 'fillRect') return () => { fills.push(String(o.fillStyle)); };
      if (k === 'stroke') return () => { strokes.push(String(o.strokeStyle)); };
      if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (k in o) return o[k];
      return () => undefined;
    },
    set(o, k, v): boolean { o[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes };
}

/** A paint window of floor with a band of `t` three tiles wide down the chunk (window columns 10–12), a river flowing south. */
function band(t: number): PaintData {
  const n = WIN * WIN, B = BORDER;
  const d: PaintData = {
    cx: 4, cy: 4, terrain: new Uint8Array(n).fill(T.Sand), ore: new Uint8Array(n), rich: new Uint16Array(n),
    height: new Uint8Array(n), biome: new Uint8Array(n), level: new Uint8Array(n),
  };
  for (let j = 0; j < WIN; j++) for (let i = B + 10; i < B + 13; i++) {
    d.terrain[j * WIN + i] = t;
    if (t === T.River) d.biome[j * WIN + i] = RIVER_BIOME + 2;
  }
  return d;
}

const scratch = (): OffscreenCanvas => ({ getContext: () => recorder().ctx }) as unknown as OffscreenCanvas;

describe('map 4\'s gaps painted (D94)', () => {
  it('the painter reads a river\'s way and the sea where the generator writes them', () => {
    expect(RIVER_BIOME).toBe(BIOME.river);
    expect(SEA_BIOME).toBe(BIOME.sea);
  });

  it('a chasm is a crevasse: its far wall lit at the lip and darker band by band, the near-black only a strip, stones on the lip', () => {
    const { ctx, fills, strokes } = recorder();
    paintChunk(ctx, band(T.Chasm), 32, scratch);
    for (const c of [CREVASSE.lip, ...CREVASSE.wall, CREVASSE.haze, CREVASSE.bottom, CREVASSE.stone]) expect(fills, c).toContain(c);
    expect(fills).not.toContain(C.river);
    expect(strokes.length).toBeGreaterThan(5); // strata, cracks, hatching, the lips
    // Far zooms: the bands, the strip and the rim; no stones.
    const far = recorder();
    paintChunk(far.ctx, band(T.Chasm), 8, scratch);
    expect(far.fills).toContain(CREVASSE.bottom);
    expect(far.fills).not.toContain(CREVASSE.stone);
  });

  it('a river: its running water and the strokes along its way (near zooms)', () => {
    const near = recorder();
    paintChunk(near.ctx, band(T.River), 32, scratch);
    expect(near.fills).toContain(C.river);
    expect(near.fills).not.toContain(C.chasm);
    expect(near.strokes.filter((s) => s.startsWith('rgba(255,255,255')).length).toBeGreaterThan(10);
    const far = recorder();
    paintChunk(far.ctx, band(T.River), 8, scratch);
    expect(far.fills).toContain(C.river);
    expect(far.strokes.filter((s) => s.startsWith('rgba(255,255,255')).length).toBe(0);
  });
});
