import { describe, it, expect } from 'vitest';
import { ceilDiv, isqrt, mulDiv, waterfill } from './fixed';
import { hash32, StateHasher } from './hash';

describe('integer helpers', () => {
  it('isqrt is the exact floor square root', () => {
    for (let n = 0; n < 5000; n++) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n, `n=${n}`).toBe(true);
    }
    expect(isqrt(1e12)).toBe(1e6);
    expect(isqrt(1e12 - 1)).toBe(999999);
  });

  it('mulDiv stays exact past 2^53', () => {
    expect(mulDiv(7, 9, 4)).toBe(15);
    const a = 9007199254740, b = 1000003, c = 999983;
    expect(mulDiv(a, b, c)).toBe(Number((BigInt(a) * BigInt(b)) / BigInt(c)));
  });

  it('ceilDiv rounds up', () => {
    expect(ceilDiv(7, 2)).toBe(4);
    expect(ceilDiv(8, 2)).toBe(4);
    expect(ceilDiv(0, 5)).toBe(0);
  });

  it('waterfill hands out everything it can, respects caps and stays proportional', () => {
    const out = new Int32Array(3);
    waterfill(100, [1000, 1000, 1000], [1, 1, 2], out, 0);
    expect([...out].reduce((a, b) => a + b, 0)).toBe(100);
    expect(out[2]).toBe(50);
    waterfill(100, [10, 1000, 1000], [1, 1, 1], out, 0);
    expect(out[0]).toBe(10);
    expect(out[1]! + out[2]!).toBe(90);
    waterfill(100, [10, 20, 5], [1, 1, 1], out, 0);
    expect([...out]).toEqual([10, 20, 5]);
  });

  it('waterfill leftovers rotate with the pointer, so shares even out over time', () => {
    const out = new Int32Array(3);
    const tot = [0, 0, 0];
    let ptr = 0;
    for (let i = 0; i < 300; i++) {
      ptr = waterfill(1, [5, 5, 5], [1, 1, 1], out, ptr);
      for (let j = 0; j < 3; j++) tot[j]! += out[j]!;
    }
    expect(tot).toEqual([100, 100, 100]);
  });
});

describe('hashing', () => {
  it('hash32 is a pure function of its inputs', () => {
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(1, 3, 2));
  });

  it('the state hasher tells streams apart and is reproducible', () => {
    const h = (xs: number[]): string => new StateHasher().ints(xs).digest();
    expect(h([1, 2, 3])).toBe(h([1, 2, 3]));
    expect(h([1, 2, 3])).not.toBe(h([1, 2, 4]));
    expect(h([2 ** 40, -5])).not.toBe(h([2 ** 40, -6]));
  });
});
