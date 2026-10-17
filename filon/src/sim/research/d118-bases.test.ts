// d118-bases.test.ts — the debug bases under D118 (research without time, its tokens a flow, its
// tiers by the Core's level): the tutorial base's research is Tier 1, data alone, no tokens; the grown
// base, its Core at level 2, sees Tier 2 locked; the late base, its Core at level 5, runs its Tier 2
// project on its servers' tokens and a flow bought on top, and reaches it.
import { describe, it, expect } from 'vitest';
import { foundScenario } from '../scenarios';
import { WORLD_EPOCH0, EPOCH } from '../constants';
import { tokenFlows } from '../systems/research';

const found = (id: 'tutorial' | 'grown' | 'late') => foundScenario(id, { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' }).sim;

describe('the debug bases’ research (D118)', () => {
  it('the tutorial base: Tier 1 on data alone, no tokens; the grown base: Tier 2 locked behind the Core’s level 3', () => {
    const tut = found('tutorial');
    expect(tut.projects.length).toBeGreaterThan(0);
    for (const p of tut.projects) expect([p.tokens, p.dur], p.id).toEqual([0, 0]);
    const grown = found('grown');
    expect(grown.hearthLevel).toBeLessThan(3);
    expect(grown.tierCoreOpen(2)).toBe(false);
    expect(grown.researchBlock('tr2')).not.toBeNull();
    for (const p of grown.projects) expect(p.tokens ?? 0, p.id).toBe(0);
  }, 60_000);

  it('the late base: its Core at level 5, every tier open; its Tier 2 project fed by its servers and a bought flow, its tokens in within the hour', () => {
    const late = found('late');
    expect(late.hearthLevel).toBe(5);
    for (const tier of [2, 3, 4]) expect(late.tierCoreOpen(tier), `tier ${tier}`).toBe(true);
    const p = late.projects.find((q) => q.id === 'an_queue')!;
    expect(p, 'an_queue under way').toBeTruthy();
    expect(p.tokens).toBeGreaterThan(0);
    expect(p.buy).toBeGreaterThan(0);
    late.run(EPOCH);
    const f = tokenFlows(late, (n) => late.netPower[n]?.sat ?? 0).get('an_queue')!;
    expect(f.servers).toBeGreaterThan(0);
    expect(f.bought).toBeGreaterThan(0);
    // Its tokens come in within the hour; its Survey Data keeps coming from the Core and its collector
    // (its Mechanics Data comes to the Fabrique's lab, not this one: it waits on it, as a player's would).
    const j1 = p.paid[0]!;
    for (let m = 0; m < 30 && (p.tokIn ?? 0) < p.tokens!; m++) late.run(EPOCH);
    expect(p.tokIn).toBe(p.tokens);
    expect(late.projects.find((q) => q.id === 'an_queue')?.buy ?? 0).toBeGreaterThan(0);
    late.run(5 * EPOCH);
    expect(p.paid[0]!).toBeGreaterThan(j1);
    expect(late.tokenStats.bought).toBe(0); // the flow stopped by itself once it had its tokens
  }, 120_000);
});
