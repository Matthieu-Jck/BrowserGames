import { describe, it, expect } from 'vitest';
import { busGains, dbToGain, DEFAULT_VOLUMES, gainToDb, MIX, sameVolumes, sliderGain } from './levels';
import { arbitrate, CUES, MAX_RIBBON_TICKS, RateLimiter, ribbonTicks, type QueuedCue } from './cues';
import type { SfxCue } from '@/core/bus';

describe('audio levels', () => {
  it('decibels and gains convert both ways', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(-200)).toBe(0);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(gainToDb(0)).toBe(-Infinity);
    for (const db of [-40, -18, -6, 0, 3]) expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 9);
  });

  it('a slider is a squared taper: 0 is silence, 1 is unity, half way ≈ −12 dB', () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(1)).toBe(1);
    expect(gainToDb(sliderGain(0.5))).toBeCloseTo(-12.04, 2);
    expect(sliderGain(-3)).toBe(0);
    expect(sliderGain(7)).toBe(1);
    expect(sliderGain(Number.NaN)).toBe(0);
    for (let s = 0.05; s <= 1; s += 0.05) expect(sliderGain(s)).toBeGreaterThan(sliderGain(s - 0.05));
  });

  it('bus gains: master and music from their sliders, effects and ambience from the effects slider', () => {
    const g = busGains({ master: 0.5, music: 1, sfx: 0 });
    expect(g.master).toBeCloseTo(0.25, 9);
    expect(g.music).toBeCloseTo(dbToGain(MIX.music), 9);
    expect(g.sfx).toBe(0);
    expect(g.ambience).toBe(0);
    const d = busGains(DEFAULT_VOLUMES);
    expect(d.sfx).toBeCloseTo(sliderGain(DEFAULT_VOLUMES.sfx) * dbToGain(MIX.sfx), 9);
  });

  it('the veil ducks the ambience only, by MIX.duck', () => {
    const open = busGains(DEFAULT_VOLUMES, 0), veiled = busGains(DEFAULT_VOLUMES, 1);
    expect(gainToDb(veiled.ambience / open.ambience)).toBeCloseTo(MIX.duck, 9);
    expect(veiled.music).toBe(open.music);
    expect(veiled.sfx).toBe(open.sfx);
  });

  it('sameVolumes ignores noise below 1e-4', () => {
    expect(sameVolumes({ master: 1, music: 0.5, sfx: 0.5 }, { master: 1, music: 0.50001, sfx: 0.5 })).toBe(true);
    expect(sameVolumes({ master: 1, music: 0.5, sfx: 0.5 }, { master: 1, music: 0.51, sfx: 0.5 })).toBe(false);
  });

  it('every cue was measured under −6 dBFS at full sliders, and none is louder than the limiter allows', () => {
    for (const [cue, spec] of Object.entries(CUES)) {
      expect(spec.peakDb, cue).toBeLessThanOrEqual(-6);
      expect(spec.peakDb, cue).toBeLessThan(MIX.limiter);
      expect(spec.peakDb, cue).toBeGreaterThan(-40); // and still audible
    }
  });
});

describe('audio cues', () => {
  const q = (cue: SfxCue, n = 1): QueuedCue => ({ cue, n });

  it('a specific cue answering the moment silences the generic click and toast of the same frame', () => {
    expect(arbitrate([q('click'), q('refused'), q('toast.bad')])).toEqual([q('refused')]);
    expect(arbitrate([q('click'), q('open')])).toEqual([q('open')]);
  });

  it('without a specific cue, only the most important generic one plays', () => {
    expect(arbitrate([q('click'), q('toast.warn')])).toEqual([q('toast.warn')]);
    expect(arbitrate([q('toast.bad'), q('tab'), q('click')])).toEqual([q('toast.bad')]);
    expect(arbitrate([q('select')])).toEqual([q('select')]);
    expect(arbitrate([])).toEqual([]);
  });

  it('an ambient cue (a cargo lift) does not silence a click', () => {
    expect(arbitrate([q('lift'), q('click')])).toEqual([q('lift'), q('click')]);
  });

  it('duplicates merge and their counts add up; specific cues keep their order', () => {
    expect(arbitrate([q('ribbon', 3), q('place'), q('ribbon', 4)])).toEqual([q('ribbon', 7), q('place')]);
  });

  it('the rate limiter spaces each cue by its own gap', () => {
    const r = new RateLimiter();
    expect(r.allow('click', 1)).toBe(true);
    expect(r.allow('click', 1.02)).toBe(false);
    expect(r.allow('tab', 1.02)).toBe(true);
    expect(r.allow('click', 1 + CUES.click.gapMs / 1000)).toBe(true);
    expect(r.allow('quest', 0)).toBe(true);
    expect(r.allow('quest', 1)).toBe(false);
  });

  it('one soft tick per ribbon tile, capped, never closer than 30 ms', () => {
    expect(ribbonTicks(1)).toEqual([0]);
    expect(ribbonTicks(5)).toHaveLength(5);
    expect(ribbonTicks(500)).toHaveLength(MAX_RIBBON_TICKS);
    for (const n of [1, 2, 7, 14, 40, 500]) {
      const t = ribbonTicks(n);
      for (let k = 1; k < t.length; k++) expect(t[k]! - t[k - 1]!).toBeGreaterThanOrEqual(0.03 - 1e-12);
      expect(t[t.length - 1]!).toBeLessThan(0.6);
    }
  });
});
