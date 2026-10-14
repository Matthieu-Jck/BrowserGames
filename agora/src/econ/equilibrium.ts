// equilibrium.ts — Chapter 1. Where supply meets demand, and what a single imposed
// price does to the market.
import type { LinearCurve, MarketResult, PriceOutcome } from './types';
import { priceAtQ, qtyAtPriceClamped } from './curves';
import { consumerSurplus, producerSurplus } from './welfare';

const EPS = 1e-9;

/** Solve for the market-clearing price and quantity, and the surplus at that point. */
export function solveEquilibrium(demand: LinearCurve, supply: LinearCurve): MarketResult {
  const denom = supply.slope - demand.slope;
  // Parallel curves never cross — degenerate, no trade.
  const qtyStarRaw = Math.abs(denom) < EPS ? 0 : (demand.intercept - supply.intercept) / denom;
  const qtyStar = Math.max(0, qtyStarRaw);
  const priceStar = priceAtQ(demand, qtyStar);
  const cs = consumerSurplus(demand, qtyStar, priceStar);
  const ps = producerSurplus(supply, qtyStar, priceStar);
  return {
    priceStar,
    qtyStar,
    consumerSurplus: cs,
    producerSurplus: ps,
    totalSurplus: cs + ps,
  };
}

/** What a single price `p` produces: how much is wanted, offered, and actually traded. */
export function outcomeAtPrice(
  demand: LinearCurve,
  supply: LinearCurve,
  p: number,
): PriceOutcome {
  const qd = qtyAtPriceClamped(demand, p);
  const qs = qtyAtPriceClamped(supply, p);
  const gap = qd - qs;
  const kind = gap > EPS ? 'shortage' : gap < -EPS ? 'surplus' : 'clearing';
  return { price: p, qd, qs, qTraded: Math.min(qd, qs), gap, kind };
}
