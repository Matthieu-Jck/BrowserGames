// fishery.ts — Chapter 5. The tragedy of the commons as logistic population dynamics.
// A shared fish stock grows logistically; harvest sustainably and it persists, harvest
// past its maximum sustainable yield and it collapses to nothing.
import type { FisheryConfig, FisheryRun } from './types';
import { clamp } from '@/core/math';

/** Maximum sustainable yield = rK/4, reached when the stock sits at K/2. */
export const maxSustainableYield = (growthRate: number, capacity: number): number =>
  (growthRate * capacity) / 4;

/** One season of logistic growth minus a harvest. Stock stays within [0, K]. */
export function stepFishery(
  stock: number,
  harvest: number,
  growthRate: number,
  capacity: number,
): number {
  const growth = growthRate * stock * (1 - stock / capacity);
  return clamp(stock + growth - harvest, 0, capacity);
}

/** The harvest the fleet *wants* this season, before the stock limits it. */
function targetHarvest(cfg: FisheryConfig): number {
  const fleetWants = cfg.boats * cfg.catchPerBoat;
  if (cfg.policy === 'quota') {
    const cap = cfg.quota ?? maxSustainableYield(cfg.growthRate, cfg.capacity);
    return Math.min(fleetWants, cap);
  }
  return fleetWants; // open access — everyone fishes flat out
}

/**
 * Run a fishery for a number of seasons under either open access (the tragedy: each
 * boat fishes for itself) or a quota (the cooperative fix, capped at sustainable yield).
 * Deterministic — no randomness — so the collapse is reproducible.
 */
export function simulateFishery(cfg: FisheryConfig): FisheryRun {
  const msy = maxSustainableYield(cfg.growthRate, cfg.capacity);
  const collapseThreshold = 0.05 * cfg.capacity;
  const want = targetHarvest(cfg);

  const stockPerSeason: number[] = [cfg.initialStock];
  const harvestPerSeason: number[] = [];
  let stock = cfg.initialStock;
  let collapseSeason: number | null = null;

  for (let s = 0; s < cfg.seasons; s++) {
    const harvest = Math.min(stock, want);
    harvestPerSeason.push(harvest);
    stock = stepFishery(stock, harvest, cfg.growthRate, cfg.capacity);
    stockPerSeason.push(stock);
    if (collapseSeason === null && stock <= collapseThreshold) collapseSeason = s + 1;
  }

  return {
    stockPerSeason,
    harvestPerSeason,
    collapsed: collapseSeason !== null,
    collapseSeason,
    sustainableYield: msy,
    finalStock: stock,
  };
}
