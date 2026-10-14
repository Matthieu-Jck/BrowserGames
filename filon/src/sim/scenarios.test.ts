import { describe, it, expect } from 'vitest';
import { QUEST_IDS } from '@/content/quests';
import { PLAN_IDS } from '@/content/research';
import { itemIdx } from '@/content/registry';
import { WORLD_SEED } from '@/content/world';
import { replay } from './commands';
import { DAY_EPOCHS, SOLAR, WORLD_EPOCH0 } from './constants';
import { foundScenario, scenarioEpoch, SCENARIO_IDS, type ScenarioId } from './scenarios';
import { Sim } from './state';
import { handsOut } from './systems/trade';
import { MapGen } from './world/mapgen';

/** Players' lands the levels must build on (the default `?seed=` is 1). */
const SEEDS = [1, 2, 3];
const NEAR = WORLD_EPOCH0 + 1000;

const build = (id: ScenarioId, seed: number) => {
  const t0 = performance.now();
  const r = foundScenario(id, { playerSeed: seed, near: NEAR, name: 'Essai' });
  return { ...r, ms: performance.now() - t0 };
};

/** The quest each level leaves current (null: the tutorial is over). */
const AT: Record<ScenarioId, string | null> = { claim: 'first_strike', smelter: 'bloom_kiln', survey: 'field_journal', tutorial: null, grown: null, late: null };

/** The roles each level must have built (positions are never pinned: they come from the map). */
const BUILT: Record<ScenarioId, readonly string[]> = {
  claim: [],
  smelter: ['iron1', 'iron2'],
  survey: ['iron1', 'iron2', 'kiln1', 'coal', 'wind1', 'wind2', 'workshop', 'kiln2', 'sand1', 'sand2'],
  tutorial: ['post', 'kiln1', 'kiln2', 'workshop', 'observatory', 'mill', 'copper', 'beacon', 'wind3', 'wind4'],
  grown: ['post', 'kiln1', 'kiln2', 'workshop', 'observatory', 'mill', 'copper'],
  late: ['post', 'kiln1', 'workshop', 'observatory', 'dockB'],
};

describe('debug bases (scenarios)', () => {
  it('a level is founded at sunrise: its build runs in full sun', () => {
    for (const near of [WORLD_EPOCH0, NEAR, NEAR + 17, NEAR + 35]) {
      const e = scenarioEpoch(near);
      expect(e).toBeLessThanOrEqual(near);
      expect(near - e).toBeLessThan(DAY_EPOCHS);
      expect(SOLAR[e % DAY_EPOCHS]).toBe(1000);
      expect(SOLAR[(e - 1 + DAY_EPOCHS) % DAY_EPOCHS]).toBeLessThan(1000);
    }
  });

  it.each(SEEDS)('every level builds on the real map of player %i, the tutorial ones with every quest met on its own', (seed) => {
    const times: string[] = [];
    for (const id of SCENARIO_IDS) {
      const { sim, report, ms } = build(id, seed);
      times.push(`${id} ${Math.round(ms)} ms`);
      expect(sim.colonyName).toBe('Essai');
      expect(sim.quests.done[0]).toBe('claim');
      expect(QUEST_IDS[sim.quests.cur] ?? null, id).toBe(AT[id]);
      for (const role of BUILT[id]) expect(report.ids[role], `${id}: ${role}`).toBeGreaterThan(0);
      for (const role of BUILT[id]) expect(sim.ents.get(report.ids[role]!), `${id}: ${role} standing`).toBeTruthy();
      expect(ms, `${id} built in ${Math.round(ms)} ms`).toBeLessThan(3000);
      if (id === 'late') {
        expect(report.granted).toEqual(expect.arrayContaining(['tr2', 'tr4', 'tr6']));
        expect(sim.hearthLevel).toBe(4);
        // The outer works stand on every land (their parts adapt to it: copper or bought circuits).
        for (const role of ['post2', 'gears2', 'bells']) expect(report.ids[role], `late: ${role}`).toBeGreaterThan(0);
        // Mechanics Data where water past the Crown gives the ceramic.
        if (report.ids.pump) for (const role of ['journal2', 'observatory2', 'ceramics']) expect(report.ids[role], `late: ${role}`).toBeGreaterThan(0);
        continue;
      }
      // The tutorial path is played, not forced, and the map allowed every part of it.
      if (id !== 'grown') {
        expect(report.forced, `${id} forced`).toEqual([]);
        expect(report.skipped, `${id} skipped`).toEqual([]);
      }
      expect(report.granted, `${id}: nothing outside the commands`).toEqual([]);
      if (id === 'tutorial') {
        // The whole factory runs: plates, glass, survey data, copper wire all made.
        for (const it of ['iron_plate', 'glass', 'journal_1', 'copper_wire']) expect(sim.produced[itemIdx(it)], it).toBeGreaterThan(0);
        expect(sim.projects.map((p) => p.id)).toEqual(['tr1']); // Mechanics under way
      }
      if (id === 'grown') {
        expect(PLAN_IDS.every((p) => sim.done.has(p))).toBe(true);
        for (const r of ['tr1', 'en1', 'dn1']) expect(sim.done.has(r), `learnt ${r}`).toBe(true);
      }
    }
    if (process.env.SCENARIO_REPORT) console.log(`player ${seed}: ${times.join(' · ')}`);
  }, 60_000);

  it.each(SEEDS)('from the tutorial on, a base pays its way on land %i: a line feeds the trade post, its purchases leave by an outlet, the grid holds all day, the money grows', (seed) => {
    for (const id of ['tutorial', 'late'] as const) {
      const { sim, report } = build(id, seed);
      const post = report.ids.post!;
      expect(sim.graph.nodeByEnt.get(post)!.inE.length, `${id}: a line into the post`).toBeGreaterThan(0);
      expect(sim.streamsOf(post)[0], `${id}: its stream`).toBe(itemIdx('iron_ore'));
      // One standing order, whose goods an outlet takes out (D43): never one that only drains the purse.
      expect(sim.trade.orders.filter((o) => o.post === post).map((o) => o.item), `${id}: its order`).toEqual([itemIdx('iron_plate')]);
      expect(handsOut(sim, sim.ents.get(post)!, itemIdx('iron_plate')), `${id}: an outlet takes the plates out`).toBe(true);
      const grid = sim.graph.netOfEnt.get(sim.hearthId)!;
      const credits0 = sim.credits;
      let low = 1000;
      for (let m = 0; m < DAY_EPOCHS; m++) { sim.run(600); low = Math.min(low, sim.netPower[grid]!.sat); }
      expect(low, `${id}: the grid's lowest satisfaction over a day`).toBeGreaterThanOrEqual(900);
      expect(sim.credits - credits0, `${id}: ocelles earned over a day`).toBeGreaterThan(20_000);
      // The late base's advanced chain runs: speed modules and Mechanics Data made over the day.
      // On land with copper past the Crown (its own circuits; elsewhere they are bought, two hours away).
      if (id === 'late' && report.ids.mill2) for (const it of ['circuit', 'pace_bell', 'gear']) expect(sim.produced[itemIdx(it)], `late: ${it}`).toBeGreaterThan(0);
    }
  }, 60_000);

  it('the same level on the same land builds the same base; its log replays to it', () => {
    for (const id of ['smelter', 'tutorial'] as const) {
      const a = build(id, 1).sim, b = build(id, 1).sim;
      expect(b.hash()).toBe(a.hash());
      const c = new Sim({ worldSeed: WORLD_SEED, playerSeed: 1, source: new MapGen(WORLD_SEED, 1), foundingEpoch: a.foundingEpoch });
      replay(c, a.log, a.tick);
      expect(c.hash(), `${id} replayed`).toBe(a.hash());
    }
  }, 60_000);
});
