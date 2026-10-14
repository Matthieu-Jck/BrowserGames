// rng.ts — deterministic PRNG + value noise (mulberry32 / xmur3, public domain — bryc).
// Everything procedural in agora hangs off these. No Date.now / Math.random in the
// hot paths — agent layouts, auction populations and fishery noise all flow from a seed
// so the engine is reproducible and the smoke test can pin behaviour.

export interface Rng {
  next(): number;
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number; // inclusive
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(arr: readonly T[]): T[];
  weighted<T>(pairs: ReadonlyArray<readonly [T, number]>): T;
  gauss(mean?: number, sd?: number): number;
}

export function hashStr(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function makeRng(seed: string | number): Rng {
  let a = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  const next = (): number => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)]!,
    chance: (p) => next() < p,
    shuffle(arr) {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j]!, a2[i]!];
      }
      return a2;
    },
    weighted(pairs) {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let r = next() * total;
      for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
      return pairs[pairs.length - 1]![0];
    },
    // Box–Muller; clamped use sites keep it well-behaved.
    gauss(mean = 0, sd = 1) {
      const u = Math.max(1e-9, next());
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
  return rng;
}

// Numerical-Recipes LCG (the overtime constants) — cheap, good enough for bulk
// agent jitter where we want a second independent stream from the same seed.
export function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface Noise2 {
  noise(x: number, y: number): number;
  fbm(x: number, y: number, oct?: number, lac?: number, gain?: number): number;
}

// 2D value noise on a hashed integer lattice, plus FBM. Both return 0..1.
export function makeNoise2(seed: string | number): Noise2 {
  const base = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  const lattice = (xi: number, yi: number): number => {
    let h = base ^ Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = lattice(xi, yi), b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x: number, y: number, oct = 5, lac = 2.0, gain = 0.5): number => {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain; freq *= lac;
    }
    return sum / norm;
  };
  return { noise, fbm };
}
