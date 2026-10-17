// token-facts.test.ts — research's AI tokens made plain (D102 on D68): a project's tokens a minute
// at its grid's power, what the claim's servers cover, what is bought and its price a minute, and
// the Compute Plan's comparison (half price plus its fee an hour).
import { describe, expect, it } from 'vitest';
import { BAL } from '@/content/balance';
import type { Sim } from '@/sim/state';
import { tokenFacts } from './token-facts';

/** A colony reduced to what tokenFacts reads: one project (no lab: full power), servers making `supply` a minute. */
function colony(o: { supply?: number; plan?: boolean; learnt?: boolean } = {}): Sim {
  return {
    projects: [{ id: 'x', lab: 0, tokens: 60_000, tokUsed: 0, dur: 6_000, el: 0, cost: [], paid: [] }],
    researchHeld: false,
    graph: o.supply ? { servers: [{ net: 0, tpm: o.supply }] } : null,
    netPower: [{ sat: 1000 }],
    tokenPlan: !!o.plan,
    mods: { flags: new Set(o.learnt ? ['tokenPlan'] : []) },
    tokenPriceK: () => (o.plan ? Math.floor((BAL.tokenCentsPerK * BAL.tokenPlan.priceFactor) / 1000) : BAL.tokenCentsPerK),
  } as unknown as Sim;
}

describe('tokenFacts', () => {
  it('a project\'s tokens a minute at full power, all bought from CrierBelt without servers', () => {
    const f = tokenFacts(colony());
    // 60 000 tokens over 6 000 ticks (10 minutes): 6 000 a minute.
    expect(f.projects.get('x')!.perMin).toBe(6000);
    expect(f.usePerMin).toBe(6000);
    expect(f.servers).toBe(0);
    expect(f.boughtPerMin).toBe(6000);
    expect(f.centsPerMin).toBe((6000 * BAL.tokenCentsPerK) / 1000); // 60 ◉ a minute at 10 ◉ the thousand
    expect(f.projects.get('x')!.centsPerMin).toBe(f.centsPerMin);
  });

  it('the claim\'s servers cover their share first; only the rest is bought', () => {
    const f = tokenFacts(colony({ supply: 1500 }));
    expect(f.servers).toBe(250);
    expect(f.boughtPerMin).toBe(4500);
    expect(f.centsPerMin).toBe((4500 * BAL.tokenCentsPerK) / 1000);
  });

  it('the Compute Plan: offered once learnt; an hour without it and with it (half price, its fee in)', () => {
    const f = tokenFacts(colony({ learnt: true }));
    expect(f.plan.offered).toBe(true);
    expect(f.plan.without).toBe(6000 * BAL.tokenCentsPerK * 60 / 1000);
    expect(f.plan.with).toBe(Math.round((6000 * Math.floor((BAL.tokenCentsPerK * BAL.tokenPlan.priceFactor) / 1000) * 60) / 1000) + BAL.tokenPlan.feeCentsPerHour);
    expect(f.plan.with).toBeLessThan(f.plan.without);
    expect(tokenFacts(colony()).plan.offered).toBe(false);
  });
});
