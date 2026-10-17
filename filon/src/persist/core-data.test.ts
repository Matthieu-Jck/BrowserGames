// core-data.test.ts — save 12 → 13 (D101): the tutorial's first lab runs on the Core's own data,
// so the data collector comes later (« Traitement des données », `an_data`) and the Face Cutter is a
// plan, no longer a research. A save from before keeps what it had: its collectors stand and it may
// build more, a Face Cutter under way is its plan taken, and the data that project had paid goes
// back to the Heart.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { deserialize, serialize, type SaveData } from '@/sim/serialize';
import { testSim } from '@/sim/testkit';
import { coreData, migrate } from './migrate';

describe('save 12 → 13 (D101): the data collector after « Traitement des données », the Face Cutter a plan', () => {
  it('a claim with the lab’s plan holds an_data; a Face Cutter under way or queued is its plan taken, its data back to the Heart', () => {
    expect(coreData({ v: 12, done: ['kiln', 'observatory'] }).done).toEqual(['an_data', 'kiln', 'observatory']);
    // A younger claim, and one that already holds both, are left alone.
    const young = { v: 12, done: ['kiln'] };
    expect(coreData(young)).toBe(young);
    const learnt = { v: 12, done: ['an_data', 'ex_quartz', 'observatory'] };
    expect(coreData(learnt)).toBe(learnt);
    const run = coreData({
      v: 12, done: ['observatory'], stock: [0, 5000, 0],
      projects: [{ id: 'ex_quartz', cost: [1, 30_000], paid: [12_000] }, { id: 'tr1', cost: [1, 20_000], paid: [3000] }],
      labQueue: [[7, 'ex_quartz'], [8, 'tr1']],
    });
    expect(run.done).toEqual(['an_data', 'ex_quartz', 'observatory']);
    expect(run.projects).toEqual([{ id: 'tr1', cost: [1, 20_000], paid: [3000] }]);
    expect(run.labQueue).toEqual([[8, 'tr1']]);
    expect(run.stock).toEqual([0, 17_000, 0]);
    // Only queued: the plan taken all the same.
    expect(coreData({ v: 12, done: ['an_data', 'observatory'], labQueue: [[7, 'ex_quartz']] }).done).toEqual(['an_data', 'ex_quartz', 'observatory']);
  });

  it('through the chain and the load: the collector stands and works, the Face Cutter is taken, the data paid is in the Heart', () => {
    const sim = testSim();
    // A lab and a collector of save 12 (the collector came with the lab's plan then).
    sim.done.add('an_data');
    sim.rebuildDerived();
    const lab = sim.place('observatory', 503, 512, 0);
    const col = sim.place('data_collector', 504, 518, 0);
    expect(lab.ok && col.ok, `${lab.reason} ${col.reason}`).toBe(true);
    const J = itemIdx('journal_1');
    const data = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
    data.v = 12;
    data.done = data.done.filter((id) => id !== 'an_data' && id !== 'ex_quartz');
    data.projects = [{ id: 'ex_quartz', lab: lab.id!, cost: [J, 30_000], paid: [12_000], dur: 3000, el: 600, tokens: 9000, tokUsed: 1800 }];
    const j0 = data.stock[J]!;
    const m = migrate(data);
    expect(m.from).toBe(12);
    const back = deserialize(m.data, sim.grid.source);
    expect(back.ents.get(col.id!)).toBeDefined();
    expect(back.done.has('an_data')).toBe(true);
    expect(back.unlocked('ex_quartz')).toBe(true); // the plan
    expect(back.projects).toEqual([]);
    expect(back.stock[J]! - j0).toBe(12_000);
  });
});
