// skyline.test.ts — the skyline packer (skyline.ts, D162): rects of mixed sizes in no order never
// overlap, keep their padding from each other and the page's edges, and fill a page far better than
// shelves would; a rect too big for what is left gets no place.
import { describe, expect, it } from 'vitest';
import { Skyline } from './skyline';

/** A small deterministic generator (no Math.random in tests that are compared run to run). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe('skyline packer (D162)', () => {
  it('mixed sizes in no order: inside the page, padded apart, well filled', () => {
    const SIZE = 1024, PAD = 6, rnd = lcg(7);
    const sky = new Skyline(SIZE, PAD);
    const placed: Array<[number, number, number, number]> = [];
    let area = 0;
    for (let k = 0; k < 400; k++) {
      // Like the neighbours' sheets: many small pieces, some wide flat ones, a few tall ones.
      const r = rnd();
      const w = Math.ceil(r < 0.6 ? 20 + rnd() * 80 : r < 0.9 ? 100 + rnd() * 250 : 60 + rnd() * 120);
      const h = Math.ceil(r < 0.6 ? 20 + rnd() * 80 : r < 0.9 ? 30 + rnd() * 90 : 150 + rnd() * 200);
      const at = sky.place(w, h);
      if (!at) continue;
      const [x, y] = at;
      expect(x).toBeGreaterThanOrEqual(PAD);
      expect(y).toBeGreaterThanOrEqual(PAD);
      expect(x + w + PAD).toBeLessThanOrEqual(SIZE);
      expect(y + h + PAD).toBeLessThanOrEqual(SIZE);
      for (const [px, py, pw, ph] of placed) {
        const apart = x >= px + pw + PAD || px >= x + w + PAD || y >= py + ph + PAD || py >= y + h + PAD;
        expect(apart).toBe(true);
      }
      placed.push([x, y, w, h]);
      area += (w + PAD) * (h + PAD);
    }
    expect(placed.length).toBeGreaterThan(50);
    expect(area / (SIZE * SIZE)).toBeGreaterThan(0.75);
  });

  it('a rect wider or taller than the room left gets no place', () => {
    const sky = new Skyline(256, 6);
    expect(sky.place(300, 10)).toBeNull();
    expect(sky.place(200, 200)).toEqual([6, 6]);
    expect(sky.place(100, 100)).toBeNull();
    expect(sky.place(30, 30)).toEqual([212, 6]);
  });
});
