// token-facts.ts — research's AI tokens made plain (D102 on D68; owner, 2026-10-16: « Pareil pour
// les tokens, ce n'est pas clair »), pure (no DOM). Since D118 tokens are a flow delivered at each
// minute's end, and since D122 research's one currency: the free flows first — the Core's compute
// (from its level 2) and the claim's servers' output —, to the projects in the order they started
// (the oldest first, each to its need), then the bank (tokens an older save's data was worth), then
// each project's own flow bought from CrierBelt (`buy`), at most what it still needs, at CrierBelt's
// price (10 ◉ the thousand, half under the Compute Plan, whose fee is paid each hour) — none while
// the purse is in the red. What this says, now: the tokens a minute each project and all research
// get, the free share, the flow bought and the ◉ a minute it costs, and the Compute Plan's
// comparison — what the tokens bought would cost an hour without it and with it, fee included.
import { BAL } from '@/content/balance';
import { serverRate, tokenFlows } from '@/sim/systems/research';
import type { Sim } from '@/sim/state';

/** One project's tokens a minute now: all of them, each part, and the bought part's bill (centi-◉ a minute). */
export interface ProjectTokens { readonly perMin: number; readonly free: number; readonly bank: number; readonly bought: number; readonly centsPerMin: number }

export interface TokenFacts {
  /** Tokens a minute research gets now (free, bank and bought). */
  readonly usePerMin: number;
  /** What the Core computes a minute now, and what the claim's servers make (both free). */
  readonly corePerMin: number;
  readonly supplyPerMin: number;
  /** Of what research gets: the free flows' share (the Core's compute and the servers), the bank's. */
  readonly freePerMin: number;
  readonly bankPerMin: number;
  /** The share of what research gets that is free (free flows and the bank), ‰ (1000 with nothing bought). */
  readonly free: number;
  /** Tokens a minute bought from CrierBelt, and their price a minute (centi-◉). */
  readonly boughtPerMin: number;
  readonly centsPerMin: number;
  /** Each running project's tokens a minute. */
  readonly projects: ReadonlyMap<string, ProjectTokens>;
  /** The Compute Plan: offered (learnt), on; what the bought tokens cost an hour without it and with it (its fee in). */
  readonly plan: { readonly offered: boolean; readonly on: boolean; readonly without: number; readonly with: number; readonly fee: number };
}

export function tokenFacts(sim: Sim): TokenFacts {
  const satOf = (net: number): number => sim.netPower[net]?.sat ?? 0;
  const priceK = sim.tokenPriceK();
  const projects = new Map<string, ProjectTokens>();
  let free = 0, bank = 0, bought = 0;
  for (const [id, f] of tokenFlows(sim, satOf)) {
    projects.set(id, { perMin: f.free + f.bank + f.bought, free: f.free, bank: f.bank, bought: f.bought, centsPerMin: (f.bought * priceK) / 1000 });
    free += f.free;
    bank += f.bank;
    bought += f.bought;
  }
  const use = free + bank + bought;
  const full = BAL.tokenCentsPerK, half = Math.floor((BAL.tokenCentsPerK * BAL.tokenPlan.priceFactor) / 1000);
  return {
    usePerMin: use, corePerMin: sim.coreComputeRate(), supplyPerMin: serverRate(sim, satOf),
    freePerMin: free, bankPerMin: bank,
    free: use > 0 ? Math.round(((free + bank) * 1000) / use) : 1000,
    boughtPerMin: bought, centsPerMin: (bought * priceK) / 1000, projects,
    plan: {
      offered: sim.mods.flags.has('tokenPlan') || sim.tokenPlan, on: sim.tokenPlan,
      without: Math.round((bought * full * 60) / 1000),
      with: Math.round((bought * half * 60) / 1000) + BAL.tokenPlan.feeCentsPerHour,
      fee: BAL.tokenPlan.feeCentsPerHour,
    },
  };
}
