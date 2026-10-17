// fit.test.ts — the responsive layout's numbers (D96): the fit factor at the sizes D96 targets.
import { describe, expect, it } from 'vitest';
import { FIT_MIN, FIT_MIN_TOUCH, NARROW, uiFit } from './fit';

describe('uiFit', () => {
  it('keeps the drawn sizes on a desktop window of 1280 × 720 and more', () => {
    expect(uiFit(1920, 1080, false)).toBe(1);
    expect(uiFit(1440, 900, false)).toBe(1);
    expect(uiFit(1280, 720, false)).toBe(1);
    expect(uiFit(2560, 1440, false)).toBe(1); // never enlarges
  });
  it('zooms out on a small laptop, by the short side, never under its floor', () => {
    expect(uiFit(1200, 800, false)).toBeCloseTo(0.938, 3);
    expect(uiFit(1366, 650, false)).toBeCloseTo(0.903, 3);
    expect(uiFit(1024, 768, false)).toBe(FIT_MIN);
  });
  it('keeps touch targets large: a higher floor', () => {
    expect(uiFit(1024, 768, true)).toBe(FIT_MIN_TOUCH);
    expect(uiFit(844, 390, true)).toBe(FIT_MIN_TOUCH);
  });
  it('measures the narrow layout against a tablet upright, and a phone against a phone', () => {
    expect(uiFit(768, 1024, true)).toBeCloseTo(0.937, 3); // the HUD on one row
    expect(uiFit(820, 1180, true)).toBe(1);
    expect(uiFit(390, 844, true)).toBeCloseTo(0.975, 3);
    expect(uiFit(360, 740, true)).toBe(0.9);
    expect(uiFit(NARROW - 1, 900, false)).toBe(1);
    expect(uiFit(600, 900, false)).toBe(FIT_MIN);
  });
});
