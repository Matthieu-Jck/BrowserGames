// controls.ts — Chapter 3. What meddling with the price costs: price ceilings/floors
// and per-unit taxes. The point is the deadweight loss — surplus that simply vanishes.
import type {
  ControlKind,
  ControlResult,
  LinearCurve,
  TaxResult,
  TaxSide,
} from './types';
import { qtyAtPriceClamped } from './curves';
import { solveEquilibrium } from './equilibrium';
import { consumerSurplus, producerSurplus, totalSurplusAtQuantity } from './welfare';

const EPS = 1e-9;

/**
 * Impose a price ceiling (binds below P*, e.g. rent control) or floor (binds above
 * P*, e.g. a minimum wage). The short side of the market rules: trade falls to the
 * lesser of demand and supply at the imposed price, and the lost surplus is the DWL.
 *
 * Surplus assumption: the units that *do* trade go to the highest-value buyers / come
 * from the lowest-cost sellers (the best case for a control). This makes the surplus
 * accounting an exact identity: csChange + psChange + deadweightLoss = 0.
 */
export function priceControl(
  demand: LinearCurve,
  supply: LinearCurve,
  opts: { kind: ControlKind; price: number },
): ControlResult {
  const eq = solveEquilibrium(demand, supply);
  const { kind, price } = opts;
  const qd = qtyAtPriceClamped(demand, price);
  const qs = qtyAtPriceClamped(supply, price);
  const binding =
    kind === 'ceiling' ? price < eq.priceStar - EPS : price > eq.priceStar + EPS;

  // The short side rules. A non-binding control just leaves the market at Q*.
  const qTraded = binding ? Math.min(qd, qs) : eq.qtyStar;
  const cs = consumerSurplus(demand, qTraded, price);
  const ps = producerSurplus(supply, qTraded, price);
  const totalNow = cs + ps;
  const deadweightLoss = Math.max(0, eq.totalSurplus - totalNow);

  return {
    kind,
    price,
    binding,
    qTraded,
    shortage: binding && kind === 'ceiling' ? Math.max(0, qd - qs) : 0,
    surplus: binding && kind === 'floor' ? Math.max(0, qs - qd) : 0,
    deadweightLoss,
    consumerSurplus: cs,
    producerSurplus: ps,
    csChange: cs - eq.consumerSurplus,
    psChange: ps - eq.producerSurplus,
    equilibrium: eq,
  };
}

/**
 * Levy a per-unit tax. The economic outcome is independent of who is legally charged
 * (`on`) — that's the tax-equivalence theorem, which this model embodies: the tax
 * drives a wedge `t` between the price buyers pay and the price sellers keep, and the
 * burden falls on the more inelastic (steeper) side of the market.
 */
export function applyTax(
  demand: LinearCurve,
  supply: LinearCurve,
  opts: { perUnit: number; on: TaxSide },
): TaxResult {
  const eq = solveEquilibrium(demand, supply);
  const t = Math.max(0, opts.perUnit);

  // Quantity where (demand price − supply price) = t.
  const denom = supply.slope - demand.slope;
  const qRaw =
    Math.abs(denom) < EPS
      ? 0
      : (demand.intercept - supply.intercept - t) / denom;
  const qty = Math.max(0, qRaw);

  const buyerPrice = demand.intercept + demand.slope * qty;
  const sellerPrice = supply.intercept + supply.slope * qty;
  const taxRevenue = t * qty;

  const cs = consumerSurplus(demand, qty, buyerPrice);
  const ps = producerSurplus(supply, qty, sellerPrice);
  const deadweightLoss = Math.max(
    0,
    totalSurplusAtQuantity(demand, supply, eq.qtyStar) -
      totalSurplusAtQuantity(demand, supply, qty),
  );

  return {
    perUnit: t,
    on: opts.on,
    qty,
    buyerPrice,
    sellerPrice,
    taxRevenue,
    deadweightLoss,
    incidenceBuyer: buyerPrice - eq.priceStar,
    incidenceSeller: eq.priceStar - sellerPrice,
    csChange: cs - eq.consumerSurplus,
    psChange: ps - eq.producerSurplus,
    equilibrium: eq,
  };
}
