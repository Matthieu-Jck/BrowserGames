import { describe, it, expect } from 'vitest';
import { makeDemand, makeSupply } from './curves';
import { solveEquilibrium, outcomeAtPrice } from './equilibrium';
import { totalSurplusAtQuantity } from './welfare';

// Demand P = 100 − Q, Supply P = 20 + Q  ⇒  Q* = 40, P* = 60.
const demand = makeDemand(100, 1);
const supply = makeSupply(20, 1);

describe('solveEquilibrium', () => {
  it('finds the closed-form equilibrium', () => {
    const eq = solveEquilibrium(demand, supply);
    expect(eq.qtyStar).toBeCloseTo(40, 6);
    expect(eq.priceStar).toBeCloseTo(60, 6);
  });

  it('computes the surplus triangles', () => {
    const eq = solveEquilibrium(demand, supply);
    expect(eq.consumerSurplus).toBeCloseTo(800, 6); // ½·(100−60)·40
    expect(eq.producerSurplus).toBeCloseTo(800, 6); // ½·(60−20)·40
    expect(eq.totalSurplus).toBeCloseTo(1600, 6);
  });

  it('handles parallel curves as no-trade', () => {
    const eq = solveEquilibrium(makeDemand(100, 1), { intercept: 10, slope: -1 });
    expect(eq.qtyStar).toBe(0);
  });
});

describe('outcomeAtPrice', () => {
  it('reports a shortage below the clearing price', () => {
    const o = outcomeAtPrice(demand, supply, 40);
    expect(o.kind).toBe('shortage');
    expect(o.qd).toBeGreaterThan(o.qs);
    expect(o.gap).toBeGreaterThan(0);
    expect(o.qTraded).toBeCloseTo(o.qs, 6); // short side rules
  });

  it('reports a surplus above the clearing price', () => {
    const o = outcomeAtPrice(demand, supply, 80);
    expect(o.kind).toBe('surplus');
    expect(o.qs).toBeGreaterThan(o.qd);
    expect(o.qTraded).toBeCloseTo(o.qd, 6);
  });

  it('clears exactly at the equilibrium price', () => {
    const o = outcomeAtPrice(demand, supply, 60);
    expect(o.kind).toBe('clearing');
    expect(o.qd).toBeCloseTo(o.qs, 6);
  });
});

describe('total surplus is maximised at the equilibrium quantity', () => {
  it('no other quantity beats Q*', () => {
    const eq = solveEquilibrium(demand, supply);
    const best = totalSurplusAtQuantity(demand, supply, eq.qtyStar);
    for (let q = 0; q <= 80; q += 1) {
      expect(totalSurplusAtQuantity(demand, supply, q)).toBeLessThanOrEqual(best + 1e-6);
    }
  });
});
