// token-facts.ts — research's AI tokens made plain (D102 on D68; owner, 2026-10-16: « Pareil pour
// les tokens, ce n'est pas clair »), pure (no DOM). Since D118 tokens are a flow delivered at each
// minute's end: the claim's servers' output, to the projects in the order they started (the oldest
// first, each to its need), then each project's own flow bought from CrierBelt (`buy`), at most what
// it still needs, at CrierBelt's price (10 ◉ the thousand, half under the Compute Plan, whose fee is
// paid each hour) — none while the purse is in the red. What this says, now: the tokens a minute
// each project and all research get, the servers' share, the flow bought and the ◉ a minute it
// costs, and the Compute Plan's comparison — what the tokens bought would cost an hour without it
// and with it, fee included.
import { BAL } from '@/content/balance';
import { serverRate, tokenFlows } from '@/sim/systems/research';
import type { Sim } from '@/sim/state';

export interface TokenFacts {
  /** Tokens a minute research gets now (the servers' share and the flows bought), and the claim's servers make. */
  readonly usePerMin: number;
  readonly supplyPerMin: number;
  /** The share of what research gets that the servers give, ‰ (1000 with nothing bought). */
  readonly servers: number;
  /** Tokens a minute bought from CrierBelt, and their price a minute (centi-◉). */
  readonly boughtPerMin: number;
  readonly centsPerMin: number;
  /** Each running project: its tokens a minute (servers' share + bought), each part, and its bill (centi-◉ a minute). */
  readonly projects: ReadonlyMap<string, { readonly perMin: number; readonly servers: number; readonly bought: number; readonly centsPerMin: number }>;
  /** The Compute Plan: offered (learnt), on; what the bought tokens cost an hour without it and with it (its fee in). */
  readonly plan: { readonly offered: boolean; readonly on: boolean; readonly without: number; readonly with: number; readonly fee: number };
}

export function tokenFacts(sim: Sim): TokenFacts {
  const satOf = (net: number): number => sim.netPower[net]?.sat ?? 0;
  const priceK = sim.tokenPriceK();
  const projects = new Map<string, { perMin: number; servers: number; bought: number; centsPerMin: number }>();
  let fromServers = 0, bought = 0;
  for (const [id, f] of tokenFlows(sim, satOf)) {
    projects.set(id, { perMin: f.servers + f.bought, servers: f.servers, bought: f.bought, centsPerMin: (f.bought * priceK) / 1000 });
    fromServers += f.servers;
    bought += f.bought;
  }
  const use = fromServers + bought;
  const full = BAL.tokenCentsPerK, half = Math.floor((BAL.tokenCentsPerK * BAL.tokenPlan.priceFactor) / 1000);
  return {
    usePerMin: use, supplyPerMin: serverRate(sim, satOf),
    servers: use > 0 ? Math.round((fromServers * 1000) / use) : 1000,
    boughtPerMin: bought, centsPerMin: (bought * priceK) / 1000, projects,
    plan: {
      offered: sim.mods.flags.has('tokenPlan') || sim.tokenPlan, on: sim.tokenPlan,
      without: Math.round((bought * full * 60) / 1000),
      with: Math.round((bought * half * 60) / 1000) + BAL.tokenPlan.feeCentsPerHour,
      fee: BAL.tokenPlan.feeCentsPerHour,
    },
  };
}
