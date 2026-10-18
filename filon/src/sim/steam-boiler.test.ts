// steam-boiler.test.ts — the steam boiler (D114): water's first use, in Tier 1. Coal and water into
// power, 600 kW for 8 coal and 30 water a minute (two and a half times the coal generator's power
// per coal), both drunk in proportion to what the grid asks; without water it gives nothing, on
// standby it burns nothing; online and offline agree; the plan that brings it (with the pump and the
// conduit, Ceramics' before) and the save step that keeps an older claim's pumps awake.
import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { buildingIdx, itemIdx } from '@/content/registry';
import { buildingsUnlockedBy, PLANS, treePrereq } from '@/content/research';
import { migrate, steamPlan } from '@/persist/migrate';
import { WORLD_EPOCH0 } from './constants';
import { GeneratorNode } from './flow/nodes';
import { catchUp } from './offline/catchup';
import { Sim } from './state';
import { grantCost, learnPlans, stockedSilo, testSource, wire } from './testkit';
import { St, T } from './types';
import { FlatSource, tileIndex } from './world/grid';

const COAL = (): number => itemIdx('coal');
const WATER = (): number => itemIdx('water');

/** A pond east of the Hearth (shallow water, on the floor): where the pump stands. */
const POND = { x: 522, y: 502, w: 4, h: 6, t: T.Shallow } as const;

/** The test world (testkit's deposits and vent) with the pond; every plan learnt. */
function wetSim(): Sim {
  const base = testSource();
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: new FlatSource(base.deposits, [...base.rocks, POND]), foundingEpoch: WORLD_EPOCH0 + 24 });
  learnPlans(sim);
  return sim;
}

/**
 * A boiler north-east of the Hearth, its coal from a silo set against its coal intake (D39), its
 * water from a pump on the pond's shore by a conduit; both wired to the Hearth. `servers` servers
 * (400 kW each) give the grid something to ask of it. Returns the boiler's and the pump's ids.
 */
function boilerBase(servers: number, coal = 2000, conduit = true): { sim: Sim; boiler: number; pump: number } {
  const sim = wetSim();
  sim.grant('iron_plate', 200); sim.grant('glass', 40); sim.grant('copper_wire', 40);
  const b = sim.place('steam_boiler', 516, 505, 0); // 516–518 × 505–506: coal in at (516,506) S, water at (518,506) S
  if (!b.ok) throw new Error(`boiler: ${b.reason}`);
  stockedSilo(sim, 516, 507, 0, 'coal', coal); // its out (516,507) faces the coal intake
  const p = sim.place('pump', 521, 507, 3); // on the shore, its outlet west
  if (!p.ok) throw new Error(`pump: ${p.reason}`);
  if (conduit && sim.placeBelts('conduit', [[520, 507, 3], [519, 507, 3], [518, 507, 0]]) !== 3) throw new Error('conduit');
  wire(sim, [b.id!, p.id!]);
  if (servers) {
    sim.done.add('an_servers');
    sim.rebuildDerived();
    for (const [x, y] of [[506, 517], [503, 517], [506, 520]].slice(0, servers)) {
      grantCost(sim, 'server');
      const s = sim.place('server', x!, y!, 0);
      if (!s.ok) throw new Error(`server: ${s.reason}`);
      wire(sim, s.id!);
    }
  }
  sim.run(1200); // the conduit fills, the boxes too
  return { sim, boiler: b.id!, pump: p.id! };
}

const boilerOf = (sim: Sim, id: number): GeneratorNode => { sim.ensureCompiled(); return sim.graph.nodeByEnt.get(id) as GeneratorNode; };

/** What it burnt and drank a minute, and its dispatch, over `min` minutes. */
function rates(sim: Sim, min: number): { coal: number; water: number } {
  const c0 = sim.consumed[COAL()]!, w0 = sim.consumed[WATER()]!;
  sim.run(600 * min);
  return { coal: (sim.consumed[COAL()]! - c0) / 1000 / min, water: (sim.consumed[WATER()]! - w0) / 1000 / min };
}

describe('the steam boiler (D114)', () => {
  it('two and a half times the coal generator’s power per coal; a pump feeds two', () => {
    const g = BUILDINGS.steam_boiler.gen, c = BUILDINGS.brazier.gen;
    expect(g.kw / g.fuelPerMin).toBe(2.5 * (c.kw / c.fuelPerMin));
    expect(BUILDINGS.pump.drill.perMin).toBe(2 * g.water);
    // The card's sentence quotes the numbers that decide (content.md: keep `desc` in step).
    for (const n of [String(g.kw), String(g.fuelPerMin), String(g.water)]) expect(BUILDINGS.steam_boiler.desc.en).toContain(n);
  });

  it('at full output: 600 kW for 8 coal and 30 water a minute', () => {
    const { sim, boiler } = boilerBase(3); // 1 230 kW asked: the Core and the boiler flat out
    const n = boilerOf(sim, boiler);
    expect(n.drinks).toBe(true);
    expect(n.outKw).toBe(600);
    const net = sim.graph.netOfEnt.get(boiler)!;
    expect(sim.ctx.dispatch[net]).toBe(1000);
    expect(n.status).toBe(St.Ok);
    const r = rates(sim, 10);
    expect(r.coal).toBeCloseTo(8, 1);
    expect(r.water).toBeCloseTo(30, 1);
    // Its whole output counted on the grid's fuel side, as the Électricité view reads it.
    expect(sim.netPower[net]!.fuel).toBe(600);
  });

  it('drinks in proportion to what the grid asks, like its coal', () => {
    const { sim, boiler } = boilerBase(1); // 430 kW asked: the Core and part of the boiler
    const net = (sim.ensureCompiled(), sim.graph.netOfEnt.get(boiler)!);
    const d = sim.ctx.dispatch[net]!;
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1000);
    const r = rates(sim, 1);
    expect(r.water / r.coal).toBeCloseTo(30 / 8, 1);
  });

  it('without water it gives nothing, its coal kept; it says the water is missing', () => {
    const { sim, boiler } = boilerBase(3, 2000, false);
    const n = boilerOf(sim, boiler);
    expect(n.water).toBe(0);
    expect(n.fuel).toBeGreaterThan(0);
    expect(n.fueled()).toBe(false);
    expect(n.status).toBe(St.NoFuel);
    const net = sim.graph.netOfEnt.get(boiler)!;
    expect(sim.netPower[net]!.fuel).toBe(0);
    const c0 = sim.consumed[COAL()]!;
    sim.run(600);
    expect(sim.consumed[COAL()]).toBe(c0);
  });

  it('on standby (the Core covers the grid) it burns and drinks nothing', () => {
    const { sim, boiler } = boilerBase(0);
    const n = boilerOf(sim, boiler);
    expect(n.fueled()).toBe(true);
    expect(n.status).toBe(St.Idle);
    const r = rates(sim, 5);
    expect(r.coal).toBe(0);
    expect(r.water).toBe(0);
  });

  it('nothing vanishes: taken down, its boxes go back to the Core', () => {
    const { sim, boiler } = boilerBase(1);
    const n = boilerOf(sim, boiler);
    const coal = n.fuel, water = n.water;
    expect(water).toBeGreaterThan(0);
    const c0 = sim.stock[COAL()]!, w0 = sim.stock[WATER()]!;
    expect(sim.remove(516, 505)).toBeTruthy();
    sim.ensureCompiled();
    expect(sim.stock[COAL()]! - c0).toBe(coal);
    expect(sim.stock[WATER()]! - w0).toBe(water);
  });

  it('online = offline over a day and a half (the night included)', () => {
    const a = boilerBase(1, 3000).sim, b = boilerBase(1, 3000).sim;
    expect(a.hash()).toBe(b.hash());
    const c0 = a.consumed[COAL()]!, w0 = a.consumed[WATER()]!;
    const N = 54 * 600;
    a.run(N);
    catchUp(b, N, { noDirect: true });
    expect(b.tick).toBe(a.tick);
    const coal = (s: Sim): number => (s.consumed[COAL()]! - c0) / 1000, water = (s: Sim): number => (s.consumed[WATER()]! - w0) / 1000;
    expect(coal(a)).toBeGreaterThan(100); // it worked through the night: the Core's panel is dark
    // The same coal and water to the milli-item: the catch-up dispatches its generators at online's
    // exact share (D114: no longer rounded up to 25 ‰, which made a half-called boiler burn 3 % more).
    expect(coal(b)).toBe(coal(a));
    expect(water(b)).toBe(water(a));
    expect(water(a) / coal(a)).toBeCloseTo(30 / 8, 1);
  });

  it('water pours down a terrace in a conduit, one at a time, and never climbs (D114)', () => {
    // A pond up on a one-level shelf north-east of the Hearth (rock at level 1, x 520–531, y 496–503),
    // its pump on the shelf, a conduit off the shelf's edge onto the floor and into the boiler.
    const base = testSource();
    const shelf = { x: 520, y: 496, w: 12, h: 8, t: T.Rock1, level: 1 }, pond = { x: 526, y: 497, w: 3, h: 3, t: T.Shallow, level: 1 };
    const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: new FlatSource(base.deposits, [...base.rocks, shelf, pond]), foundingEpoch: WORLD_EPOCH0 + 24 });
    learnPlans(sim);
    sim.grant('iron_plate', 200); sim.grant('glass', 40); sim.grant('copper_wire', 40);
    expect(sim.grid.level(522, 503)).toBe(1);
    expect(sim.grid.level(522, 504)).toBe(0);
    const p = sim.place('pump', 525, 498, 3); // on the shelf, by the pond: its outlet west, (524, 498)
    expect(p.ok, String(p.reason)).toBe(true);
    // Climbing is refused; pouring one terrace down is not.
    expect(sim.canPlace('conduit', 522, 504, 0).reason).toBe('cliff'); // on the floor, facing the shelf
    expect(sim.canPlace('conduit', 522, 503, 2).ok).toBe(true); // on the shelf's edge, facing the floor below
    const b = sim.place('steam_boiler', 520, 506, 0); // on the floor: water in at (522, 507) from (522, 508)
    expect(b.ok, String(b.reason)).toBe(true);
    const path: Array<[number, number, 0 | 1 | 2 | 3]> = [[524, 498, 3], [523, 498, 3], [522, 498, 2], [522, 499, 2], [522, 500, 2], [522, 501, 2], [522, 502, 2], [522, 503, 2], [522, 504, 2], [522, 505, 1], [523, 505, 1], [524, 505, 2], [524, 506, 2], [524, 507, 2], [524, 508, 3], [523, 508, 3], [522, 508, 0]];
    expect(sim.placeBelts('conduit', path)).toBe(path.length);
    wire(sim, b.id!);
    // The pump up on the shelf, past the Core's reach: a pole on the floor, one on the shelf (each wires itself to the last).
    expect(sim.place('mast', 517, 506, 0).ok).toBe(true);
    const m2 = sim.place('mast', 521, 501, 0);
    expect(m2.ok).toBe(true);
    wire(sim, p.id!, m2.id!);
    sim.run(1200);
    const n = boilerOf(sim, b.id!);
    expect(n.water).toBeGreaterThan(0); // the water came down the edge
    sim.ensureCompiled();
    expect(sim.graph.chainByTile.get(tileIndex(522, 503))).toBe(sim.graph.chainByTile.get(tileIndex(522, 504))); // one line over the edge
  });

  it('the Steam plan, after the coal generator, brings the boiler, the pump and the conduit (a plate a tile)', () => {
    expect(treePrereq('steam')).toEqual(['brazier']);
    expect(PLANS.steam.lane).toBe('energy');
    expect(buildingsUnlockedBy('steam').sort()).toEqual(['conduit', 'pump', 'steam_boiler']);
    expect(BUILDINGS.conduit.cost).toEqual([['iron_plate', 1]]);
    // Everything the plan costs, and the buildings, in the bootstrap's materials (D36): no Tier 2 part.
    for (const id of ['pump', 'conduit', 'steam_boiler'] as const) {
      for (const [it] of BUILDINGS[id].cost) expect(['iron_plate', 'glass', 'copper_wire'], `${id}: ${it}`).toContain(it);
    }
    expect(buildingIdx('steam_boiler')).toBeGreaterThan(buildingIdx('brazier'));
  });

  it('save 15 → 16: a claim past the lab’s plan holds the Steam plan; one before it does not', () => {
    expect(steamPlan({ done: ['brazier', 'observatory', 'tr3'] }).done).toEqual(['brazier', 'observatory', 'steam', 'tr3']);
    expect(steamPlan({ done: ['brazier', 'kiln'] }).done).toEqual(['brazier', 'kiln']);
    const d = { done: ['observatory', 'steam'] };
    expect(steamPlan(d)).toBe(d);
    // Through the migration chain from 15.
    const m = migrate({ v: 15, done: ['observatory'] } as never);
    expect((m.data as unknown as { done: string[] }).done).toContain('steam');
  });
});
