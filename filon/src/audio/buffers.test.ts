import { describe, it, expect } from 'vitest';
import { makeRng } from '@/core/rng';
import { clickTrain, impulseResponse, pinkNoise, softClipCurve, whiteNoise } from './buffers';
import { Sound } from './sound';

const SR = 48000;
const mean = (x: Float32Array): number => x.reduce((s, v) => s + v, 0) / x.length;
const peak = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x: Float32Array, a = 0, b = x.length): number => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (b - a));
};

describe('audio buffers', () => {
  it('noises are centred (no DC) and peak at 0.9', () => {
    for (const x of [whiteNoise(SR, makeRng(1)), pinkNoise(SR * 2, makeRng(2), SR), clickTrain(SR * 2, SR, 30, makeRng(3))]) {
      expect(Math.abs(mean(x))).toBeLessThan(1e-6);
      expect(peak(x)).toBeCloseTo(0.9, 6);
    }
  });

  it('pink noise has more energy low than high, and loops without a seam', () => {
    const x = pinkNoise(SR * 2, makeRng(5), SR);
    // First differences measure high frequencies: pink noise's are much smaller than white noise's.
    const diff = (y: Float32Array): number => { let s = 0; for (let i = 1; i < y.length; i++) s += (y[i]! - y[i - 1]!) ** 2; return Math.sqrt(s / y.length) / rms(y); };
    expect(diff(x)).toBeLessThan(diff(whiteNoise(SR * 2, makeRng(5))) / 2);
    // The jump from the last sample to the first is an ordinary step of the signal.
    const seam = Math.abs(x[0]! - x[x.length - 1]!);
    expect(seam).toBeLessThan(6 * diff(x) * rms(x));
  });

  it('the click train is sparse: mostly silence, and clicks of a few milliseconds', () => {
    const x = clickTrain(SR * 4, SR, 30, makeRng(7));
    let quiet = 0;
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) < 0.01) quiet++;
    expect(quiet / x.length).toBeGreaterThan(0.6);
    expect(rms(x, x.length - SR * 0.01, x.length)).toBeLessThan(0.02); // nothing straddles the loop point
  });

  it('the impulse response is stereo, decorrelated, silent before its pre-delay, and decays by > 40 dB', () => {
    const [l, r] = impulseResponse(SR, 3.2, makeRng(9));
    expect(l.length).toBe(Math.ceil(SR * 3.2));
    expect(peak(l.subarray(0, Math.floor(SR * 0.013)))).toBeLessThan(1e-3);
    const head = rms(l, Math.floor(SR * 0.03), Math.floor(SR * 0.3)), tail = rms(l, Math.floor(SR * 2.8), l.length);
    expect(20 * Math.log10(tail / head)).toBeLessThan(-40);
    let c = 0;
    for (let i = 0; i < l.length; i++) c += l[i]! * r[i]!;
    expect(Math.abs(c / l.length) / (rms(l) * rms(r))).toBeLessThan(0.1);
  });

  it('the soft clip is transparent below its knee and never exceeds its ceiling', () => {
    const c = softClipCurve(4097, 0.8, 0.98);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      if (Math.abs(x) <= 0.8) expect(c[i]!).toBeCloseTo(x, 6);
      expect(Math.abs(c[i]!)).toBeLessThanOrEqual(0.98);
      if (i) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
    }
  });
});

describe('audio without Web Audio (Node)', () => {
  it('the sound front door is a quiet no-op: nothing throws', () => {
    const s = new Sound(1);
    expect(s.state).toBe('off');
    expect(s.available).toBe(false);
    expect(() => {
      s.unlock();
      s.setVolumes({ master: 0.3, music: 0.2, sfx: 0.1 });
      s.cue('click');
      s.setHidden(true);
      s.setHidden(false);
      s.frame({ hour: 12, night: 0, gust: 1000, activity: 0.5, machines: 3, machinePan: 0, items: 10, zoom: 1, veiled: false });
    }).not.toThrow();
    expect(s.describe()).toMatchObject({ state: 'off', context: 'none', played: 0, score: null });
  });
});
