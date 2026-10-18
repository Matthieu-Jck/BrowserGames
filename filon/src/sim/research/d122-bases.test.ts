// d122-bases.test.ts — the debug bases' research under D118 and D122 (research without time and
// without data: tokens as a flow at every tier, resources paid at launch, tiers by the Core's level):
// the tutorial base runs its Tier 1 node on the Core's compute alone and learns it in minutes; the
// grown base, its Core at level 2, sees Tier 2 locked; the late base, its Core at level 5, runs its
// Tier 2 project on the Core's compute, its servers and a flow bought on top, and learns it.
import { describe, it, expect } from 'vitest';
import { foundScenario } from '../scenarios';
import { WORLD_EPOCH0, EPOCH } from '../constants';
import { tokenFlows } from '../systems/research';

const found = (id: 'tutorial' | 'grown' | 'late') => foundScenario(id, { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' }).sim;

describe('the debug bases’ research (D118, D122)', () => {
  it('the tutorial base: a Tier 1 node on the Core’s compute alone, learnt in minutes; the grown base: Tier 2 locked behind the Core’s level 3', () => {
    const tut = found('tutorial');
    expect(tut.hearthLevel).toBe(2);
    expect(tut.coreComputeRate()).toBe(1000);
    const p = tut.projects[0]!;
    expect(p, 'a node under way').toBeTruthy();
    expect([p.dur, p.buy ?? 0]).toEqual([0, 0]);
    expect(p.tokens).toBeLessThanOrEqual(5000);
    expect(p.paid).toEqual(p.cost.map((c) => c.mu)); // its resources paid at launch
    for (let m = 0; m < 8 && !tut.done.has(p.id); m++) tut.run(EPOCH);
    expect(tut.done.has(p.id), `${p.id} learnt on the Core's compute`).toBe(true);
    const grown = found('grown');
    expect(grown.hearthLevel).toBeLessThan(3);
    expect(grown.tierCoreOpen(2)).toBe(false);
    expect(grown.researchBlock('tr2')).not.toBeNull();
    for (const q of grown.projects) expect(q.buy ?? 0, q.id).toBe(0); // Tier 1: the Core's compute suffices
  }, 60_000);

  it('the late base: its Core at level 5, every tier open; its Tier 2 projects fed by the Core, its servers and bought flows, learnt within the hour', () => {
    const late = found('late');
    expect(late.hearthLevel).toBe(5);
    for (const tier of [2, 3, 4]) expect(late.tierCoreOpen(tier), `tier ${tier}`).toBe(true);
    const p = late.projects.find((q) => q.id === 'an_queue')!;
    expect(p, 'an_queue under way').toBeTruthy();
    expect(p.tokens).toBeGreaterThan(0);
    expect(p.buy).toBeGreaterThan(0);
    expect(late.projects.some((q) => q.id === 'en_solarfarm'), 'the Fabrique’s lab under way').toBe(true);
    late.run(EPOCH);
    const f = tokenFlows(late, (n) => late.netPower[n]?.sat ?? 0).get('an_queue')!;
    expect(f.free).toBeGreaterThan(0);
    expect(f.bought).toBeGreaterThan(0);
    for (let m = 0; m < 60 && !late.done.has('an_queue'); m++) late.run(EPOCH);
    expect(late.done.has('an_queue'), 'learnt: no data to wait for (D122)').toBe(true);
    late.run(EPOCH);
    expect(late.projects.some((q) => q.id === 'an_queue')).toBe(false);
  }, 120_000);
});
