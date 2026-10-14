// auction.ts — Chapter 2, the signature set-piece. Hundreds of buyers and sellers with
// hidden reservation prices trade with NO central planner, and the price finds its own
// way to equilibrium.
//
// Mechanism: an adaptive sealed-bid call auction. Each round every trader shouts a
// budget-respecting price (a buyer never bids above their value; a seller never asks
// below their cost — the Gode–Sunder budget constraint that guarantees no loss-making
// trade). Shouts start noisy and the noise decays each round, so the crowd "learns":
// early rounds scatter, late rounds home onto the true crossing of supply and demand.
//
// Determinism: the whole thing runs off a seeded RNG, so the same seed reproduces the
// same price path — which is what the smoke test and unit tests pin.
import type { AuctionConfig, AuctionResult, AuctionTrade } from './types';
import { priceAtQ } from './curves';
import { solveEquilibrium } from './equilibrium';
import { makeRng } from '@/core/rng';
import { clamp, mean, variance } from '@/core/math';

interface Shout { shout: number; limit: number; }

export function runDoubleAuction(cfg: AuctionConfig): AuctionResult {
  const nBuyers = cfg.buyers ?? 60;
  const nSellers = cfg.sellers ?? 60;
  const rounds = cfg.rounds ?? 50;
  const rng = makeRng(cfg.seed);
  const eq = solveEquilibrium(cfg.demand, cfg.supply);

  // Induced values: sample the curves so the population *is* the supply/demand schedule.
  // Span 0 → ~2·Q* so the equilibrium sits in the middle of the crowd.
  const qMax = Math.max(1, eq.qtyStar * 2);
  const values: number[] = [];
  for (let i = 0; i < nBuyers; i++) {
    values.push(priceAtQ(cfg.demand, ((i + 0.5) / nBuyers) * qMax));
  }
  const costs: number[] = [];
  for (let j = 0; j < nSellers; j++) {
    costs.push(priceAtQ(cfg.supply, ((j + 0.5) / nSellers) * qMax));
  }

  // Price bracket for the shout noise.
  const priceLo = Math.min(cfg.supply.intercept, ...costs);
  const priceHi = Math.max(cfg.demand.intercept, ...values);

  // Best-case (efficient) surplus: match the highest values to the lowest costs.
  const valsDesc = [...values].sort((a, b) => b - a);
  const costsAsc = [...costs].sort((a, b) => a - b);
  let maxSurplus = 0;
  for (let i = 0; i < Math.min(valsDesc.length, costsAsc.length); i++) {
    const gain = valsDesc[i]! - costsAsc[i]!;
    if (gain <= 0) break;
    maxSurplus += gain;
  }

  const pricePerRound: number[] = [];
  const efficiencyPerRound: number[] = [];
  const trades: AuctionTrade[] = [];

  for (let r = 0; r < rounds; r++) {
    const noise = rounds > 1 ? 1 - r / (rounds - 1) : 0; // 1 → 0 across the run

    const bids: Shout[] = values.map((v) => {
      const margin = noise * rng.next() * Math.max(0, v - priceLo);
      return { shout: clamp(v - margin, priceLo, v), limit: v };
    });
    const asks: Shout[] = costs.map((c) => {
      const margin = noise * rng.next() * Math.max(0, priceHi - c);
      return { shout: clamp(c + margin, c, priceHi), limit: c };
    });

    bids.sort((a, b) => b.shout - a.shout); // highest bids first
    asks.sort((a, b) => a.shout - b.shout); // lowest asks first

    // March down the crossed orders: matched while bid ≥ ask.
    let m = 0;
    const pairs = Math.min(bids.length, asks.length);
    while (m < pairs && bids[m]!.shout >= asks[m]!.shout) m++;

    if (m === 0) {
      // Nothing crossed this round — carry the best quotes' midpoint as the reading.
      const mid = bids[0] && asks[0] ? (bids[0].shout + asks[0].shout) / 2 : eq.priceStar;
      pricePerRound.push(mid);
      efficiencyPerRound.push(0);
      continue;
    }

    // Uniform clearing price: midpoint of the marginal accepted pair.
    const pc = (bids[m - 1]!.shout + asks[m - 1]!.shout) / 2;
    pricePerRound.push(pc);

    let realized = 0;
    for (let i = 0; i < m; i++) {
      const b = bids[i]!, a = asks[i]!;
      realized += b.limit - a.limit; // ≥ 0: budget constraint guarantees value ≥ cost
      trades.push({ round: r, price: pc, buyerValue: b.limit, sellerCost: a.limit });
    }
    efficiencyPerRound.push(maxSurplus > 0 ? realized / maxSurplus : 0);
  }

  // Running mean — the line that visibly settles onto the equilibrium.
  const runningMean: number[] = [];
  let acc = 0;
  for (let r = 0; r < pricePerRound.length; r++) {
    acc += pricePerRound[r]!;
    runningMean.push(acc / (r + 1));
  }

  // Settled phase = the last quarter of rounds (the noise is near zero there).
  const tail = Math.max(1, Math.floor(rounds / 4));
  const tailPrices = pricePerRound.slice(-tail);
  const tailEff = efficiencyPerRound.slice(-tail);
  const finalMeanPrice = mean(tailPrices);

  return {
    pricePerRound,
    runningMean,
    trades,
    finalMeanPrice,
    equilibrium: eq,
    convergenceError: eq.priceStar > 0 ? Math.abs(finalMeanPrice - eq.priceStar) / eq.priceStar : 0,
    efficiency: mean(tailEff),
    values,
    costs,
  };
}

/** Variance of the first vs last quarter of the price path — used to show it settling. */
export function settlingStats(result: AuctionResult): { early: number; late: number } {
  const n = result.pricePerRound.length;
  const q = Math.max(1, Math.floor(n / 4));
  return {
    early: variance(result.pricePerRound.slice(0, q)),
    late: variance(result.pricePerRound.slice(-q)),
  };
}
