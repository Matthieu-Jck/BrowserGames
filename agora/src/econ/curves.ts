// curves.ts — linear supply/demand primitives. P = intercept + slope·Q.
import type { LinearCurve } from './types';

/** Price along the curve at quantity q. */
export const priceAtQ = (c: LinearCurve, q: number): number => c.intercept + c.slope * q;

/** Quantity at a given price (raw inverse; may be negative — caller clamps if needed). */
export const qtyAtPrice = (c: LinearCurve, p: number): number =>
  c.slope === 0 ? 0 : (p - c.intercept) / c.slope;

/** Quantity at a price, floored at zero (the economically meaningful reading). */
export const qtyAtPriceClamped = (c: LinearCurve, p: number): number =>
  Math.max(0, qtyAtPrice(c, p));

/**
 * Demand curve from a choke price (max price anyone will pay, at Q=0) and a
 * positive `drop` = how much price falls per unit. Stored with negative slope.
 */
export const makeDemand = (chokePrice: number, drop: number): LinearCurve => ({
  intercept: chokePrice,
  slope: -Math.abs(drop),
});

/**
 * Supply curve from a reservation price (lowest price to produce the first unit)
 * and a positive `rise` = how much price climbs per unit.
 */
export const makeSupply = (reservationPrice: number, rise: number): LinearCurve => ({
  intercept: reservationPrice,
  slope: Math.abs(rise),
});
