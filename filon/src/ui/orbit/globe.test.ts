// globe.test.ts — the orbital view's geometry: the terminator crosses the cirque when its sun
// rises and sets (the sim's SOLAR table), the view puts east right and north up, the visible
// outline of a cap has the right area, and the Crier Ring's frame is orthonormal.
import { describe, expect, it } from 'vitest';
import { HOME_POSITION } from '@/content/colonies';
import { DAY_EPOCHS, SOLAR } from '@/sim/constants';
import { sunPermille } from '@/sim/power/network';
import { NOON, capOutline, dot, fromLatLon, greatArc, len3, ringAt, ringFrame, sunDir, toView, viewFrame, type P2 } from './globe';

const area = (pts: readonly P2[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
};

describe('orbital view geometry', () => {
  const home = fromLatLon(HOME_POSITION.lat, HOME_POSITION.lon);

  it('the sun is up over the cirque exactly while the sim gives solar output', () => {
    const base = 36 * 11_000; // any whole day
    for (let d = 0; d < DAY_EPOCHS; d++) {
      const mid = dot(home, sunDir(base + d + 0.5));
      if (SOLAR[d]! > 0) expect(mid, `day-epoch ${d}`).toBeGreaterThan(0);
      else expect(mid, `day-epoch ${d}`).toBeLessThan(0);
      expect(sunPermille(base + d) > 0).toBe(SOLAR[d]! > 0);
    }
    expect(dot(home, sunDir(base + NOON))).toBeGreaterThan(0.6);
    // Sunrise and sunset sit on the terminator.
    expect(Math.abs(dot(home, sunDir(base + NOON - 12)))).toBeLessThan(1e-9);
    expect(Math.abs(dot(home, sunDir(base + NOON + 12)))).toBeLessThan(1e-9);
  });

  it('looks at the planet from space: centre ahead, east right, north up', () => {
    const f = viewFrame(10, 5);
    const c = toView(f, fromLatLon(10, 5));
    expect(c[0]).toBeCloseTo(0, 9);
    expect(c[1]).toBeCloseTo(0, 9);
    expect(c[2]).toBeCloseTo(1, 9);
    expect(toView(f, fromLatLon(10, 25))[0]).toBeGreaterThan(0);
    expect(toView(f, fromLatLon(30, 5))[1]).toBeLessThan(0);
  });

  it('outlines the visible part of a cap', () => {
    const front = capOutline([0, 0, 1], Math.PI / 3)!;
    expect(area(front)).toBeCloseTo(Math.PI * 0.75, 2);
    expect(capOutline([0, 0, -1], Math.PI / 3)).toBeNull();
    // A hemisphere seen side-on is half the disc; a quarter-turned one, a bit more than half.
    expect(area(capOutline([1, 0, 0], Math.PI / 2)!)).toBeCloseTo(Math.PI / 2, 2);
    const tilted = capOutline([Math.SQRT1_2, 0, Math.SQRT1_2], Math.PI / 2)!;
    expect(area(tilted)).toBeCloseTo(Math.PI / 2 + (Math.PI / 2) * Math.SQRT1_2, 2);
    for (const [x, y] of tilted) expect(x * x + y * y).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('lifts freight routes above the ground and frames the ring', () => {
    const arc = greatArc(home, fromLatLon(-20, 40), 0.1, 20);
    expect(len3(arc[0]!)).toBeCloseTo(1, 9);
    expect(len3(arc[10]!)).toBeCloseTo(1.1, 9);
    expect(len3(arc[20]!)).toBeCloseTo(1, 9);
    const r = ringFrame(0.3, -0.1);
    expect(dot(r.e1, r.e2)).toBeCloseTo(0, 9);
    expect(dot(r.e1, r.up)).toBeCloseTo(0, 9);
    expect(dot(r.e2, r.up)).toBeCloseTo(0, 9);
    expect(r.up[1]).toBeLessThan(0);
    const near = ringAt(r, Math.PI / 2, 1.6);
    expect(near[2]).toBeGreaterThan(0);
    expect(near[1]).toBeGreaterThan(0);
  });
});
