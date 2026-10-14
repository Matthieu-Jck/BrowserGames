// rng.ts — deterministic PRNG (mulberry32 / xmur3-style string hash, public domain — bryc),
// ported from agora. Used for content generation (colony names, decals, ink jitter). The
// gaussian helper lives in market/pricing.ts: it needs log/cos, which src/core must not use.

export interface Rng {
  next(): number;
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number; // inclusive
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(arr: readonly T[]): T[];
  weighted<T>(pairs: ReadonlyArray<readonly [T, number]>): T;
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
  return {
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
  };
}
