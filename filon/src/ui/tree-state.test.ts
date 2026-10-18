// tree-state.test.ts — the tech tree's state, derived once for the HUD's chips and the tree screen
// (tree-state.ts): the plans ready are the ones the Heart can pay for now, a node's state follows
// what blocks it (the Core's level too, D118; its resources, D122), a project's state says its
// tokens, the flows it gets (the Core's compute, the servers, the bank, its bought flow), when its
// tokens will be in and what it waits for, the same way to both.
import { describe, it, expect } from 'vitest';
import { ITEM_IDS } from '@/content/registry';
import { PLAN_IDS } from '@/content/research';
import { QUEST_IDS } from '@/content/quests';
import { planCost } from '@/sim/systems/research';
import { effectiveCost } from '@/sim/research/runtime';
import { testSim, wire } from '@/sim/testkit';
import { treePrereq } from '@/content/research';
import type { Sim } from '@/sim/state';
import { planState, projectTiming, readyPlans, researchState } from './tree-state';

/** A node's resources (D122), granted with room to spare (whatever the table asks today). */
function grantCost(sim: Sim, id: string): void {
  for (const c of effectiveCost(id, sim.mods).cost) sim.grant(ITEM_IDS[c.item]!, Math.ceil(c.mu / 1000) + 50);
}

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

  it('a research node runs ready → active; poor while the Core lacks its resources; its state: its tokens as ‰, its flows, when they are in, what it waits for (D118, D122)', () => {
    const sim = testSim();
    sim.done.add('ex_quartz'); // Mechanics hangs from the Face Cutter (D87): learnt outside commands
    sim.rebuildDerived();
    expect(researchState(sim, 'tr1')).toBe('waiting'); // no lab yet
    const lab = sim.place('observatory', 503, 512, 0);
    expect(lab.ok).toBe(true);
    wire(sim, lab.id!);
    sim.ensureCompiled();
    sim.run(1);
    // Its resources (D122): short in the Core, « poor »; paid in full, ready.
    sim.stock[effectiveCost('tr1', sim.mods).cost[0]!.item] = 0;
    expect(researchState(sim, 'tr1')).toBe('poor');
    grantCost(sim, 'tr1');
    expect(researchState(sim, 'tr1')).toBe('ready');
    expect(researchState(sim, 'tr2')).toBe('locked');
    expect(sim.startResearch('tr1').ok).toBe(true);
    expect(researchState(sim, 'tr1')).toBe('active');
    const p = sim.projects[0]!;
    // The Core at level 1 computes nothing: no flow reaches it, it waits for tokens.
    expect(projectTiming(sim, p)).toMatchObject({ tokens: 0, usesTokens: true, free: 0, bought: 0, held: false, waiting: 'tokens', left: Infinity, permille: 0 });
    expect(projectTiming(sim, p).sat).toBeGreaterThan(0);
    // Level 2 mounts its compute bay: 1 000 tokens a minute, its 2 000 tokens in two minutes.
    sim.hearthLevel = 2;
    expect(projectTiming(sim, p)).toMatchObject({ free: sim.coreComputeRate(), waiting: null, tokLeft: 120, left: 120 });
    // Its lab without power: it takes nothing, it waits for power.
    const net = sim.graph!.nodeByEnt.get(lab.id!)!.net;
    const sat = sim.netPower[net]!.sat;
    sim.netPower[net]!.sat = 0;
    expect(projectTiming(sim, p)).toMatchObject({ sat: 0, free: 0, waiting: 'power', tokLeft: Infinity });
    sim.netPower[net]!.sat = sat;
    // Tier 2 behind the Core's level 3 (D118): locked, like a missing prerequisite.
    for (const id of [...treePrereq('tr_synth'), 'tr_synth']) sim.done.add(id);
    sim.rebuildDerived();
    expect(sim.researchBlock('tr2')).toBe('core');
    expect(researchState(sim, 'tr2')).toBe('locked');
    expect(sim.cancelResearch('tr1')).toBe(true);
    sim.hearthLevel = 3;
    sim.expertise.slots = [{ id: 'estate', at: 0, on: false }, { id: 'haulage', at: 0, on: false }];
    learnSlots(sim);
    grantCost(sim, 'tr2');
    sim.credits = 1_000_000;
    expect(sim.startResearch('tr2', lab.id!, 3000).ok).toBe(true);
    // Its 15 000 tokens at the Core's compute (level 3's 1 500, Overclocking's 500 more) and 3 000 bought: three minutes.
    const q = sim.projects.find((x) => x.id === 'tr2')!;
    const core = sim.coreComputeRate();
    expect(core).toBe(2000);
    expect(projectTiming(sim, q)).toMatchObject({ tokens: 0, usesTokens: true, free: core, bank: 0, bought: 3000, waiting: null, tokLeft: 180, left: 180, held: false });
    // A purse in the red holds its bought flow; the Core's compute goes on: eight minutes.
    sim.credits = -1;
    expect(projectTiming(sim, q)).toMatchObject({ held: true, free: core, bought: 0, waiting: null, tokLeft: 480 });
    // The bank (an older save's data, D122) tops it up at the next boundary.
    sim.credits = 1_000_000;
    sim.tokenBank = 5000;
    expect(projectTiming(sim, q)).toMatchObject({ free: core, bank: 5000, bought: 3000 });
    // A reconversion (no lab) runs on its time.
    const respec = { ...q, id: 'respec:en', lab: 0, cost: [], paid: [], tokens: undefined, tokIn: undefined, buy: 0, dur: 600, el: 300_000 };
    sim.projects.push(respec);
    expect(projectTiming(sim, respec)).toMatchObject({ sat: 1000, left: 30, waiting: null, usesTokens: false });
  });
});
