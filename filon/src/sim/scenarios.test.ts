import { describe, it, expect } from 'vitest';
import { QUEST_IDS } from '@/content/quests';
import { PLAN_IDS, RESEARCH } from '@/content/research';
import { itemIdx } from '@/content/registry';
import { WORLD_SEED } from '@/content/world';
import { timed } from '@/core/cpu-time';
import { replay } from './commands';
import { DAY_EPOCHS, SOLAR, WORLD_EPOCH0 } from './constants';
import { foundScenario, idleAfter, scenarioEpoch, SCENARIO_IDS, type ScenarioId } from './scenarios';
import { Sim } from './state';
import { handsOut } from './systems/trade';
import { MapGen } from './world/mapgen';

/** Players' lands the levels must build on (the default `?seed=` is 1). */
const SEEDS = [1, 2, 3];
const NEAR = WORLD_EPOCH0 + 1000;

/** A level founded, and its time on the CPU (core/cpu-time.ts: other test runs on the machine do not count) and on the wall. */
const build = (id: ScenarioId, seed: number) => {
  const { value, ms, wall } = timed(() => foundScenario(id, { playerSeed: seed, near: NEAR, name: 'Essai' }));
  return { ...value, ms, wall };
};

/** The quest each level leaves current (null: the tutorial is over). */
const AT: Record<ScenarioId, string | null> = { claim: 'first_strike', smelter: 'bloom_kiln', survey: 'crier_trade', tutorial: 'synth_parts', grown: null, late: null };

/** The roles each level must have built (positions are never pinned: they come from the map). */
const BUILT: Record<ScenarioId, readonly string[]> = {
  claim: [],
  smelter: ['iron1'],
  survey: ['iron1', 'iron2', 'kiln1', 'coal', 'wind1', 'wind2', 'kiln2', 'sand1', 'sand2'],
  // No data collector in the tutorial (D101): its lab runs on the Core's own data; the collector comes at the grown level.
  tutorial: ['post', 'kiln1', 'kiln2', 'observatory', 'mill', 'copper', 'beacon', 'wind3', 'wind4', 'cutter1', 'cutter2', 'osc'],
  grown: ['post', 'kiln1', 'kiln2', 'collector', 'observatory', 'mill', 'copper', 'cutter1', 'cutter2', 'osc'],
  // The late base's works (scenario-late.ts): the potteries on the tarn's peak, the Fabrique on
  // the copper field — on every land (the Ember Fields mine and its thermal cores where the land has
  // that site: checked below).
  late: [
    'post', 'kiln1', 'collector', 'observatory', 'cutter1', 'cutter2', 'osc',
    'oven', 'pump', 'dockT', 'digger1',
    'boreCu', 'post2', 'dockW', 'mill2', 'mill3', 'circuits', 'circuits2', 'gears2', 'bells', 'data2', 'observatory2', 'sorter2',
  ],
};

/**
 * The production buildings that stand off three minutes on end while the base runs six more (D85,
 * owner 2026-10-15: two copper drills of the late base fed ribbons that led nowhere). It runs the
 * base: the last check on it.
 */
const idle = (sim: Sim): string[] => idleAfter(sim).map((i) => `${i.def}@${i.x},${i.y}:${i.work}`);

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
      const { sim, report, ms, wall } = build(id, seed);
      times.push(`${id} ${Math.round(ms)} ms (${Math.round(wall)} on the wall)`);
      expect(sim.colonyName).toBe('Essai');
      expect(sim.quests.done[0]).toBe('claim');
      expect(QUEST_IDS[sim.quests.cur] ?? null, id).toBe(AT[id]);
      for (const role of BUILT[id]) expect(report.ids[role], `${id}: ${role}`).toBeGreaterThan(0);
      for (const role of BUILT[id]) expect(sim.ents.get(report.ids[role]!), `${id}: ${role} standing`).toBeTruthy();
      expect(ms, `${id} built in ${Math.round(ms)} ms of CPU (${Math.round(wall)} ms on the wall)`).toBeLessThan(3000);
      // Every line laid leads somewhere: into a building or on along another ribbon (owner,
      // 2026-10-14: a bridge fed from its side "doesn't work" — D55: entered from straight behind).
      sim.ensureCompiled();
      const dead = sim.graph.chains.filter((c) => !c.outE.length).map((c) => { const t = c.tiles[c.tiles.length - 1]!; return `${t % 1024},${(t - (t % 1024)) / 1024}`; });
      expect(dead, `${id}: lines that end nowhere`).toEqual([]);
      if (id === 'late') {
        expect(report.granted).toEqual(expect.arrayContaining(['tr2', 'tr4', 'tr6', 'tr8', 'ex5', 'ex8', 'xp_far', 'dn_etcher', 'dn8', 'enK', 'cm3', 'an_servers']));
        expect(sim.hearthLevel).toBe(4);
        // Over half the tree done (D66, D69: 44 of 77), the Research Queue researched for real.
        expect(Object.keys(RESEARCH).filter((r) => sim.done.has(r)).length, 'late: research done').toBeGreaterThanOrEqual(44);
        // The first lab on the Research Queue (D107: the Compute Plan comes learnt with the Wider Wharf).
        expect(sim.projects.map((p) => p.id).sort(), 'late: research under way').toEqual(['an_queue']);
        // The Ember Fields mine where the land has the site, its embersalt flown to the Fabrique's thermal cores.
        if (report.ids.boreE) for (const role of ['dockE', 'cores']) expect(report.ids[role], `late: ${role}`).toBeGreaterThan(0);
        // Nothing the map refused (each part of the works is laid whole, or skipped by name) but the
        // grown base's gear workshop where its plate line is too short to branch (land 3).
        expect(report.skipped.filter((s) => s !== 'gears'), 'late skipped').toEqual([]);
        expect(idle(sim), 'late: idle three minutes on end').toEqual([]);
        continue;
      }
      // The tutorial path is played, not forced, and the map allowed every part of it.
      if (id !== 'grown') {
        expect(report.forced, `${id} forced`).toEqual([]);
        expect(report.skipped, `${id} skipped`).toEqual([]);
      }
      expect(report.granted, `${id}: nothing outside the commands`).toEqual([]);
      if (id === 'tutorial') {
        // The whole factory runs: plates, glass, data files (the Core's), copper wire, the vein's quartz all made.
        for (const it of ['iron_plate', 'glass', 'journal_1', 'copper_wire', 'quartz']) expect(sim.produced[itemIdx(it)], it).toBeGreaterThan(0);
        expect(sim.done.has('ex_quartz'), 'the Face Cutter’s plan').toBe(true);
        // The Core raised by the player's command (D101), Mechanics begun on its data (learnt by now: D107).
        expect(sim.hearthLevel).toBe(2);
        expect(sim.log.filter((l) => l.cmd.k === 'hearthUp')).toHaveLength(1);
        expect(sim.projects.map((p) => p.id).concat([...sim.done].filter((id) => id === 'tr1'))).toContain('tr1');
      }
      if (id === 'grown') {
        expect(PLAN_IDS.every((p) => sim.done.has(p))).toBe(true);
        expect(sim.produced[itemIdx('oscillator')], 'grown: oscillators made').toBeGreaterThan(0);
        for (const r of ['tr1', 'an_data', 'en_pitch', 'xp_swift']) expect(sim.done.has(r), `learnt ${r}`).toBe(true);
        expect(idle(sim), 'grown: idle three minutes on end').toEqual([]);
      }
    }
    if (process.env.SCENARIO_REPORT) console.log(`player ${seed}: ${times.join(' · ')}`);
  }, 60_000);

  it.each(SEEDS)('from the tutorial on, a base pays its way on land %i: a line feeds the trade post, its purchases leave by an outlet, the grid holds all day, the money grows', (seed) => {
    for (const id of ['tutorial', 'late'] as const) {
      const { sim, report } = build(id, seed);
      const post = report.ids.post!;
      expect(sim.graph.nodeByEnt.get(post)!.inE.length, `${id}: a line into the post`).toBeGreaterThan(0);
      expect(sim.cargoOf(post), `${id}: its cargo`).not.toContain(itemIdx('iron_ore')); // its entrance sells the ore (D64)
      // One standing order, whose goods an outlet takes out (D43): never one that only drains the purse.
      expect(sim.trade.orders.filter((o) => o.post === post).map((o) => o.item), `${id}: its order`).toEqual([itemIdx('iron_plate')]);
      expect(handsOut(sim, sim.ents.get(post)!, itemIdx('iron_plate')), `${id}: an outlet takes the plates out`).toBe(true);
      const grid = sim.graph.netOfEnt.get(sim.hearthId)!;
      const credits0 = sim.credits;
      const produced0 = Float64Array.from(sim.produced);
      let low = 1000;
      for (let m = 0; m < DAY_EPOCHS; m++) { sim.run(600); low = Math.min(low, sim.netPower[grid]!.sat); }
      expect(low, `${id}: the grid's lowest satisfaction over a day`).toBeGreaterThanOrEqual(900);
      expect(sim.credits - credits0, `${id}: ocelles earned over a day`).toBeGreaterThan(20_000);
      if (id === 'late') {
        // The late base's chains run over the day (D66): the Fabrique's wire, circuits, gears, speed
        // modules and data files, the potteries' ceramic, the thermal cores where embersalt comes.
        const made = (it: string): number => sim.produced[itemIdx(it)]! - produced0[itemIdx(it)]!;
        for (const it of ['copper_wire', 'circuit', 'gear', 'pace_bell', 'journal_1', 'ceramic', ...(report.ids.cores ? ['thermal_core'] : [])]) expect(made(it), `late: ${it} made over a day`).toBeGreaterThan(0);
        // Far more than its way: its sales of what it makes, after what it buys.
        expect(sim.credits - credits0, 'late: ocelles earned over a day').toBeGreaterThan(100_000);
      }
    }
  }, 60_000);

  it('the same level on the same land builds the same base; its log replays to it', () => {
    // The late base too is deterministic (its research is granted outside the commands: no replay).
    expect(build('late', 2).sim.hash(), 'late: the same base').toBe(build('late', 2).sim.hash());
    for (const id of ['smelter', 'tutorial'] as const) {
      const a = build(id, 1).sim, b = build(id, 1).sim;
      expect(b.hash()).toBe(a.hash());
      const c = new Sim({ worldSeed: WORLD_SEED, playerSeed: 1, source: new MapGen(WORLD_SEED, 1), foundingEpoch: a.foundingEpoch });
      replay(c, a.log, a.tick);
      expect(c.hash(), `${id} replayed`).toBe(a.hash());
    }
  }, 60_000);
});
