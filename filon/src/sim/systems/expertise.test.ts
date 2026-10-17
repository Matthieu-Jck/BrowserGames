// expertise.test.ts — the expertises (D93): the table and the arc (the Synthesis closes Tier 1,
// mounts the Archive at the Core's level 3, two expertises open Tier 2); feats and ranks read at a
// minute's boundary, earned in silence before the Archive; choosing and reorienting (refusals,
// the price that grows, the 24 h without); the effects through the Mods (a drill's rate, a family's
// research, land's price); saves and the commands' replay; online ≈ offline — a rank rising and a
// réorientation coming into place during an absence, the same as ticking, bit for bit.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { EXPERTISES, EXPERTISE_IDS, expertiseProblems } from '@/content/expertises';
import { itemIdx } from '@/content/registry';
import { FAMILY_IDS, RESEARCH, TIER1_WHOLE, TIER_GATE } from '@/content/research';
import type { ResearchDef } from '@/content/types';
import { validateContent } from '@/content/validate';
import { EPOCH } from '../constants';
import { replay, type Command } from '../commands';
import { DrillNode } from '../flow/nodes';
import { catchUp } from '../offline/catchup';
import { effectiveCost } from '../research/runtime';
import { deserialize, serialize } from '../serialize';
import type { Sim } from '../state';
import { drillToHearth, steadyPower, testSim, testSource } from '../testkit';
import { featValue, tierTwoOpen } from './expertise';
import { expertiseArc, migrate } from '@/persist/migrate';

/** Run to the end of the minute (the boundary the feats are read at). */
const toBoundary = (sim: Sim): void => { sim.run(EPOCH - (sim.tick % EPOCH)); };
/** Whole milli-items of iron ore made (a rig: what a long life of drills would have made). */
const mined = (sim: Sim, items: number): void => { sim.produced[itemIdx('iron_ore')] = items * 1000; };
/** A claim with the Archive mounted (the Core at level 3, outside the commands). */
function archived(): Sim {
  const sim = testSim();
  sim.hearthLevel = BAL.expertise.level;
  return sim;
}
const twin = (sim: Sim): [Sim, Sim] => {
  const save = JSON.stringify(serialize(sim));
  return [deserialize(JSON.parse(save), testSource()), deserialize(JSON.parse(save), testSource())];
};
const expertiseEvents = (sim: Sim) => sim.events.filter((e) => e.k === 'expertise');

describe('the expertises (D93)', () => {
  it('hold two per family, one production and one research, each earned by a feat of its own', () => {
    expect(expertiseProblems(FAMILY_IDS)).toEqual([]);
    expect(validateContent()).toEqual([]);
    expect(EXPERTISE_IDS.length).toBe(12);
    expect(new Set(EXPERTISE_IDS.map((id) => EXPERTISES[id].feat)).size).toBe(12);
  });

  it('close Tier 1 whole with the Synthesis, which mounts the Archive; Tier 2 opens with it and two expertises', () => {
    const t1 = (Object.entries(RESEARCH) as Array<[string, ResearchDef]>).filter(([id, r]) => r.tier === 1 && id !== TIER1_WHOLE).map(([id]) => id);
    expect((RESEARCH as Record<string, ResearchDef>)[TIER1_WHOLE]!.prereq).toEqual(expect.arrayContaining(t1));
    expect(TIER_GATE[2]).toBe(TIER1_WHOLE);
    expect(BAL.hearthUpgrades[BAL.expertise.level - 2]!.unlock).toBe(TIER1_WHOLE);
    // A claim with all of Tier 1: Tier 2 waits for the expertises.
    const sim = archived();
    for (const id of [...t1, TIER1_WHOLE]) sim.done.add(id);
    sim.rebuildDerived();
    expect(sim.researchBlock('tr2')).toBe('expertise');
    expect(sim.researchBlock('en_heavyacc')).toBe('expertise'); // a family's first Tier 2 node
    sim.expertise.ranks.set('estate', 1); sim.expertise.ranks.set('haulage', 1);
    expect(sim.chooseExpertise(0, 'estate')).toBeNull();
    expect(sim.researchBlock('tr2')).toBe('expertise'); // one is not enough
    expect(sim.chooseExpertise(1, 'haulage')).toBeNull();
    expect(tierTwoOpen(sim)).toBe(true);
    expect(sim.researchBlock('tr2')).not.toBe('expertise');
    // A claim from before the expertises that already researched Tier 2 keeps it open, and the
    // v10 → v11 step gives it the Synthesis (a node under way counts too); a younger one is left as it was.
    const old = testSim();
    old.done.add('tr1'); old.done.add('tr2');
    const save = serialize(old);
    delete save.expertise;
    const back = deserialize(save, testSource());
    expect(tierTwoOpen(back)).toBe(true);
    expect(expertiseArc({ v: 10, done: ['tr1', 'tr2'] }).done).toEqual(['tr1', 'tr2', TIER1_WHOLE]);
    expect(expertiseArc({ v: 10, done: ['tr1'], projects: [{ id: 'ex3' }] }).done).toEqual(['tr1', TIER1_WHOLE]);
    expect(expertiseArc({ v: 10, done: ['tr1', 'en2'] }).done).toEqual(['tr1', 'en2']);
    expect(migrate({ ...JSON.parse(JSON.stringify(save)), v: 10, done: ['tr1', 'tr2'] }).data.done).toContain(TIER1_WHOLE);
  });

  it('read the feats at a minute’s boundary: ranks rise, never fall, and are announced once the Archive is mounted', () => {
    const sim = testSim();
    const p = 1234;
    mined(sim, EXPERTISES.ore_cutting.ranks[0] - 1);
    toBoundary(sim);
    expect(sim.expertise.ranks.get('ore_cutting')).toBeUndefined();
    mined(sim, EXPERTISES.ore_cutting.ranks[0]);
    sim.land.bought.add(p);
    toBoundary(sim);
    expect(sim.expertise.ranks.get('ore_cutting')).toBe(1);
    expect(sim.expertise.ranks.get('estate')).toBe(1);
    expect(expertiseEvents(sim)).toEqual([]); // the Core has no Archive yet: earned in silence
    sim.land.bought.delete(p); // a parcel sold back: the rank stays
    sim.hearthLevel = BAL.expertise.level;
    mined(sim, EXPERTISES.ore_cutting.ranks[2]);
    toBoundary(sim);
    expect(sim.expertise.ranks.get('estate')).toBe(1);
    expect(sim.expertise.ranks.get('ore_cutting')).toBe(3);
    expect(expertiseEvents(sim)).toEqual([{ k: 'expertise', id: 'ore_cutting', rank: 3, what: 'earned' }]);
    // The Core's grid: minutes in a row at 95 %, the best run kept when one falls short.
    const x = sim.expertise;
    const run = x.streak;
    sim.expertiseEpoch(() => 1000);
    expect(x.streak).toBe(run + 1);
    expect(x.best).toBeGreaterThanOrEqual(run + 1);
    const best = x.best;
    sim.expertiseEpoch(() => BAL.expertise.gridPermille - 25);
    expect([x.streak, x.best]).toEqual([0, best]);
    expect(featValue(sim, 'grid')).toBe(best);
  });

  it('choose into an empty slot at once, reorient for a price that grows, the new one in place 24 h later', () => {
    const sim = testSim();
    sim.expertise.ranks.set('estate', 2);
    expect(sim.chooseBlock(0, 'estate')).toBe('locked'); // no Archive yet
    sim.hearthLevel = BAL.expertise.level;
    expect(sim.chooseBlock(0, 'ore_cutting')).toBe('unearned');
    expect(sim.chooseBlock(2, 'estate')).toBe('slot');
    expect(sim.chooseBlock(0, 'nope')).toBe('unknown');
    expect(sim.chooseExpertise(0, 'estate')).toBeNull();
    expect(sim.mods.landPrice).toBe(EXPERTISES.estate.permille[1]); // rank II
    expect(sim.chooseBlock(1, 'estate')).toBe('held');
    sim.expertise.ranks.set('fabrication', 1);
    expect(sim.chooseBlock(0, 'fabrication')).toBe('full');
    expect(sim.reorientBlock(1, 'fabrication')).toBe('empty');
    expect(sim.chooseExpertise(1, 'fabrication')).toBeNull();
    expect(sim.mods.craftSpeed).toBe(1100);
    // Réorientation: paid from the purse, dearer each time; the old one goes at once.
    sim.expertise.ranks.set('methods', 1);
    sim.credits = BAL.expertise.reorientCents - 1;
    expect(sim.reorientBlock(0, 'methods')).toBe('funds');
    sim.credits = 1_000_000;
    expect(sim.reorientCost()).toBe(BAL.expertise.reorientCents);
    expect(sim.reorient(0, 'methods')).toBeNull();
    expect(sim.credits).toBe(1_000_000 - BAL.expertise.reorientCents);
    expect(sim.reorientCost()).toBe(Math.floor((BAL.expertise.reorientCents * BAL.expertise.reorientGrowth) / 1000));
    const slot = sim.expertise.slots[0]!;
    expect(slot).toEqual({ id: 'methods', at: sim.absEpoch() + BAL.expertise.gapMinutes, on: false });
    expect(sim.mods.landPrice).toBe(1000); // Estate gone at once
    expect(sim.mods.fam.dn.time).toBe(1000); // Methods not yet in place
    expect(effectiveCost('dn3', sim.mods).ticks).toBe(effectiveCost('dn3').ticks);
    // The gap ends at a minute's boundary (shortened here: the rule is the same at 24 h).
    slot.at = sim.absEpoch() + 2;
    toBoundary(sim);
    expect(slot.on).toBe(false);
    sim.events.length = 0;
    toBoundary(sim);
    expect(slot.on).toBe(true);
    expect(expertiseEvents(sim)).toEqual([{ k: 'expertise', id: 'methods', rank: 1, what: 'ready' }]);
    expect(sim.mods.fam.dn.time).toBe(EXPERTISES.methods.permille[0]);
    // A research expertise: its family's nodes started now take its share off; the trunk's and other families' do not.
    const table = effectiveCost('dn3'), now = effectiveCost('dn3', sim.mods);
    expect(now.ticks).toBe(Math.floor((table.ticks * EXPERTISES.methods.permille[0]) / 1000));
    expect(now.tokens).toBe(table.tokens);
    expect(effectiveCost('tr1', sim.mods)).toEqual(effectiveCost('tr1'));
    expect(effectiveCost('en_pitch', sim.mods)).toEqual(effectiveCost('en_pitch'));
  });

  it('make drills cut faster with Ore Cutting, from the moment it is in place', () => {
    const sim = archived();
    steadyPower(sim);
    const d = drillToHearth(sim);
    sim.ensureCompiled();
    const before = (sim.graph.nodeByEnt.get(d) as DrillNode).rateEp;
    sim.expertise.ranks.set('ore_cutting', 1);
    sim.chooseExpertise(0, 'ore_cutting');
    sim.ensureCompiled();
    expect((sim.graph.nodeByEnt.get(d) as DrillNode).rateEp).toBe(Math.floor((before * 1100) / 1000));
  });

  it('keep across a save, and the commands replay to the same state', () => {
    const sim = archived();
    for (const id of ['estate', 'trading', 'archiving']) sim.expertise.ranks.set(id, 1);
    sim.credits = 1_000_000;
    sim.run(EPOCH + 7);
    const start = JSON.stringify(serialize(sim));
    const from = sim.log.length;
    sim.chooseExpertise(0, 'estate');
    sim.run(30);
    sim.chooseExpertise(1, 'trading');
    sim.run(EPOCH);
    sim.reorient(0, 'archiving');
    sim.run(EPOCH * 3);
    expect(deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource()).hash()).toBe(sim.hash());
    const log = sim.log.slice(from);
    expect(log.map((l) => l.cmd.k)).toEqual(['expertise', 'expertise', 'reorient']);
    const again = deserialize(JSON.parse(start), testSource());
    replay(again, log as Array<{ tick: number; cmd: Command }>, sim.tick);
    expect(again.hash()).toBe(sim.hash());
    expect(again.expertise.slots).toEqual(sim.expertise.slots);
  });

  it('online ≈ offline: a rank rising and a réorientation coming into place during an absence, bit for bit', () => {
    const sim = archived();
    steadyPower(sim);
    drillToHearth(sim);
    sim.run(300);
    // Ore Cutting earned and in place; rank II a few minutes of drilling away.
    mined(sim, EXPERTISES.ore_cutting.ranks[0]);
    toBoundary(sim);
    expect(sim.chooseExpertise(0, 'ore_cutting')).toBeNull();
    mined(sim, EXPERTISES.ore_cutting.ranks[1] - 60);
    // Estate in the other slot, reoriented to Archiving: in place 40 minutes from now (shortened).
    sim.expertise.ranks.set('estate', 1); sim.expertise.ranks.set('archiving', 1);
    sim.credits = 1_000_000;
    expect(sim.chooseExpertise(1, 'estate')).toBeNull();
    expect(sim.reorient(1, 'archiving')).toBeNull();
    sim.expertise.slots[1]!.at = sim.absEpoch() + 40;
    const [on, off] = twin(sim);
    const T = 2 * 3600 * 10;
    on.run(T);
    catchUp(off, T, { noDirect: true });
    expect(on.expertise.ranks.get('ore_cutting')).toBe(2);
    expect(on.expertise.slots[1]!.on).toBe(true);
    expect(on.mods.drillRate).toBe(EXPERTISES.ore_cutting.permille[1]);
    expect(off.expertise).toEqual(on.expertise);
    expect(off.mods.drillRate).toBe(on.mods.drillRate);
    expect(off.mods.dataRate).toBe(on.mods.dataRate);
    expect(off.stock[itemIdx('iron_ore')]).toBe(on.stock[itemIdx('iron_ore')]);
    expect(off.hash()).toBe(on.hash());
  });
});
