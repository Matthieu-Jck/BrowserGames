// vein.test.ts — a face ore's vein (D87): a rock tile holding quartz is a vein column (terrain.ts
// `columnLook`), drawn with its seam and crystals on its walls (rock.ts `drawColumn`'s `vein`; the
// far paint keeps only the seam at its lightest detail); in plan a vein shows its crystals along the
// edges that drop to lower ground (`paintChunk`), while a buried one keeps the faint hidden dot. A
// recorder stands in for the canvas: it notes the style of every fill.
import { describe, it, expect } from 'vitest';
import { ITEM_IDS } from '@/content/registry';
import { T } from '@/sim/types';
import { masksAt } from '../relief';
import { QZ, drawColumn } from './rock';
import { BORDER, WIN, columnLook, paintChunk, windowLevels, type PaintData } from './terrain';

/** A stand-in 2D context: draws nothing, records the fill style of each fill. */
function recorder(): { ctx: CanvasRenderingContext2D; fills: string[] } {
  const fills: string[] = [];
  const t: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(t, {
    get(o, k): unknown {
      if (k === 'fill' || k === 'fillRect') return () => { fills.push(String(o.fillStyle)); };
      if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (k in o) return o[k];
      return () => undefined;
    },
    set(o, k, v): boolean { o[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

const QUARTZ = ITEM_IDS.indexOf('quartz' as (typeof ITEM_IDS)[number]);
const IRON = ITEM_IDS.indexOf('iron_ore' as (typeof ITEM_IDS)[number]);

/** A paint window: a 5×5 block of rock one level up in the chunk, floor round it; ores where asked (window coords). */
function field(ores: ReadonlyArray<readonly [number, number, number]>): PaintData {
  const n = WIN * WIN, B = BORDER;
  const d: PaintData = {
    cx: 4, cy: 4, terrain: new Uint8Array(n).fill(T.Sand), ore: new Uint8Array(n), rich: new Uint16Array(n),
    height: new Uint8Array(n), biome: new Uint8Array(n), level: new Uint8Array(n),
  };
  for (let j = B + 5; j < B + 10; j++) for (let i = B + 5; i < B + 10; i++) { d.terrain[j * WIN + i] = T.Rock2; d.level[j * WIN + i] = 1; }
  for (const [i, j, item] of ores) { d.ore[j * WIN + i] = item + 1; d.rich[j * WIN + i] = 400; }
  return d;
}

describe('the face ore’s vein (D87)', () => {
  it('a rock tile holding a face ore is a vein column; other ores and bare rock are not', () => {
    expect(QUARTZ).toBeGreaterThanOrEqual(0);
    const B = BORDER;
    const d = field([[B + 9, B + 7, QUARTZ], [B + 5, B + 7, IRON]]);
    const { lv } = windowLevels(d);
    expect(columnLook(d, lv, (B + 7) * WIN + B + 9).vein).toBe(true);
    expect(columnLook(d, lv, (B + 7) * WIN + B + 5).vein).toBe(false);
    expect(columnLook(d, lv, (B + 7) * WIN + B + 7).vein).toBe(false);
  });

  it('a vein column wears crystals on its walls; the far paint’s lightest detail only the seam', () => {
    const lv = (x: number, y: number): number => (x === 0 && y === 0 ? 2 : 0);
    const P = (u: number, v: number, z: number): [number, number] => [(u - v) * 64, (u + v) * 32 - z * 32];
    const draw = (detail: 0 | 1 | 2, vein: boolean): string[] => {
      const { ctx, fills } = recorder();
      drawColumn(ctx, P, 1, masksAt(lv, 0, 0), { detail, seed: 7, k: 1, vein });
      return fills;
    };
    expect(draw(2, false).filter((f) => f === QZ.lit)).toHaveLength(0);
    expect(draw(2, true).filter((f) => f === QZ.lit).length).toBeGreaterThan(4);
    expect(draw(1, true).filter((f) => f === QZ.lit).length).toBeGreaterThan(2);
    const far = draw(0, true);
    expect(far.filter((f) => f === QZ.lit)).toHaveLength(0);
    expect(far).toContain(QZ.body);
  });

  it('in plan a bared vein shows crystals along its face; a buried one only the hidden dot', () => {
    const B = BORDER;
    const paint = (d: PaintData): string[] => {
      const { ctx, fills } = recorder();
      paintChunk(ctx, d, 32, () => ({ getContext: () => recorder().ctx }) as unknown as OffscreenCanvas);
      return fills;
    };
    // East edge of the block: it drops to the floor beside it.
    expect(paint(field([[B + 9, B + 7, QUARTZ]])).filter((f) => f === QZ.lit).length).toBeGreaterThan(2);
    // In the middle of the block: nothing drops, the vein is buried.
    expect(paint(field([[B + 7, B + 7, QUARTZ]])).filter((f) => f === QZ.lit)).toHaveLength(0);
  });
});
