// electric-smelter.test.ts — the electric smelter (D106): the smelter's plates and glass on power
// alone, at the smelter's pace (10 a minute, D97), the arc furnace twice as fast on the same
// recipes; a heavy draw while it works, a small one idle; two recipes, so it waits for the
// player's choice (D83); the recipes unlock with the Tier 1 node, before the arc furnace; and
// the save step that keeps an older claim's tree whole.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { BUILDINGS } from '@/content/buildings';
import { RECIPES } from '@/content/recipes';
import { buildingIdx, itemIdx, recipeIdx, recipesFor } from '@/content/registry';
import { RESEARCH, treePrereq } from '@/content/research';
import { WORLD_SEED } from '@/content/world';
import { LocalMarketService } from '@/market/service';
import { electricSmelting, migrate } from '@/persist/migrate';
import { recipeOf } from './cfg';
import { grantCost, line, steadyPower, stockedSilo, testSim, wire } from './testkit';
import type { Sim } from './state';

/** The Electric Smelting learnt (and `more` nodes), outside commands: engine tests start with the plans only. */
function learn(sim: Sim, ...more: string[]): void {
  for (const id of ['dn3', 'dn_esmelt', ...more]) sim.done.add(id);
  sim.rebuildDerived();
}

/**
 * A furnace north of the Hearth (as the catch-up test's kiln line, without the coal): a silo of
 * `item` below it feeding its back input, its output west and south into the Hearth's north input.
 */
function furnaceLine(sim: Sim, def: string, recipe: string, item: string): number {
  grantCost(sim, def as never); // its price today (D123: copper plates and bricks)
  const k = sim.place(def, 512, 503, 0);
  if (!k.ok) throw new Error(`${def}: ${k.reason}`);
  expect(sim.setRecipe(k.id!, recipe)).toBe(true);
  stockedSilo(sim, 512, 507, 0, item, 2000);
  const n1 = sim.placeBelts('ribbon', line(512, 506, 0, 2));
  const n2 = sim.placeBelts('ribbon', [[512, 502, 3], ...line(511, 502, 2, 8)]);
  if (n1 !== 2 || n2 !== 9) throw new Error(`belts ${n1} ${n2}`);
  wire(sim, k.id!);
  return k.id!;
}

/** Plates (or glass) made a minute, over `min` minutes after a 2-minute start. */
function perMin(sim: Sim, item: string, min: number): number {
  sim.run(1200);
  const it = itemIdx(item), p0 = sim.produced[it]!;
  sim.run(600 * min);
  return (sim.produced[it]! - p0) / 1000 / min;
}

describe('the electric smelter (D106)', () => {
  it('casts 10 plates a minute from ore alone, on power: no coal', () => {
    const sim = testSim();
    learn(sim);
    steadyPower(sim);
    const id = furnaceLine(sim, 'electric_smelter', 'arc_plate', 'iron_ore');
    expect(perMin(sim, 'iron_plate', 10)).toBeCloseTo(10, 1);
    expect(sim.consumed[itemIdx('coal')]).toBe(0);
    // It draws its 300 kW from the grid while it works.
    sim.ensureCompiled();
    const net = sim.graph.netOfEnt.get(id)!;
    expect(net).toBeGreaterThanOrEqual(0);
    expect(sim.netPower[net]!.demand).toBeGreaterThanOrEqual(BUILDINGS.electric_smelter.kw);
  });

  it('and glass at the coal smelter\'s pace: 10 a minute from 30 sand', () => {
    const sim = testSim();
    learn(sim);
    steadyPower(sim);
    furnaceLine(sim, 'electric_smelter', 'arc_glass', 'sand');
    expect(perMin(sim, 'glass', 10)).toBeCloseTo(10, 1);
    expect(RECIPES.arc_glass.seconds).toBe(RECIPES.glass.seconds);
  });

  it('the arc furnace runs the same recipes twice as fast: 20 plates a minute', () => {
    const sim = testSim();
    steadyPower(sim);
    learn(sim, 'dn_arc');
    furnaceLine(sim, 'arc_furnace', 'arc_plate', 'iron_ore');
    expect(perMin(sim, 'iron_plate', 10)).toBeCloseTo(20, 1);
  });

  it('makes nothing off the grid; its recipes are its and the arc furnace\'s, at the smelter\'s pace', () => {
    const sim = testSim();
    learn(sim);
    grantCost(sim, 'electric_smelter');
    const k = sim.place('electric_smelter', 512, 503, 0);
    expect(k.ok, k.reason).toBe(true);
    sim.setRecipe(k.id!, 'arc_plate');
    stockedSilo(sim, 512, 507, 0, 'iron_ore', 100);
    sim.placeBelts('ribbon', line(512, 506, 0, 2));
    sim.placeBelts('ribbon', [[512, 502, 3], ...line(511, 502, 2, 8)]);
    sim.run(6000); // never wired: no grid, no plate
    expect(sim.produced[itemIdx('iron_plate')]).toBe(0);
    // The coal recipes are the kilns' alone, the power ones its and the arc furnace's.
    expect(recipesFor(buildingIdx('electric_smelter')).map((r) => r.id).sort()).toEqual(['arc_copper', 'arc_glass', 'arc_plate']); // copper plates too since D123
    expect(RECIPES.arc_plate.seconds).toBe(RECIPES.iron_plate.seconds);
  });

  it('its recipes to choose from: a new one waits for the player (D83); Tier 1, before the arc furnace', () => {
    const sim = testSim();
    learn(sim);
    grantCost(sim, 'electric_smelter');
    const k = sim.place('electric_smelter', 520, 520, 0);
    expect(k.ok, k.reason).toBe(true);
    expect(recipeOf(sim.ents.get(k.id!)!.cfg)).toBe(0);
    expect(sim.setRecipe(k.id!, 'arc_glass')).toBe(true);
    expect(recipeOf(sim.ents.get(k.id!)!.cfg)).toBe(recipeIdx('arc_glass') + 1);
    // The node: Tier 1 of Machines, after the steel mill (D123); the arc furnace's node hangs from it.
    expect(RESEARCH.dn_esmelt.tier).toBe(1);
    expect(RESEARCH.dn_esmelt.prereq).toContain('dn_steel'); // after the steel mill since D123
    const closure = (id: string): string[] => [id, ...treePrereq(id).flatMap(closure)];
    expect(closure('dn_arc')).toContain('dn_esmelt');
    expect(RECIPES.arc_plate.unlock).toBe('dn_esmelt');
    expect(BUILDINGS.electric_smelter.unlock).toBe('dn_esmelt');
  });

  it('without the node, neither the building nor its recipes', () => {
    const sim = testSim();
    expect(sim.place('electric_smelter', 520, 520, 0).reason).toBe('locked');
    const kiln = sim.place('kiln', 520, 520, 0);
    expect(kiln.ok).toBe(true);
    expect(sim.setRecipe(kiln.id!, 'arc_plate')).toBe(false); // not the kiln's, nor unlocked
  });
  it('on the Crier\'s board, where a kW·min costs c_E: coal stays the cheaper plate, power the better use of the land', () => {
    const svc = new LocalMarketService({ worldSeed: WORLD_SEED, foundingEpoch: 29_853_761, events: false, firstTrade: false, noise: false });
    const [coal, power] = ['iron_plate', 'arc_plate'].map((id) => svc.board([id], BAL.market.energyCost)[0]!);
    expect(power!.machine).toBe('electric_smelter'); // the recipe's first machine: the board's row names it
    expect(power!.cycles).toBe(coal!.cycles); // 10 a minute each
    expect(power!.energy).toBeCloseTo(BUILDINGS.electric_smelter.kw * BAL.market.energyCost, 9);
    expect(power!.margin).toBeLessThan(coal!.margin); // its 300 kW cost more than 10 coal
    expect(power!.perTile!).toBeGreaterThan(coal!.perTile!); // but it mines no coal: more from each deposit tile
  });
});

describe('save 11 → 12 (D106): a claim past the Electric Smelting holds it', () => {
  it('the twin wire mill or the Synthesis, learnt or under way, brings it; a younger claim is left alone', () => {
    expect(electricSmelting({ v: 11, done: ['dn3', 'dn_wiremill'] }).done).toEqual(['dn3', 'dn_esmelt', 'dn_wiremill']);
    expect(electricSmelting({ v: 11, done: ['tr1', 'tr_synth', 'tr2'] }).done).toContain('dn_esmelt');
    expect(electricSmelting({ v: 11, done: ['dn3'], projects: [{ id: 'dn_wiremill' }] }).done).toEqual(['dn3', 'dn_esmelt']);
    const young = { v: 11, done: ['dn3', 'tr1'] };
    expect(electricSmelting(young)).toBe(young);
    // Through the chain: a Tier 2 claim of save 10 gets the Synthesis (D93), then this.
    expect(migrate({ v: 10, done: ['tr1', 'tr2'] } as { v: number }).data.done).toEqual(expect.arrayContaining(['tr_synth', 'dn_esmelt']));
  });
});
