// tree-state.test.ts — the tech tree's state, derived once for the HUD's chips and the tree screen
// (tree-state.ts): the plans ready are the ones the Heart can pay for now, a node's state follows
// what blocks it, a project's clock says held, power, time left and data owed the same way to both.
import { describe, it, expect } from 'vitest';
import { ITEM_IDS, itemIdx } from '@/content/registry';
import { PLAN_IDS } from '@/content/research';
import { QUEST_IDS } from '@/content/quests';
import { planCost } from '@/sim/systems/research';
import { testSim, wire } from '@/sim/testkit';
import { planState, projectTiming, readyPlans, researchState } from './tree-state';

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

  it('a research node runs ready → active; its clock: its grid’s power, its time left, its data owed, held by a purse in the red (a reconversion runs on)', () => {
    const sim = testSim();
    sim.done.add('ex_quartz'); // Mechanics hangs from the Face Cutter (D87): learnt outside commands
    sim.rebuildDerived();
    expect(researchState(sim, 'tr1')).toBe('waiting'); // no lab yet
    const lab = sim.place('observatory', 503, 512, 0);
    expect(lab.ok).toBe(true);
    wire(sim, lab.id!);
    sim.ensureCompiled();
    sim.stores.get(lab.id!)![itemIdx('journal_1')] = 100 * 1000;
    expect(researchState(sim, 'tr1')).toBe('ready');
    expect(researchState(sim, 'tr2')).toBe('locked');
    expect(sim.startResearch('tr1').ok).toBe(true);
    expect(researchState(sim, 'tr1')).toBe('active');
    sim.run(20);
    const p = sim.projects[0]!;
    const tm = projectTiming(sim, p);
    expect(tm.held).toBe(false);
    expect(tm.sat).toBeGreaterThan(0);
    expect(tm.left).toBeCloseTo((p.dur * 1000 - p.el) / tm.sat / 10, 6);
    expect(tm.short).toBe(false);
    // Its minimum time run, its data still owed: it waits for data.
    expect(projectTiming(sim, { ...p, el: p.dur * 1000, paid: p.paid.map(() => 0) }).short).toBe(true);
    // A purse in the red holds it — not a reconversion, which has no lab and runs on.
    sim.researchHeld = true;
    expect(projectTiming(sim, p).held).toBe(true);
    expect(projectTiming(sim, { ...p, lab: 0 })).toMatchObject({ held: false, sat: 1000 });
  });
});
