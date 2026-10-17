// research-d118.test.ts — save 17 → 18 (D118): research without time, its tokens a flow. A project
// under way keeps the data it paid and loses its minimum time; a Tier 1 one its tokens too — it
// finishes as soon as its data is paid; a Tier 2+ one keeps the tokens it started with as those it
// needs and counts what it had used as delivered (generous: the allowance's share of its time, or
// what was counted if more); the tokens used and not yet billed are forgiven.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { treePrereq } from '@/content/research';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import { remapSave } from '@/sim/save-remap';
import { testSim, wire } from '@/sim/testkit';
import { migrate, researchFlows } from './migrate';

const J1 = (): number => itemIdx('journal_1'), J2 = (): number => itemIdx('journal_2');

describe('save 17 → 18 (D118): research without time, its tokens a flow', () => {
  it('the step: no time for any project, no tokens for a Tier 1 one, a Tier 2+ one’s use counted as delivered; the unbilled minute forgiven', () => {
    const d = researchFlows({
      v: 17,
      projects: [
        { id: 'tr1', lab: 5, cost: [1, 6000], paid: [3000], dur: 600, el: 300_000, tokens: 8000, tokUsed: 4000 },
        { id: 'tr2', lab: 6, cost: [1, 60_000, 2, 20_000], paid: [30_000, 0], dur: 4800, el: 1_200_000, tokens: 15_000, tokUsed: 3000 },
        { id: 'tr3', lab: 7, cost: [1, 90_000], paid: [90_000], dur: 4800, el: 9_000_000, tokens: 60_000, tokUsed: 60_000 },
        { id: 'respec:en', lab: 0, cost: [], paid: [], dur: 600, el: 1000, notes: 50 },
        { id: 'en_pitch', lab: 8, cost: [1, 6000], paid: [0], dur: 600, el: 0 },
      ],
      tokens: { use: 500, serverAcc: 1234, held: false, plan: true },
    });
    expect(d.projects).toEqual([
      { id: 'tr1', lab: 5, cost: [1, 6000], paid: [3000], dur: 0, el: 0, tokens: 0, tokIn: 0 },
      { id: 'tr2', lab: 6, cost: [1, 60_000, 2, 20_000], paid: [30_000, 0], dur: 0, el: 0, tokens: 15_000, tokIn: 3750 }, // a quarter of its time: 3 750, more than the 3 000 counted
      { id: 'tr3', lab: 7, cost: [1, 90_000], paid: [90_000], dur: 0, el: 0, tokens: 60_000, tokIn: 60_000 },
      { id: 'respec:en', lab: 0, cost: [], paid: [], dur: 600, el: 1000, notes: 50 }, // a reconversion runs out its time
      { id: 'en_pitch', lab: 8, cost: [1, 6000], paid: [0], dur: 600, el: 0 }, // from before tokens: the load rebases it
    ]);
    expect(d.tokens).toEqual({ serverAcc: 1234, held: false, plan: true });
  });

  it('through the chain and the load: a Tier 1 project finishes once its data is in, a Tier 2 one waits for its tokens, then a bought flow finishes it', () => {
    const sim = testSim();
    sim.done.add('ex_quartz');
    for (const id of [...treePrereq('tr_synth'), 'tr_synth']) sim.done.add(id);
    sim.done.delete('en_pitch'); // a Tier 1 node still to learn (the Synthesis learnt by an older claim's ways: a forged save)
    sim.hearthLevel = 3;
    sim.expertise.slots = [{ id: 'estate', at: 0, on: false }, { id: 'haulage', at: 0, on: false }];
    sim.rebuildDerived();
    const a = sim.place('observatory', 503, 512, 0);
    sim.grant('iron_plate', 30); sim.grant('glass', 20); sim.grant('copper_wire', 10);
    const b = sim.place('observatory', 516, 516, 0);
    expect(a.ok && b.ok, `${a.reason} ${b.reason}`).toBe(true);
    wire(sim, [a.id!, b.id!]);
    sim.ensureCompiled();
    sim.stores.get(a.id!)![J1()] = 3000; // the Tier 1 node's last 3 files, in its lab
    sim.stores.get(b.id!)![J1()] = 30_000; sim.stores.get(b.id!)![J2()] = 20_000; // Earthworks' data, all in
    const data = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
    // A save 17: Pitch-Control half done, Earthworks a quarter of its time run, the minute's tokens unbilled.
    (data as unknown as Record<string, unknown>).v = 17;
    (data as unknown as { projects: unknown[] }).projects = [
      { id: 'en_pitch', lab: a.id!, cost: [J1(), 6000], paid: [3000], dur: 600, el: 300_000, tokens: 0, tokUsed: 0 },
      { id: 'tr2', lab: b.id!, cost: [J1(), 60_000, J2(), 20_000], paid: [30_000, 0], dur: 4800, el: 1_200_000, tokens: 15_000, tokUsed: 3000 },
    ];
    (data as unknown as { tokens: Record<string, unknown> }).tokens = { use: 500, serverAcc: 0, held: false, plan: false };
    const m = migrate(data);
    expect([m.from, m.data.v]).toEqual([17, SAVE_VERSION]);
    const back = deserialize(remapSave(m.data).data, sim.grid.source);
    const credits = back.credits;
    expect(back.projects.map((p) => [p.id, p.dur, p.tokens, p.tokIn])).toEqual([['en_pitch', 0, 0, 0], ['tr2', 0, 15_000, 3750]]);
    back.run(1);
    expect(back.done.has('en_pitch')).toBe(true); // Tier 1: its data paid, done at once
    expect(back.projects[0]!.paid).toEqual([60_000, 20_000]); // Earthworks' data taken; its tokens to come
    back.run(1200);
    expect(back.done.has('tr2')).toBe(false); // no server, nothing bought: it waits
    expect(back.credits).toBe(credits); // the unbilled minute forgiven
    expect(back.setTokenBuy('tr2', 15_000)).toBe(true);
    back.run(600);
    expect(back.done.has('tr2')).toBe(true);
    expect(back.credits).toBe(credits - (15_000 - 3750)); // only what it still needed, at 10 ◉ the thousand
  });
});
