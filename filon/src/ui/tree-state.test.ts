// tree-state.test.ts — the tech tree's state, derived once for the HUD's chips and the tree screen
// (tree-state.ts): the plans ready are the ones the Heart can pay for now, a node's state follows
// what blocks it (the Core's level too, D118), a project's state says its data and its tokens, the
// flows it gets, when its tokens will be in and what it waits for, the same way to both.
import { describe, it, expect } from 'vitest';
import { ITEM_IDS, itemIdx } from '@/content/registry';
import { PLAN_IDS } from '@/content/research';
import { QUEST_IDS } from '@/content/quests';
import { planCost } from '@/sim/systems/research';
import { testSim, wire } from '@/sim/testkit';
import { treePrereq } from '@/content/research';
import type { Sim } from '@/sim/state';
import { planState, projectTiming, readyPlans, researchState } from './tree-state';

/** A second research slot, granted outside commands. */
function learnSlots(sim: Sim): void {
  for (const id of ['tr3', 'tr4', 'tr5']) sim.done.add(id);
  sim.rebuildDerived();
}

describe('the tech tree’s state, one derivation for the HUD and the tree', () => {
  it('a plan is ready exactly when the Heart can pay for it now; taken, it is done and leaves the HUD’s count', () => {
    const sim = testSim(undefined, { plans: false });
    sim.quests.skipped = true; // the tree as it stands outside the tutorial (D101 paces it: below)
    for (const id of PLAN_IDS) {
      const b = sim.planBlock(id);
      expect(planState(sim, id), id).toBe(b === null ? 'ready' : b === 'done' ? 'done' : b === 'prereq' ? 'locked' : 'poor');
    }
    // A plan whose prerequisites are met, paid for: ready, counted; taken: done, no longer counted.
    const id = PLAN_IDS.find((p) => planState(sim, p) !== 'locked' && planState(sim, p) !== 'done')!;
    for (const c of planCost(id)) sim.grant(ITEM_IDS[c.item]!, Math.ceil(c.mu / 1000) + 100);
    expect(planState(sim, id)).toBe('ready');
    expect(readyPlans(sim)).toContain(id);
    expect(readyPlans(sim)).toEqual(PLAN_IDS.filter((p) => sim.planBlock(p) === null));
    expect(sim.unlockPlan(id).ok).toBe(true);
    expect(planState(sim, id)).toBe('done');
    expect(readyPlans(sim)).not.toContain(id);
  });

  it('during the tutorial the HUD counts only the plans its quests offer (D101); everything once it is skipped', () => {
    const sim = testSim(undefined, { plans: false });
    sim.quests.skipped = false;
    sim.quests.cur = QUEST_IDS.indexOf('bloom_kiln'); // a rig: the smelter's quest current
    for (const c of planCost('router')) sim.grant(ITEM_IDS[c.item]!, Math.ceil(c.mu / 1000) + 100);
    expect(sim.planBlock('router')).toBeNull(); // the Heart could pay for it…
    expect(readyPlans(sim)).not.toContain('router'); // …but the tree does not offer it yet
    expect(readyPlans(sim)).toContain('kiln');
    sim.quests.skipped = true;
    expect(readyPlans(sim)).toContain('router');
  });

  it('a research node runs ready → active; its state: its data and tokens as ‰, its flows, when its tokens are in, what it waits for (D118)', () => {
    const sim = testSim();
    sim.done.add('ex_quartz'); // Mechanics hangs from the Face Cutter (D87): learnt outside commands
    sim.rebuildDerived();
    expect(researchState(sim, 'tr1')).toBe('waiting'); // no lab yet
    const lab = sim.place('observatory', 503, 512, 0);
    expect(lab.ok).toBe(true);
    wire(sim, lab.id!);
    sim.ensureCompiled();
    sim.stores.get(lab.id!)![itemIdx('journal_1')] = 3 * 1000;
    expect(researchState(sim, 'tr1')).toBe('ready');
    expect(researchState(sim, 'tr2')).toBe('locked');
    expect(sim.startResearch('tr1').ok).toBe(true);
    expect(researchState(sim, 'tr1')).toBe('active');
    sim.run(20);
    // Tier 1, half its data in: no tokens, it waits for data.
    const p = sim.projects[0]!;
    expect(projectTiming(sim, p)).toMatchObject({ data: 500, tokens: 1000, usesTokens: false, held: false, waiting: 'data', left: Infinity, permille: 500 });
    expect(projectTiming(sim, p).sat).toBeGreaterThan(0);
    // Tier 2 behind the Core's level 3 (D118): locked, like a missing prerequisite.
    for (const id of [...treePrereq('tr_synth'), 'tr_synth']) sim.done.add(id);
    sim.rebuildDerived();
    expect(sim.researchBlock('tr2')).toBe('core');
    expect(researchState(sim, 'tr2')).toBe('locked');
    sim.hearthLevel = 3;
    sim.expertise.slots = [{ id: 'estate', at: 0, on: false }, { id: 'haulage', at: 0, on: false }];
    learnSlots(sim);
    sim.grant('iron_plate', 30); sim.grant('glass', 20); sim.grant('copper_wire', 10);
    const lab2 = sim.place('observatory', 516, 516, 0);
    expect(lab2.ok).toBe(true);
    wire(sim, lab2.id!);
    sim.ensureCompiled();
    sim.stores.get(lab2.id!)![itemIdx('journal_1')] = 60_000; sim.stores.get(lab2.id!)![itemIdx('journal_2')] = 20_000;
    sim.credits = 1_000_000;
    expect(sim.startResearch('tr2', lab2.id!, 3000).ok).toBe(true);
    sim.run(1);
    // Its data in, its 15 000 tokens to come at 3 000 a minute: five minutes.
    const q = sim.projects.find((x) => x.id === 'tr2')!;
    expect(projectTiming(sim, q)).toMatchObject({ data: 1000, tokens: 0, usesTokens: true, servers: 0, bought: 3000, waiting: null, tokLeft: 300, left: 300, held: false });
    // A purse in the red holds its bought flow: nothing reaches it.
    sim.credits = -1;
    expect(projectTiming(sim, q)).toMatchObject({ held: true, bought: 0, waiting: 'tokens', tokLeft: Infinity });
    // A reconversion (no lab) runs on its time.
    const respec = { ...p, id: 'respec:en', lab: 0, cost: [], paid: [], tokens: undefined, dur: 600, el: 300_000 };
    sim.projects.push(respec);
    expect(projectTiming(sim, respec)).toMatchObject({ sat: 1000, left: 30, waiting: null, usesTokens: false });
  });
});
