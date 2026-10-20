// neighbour-lod.test.ts — the neighbouring bases' looks (D162, neighbour-lod.ts): the zoom's look
// holds between its thresholds, the far copies are never asked to show more than they hold, and the
// plan lays the near bases nearest first, again on a new look or sheet, and drops the stale far ones.
import { describe, expect, it } from 'vitest';
import { DETAIL_OVER, FAR_K, FAR_UNDER, grow, overlaps, planBases, zoomLook, type LaidBase } from './neighbour-lod';

describe('neighbouring bases: looks (D162)', () => {
  it('the look holds between its thresholds; the far copies are drawn only where they are as sharp as the atlas', () => {
    expect(zoomLook(null, 0.125)).toBe('far');
    expect(zoomLook(null, 0.8)).toBe('far');
    expect(zoomLook(null, 1.4)).toBe('detail');
    // Zooming in through the band keeps far, out through it keeps detail.
    expect(zoomLook('far', 0.85)).toBe('far');
    expect(zoomLook('detail', 0.8)).toBe('detail');
    expect(zoomLook('detail', 0.74)).toBe('far');
    expect(zoomLook('far', DETAIL_OVER)).toBe('detail');
    // The atlas is baked at 2× world px: a far copy holds a texel per screen px up to zoom × density 2 / FAR_K.
    expect(DETAIL_OVER).toBeLessThanOrEqual(2 / FAR_K);
    expect(FAR_UNDER).toBeLessThan(DETAIL_OVER);
    for (let zr = 0.05; zr < 3; zr += 0.01) {
      let look = zoomLook(null, zr);
      for (const z of [zr * 0.9, zr * 1.1, zr]) look = zoomLook(look, z);
      if (look === 'far') expect(zr).toBeLessThanOrEqual(2 / FAR_K);
    }
  });

  it('boxes: overlap with edges touching, grown on every side', () => {
    expect(overlaps([0, 0, 10, 10], [10, 10, 20, 20])).toBe(true);
    expect(overlaps([0, 0, 10, 10], [11, 0, 20, 10])).toBe(false);
    expect(grow([5, 5, 6, 6], 2)).toEqual([3, 3, 8, 8]);
  });

  it('the plan: near bases laid nearest first, again on a new look or sheet; stale ones out of the ring dropped', () => {
    const gen = { far: 3, detail: 7 };
    const laid: LaidBase[] = [
      { hub: 10, look: 'far', gen: 3 }, // near, far: kept as is in far, re-laid in detail
      { hub: 11, look: 'detail', gen: 7 }, // near, detail
      { hub: 12, look: 'detail', gen: 7 }, // out of the ring, detail
      { hub: 13, look: 'far', gen: 2 }, // out of the ring, an old far sheet
      { hub: 14, look: 'far', gen: 3 }, // out of the ring, far, current
    ];
    const near = [{ hub: 11, d: 50 }, { hub: 10, d: 400 }, { hub: 20, d: 100 }, { hub: 21, d: 100 }];
    const far = planBases(laid, near, 'far', gen);
    expect(far.lay).toEqual([11, 20, 21]); // 11 back to far; 20, 21 new (tied: by hub)
    expect(far.drop).toEqual([12, 13]); // detail out of sight in a far zoom; an old sheet
    const detail = planBases(laid, near, 'detail', gen);
    expect(detail.lay).toEqual([20, 21, 10]); // 11 already in detail
    expect(detail.drop).toEqual([13]); // 12 stays (detail, current sheet), 14 stays (far, current) until its timer
    // A renewed detail sheet: the near detail base laid again, the one out of sight dropped.
    const renewed = planBases(laid, near, 'detail', { far: 3, detail: 8 });
    expect(renewed.lay).toEqual([11, 20, 21, 10]);
    expect(renewed.drop).toEqual([12, 13]);
  });
});
