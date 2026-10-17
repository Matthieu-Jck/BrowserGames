// tree-d107.test.ts — save 13 → 14 (D107): a sensible tree. The Fast Drill came down to Tier 1 and
// « Second comptoir » is new there, so a claim past the Synthesis holds both (its Tier 1 stays
// whole). Everything else a save holds is untouched: nodes that moved keep their ids, a project
// keeps the cost it started at, Tier 2 stays open only for what opened it before. Played on a late
// debug base saved as it was before the change.
import { describe, it, expect } from 'vitest';
import { RESEARCH, treePrereq } from '@/content/research';
import { WORLD_EPOCH0 } from '@/sim/constants';
import { foundScenario } from '@/sim/scenarios';
import { deserialize, serialize, type SaveData } from '@/sim/serialize';
import { tierTwoOpen } from '@/sim/systems/expertise';
import { maxPosts } from '@/sim/trade';
import { testSim } from '@/sim/testkit';
import { migrate, tierOneWhole } from './migrate';

describe('save 13 → 14 (D107): Tier 1 whole after the Fast Drill and the second post moved in', () => {
  it('a claim holding the Synthesis (learnt or under way) gets the two; a younger one is left alone', () => {
    expect(tierOneWhole({ v: 13, done: ['tr1', 'tr_synth'] }).done).toEqual(['cm_post2', 'ex_fastdrill', 'tr1', 'tr_synth']);
    expect(tierOneWhole({ v: 13, done: ['tr1'], projects: [{ id: 'tr_synth' }] }).done).toEqual(['cm_post2', 'ex_fastdrill', 'tr1']);
    const young = { v: 13, done: ['tr1', 'cm2', 'ex_sifter'] };
    expect(tierOneWhole(young)).toBe(young); // its Standing Orders and Sifter (Tier 2 now) stay learnt
    const whole = { v: 13, done: ['cm_post2', 'ex_fastdrill', 'tr_synth'] };
    expect(tierOneWhole(whole)).toBe(whole);
    // A Fast Drill under way (it was Tier 2) is learnt instead, the data it had paid back in the Heart.
    const run = tierOneWhole({
      v: 13, done: ['tr_synth'], stock: [0, 2000],
      projects: [{ id: 'ex_fastdrill', cost: [1, 480_000], paid: [40_000] }, { id: 'tr2', cost: [1, 40_000], paid: [1000] }],
      labQueue: [[7, 'ex_fastdrill'], [8, 'tr3']],
    });
    expect(run.done).toEqual(['cm_post2', 'ex_fastdrill', 'tr_synth']);
    expect(run.projects).toEqual([{ id: 'tr2', cost: [1, 40_000], paid: [1000] }]);
    expect(run.labQueue).toEqual([[8, 'tr3']]);
    expect(run.stock).toEqual([0, 42_000]);
  });

  it('a young save whose Standing Orders were Tier 1 does not open Tier 2 with them', () => {
    const sim = testSim();
    for (const id of ['tr1', 'cm2', 'ex_sifter']) sim.done.add(id);
    sim.rebuildDerived();
    expect(RESEARCH.cm2.tier).toBe(2);
    expect(tierTwoOpen(sim)).toBe(false);
  });

  it('a late base saved before: through the chain and the load, its research stands, its projects keep their costs, its posts and Tier 2 stay', () => {
    const { sim } = foundScenario('late', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' });
    const data = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
    data.v = 13;
    data.done = data.done.filter((id) => id !== 'ex_fastdrill' && id !== 'cm_post2');
    // Its projects as they were started under the old table (a longer, dearer node): kept as they are.
    data.projects = (data.projects ?? []).map((p) => ({ ...p, dur: p.dur * 6, cost: p.cost.map((v, i) => (i % 2 ? v * 2 : v)) }));
    const projects = JSON.parse(JSON.stringify(data.projects)) as SaveData['projects'];
    expect(projects?.length, 'the late base runs research').toBeGreaterThan(0);
    const m = migrate(data);
    expect(m.from).toBe(13);
    const back = deserialize(m.data, sim.grid.source);
    expect(back.done.has('tr_synth')).toBe(true);
    expect(back.done.has('ex_fastdrill') && back.done.has('cm_post2')).toBe(true);
    for (const id of sim.done) expect(back.done.has(id), id).toBe(true);
    expect(back.projects.map((p) => ({ id: p.id, dur: p.dur, cost: p.cost.flatMap((c) => [c.item, c.mu]) })))
      .toEqual((projects ?? []).map((p) => ({ id: p.id, dur: p.dur, cost: p.cost })));
    expect(tierTwoOpen(back)).toBe(true);
    expect(maxPosts(back.mods)).toBeGreaterThanOrEqual(2);
    // Every node it holds is still a node of the tree, its prerequisites a mix of what moved: nothing dropped.
    for (const id of back.done) expect(treePrereq(id)).toBeDefined();
  });
});
