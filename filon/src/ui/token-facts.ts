// token-facts.ts — research's AI tokens made plain (D102 on D68; owner, 2026-10-16: « Pareil pour
// les tokens, ce n'est pas clair »), pure (no DOM). A project uses its tokens as it runs, at its
// lab's grid's power: ⌊tokens·e / (dur·1000)⌋ by its elapsed e, so `tokens × sat × EPOCH /
// (dur × 1000)` a minute. The claim's servers cover what they make; the rest is bought from
// CrierBelt each minute at its price (10 ◉ the thousand, half under the Compute Plan, whose fee is
// paid each hour). What this says, now: the tokens a minute of each project and of all research,
// the servers' share, the ◉ a minute they cost, and the Compute Plan's comparison — what the
// tokens bought would cost an hour without it and with it, fee included.
import { BAL } from '@/content/balance';
import { EPOCH } from '@/sim/constants';
import { serverRate } from '@/sim/systems/research';
import type { Sim } from '@/sim/state';
import { projectTiming } from './tree-state';

export interface TokenFacts {
  /** Tokens a minute all research uses now, and the claim's servers make. */
  readonly usePerMin: number;
  readonly supplyPerMin: number;
  /** The share of the use the servers cover, ‰ (1000 with nothing to buy). */
  readonly servers: number;
  /** Tokens a minute bought from CrierBelt, and their price a minute (centi-◉). */
  readonly boughtPerMin: number;
  readonly centsPerMin: number;
  /** Each running project: its tokens a minute and its part of the bill (centi-◉ a minute). */
  readonly projects: ReadonlyMap<string, { readonly perMin: number; readonly centsPerMin: number }>;
  /** The Compute Plan: offered (learnt), on; what the bought tokens cost an hour without it and with it (its fee in). */
  readonly plan: { readonly offered: boolean; readonly on: boolean; readonly without: number; readonly with: number; readonly fee: number };
}

export function tokenFacts(sim: Sim): TokenFacts {
  const projects = new Map<string, { perMin: number; centsPerMin: number }>();
  let use = 0;
  for (const p of sim.projects) {
    const tm = projectTiming(sim, p);
    const perMin = (p.tokens ?? 0) > 0 && p.dur > 0 && !tm.held ? ((p.tokens ?? 0) * tm.sat * EPOCH) / (p.dur * 1000) : 0;
    projects.set(p.id, { perMin, centsPerMin: 0 });
    use += perMin;
  }
  const supply = serverRate(sim, (net) => sim.netPower[net]?.sat ?? 0);
  const bought = Math.max(0, use - supply);
  const priceK = sim.tokenPriceK();
  const centsPerMin = (bought * priceK) / 1000;
  // Each project's part of the bill: its share of what is bought (the servers cover all alike).
  for (const v of projects.values()) v.centsPerMin = use > 0 ? (centsPerMin * v.perMin) / use : 0;
  const full = BAL.tokenCentsPerK, half = Math.floor((BAL.tokenCentsPerK * BAL.tokenPlan.priceFactor) / 1000);
  return {
    usePerMin: use, supplyPerMin: supply,
    servers: use > 0 ? Math.round((Math.min(use, supply) * 1000) / use) : 1000,
    boughtPerMin: bought, centsPerMin, projects,
    plan: {
      offered: sim.mods.flags.has('tokenPlan') || sim.tokenPlan, on: sim.tokenPlan,
      without: Math.round((bought * full * 60) / 1000),
      with: Math.round((bought * half * 60) / 1000) + BAL.tokenPlan.feeCentsPerHour,
      fee: BAL.tokenPlan.feeCentsPerHour,
    },
  };
}
