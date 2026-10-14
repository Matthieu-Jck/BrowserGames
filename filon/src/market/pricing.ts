// pricing.ts — the price formation maths of the Crier (design §6), as pure functions. Per item,
// with r = P / V:
// · NPC supply S = S0·e·r^0.8 and demand D = D0·e′·r^−0.6; the equilibrium r* solves
//   D(r*) + imports = S(r*) + exports, by bisection on ln r ∈ [ln 0.25, ln 4];
// · a stateless noise u(t): smooth value noise in four octaves on a lattice of Gaussian values
//   drawn from hash(seed, item, octave, cell), normalised to unit σ. The design asks for an
//   Ornstein–Uhlenbeck wander with τ ≈ 12 h; an exact OU path needs either saved state or a sum
//   over hundreds of past draws, while this needs four lattice cells, has the same σ and an
//   autocorrelation that falls to 1/e after ≈ 12 h (smoother than OU below an hour: prices do
//   not jitter from one minute to the next). Being a pure function of time, it is never saved;
// · a spot trade walks down (sell) or up (buy) an exponential depth curve: the marginal price
//   after a net volume w is P·e^(−w/K), K = κ·Q, clamped to the price bounds; its mean over a
//   sale of L from 0 is P·(K/L)·(1 − e^(−L/K)) — 0.787·P for 9 000 plates (Q 600);
// · integer conversions: centi-ocelles, the spread, the trade post's fee.
// Floats and Math.exp/log are fine here (the market is authoritative where it runs); the sim
// only ever sees the integers these produce. The one Gaussian of the game lives here.
import { BAL } from '@/content/balance';
import { ceilDiv, mulDiv } from '@/core/fixed';
import { hash32 } from '@/core/hash';
import type { TradeSide } from './types';

const M = BAL.market;
export const LN_RMIN = Math.log(M.rMin);
export const LN_RMAX = Math.log(M.rMax);
const ES = M.supplyExp;
const ED = M.demandExp;

// ── noise ────────────────────────────────────────────────────────────────────

/** Standard normal deviate from two hashed uniforms (Box–Muller). */
export function gauss(seed: number, a: number, b: number, c: number): number {
  const u1 = (hash32(seed, a, b, c, 1) + 1) / 4294967297; // (0, 1]: log is finite
  const u2 = hash32(seed, a, b, c, 2) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** The noise's own seed in a world (kept apart from every other hash of the world seed). */
export const noiseSeedOf = (worldSeed: number): number => hash32(worldSeed >>> 0, 0x6e015e);

/** Octave lattice spacings (minutes) and gains. */
export const OCT_L: readonly number[] = M.noiseOctaves.map((o) => o[0]);
export const OCT_G: readonly number[] = M.noiseOctaves.map((o) => o[1]);
/**
 * Unit-σ normalisation: smoothstep interpolation between independent N(0,1) lattice values
 * has a variance averaging ∫(1 − s)² + s² df = 26/35 over a cell, summed over the octaves.
 */
export const NOISE_NORM = 1 / Math.sqrt((26 / 35) * OCT_G.reduce((a, g) => a + g * g, 0));

/** Lattice phase of an octave for an item, so cells of different items and octaves never align. */
export const noiseOffset = (seed: number, item: number, octave: number): number => hash32(seed, item, octave, 0x0ff5e7) % OCT_L[octave]!;

/** The unit-σ noise of an item at epoch t (pure; the engine caches lattice cells but computes the same). */
export function noiseAt(seed: number, item: number, t: number): number {
  let u = 0;
  for (let o = 0; o < OCT_L.length; o++) {
    const x = (t + noiseOffset(seed, item, o)) / OCT_L[o]!;
    const k = Math.floor(x), f = x - k, s = f * f * (3 - 2 * f);
    const g0 = gauss(seed, item, o, k), g1 = gauss(seed, item, o, k + 1);
    u += OCT_G[o]! * (g0 + (g1 - g0) * s);
  }
  return u * NOISE_NORM;
}

// ── equilibrium ──────────────────────────────────────────────────────────────

/** ln r* with no player flow: D·r^−0.6 = S·r^0.8 ⇒ ln r = ln(D/S) / 1.4, clamped to the bounds. */
export function lnRatioNoFlow(S: number, D: number): number {
  if (!(S > 0) || !(D > 0)) return 0;
  const L = Math.log(D / S) / (ES + ED);
  return L < LN_RMIN ? LN_RMIN : L > LN_RMAX ? LN_RMAX : L;
}

/**
 * ln r* where NPC demand plus the player's imports m meets NPC supply plus the player's exports
 * x (items/min): D·r^−0.6 + m = S·r^0.8 + x. The excess demand falls with r, so the root is
 * unique; it is found by bisection on [ln rMin, ln rMax] (a root beyond a bound clamps to it).
 */
export function lnEquilibrium(S: number, D: number, x: number, m: number): number {
  if (x === 0 && m === 0) return lnRatioNoFlow(S, D);
  const excess = (L: number): number => D * Math.exp(-ED * L) + m - S * Math.exp(ES * L) - x;
  let lo = LN_RMIN, hi = LN_RMAX;
  if (excess(lo) <= 0) return lo;
  if (excess(hi) >= 0) return hi;
  for (let i = 0; i < M.bisectSteps; i++) {
    const mid = (lo + hi) / 2;
    if (excess(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Fraction of the gap to the target that smoothing closes over Δ minutes: 1 − e^(−Δ/τ). */
export const easeFactor = (dtMin: number, tauMin: number): number => 1 - Math.exp(-dtMin / tauMin);

/** T3/T4 depth (or demand) ramp: rampFrom at the colony's day 0 → 1 after rampDays[tier]. */
export function rampAt(tier: number, day: number): number {
  const days = M.rampDays[tier] ?? 0;
  if (days <= 0) return 1;
  const f = day <= 0 ? 0 : day >= days ? 1 : day / days;
  return M.rampFrom + (1 - M.rampFrom) * f;
}

// ── spot depth ───────────────────────────────────────────────────────────────

/** Depth of a spot trade (items): κ minutes of the item's NPC flow. */
export const spotDepth = (flowPerMin: number): number => M.spotKappaMin * flowPerMin;

/**
 * Mean over w ∈ [a, b] (a < b) of clamp(e^(−w/K), lo, hi): the price path of spot trades
 * relative to the mid when the epoch began, w = net volume booked so far (sold +, bought −).
 * The clamp keeps the marginal price inside the market's bounds (lo = rMin·V / P, hi = rMax·V / P).
 */
export function meanPath(a: number, b: number, K: number, lo: number, hi: number): number {
  const g = (w: number): number => { const v = Math.exp(-w / K); return v < lo ? lo : v > hi ? hi : v; };
  if (!(b > a)) return g(a);
  const wHi = -K * Math.log(hi); // below it the price sits at the ceiling (heavy buying)
  const wLo = -K * Math.log(lo); // above it at the floor (heavy selling)
  let sum = 0;
  if (a < wHi) sum += hi * (Math.min(b, wHi) - a);
  const m0 = Math.max(a, wHi), m1 = Math.min(b, wLo);
  if (m1 > m0) sum += K * (Math.exp(-m0 / K) - Math.exp(-m1 / K));
  if (b > wLo) sum += lo * (b - Math.max(a, wLo));
  return sum / (b - a);
}

/**
 * Lasting ln price factor of a net spot volume W settled in one epoch: a sale leaves
 * max(floor, 1 − W/2K) (−25 % for 9 000 plates), a purchase the mirror factor in ln space.
 */
export function spotShock(W: number, K: number): number {
  if (W === 0 || !(K > 0)) return 0;
  const f = Math.max(M.shockFloor, 1 - Math.abs(W) / (2 * K));
  return W > 0 ? Math.log(f) : -Math.log(f);
}

// ── integers for the sim ─────────────────────────────────────────────────────

/** Bid and ask (centi-ocelles) around a mid price P (◉) with spread s, rounded in the market's favour. */
export function bidCents(P: number, s: number): number {
  return Math.max(1, Math.floor(P * (1 - s / 2) * 100));
}
export function askCents(P: number, s: number, bid: number): number {
  return Math.max(bid + 1, Math.ceil(P * (1 + s / 2) * 100));
}

/** Value (centi-ocelles) of `mu` milli-items at `unitCents` per item, rounded in the market's favour. */
export function valueCents(mu: number, unitCents: number, side: TradeSide): number {
  return side === 'sell' ? mulDiv(mu, unitCents, 1000) : ceilDiv(mu * unitCents, 1000);
}

/**
 * Price after the trade post's fee (‰, e.g. mods.tradeFee = 80): a sale pays out
 * ⌊cents·(1 − fee)⌋, a purchase costs ⌈cents·(1 + fee)⌉. The market never applies the fee.
 */
export function afterFee(cents: number, side: TradeSide, feePermille: number): number {
  return side === 'sell' ? mulDiv(cents, 1000 - feePermille, 1000) : ceilDiv(cents * (1000 + feePermille), 1000);
}
