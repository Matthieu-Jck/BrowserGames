import { describe, it, expect } from 'vitest';
import { makeDemand, makeSupply } from './curves';
import { priceControl, applyTax } from './controls';
import { solveEquilibrium } from './equilibrium';

const demand = makeDemand(100, 1); // P = 100 − Q
const supply = makeSupply(20, 1); // P = 20 + Q ; eq at P*=60, Q*=40

describe('price controls', () => {
  it('a binding ceiling creates a shortage and destroys surplus', () => {
    const r = priceControl(demand, supply, { kind: 'ceiling', price: 40 });
    expect(r.binding).toBe(true);
    expect(r.shortage).toBeGreaterThan(0);
    expect(r.qTraded).toBeLessThan(r.equilibrium.qtyStar);
    expect(r.deadweightLoss).toBeGreaterThan(0);
  });

  it('a binding floor creates a surplus (glut)', () => {
    const r = priceControl(demand, supply, { kind: 'floor', price: 80 });
    expect(r.binding).toBe(true);
    expect(r.surplus).toBeGreaterThan(0);
    expect(r.deadweightLoss).toBeGreaterThan(0);
  });

  it('a non-binding control leaves the market at equilibrium', () => {
    const r = priceControl(demand, supply, { kind: 'ceiling', price: 90 });
    expect(r.binding).toBe(false);
    expect(r.deadweightLoss).toBeCloseTo(0, 6);
    expect(r.qTraded).toBeCloseTo(r.equilibrium.qtyStar, 6);
  });

  it('conserves surplus: csChange + psChange + DWL = 0', () => {
    const r = priceControl(demand, supply, { kind: 'ceiling', price: 35 });
    expect(r.csChange + r.psChange + r.deadweightLoss).toBeCloseTo(0, 6);
  });

  it('deadweight loss is never negative', () => {
    for (let p = 20; p <= 100; p += 5) {
      expect(priceControl(demand, supply, { kind: 'ceiling', price: p }).deadweightLoss)
        .toBeGreaterThanOrEqual(-1e-9);
    }
  });
});

describe('taxes', () => {
  it('drives a wedge equal to the tax and raises revenue', () => {
    const r = applyTax(demand, supply, { perUnit: 12, on: 'seller' });
    expect(r.buyerPrice - r.sellerPrice).toBeCloseTo(12, 6);
    expect(r.taxRevenue).toBeCloseTo(12 * r.qty, 6);
    expect(r.deadweightLoss).toBeGreaterThan(0);
  });

  it('incidence splits the tax between the two sides', () => {
    const r = applyTax(demand, supply, { perUnit: 12, on: 'buyer' });
    expect(r.incidenceBuyer + r.incidenceSeller).toBeCloseTo(12, 6);
  });

  it('tax equivalence: who is charged does not change the outcome', () => {
    const onBuyer = applyTax(demand, supply, { perUnit: 12, on: 'buyer' });
    const onSeller = applyTax(demand, supply, { perUnit: 12, on: 'seller' });
    expect(onBuyer.qty).toBeCloseTo(onSeller.qty, 6);
    expect(onBuyer.incidenceBuyer).toBeCloseTo(onSeller.incidenceBuyer, 6);
    expect(onBuyer.deadweightLoss).toBeCloseTo(onSeller.deadweightLoss, 6);
  });

  it('the inelastic (steeper) side bears more of the tax', () => {
    // Steep demand (inelastic) vs gentle supply ⇒ buyers bear more.
    const steepDemand = makeDemand(100, 3);
    const gentleSupply = makeSupply(20, 1);
    const r = applyTax(steepDemand, gentleSupply, { perUnit: 10, on: 'seller' });
    expect(r.incidenceBuyer).toBeGreaterThan(r.incidenceSeller);
  });

  it('conserves surplus: csChange + psChange + revenue + DWL = 0', () => {
    const r = applyTax(demand, supply, { perUnit: 12, on: 'seller' });
    expect(r.csChange + r.psChange + r.taxRevenue + r.deadweightLoss).toBeCloseTo(0, 6);
  });

  it('a zero tax is a no-op', () => {
    const r = applyTax(demand, supply, { perUnit: 0, on: 'buyer' });
    const eq = solveEquilibrium(demand, supply);
    expect(r.qty).toBeCloseTo(eq.qtyStar, 6);
    expect(r.deadweightLoss).toBeCloseTo(0, 6);
  });
});
