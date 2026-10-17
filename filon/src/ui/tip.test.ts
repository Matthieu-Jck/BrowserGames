// tip.test.ts — the cursor tip stays inside the window (D96): beside a cursor, above a finger.
import { describe, expect, it } from 'vitest';
import { tipPlace } from './tip';

describe('tipPlace', () => {
  it('goes below-right of a cursor', () => {
    expect(tipPlace(100, 100, 120, 40, 1280, 720, false)).toEqual([118, 120]);
  });
  it('flips left and up near the window\'s right and bottom edges', () => {
    expect(tipPlace(1250, 700, 120, 40, 1280, 720, false)).toEqual([1250 - 120 - 18, 700 - 40 - 14]);
  });
  it('sits above a finger, and below it at the window\'s top', () => {
    expect(tipPlace(200, 400, 120, 40, 390, 844, true)).toEqual([218, 400 - 40 - 36]);
    expect(tipPlace(200, 30, 120, 40, 390, 844, true)).toEqual([218, 74]);
  });
  it('never leaves the window, even wider than the room on either side', () => {
    const [x, y] = tipPlace(195, 420, 300, 60, 390, 844, true);
    expect(x).toBeGreaterThanOrEqual(8);
    expect(x + 300).toBeLessThanOrEqual(390 - 8);
    expect(y).toBeGreaterThanOrEqual(8);
  });
});
