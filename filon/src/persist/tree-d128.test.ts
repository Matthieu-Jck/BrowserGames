// tree-d128.test.ts — save 19 → 20 (D128): the tree in categories. The quartz workshop, which came
// with the Face Cutter's plan, is a research node of its own (`dn_quartzshop`); a claim holding the
// plan holds the node too (`quartzWorkshop`). Nothing else a save holds moves: the nodes keep their
// ids, a project keeps its cost, and a node learnt stays learnt even where its category now waits
// for one of the tier before — only the nodes still to learn there wait. Played on the tutorial's
// base at Tier 1, the late base past Tier 2, and a forged claim whose Tier 3 got ahead of its Tier 2.
import { describe, it, expect } from 'vitest';
import { RESEARCH, categoryNodes, unmetGates } from '@/content/research';
import { WORLD_EPOCH0 } from '@/sim/constants';
import { remapSave } from '@/sim/save-remap';
import { foundScenario } from '@/sim/scenarios';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import type { Sim } from '@/sim/state';
import { testSim, testSource } from '@/sim/testkit';
import { migrate, quartzWorkshop } from './migrate';

/** A save 19 of `sim`: what it was before the quartz workshop had its own node. */
function save19(sim: Sim): SaveData {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
  d.v = 19;
  d.done = d.done.filter((id) => id !== 'dn_quartzshop');
  return d;
}

/** The save through the chain, the remap and the load. */
function open(d: SaveData, sim: Sim): Sim {
  const m = migrate(d as unknown as { v: number });
  expect([m.from, m.data.v]).toEqual([19, SAVE_VERSION]);
  return deserialize(remapSave(m.data).data, sim.grid.source);
}

const found = (id: 'tutorial' | 'late'): Sim => foundScenario(id, { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' }).sim;

describe('save 19 → 20 (D128): the quartz workshop’s own node, the tree in categories', () => {
  it('the step: a claim holding the Face Cutter’s plan holds the quartz workshop’s node; a younger one is left alone', () => {
    expect(quartzWorkshop({ v: 19, done: ['ex_quartz', 'observatory'] }).done).toEqual(['dn_quartzshop', 'ex_quartz', 'observatory']);
    const young = { v: 19, done: ['kiln', 'wire_mill'] };
    expect(quartzWorkshop(young)).toBe(young);
    const already = { v: 19, done: ['dn_quartzshop', 'ex_quartz'] };
    expect(quartzWorkshop(already)).toBe(already);
  });

  it('a Tier 1 save (the tutorial’s base): its research stands, its quartz workshops buildable, the Workshop as far as it was', () => {
    const sim = found('tutorial');
    const d = save19(sim);
    const back = open(d, sim);
    for (const id of d.done) expect(back.done.has(id), id).toBe(true);
    expect(back.done.has('dn_quartzshop')).toBe(back.done.has('ex_quartz'));
    if (back.done.has('ex_quartz')) expect(back.unlocked('dn_quartzshop')).toBe(true);
    // Tier 1 opens with the lab: no category of it waits for another.
    for (const id of Object.keys(RESEARCH)) if (RESEARCH[id as keyof typeof RESEARCH].tier === 1) expect(unmetGates(id, back.done), id).toEqual([]);
  });

  it('a late save (past Tier 2): through the chain and the load, every node it held stays, its projects keep their costs', () => {
    const sim = found('late');
    const d = save19(sim);
    const projects = JSON.parse(JSON.stringify(d.projects ?? [])) as NonNullable<SaveData['projects']>;
    expect(projects.length, 'the late base runs research').toBeGreaterThan(0);
    const back = open(d, sim);
    for (const id of sim.done) expect(back.done.has(id), id).toBe(true);
    expect(back.done.has('dn_quartzshop')).toBe(true);
    expect(back.projects.map((p) => ({ id: p.id, cost: p.cost.flatMap((c) => [c.item, c.mu]), tokens: p.tokens })))
      .toEqual(projects.map((p) => ({ id: p.id, cost: p.cost, tokens: p.tokens })));
  });

  it('a claim whose Tier 3 got ahead of its Tier 2: what it learnt stays, the rest of that category waits for the gate', () => {
    const sim = testSim();
    // The old rule: Tier 1 whole (the Synthesis needed it), Ceramics and Optics for Tier 3, then the
    // Distributors — Transport's, whose gate (Territory) it never finished.
    const t1 = Object.keys(RESEARCH).filter((id) => RESEARCH[id as keyof typeof RESEARCH].tier === 1 && id !== 'dn_quartzshop');
    for (const id of ['ex_quartz', 'observatory', ...t1, 'tr3', 'tr6', 'xp_camo', 'xp_distrib']) sim.done.add(id);
    sim.hearthLevel = 4;
    sim.rebuildDerived();
    const d = save19(sim);
    const back = deserialize(remapSave(migrate(d as unknown as { v: number }).data).data, testSource());
    expect(back.done.has('xp_distrib')).toBe(true);
    expect(back.done.has('dn_quartzshop')).toBe(true);
    expect(unmetGates('xp_express', back.done)).toEqual(['t2_land']);
    expect(back.researchBlock('xp_express')).toBe('gate');
    // Finishing the Territory opens Transport again.
    for (const id of categoryNodes('t2_land')) back.done.add(id);
    back.rebuildDerived();
    expect(back.researchBlock('xp_express')).not.toBe('gate');
  });
});
