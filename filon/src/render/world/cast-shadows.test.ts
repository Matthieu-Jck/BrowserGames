// cast-shadows.test.ts — the buildings' shadows through the day: the map that stretches and
// swings a baked shadow (identity for the reference light, sends the reference displacement to
// the sun's, keeps the direction across it), and the look (none at night, shortest at noon,
// long and softer in a low sun, darkest at midday), every shadow falling away from the sun at
// every hour (the seam: owner, 2026-10-13), and how far a shadow can ever reach (what a building
// on the mountains sorts past: world/stand.ts).
import { describe, it, expect } from 'vitest';
import {
  farSide, seamClip, SHADOW_DX, SHADOW_DY, SHADOW_LONGEST, SHADOW_PX, shadowLook, shadowMap, shadowReach, sunDirection, sunHeight,
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
