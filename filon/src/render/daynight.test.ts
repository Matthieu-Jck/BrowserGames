// daynight.test.ts — the day's look: the 24-hour clock on the world day, keyframes that never
// go black and turn smoothly, lights on at night only, the sun as the SOLAR table says.
import { describe, it, expect } from 'vitest';
import { DAY_EPOCHS, SOLAR } from '@/sim/constants';
import { gradeAt, hourOf, MOMENTS, newGrade, phaseAt, phaseOf, sunAt, tintOf } from './daynight';

describe('day / night grade', () => {
  it('the clock: midnight at day epoch 6, noon at 24, the night falls at 20:00 (day epoch 0)', () => {
    expect(hourOf(6)).toBe(0);
    expect(hourOf(24)).toBe(12);
    expect(hourOf(0)).toBe(20);
    expect(hourOf(12)).toBe(4);
    for (let h = 0; h < 24; h += 0.75) expect(hourOf(phaseOf(h))).toBeCloseTo(h, 9);
    expect(phaseAt(36 * 600 * 1000 + 24 * 600)).toBeCloseTo(24, 9);
  });

  it('never goes black and turns smoothly', () => {
    const g = newGrade(), prev = newGrade();
    gradeAt(0, prev);
    for (let i = 1; i <= 3600; i++) {
      const p = (i / 100) % DAY_EPOCHS;
      gradeAt(p, g);
      expect(Math.min(g.r, g.g, g.b), `phase ${p}`).toBeGreaterThanOrEqual(0.5);
      expect(Math.max(Math.abs(g.r - prev.r), Math.abs(g.g - prev.g), Math.abs(g.b - prev.b), Math.abs(g.night - prev.night)), `phase ${p}`).toBeLessThan(0.03);
      prev.r = g.r; prev.g = g.g; prev.b = g.b; prev.night = g.night;
    }
  });

  it('lights at night, none by day; clouds by day only', () => {
    const at = (h: number): ReturnType<typeof gradeAt> => gradeAt(phaseOf(h));
    expect(at(MOMENTS.night).night).toBe(1);
    expect(at(MOMENTS.noon).night).toBe(0);
    expect(at(MOMENTS.noon).clouds).toBe(1);
    expect(at(MOMENTS.night).clouds).toBe(0);
    const dawn = at(MOMENTS.dawn), dusk = at(MOMENTS.dusk);
    expect(dawn.night).toBeGreaterThan(0.2); expect(dawn.night).toBeLessThan(0.8);
    expect(dusk.night).toBeGreaterThan(0.2); expect(dusk.night).toBeLessThan(0.8);
    // Dawn is rosy (red over blue), dusk coral (red over green over blue), noon nearly white.
    expect(dawn.r).toBeGreaterThan(dawn.g);
    expect(dusk.r).toBeGreaterThan(dusk.g); expect(dusk.g).toBeGreaterThan(dusk.b);
    expect(Math.min(at(12).r, at(12).g, at(12).b)).toBeGreaterThan(0.95);
    // The night is lilac: blue above red and green.
    expect(at(0).b).toBeGreaterThan(at(0).r);
  });

  it('the sun the eye sees follows the SOLAR table', () => {
    for (let e = 0; e < DAY_EPOCHS; e++) expect(sunAt(e + 0.5)).toBeCloseTo(SOLAR[e]! / 1000, 9);
    expect(sunAt(3)).toBe(0);
    expect(sunAt(24)).toBe(1);
  });

  it('the plan view keeps a lighter grade; strength 0 is white', () => {
    const g = gradeAt(phaseOf(0));
    expect(tintOf(g, 0)).toBe(0xffffff);
    const full = tintOf(g, 1), light = tintOf(g, 0.4);
    expect(light & 0xff).toBeGreaterThan(full & 0xff);
    expect((light >> 16) & 0xff).toBeGreaterThan((full >> 16) & 0xff);
  });
});
