import { describe, it, expect } from 'vitest';
import { makeDemand, makeSupply } from './curves';
import { runDoubleAuction, settlingStats } from './auction';

const demand = makeDemand(100, 1); // P = 100 − Q
const supply = makeSupply(20, 1); // P = 20 + Q ; eq P*=60, Q*=40
const cfg = { seed: 'agora-ch2', demand, supply, buyers: 80, sellers: 80, rounds: 60 };

describe('the double auction converges to equilibrium without a planner', () => {
  it('settles near the competitive price', () => {
    const r = runDoubleAuction(cfg);
    expect(r.equilibrium.priceStar).toBeCloseTo(60, 6);
    expect(r.convergenceError).toBeLessThan(0.08); // within 8% of P*
  });

  it('the price path settles down (late variance ≪ early variance)', () => {
    const r = runDoubleAuction(cfg);
    const { early, late } = settlingStats(r);
    expect(late).toBeLessThan(early);
  });

  it('captures almost all the available surplus once settled', () => {
    const r = runDoubleAuction(cfg);
    expect(r.efficiency).toBeGreaterThan(0.9);
  });

  it('never lets a buyer pay above value or a seller sell below cost', () => {
    const r = runDoubleAuction(cfg);
    expect(r.trades.length).toBeGreaterThan(0);
    for (const t of r.trades) {
      expect(t.price).toBeLessThanOrEqual(t.buyerValue + 1e-9);
      expect(t.price).toBeGreaterThanOrEqual(t.sellerCost - 1e-9);
      expect(t.buyerValue).toBeGreaterThanOrEqual(t.sellerCost - 1e-9);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = runDoubleAuction(cfg);
    const b = runDoubleAuction(cfg);
    expect(b.pricePerRound).toEqual(a.pricePerRound);
  });

  it('a different seed gives a different path but the same destination', () => {
    const a = runDoubleAuction(cfg);
    const b = runDoubleAuction({ ...cfg, seed: 'different' });
    expect(b.pricePerRound).not.toEqual(a.pricePerRound);
    expect(b.finalMeanPrice).toBeCloseTo(a.finalMeanPrice, 0); // both land at ~P*
  });
});
