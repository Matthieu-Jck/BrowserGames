// cast-shadows.test.ts — the buildings' shadows through the day: the map that stretches and
// swings a baked shadow (identity for the reference light, sends the reference displacement to
// the sun's, keeps the direction across it), and the look (none at night, shortest at noon,
// long and softer in a low sun, darkest at midday), every shadow falling away from the sun at
// every hour (the seam: owner, 2026-10-13), and how far a shadow can ever reach (what a building
// on the mountains sorts past: world/stand.ts). An item sorted among the volumes reads the shade
// back from a mask through the day's map (D130), within the reach the shadows are indexed by, and
// takes it as a tint.
import { describe, it, expect } from 'vitest';
import {
  farSide, maskCover, maskReach, seamClip, shadeTint, SHADOW_DX, SHADOW_DY, SHADOW_LONGEST, SHADOW_PX, SHADOW_TINT, shadowLook, shadowMap, shadowReach, sunDirection, sunHeight,
  type MaskAlpha,
} from './cast-shadows';

const apply = ([a, b, c, d]: [number, number, number, number], x: number, y: number): [number, number] => [a * x + c * y, b * x + d * y];
/** A tile shift (dx, dy) as iso world px, and back. */
const iso = (dx: number, dy: number): [number, number] => [(dx - dy) * 32, (dx + dy) * 16];
const tile = (X: number, Y: number): [number, number] => [(X / 32 + Y / 16) / 2, (Y / 16 - X / 32) / 2];
/** How far towards the sun a w × h footprint reaches from its centre (its sun-side edge). */
const sunEdge = (w: number, h: number, [sx, sy]: [number, number]): number =>
  Math.max(...[[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => x! * sx + y! * sy));
/** Is (x, y) inside a convex polygon (either winding)? */
const inPoly = (poly: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean => {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!, [bx, by] = poly[(i + 1) % poly.length]!;
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(c) < 1e-9) continue;
    if (!sign) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
};

describe('cast shadows', () => {
  it('every shadow falls away from the sun, at every hour of the day (owner, 2026-10-13)', () => {
    for (let hour = 4.4; hour <= 19.6; hour += 0.2) {
      const look = shadowLook(hour, 0), m = shadowMap(look.length, look.angle), sun = sunDirection(hour);
      expect(Math.hypot(...sun)).toBeCloseTo(1, 9);
      expect(sun[0]).toBeLessThan(-0.9); // on the art's light side all day (−x: the screen's top-left)
      // A mast's tip above the foot: its shadow runs straight away from the sun, as long as the look says.
      for (const z of [1, 3, 5]) {
        const [dx, dy] = tile(...apply(m, SHADOW_PX[0] * z, SHADOW_PX[1] * z)), n = Math.hypot(dx, dy);
        expect((dx * sun[0] + dy * sun[1]) / n).toBeCloseTo(-1, 9);
        expect(n).toBeCloseTo(Math.hypot(SHADOW_DX, SHADOW_DY) * look.length * z, 9);
      }
      // Any point of a building, at any height: what is drawn of its shadow (the far side of the
      // seam) never lies beyond the building's own sun-side edge.
      for (const [w, h] of [[1, 1], [2, 2], [3, 2], [4, 4]] as const) {
        const edge = sunEdge(w, h, sun);
        for (let gx = -w / 2; gx <= w / 2 + 1e-9; gx += w / 8) {
          for (let gy = -h / 2; gy <= h / 2 + 1e-9; gy += h / 8) {
            for (const z of [0, 0.1, 0.4, 1.5, 3, 5.3]) {
              const [qx, qy] = iso(gx + z * SHADOW_DX, gy + z * SHADOW_DY); // the baked point, from the foot
              if (!farSide(qx, qy)) continue;
              const [tx, ty] = tile(...apply(m, qx, qy));
              expect(tx * sun[0] + ty * sun[1]).toBeLessThanOrEqual(edge + 1e-9);
            }
          }
        }
      }
    }
  });

  it('without the seam, a dawn stretch pushed a turbine foot\'s shadow out towards the sun', () => {
    const look = shadowLook(5, 0), m = shadowMap(look.length, look.angle), sun = sunDirection(5);
    const [qx, qy] = iso(-0.72, 0); // the sun-side edge of a turbine's foot (a 2×2 footprint), on the ground
    expect(farSide(qx, qy)).toBe(false); // so it is not drawn
    const [tx, ty] = tile(...apply(m, qx, qy));
    expect(tx * sun[0] + ty * sun[1]).toBeGreaterThan(sunEdge(2, 2, sun)); // past the building, towards the sun
  });

  it('the bake clips a mask to exactly the far side of the seam through its foot', () => {
    const cx = 37, cy = 52, poly = seamClip(cx, cy, 400);
    for (let x = -150; x <= 150; x += 7.3) {
      for (let y = -120; y <= 120; y += 6.1) {
        if (Math.abs(x * SHADOW_PX[0] + y * SHADOW_PX[1]) < 1e-6) continue; // on the seam itself
        expect(inPoly(poly, cx + x, cy + y)).toBe(farSide(x, y));
      }
    }
  });

  it('no shadow of the day falls farther than its reach, towards the viewer or across the screen', () => {
    let longest = 0, deepest = 0;
    for (let hour = 0; hour < 24; hour += 0.05) {
      const look = shadowLook(hour, 0);
      longest = Math.max(longest, look.length);
      // A point 1 level up: its shadow, the reference swung and stretched (shadowMap's own terms), in tiles.
      const c = Math.cos(look.angle) * look.length, s = Math.sin(look.angle) * look.length;
      const dx = SHADOW_DX * c - SHADOW_DY * s, dy = SHADOW_DX * s + SHADOW_DY * c;
      deepest = Math.max(deepest, dx + dy, dx - dy);
      expect(dx + dy).toBeLessThanOrEqual(shadowReach(1) + 1e-9);
      expect(dx - dy).toBeLessThanOrEqual(shadowReach(1) + 1e-9);
    }
    expect(longest).toBeLessThanOrEqual(SHADOW_LONGEST + 1e-9);
    expect(deepest).toBeGreaterThan(shadowReach(1) * 0.97); // and it is not loose
    expect(shadowReach(5)).toBeCloseTo(5 * shadowReach(1), 9);
  });

  it('the reference light leaves a baked shadow as it is', () => {
    const m = shadowMap(1, 0);
    expect(m[0]).toBeCloseTo(1, 9); expect(m[1]).toBeCloseTo(0, 9);
    expect(m[2]).toBeCloseTo(0, 9); expect(m[3]).toBeCloseTo(1, 9);
  });

  it('stretches and swings the reference displacement into the sun’s, keeping the cross direction', () => {
    const s0 = iso(SHADOW_DX, SHADOW_DY);
    for (const [len, ang] of [[0.6, 0], [1.9, 0.2], [1.2, -0.2]] as const) {
      const m = shadowMap(len, ang);
      const dx = (SHADOW_DX * Math.cos(ang) - SHADOW_DY * Math.sin(ang)) * len, dy = (SHADOW_DX * Math.sin(ang) + SHADOW_DY * Math.cos(ang)) * len;
      const [sx, sy] = apply(m, s0[0], s0[1]), [ex, ey] = iso(dx, dy);
      expect(sx).toBeCloseTo(ex, 6);
      expect(sy).toBeCloseTo(ey, 6);
      const [px, py] = apply(m, -s0[1], s0[0]);
      expect(px).toBeCloseTo(-s0[1], 6);
      expect(py).toBeCloseTo(s0[0], 6);
    }
  });

  it('none at night, shortest at noon, long and soft in a low sun', () => {
    expect(shadowLook(0, 1).alpha).toBe(0);
    expect(shadowLook(21, 1).alpha).toBe(0);
    const noon = shadowLook(12, 0), morning = shadowLook(7, 0.02), dusk = shadowLook(19, 0.5);
    expect(sunHeight(12)).toBeCloseTo(1, 2);
    expect(noon.length).toBeLessThan(morning.length);
    expect(morning.length).toBeLessThan(dusk.length);
    expect(noon.alpha).toBeGreaterThan(morning.alpha);
    expect(morning.alpha).toBeGreaterThan(dusk.alpha);
    expect(dusk.alpha).toBeGreaterThan(0.1); // still there in the golden light
    expect(morning.angle).toBeLessThan(0);
    expect(dusk.angle).toBeGreaterThan(0);
    // It turns smoothly through the day.
    for (let h = 0; h < 24; h += 0.05) {
      const a = shadowLook(h, 0), b = shadowLook(h + 0.05, 0);
      expect(Math.abs(a.length - b.length)).toBeLessThan(0.1);
      expect(Math.abs(a.alpha - b.alpha)).toBeLessThan(0.02);
    }
  });
});

describe('cast shadows: read back where an item stands (D130)', () => {
  /** A w × h mask, opaque on the px `on` says. */
  const mask = (w: number, h: number, on: (x: number, y: number) => boolean): MaskAlpha => {
    const a = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = on(x, y) ? 255 : 0;
    return { w, h, a };
  };
  const I = [1, 0, 0, 1] as const;

  it('reads the mask px a point is over, as laid (its top-left at (x, y)), none off it', () => {
    const m = mask(10, 6, (x, y) => x === 7 && y === 2);
    expect(maskCover(m, I, 100, 50, 105, 53, 107.5, 52.5)).toBe(1);
    expect(maskCover(m, I, 100, 50, 105, 53, 106.5, 52.5)).toBe(0);
    expect(maskCover(m, I, 100, 50, 105, 53, 99, 52)).toBe(0);
    expect(maskCover(m, I, 100, 50, 105, 53, 111, 52)).toBe(0);
  });

  it('through the day’s map: a mask px is read back where the map sends it about the foot', () => {
    const W = 40, H = 30, x = 200, y = 120, fx = 210, fy = 130;
    const m = mask(W, H, (i, j) => i === 31 && j === 22);
    for (const [len, ang] of [[0.6, 0], [SHADOW_LONGEST, 0.2], [1.3, -0.2]] as const) {
      const M = shadowMap(len, ang);
      // The px's centre, relative to the foot, mapped.
      const qx = x + 31.5 - fx, qy = y + 22.5 - fy;
      const [px, py] = apply(M, qx, qy);
      expect(maskCover(m, M, x, y, fx, fy, fx + px, fy + py)).toBe(1);
      const [ox, oy] = apply(M, qx + 1, qy);
      expect(maskCover(m, M, x, y, fx, fy, fx + ox, fy + oy)).toBe(0);
    }
  });

  it('a mask’s shadow stays within its box and reach at every hour', () => {
    let seed = 7;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let n = 0; n < 40; n++) {
      const w = 20 + rnd() * 140, h = 20 + rnd() * 120, x = rnd() * 400, y = rnd() * 400;
      const fx = x + w * (0.2 + 0.4 * rnd()), fy = y + h * (0.4 + 0.5 * rnd());
      const r = maskReach(x, y, w, h, fx, fy);
      for (let h24 = 4.5; h24 < 19.6; h24 += 0.5) {
        const look = shadowLook(h24, 0);
        const M = shadowMap(look.length, look.angle);
        for (let k = 0; k < 30; k++) {
          const qx = x + rnd() * w - fx, qy = y + rnd() * h - fy;
          if (!farSide(qx, qy)) continue; // only the far side of the seam is baked
          const [px, py] = apply(M, qx, qy);
          expect(fx + px).toBeGreaterThanOrEqual(x - r);
          expect(fx + px).toBeLessThanOrEqual(x + w + r);
          expect(fy + py).toBeGreaterThanOrEqual(y - r);
          expect(fy + py).toBeLessThanOrEqual(y + h + r);
        }
      }
    }
  });

  it('as a tint: white unshaded, the shadows’ ink fully shaded, darker the more it covers', () => {
    expect(shadeTint(0)).toBe(0xffffff);
    expect(shadeTint(1)).toBe(SHADOW_TINT);
    const ch = (c: number): number[] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const half = ch(shadeTint(0.46)), less = ch(shadeTint(0.2));
    for (let i = 0; i < 3; i++) {
      expect(half[i]!).toBeLessThan(less[i]!);
      expect(less[i]!).toBeLessThan(255);
      expect(half[i]!).toBeGreaterThan(ch(SHADOW_TINT)[i]!);
    }
  });
});
