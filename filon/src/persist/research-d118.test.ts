// research-d118.test.ts — save 17 → 18 (D118): research without time, its tokens a flow. A project
// under way keeps the data it paid and loses its minimum time; a Tier 1 one its tokens too — it
// finishes as soon as its data is paid; a Tier 2+ one keeps the tokens it started with as those it
// needs and counts what it had used as delivered (generous: the allowance's share of its time, or
// what was counted if more); the tokens used and not yet billed are forgiven. Through today's chain the
// next step (D122, save 19) turns the data into tokens: the load test checks both.
import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { treePrereq } from '@/content/research';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import { remapSave } from '@/sim/save-remap';
import { testSim, wire } from '@/sim/testkit';
import { migrate, researchFlows } from './migrate';

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

  it('through the chain and the load (D122 since: no data, tokens at every tier): the data its projects paid and its labs held banked as tokens, both projects done at once', () => {
    const sim = testSim();
    sim.done.add('ex_quartz');
    for (const id of [...treePrereq('tr_synth'), 'tr_synth']) sim.done.add(id);
    sim.done.delete('en_pitch'); // a Tier 1 node still to learn (the Synthesis learnt by an older claim's ways: a forged save)
    sim.hearthLevel = 3;
    sim.expertise.slots = [{ id: 'estate', at: 0, on: false }, { id: 'haulage', at: 0, on: false }];
    sim.rebuildDerived();
    const a = sim.place('observatory', 503, 512, 0);
    for (const [it, n] of BUILDINGS.observatory.cost) sim.grant(it, n);
    const b = sim.place('observatory', 516, 516, 0);
    expect(a.ok && b.ok, `${a.reason} ${b.reason}`).toBe(true);
    wire(sim, [a.id!, b.id!]);
    sim.ensureCompiled();
    const data = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
    // Survey and Mechanics Data, gone from today's content (D122): the forged save's own table names them.
    const J1 = data.content!.items.length, J2 = J1 + 1;
    data.content!.items.push('journal_1', 'journal_2');
    const store = (n1: number, n2: number): number[] => { const st = new Array<number>(J2 + 1).fill(0); st[J1] = n1; st[J2] = n2; return st; };
    data.stores = [...data.stores.filter(([id]) => id !== a.id && id !== b.id), [a.id!, store(3000, 0)], [b.id!, store(30_000, 20_000)]];
    // A save 17: Pitch-Control half done, Earthworks a quarter of its time run, the minute's tokens unbilled.
    (data as unknown as Record<string, unknown>).v = 17;
    (data as unknown as { projects: unknown[] }).projects = [
      { id: 'en_pitch', lab: a.id!, cost: [J1, 6000], paid: [3000], dur: 600, el: 300_000, tokens: 0, tokUsed: 0 },
      { id: 'tr2', lab: b.id!, cost: [J1, 60_000, J2, 20_000], paid: [30_000, 0], dur: 4800, el: 1_200_000, tokens: 15_000, tokUsed: 3000 },
    ];
    (data as unknown as { tokens: Record<string, unknown> }).tokens = { use: 500, serverAcc: 0, held: false, plan: false };
    const m = migrate(data);
    expect([m.from, m.data.v]).toEqual([17, SAVE_VERSION]);
    const r = remapSave(m.data);
    const back = deserialize(r.data, sim.grid.source);
    const credits = back.credits;
    // 18 → 19: Pitch-Control now needs Tier 1's 2 000 tokens, its 3 Survey Data worth 3 300 (1 300 over,
    // banked); Earthworks its 15 000, 3 750 counted and 30 Survey Data worth 33 000 (21 750 over).
    expect(back.projects.map((p) => [p.id, p.dur, p.tokens, p.tokIn, p.cost.length])).toEqual([['en_pitch', 0, 2000, 2000, 0], ['tr2', 0, 15_000, 15_000, 0]]);
    // The labs' files banked by the remap: 33 Survey Data and 20 Mechanics Data.
    expect(r.note?.converted).toEqual([{ id: 'journal_1', mu: 33_000, tokens: 36_300 }, { id: 'journal_2', mu: 20_000, tokens: 118_000 }]);
    expect(back.tokenBank).toBe(1300 + 21_750 + 36_300 + 118_000);
    expect(back.stores.has(a.id!) || back.stores.has(b.id!)).toBe(false); // a lab holds nothing now
    back.run(1);
    expect(back.done.has('en_pitch') && back.done.has('tr2')).toBe(true); // their tokens in: done at once
    expect(back.credits).toBe(credits); // the unbilled minute forgiven, nothing bought
  });
});
