// hash.ts — stateless integer hashing (no RNG state to save or replay) and a two-lane
// state hasher for determinism checks. Only Math.imul, shifts and xor: identical on every
// JS engine, so a future server recomputes exactly what the client did.

/** Final avalanche of a 32-bit value (lowbias32 by Chris Wellons). */
export function mix32(h: number): number {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash a seed and up to four integers into an unsigned 32-bit value. */
export function hash32(seed: number, a = 0, b = 0, c = 0, d = 0): number {
  let h = mix32((seed ^ 0x9e3779b9) >>> 0);
  h = mix32((h ^ Math.imul(a | 0, 0x85ebca6b)) >>> 0);
  h = mix32((h ^ Math.imul(b | 0, 0xc2b2ae35)) >>> 0);
  h = mix32((h ^ Math.imul(c | 0, 0x27d4eb2f)) >>> 0);
  h = mix32((h ^ Math.imul(d | 0, 0x165667b1)) >>> 0);
  return h;
}

/** Integer in [0, n) from a hash (n ≤ 2^31). */
export function hashInt(n: number, seed: number, a = 0, b = 0, c = 0, d = 0): number {
  return hash32(seed, a, b, c, d) % n;
}

/** Per-mille roll: true with probability permille/1000, purely from the inputs. */
export function hashChance(permille: number, seed: number, a = 0, b = 0, c = 0, d = 0): boolean {
  return hash32(seed, a, b, c, d) % 1000 < permille;
}

/** Float in [0,1) — for render/market use only, never fed back into sim state. */
export function hashUnit(seed: number, a = 0, b = 0, c = 0, d = 0): number {
  return hash32(seed, a, b, c, d) / 4294967296;
}

const TWO32 = 4294967296;

/**
 * Two independent 32-bit lanes over a stream of integers (safe up to 2^53). Used for the
 * engine state hash: "same save + same commands ⇒ same hash" is a core invariant.
 */
export class StateHasher {
  private a = 0x811c9dc5;
  private b = 0x1b873593;
  private n = 0;

  int(v: number): this {
    const hi = Math.floor(v / TWO32);
    const lo = v - hi * TWO32;
    this.word(lo >>> 0);
    this.word(hi | 0);
    return this;
  }

  ints(arr: ArrayLike<number>): this {
    this.int(arr.length);
    for (let i = 0; i < arr.length; i++) this.int(arr[i]!);
    return this;
  }

  str(s: string): this {
    this.int(s.length);
    for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
    return this;
  }

  private word(w: number): void {
    this.a = Math.imul(this.a ^ w, 0x01000193) >>> 0;
    this.b = mix32((this.b + Math.imul(w ^ this.n, 0x9e3779b1)) >>> 0);
    this.n = (this.n + 1) | 0;
  }

  /** Start over (reuse one hasher in hot loops). */
  reset(): this {
    this.a = 0x811c9dc5;
    this.b = 0x1b873593;
    this.n = 0;
    return this;
  }

  /** Both lanes folded into one safe integer (53 bits) — a cheap Map key. */
  key53(): number {
    const fa = mix32((this.a ^ this.n) >>> 0);
    const fb = mix32((this.b ^ 0x5bd1e995) >>> 0);
    return (fa & 0x1fffff) * 4294967296 + fb;
  }

  /** 16 hex chars: lane A then lane B. */
  digest(): string {
    const fa = mix32((this.a ^ this.n) >>> 0).toString(16).padStart(8, '0');
    const fb = mix32((this.b ^ 0x5bd1e995) >>> 0).toString(16).padStart(8, '0');
    return fa + fb;
  }
}
