// pace.test.ts — the frame pacer (D100): under a cap it draws evenly spaced frames whatever the display's rate.
import { describe, it, expect } from 'vitest';
import { FramePacer } from './pace';

/** The frames drawn over `secs` seconds of a display at `hz`, under a cap of `fps`. */
function drawn(hz: number, fps: number, secs = 2): number[] {
  const p = new FramePacer(), out: number[] = [];
  for (let k = 0; k < hz * secs; k++) {
    const now = (k * 1000) / hz + (k % 3) * 0.6; // a little jitter, as browsers have
    if (p.due(now, fps)) out.push(now);
  }
  return out;
}

describe('frame pacing (D100)', () => {
  it('draws every frame without a cap', () => {
    expect(drawn(60, 0)).toHaveLength(120);
    expect(drawn(120, 0)).toHaveLength(240);
  });

  it('draws 30 frames a second under a 30 fps cap, on a 60, 120 or 144 Hz display, evenly', () => {
    for (const hz of [60, 120, 144]) {
      const f = drawn(hz, 30);
      expect(f.length / 2).toBeGreaterThanOrEqual(27);
      expect(f.length / 2).toBeLessThanOrEqual(31);
      const gaps = f.slice(1).map((t, i) => t - f[i]!);
      expect(Math.max(...gaps)).toBeLessThan(1000 / 30 + 1000 / hz + 2); // never skips a whole interval
    }
  });

  it('leaves a display slower than the cap alone', () => {
    expect(drawn(60, 120)).toHaveLength(120);
  });

  it('asks for the next frame a display frame or so before it is due, never after', () => {
    const p = new FramePacer();
    expect(p.wait(0, 30)).toBe(0); // nothing drawn yet
    p.due(1000, 30);
    expect(p.wait(1000, 30)).toBeGreaterThan(5); // the 60 Hz frame in between is not asked for
    expect(1000 + p.wait(1000, 30) + 1000 / 60).toBeLessThan(1000 + 1000 / 30); // asked in time for the frame that is due
    expect(p.wait(1029, 30)).toBe(0);
    expect(p.wait(1000, 0)).toBe(0);
  });

  it('draws evenly when it waits as told (a 60 Hz display, 30 fps)', () => {
    const p = new FramePacer(), drawnAt: number[] = [];
    let t = 0;
    while (t < 2000) {
      if (p.due(t, 30)) drawnAt.push(t);
      const w = p.wait(t, 30);
      t = Math.ceil((t + Math.max(w, 1)) / (1000 / 60)) * (1000 / 60); // the next display frame after the wait
    }
    expect(drawnAt.length).toBeGreaterThanOrEqual(58);
    expect(drawnAt.length).toBeLessThanOrEqual(61);
  });
});
