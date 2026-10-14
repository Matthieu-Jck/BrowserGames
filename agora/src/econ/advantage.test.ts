import { describe, it, expect } from 'vitest';
import { comparativeAdvantage } from './advantage';
import type { Producer } from './types';

describe('comparativeAdvantage', () => {
  // A is absolutely better at BOTH goods (10,10) vs (2,8) — yet trade still pays.
  const a: Producer = { name: 'Ada', output: [10, 10] };
  const b: Producer = { name: 'Ben', output: [2, 8] };

  it('finds gains from trade even under absolute advantage in both goods', () => {
    const r = comparativeAdvantage(a, b);
    expect(r.gainsExist).toBe(true);
    expect(r.gain).toBeGreaterThan(0);
    expect(r.specializedValue).toBeGreaterThan(r.autarkyValue);
  });

  it('assigns goods by comparative, not absolute, advantage', () => {
    const r = comparativeAdvantage(a, b);
    // Ada's opp cost of good0 is 1, Ben's is 4 ⇒ Ada makes good0, Ben makes good1.
    expect(r.caProducer[0]).toBe(0);
    expect(r.caProducer[1]).toBe(1);
  });

  it('puts the terms of trade strictly between the two opportunity costs', () => {
    const r = comparativeAdvantage(a, b);
    expect(r.termsOfTrade.min).toBeCloseTo(1, 6);
    expect(r.termsOfTrade.max).toBeCloseTo(4, 6);
    expect(r.termsOfTrade.mid).toBeGreaterThan(r.termsOfTrade.min);
    expect(r.termsOfTrade.mid).toBeLessThan(r.termsOfTrade.max);
  });

  it('finds no gains when opportunity costs are identical', () => {
    const r = comparativeAdvantage({ name: 'X', output: [10, 10] }, { name: 'Y', output: [5, 5] });
    expect(r.gainsExist).toBe(false);
    expect(r.gain).toBeCloseTo(0, 6);
  });
});
