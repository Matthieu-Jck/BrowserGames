// solve.ts — per-network power balance, identical online and offline. Merit order:
// renewables (wind, sun, geothermal, the Hearth) → fuel generators (load-following, fuel
// burnt ∝ dispatch) → accumulators. Satisfaction s = served / demanded, floored to 25‰ steps;
// machines run at speed × s. Integers only: kW, kW·tick, ‰.
import { SAT_STEP } from '../constants';
import { floorTo } from '@/core/fixed';

export interface PowerResult {
  sat: number;      // ‰
  dispatch: number; // ‰ of fuel-generator capacity in use
  /** Net accumulator energy change this tick (kW·tick, + charge / − discharge). */
  accDelta: number;
  served: number;
}

/**
 * @param D demand (kW)   @param R renewable supply (kW)   @param F fuelled generator capacity (kW)
 * @param accE stored energy (kW·tick)   @param accCap capacity (kW·tick)   @param accRate max rate (kW)
 */
export function solvePower(D: number, R: number, F: number, accE: number, accCap: number, accRate: number): PowerResult {
  if (R >= D) {
    const surplus = R - D;
    const charge = Math.min(surplus, accRate, accCap - accE);
    return { sat: 1000, dispatch: 0, accDelta: charge > 0 ? charge : 0, served: D };
  }
  const need = D - R;
  const gen = Math.min(F, need);
  const dispatch = F > 0 ? Math.min(1000, Math.ceil((gen * 1000) / F)) : 0;
  const rem = need - gen;
  const dis = Math.min(rem, accRate, accE);
  const unmet = rem - dis;
  const sat = unmet <= 0 ? 1000 : floorTo(Math.floor((1000 * (D - unmet)) / D), SAT_STEP);
  return { sat, dispatch, accDelta: -dis, served: D - unmet };
}
