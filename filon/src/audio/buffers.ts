// buffers.ts — the raw material the synthesizer loops or convolves, generated in code (pure: plain
// Float32Arrays from a seeded generator, unit-tested in Node; engine.ts copies them into
// AudioBuffers): white noise for the one-shots, pink noise for the wind (looped seamlessly), a
// train of tiny clicks for the ribbons' rattle (looped), the reverb's impulse response (a wide,
// soft desert space: decaying noise that darkens as it fades), and the safety clipper's curve.
// Every buffer is centred (no DC: a speaker must never be pushed off its rest).
import type { Rng } from '@/core/rng';

/** A sample array Web Audio accepts as is (AudioBuffer channels, PeriodicWave, WaveShaper curves). */
export type Samples = Float32Array<ArrayBuffer>;

/** Subtract the mean, in place. */
function centre(x: Samples): Samples {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  const m = s / Math.max(1, x.length);
  for (let i = 0; i < x.length; i++) x[i] = x[i]! - m;
  return x;
}

/** Scale in place so that the largest sample is `peak`. */
function normalise(x: Samples, peak: number): Samples {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]!));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i]! * peak) / m;
  return x;
}

/**
 * Make `x` (n + f samples) loop without a seam: the last f samples are cross-faded (equal power)
 * into the first f, so the sample after the last one is the stream's own continuation. Returns n samples.
 */
function loopable(x: Samples, f: number): Samples {
  const n = x.length - f;
  const out = x.slice(0, n);
  for (let i = 0; i < f; i++) {
    const w = i / f;
    out[i] = x[i]! * Math.sqrt(w) + x[n + i]! * Math.sqrt(1 - w);
  }
  return out;
}

/** White noise, centred, peak 0.9. */
export function whiteNoise(n: number, rng: Rng): Samples {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rng.next() * 2 - 1;
  return normalise(centre(x), 0.9);
}

/** Pink noise (Paul Kellet's filter: −3 dB per octave), centred, peak 0.9, seamless as a loop. */
export function pinkNoise(n: number, rng: Rng, sampleRate: number): Samples {
  const f = Math.max(16, Math.floor(sampleRate * 0.05));
  const x = new Float32Array(n + f);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = -4096; i < x.length; i++) { // the first 4096 samples warm the filter up and are dropped
    const w = rng.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    if (i >= 0) x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return normalise(centre(loopable(centre(x), f)), 0.9);
}

/**
 * Tiny clicks at random (Poisson, `rate` per second): each a 1.5–5 ms burst of noise, decaying,
 * of random strength. Looped under a band-pass, it is the rattle of items on ribbons. Peak 0.9.
 */
export function clickTrain(n: number, sampleRate: number, rate: number, rng: Rng): Samples {
  const x = new Float32Array(n);
  const end = n - Math.floor(sampleRate * 0.01); // no click straddles the loop point
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rng.next() * 0.999999) / rate;
    const i0 = Math.floor(t * sampleRate);
    if (i0 >= end) break;
    const amp = rng.range(0.25, 1);
    const len = Math.max(8, Math.floor(sampleRate * rng.range(0.0015, 0.005)));
    const tau = len / 3;
    for (let j = 0; j < len && i0 + j < n; j++) x[i0 + j] = x[i0 + j]! + amp * (rng.next() * 2 - 1) * Math.exp(-j / tau);
  }
  return normalise(centre(x), 0.9);
}

/**
 * The reverb's impulse response, one channel per array (independent noise: a wide image). It
 * falls by 60 dB over `seconds`, opens after a short pre-delay, and darkens as it decays (a
 * one-pole low-pass closing from ~6 kHz to ~1 kHz), like air over sand rather than a hall.
 */
export function impulseResponse(sampleRate: number, seconds: number, rng: Rng, predelay = 0.014): [Samples, Samples] {
  const n = Math.max(1, Math.ceil(sampleRate * seconds));
  const ch = (): Samples => {
    const x = new Float32Array(n);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate, u = t / seconds;
      const a = 0.85 - 0.73 * Math.pow(u, 0.6);
      y += a * (rng.next() * 2 - 1 - y);
      const onset = t < predelay ? 0 : Math.min(1, (t - predelay) / 0.01);
      x[i] = y * Math.exp(-6.9 * u) * onset;
    }
    return centre(x);
  };
  return [ch(), ch()];
}

/**
 * The safety clipper on the master (a WaveShaper curve over −1 … 1): the identity below `knee`
 * (transparent for everything the mix normally does), then a smooth tanh shoulder up to `ceiling`.
 */
export function softClipCurve(n = 4096, knee = 0.8, ceiling = 0.98): Samples {
  const c = new Float32Array(n);
  const room = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}
