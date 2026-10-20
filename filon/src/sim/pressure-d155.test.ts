// pressure-d155.test.ts — the water's pressure and the pressure gauge (D155; owner, 2026-10-19: « we
// also need a special thing to attach to a conduit that will tell the player the pressure in it (if
// it's too low, need a better pump or more pumps) »): a water network's pumps against its drinkers at
// full work, its state (enough, tight, short, dry, nothing drinking) and what to add; the gauge set into
// a conduit line by a click, turned as it runs, carrying the water as the conduit did — the flows and the
// catch-up unchanged, a reading that never touches the sim.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { BUILDINGS } from '@/content/buildings';
import { buildingIdx, isDragDef, itemIdx } from '@/content/registry';
import { buildingsUnlockedBy } from '@/content/research';
import { WORLD_EPOCH0 } from './constants';
import { catchUp } from './offline/catchup';
import { PRESSURE_MAX, pressureAt, pressureFix, pressureState, readPressure } from './readouts/pressure';
import { Sim } from './state';
import { grantCost, learnPlans, testSource, wire } from './testkit';
import { T, type Rot } from './types';
import { FlatSource } from './world/grid';

const WATER = (): number => itemIdx('water');
/** A pond east of the Hearth (x 522–525, y 502–507): the pump stands on its west shore. */
const POND = { x: 522, y: 502, w: 4, h: 6, t: T.Shallow } as const;

function wetSim(): Sim {
  const base = testSource();
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: new FlatSource(base.deposits, [...base.rocks, POND]), foundingEpoch: WORLD_EPOCH0 + 24 });
  learnPlans(sim);
  sim.grant('iron_plate', 600); sim.grant('glass', 100); sim.grant('copper_wire', 100);
  return sim;
}

/**
 * A pump at (521, 507) (wired unless `dry`), its line west along y = 507 from (520, 507) to (509, 507),
 * and `boilers` steam boilers north of it (at x 516, 512, 508, y 504–505), each watered by a branch drawn
 * north off the line into its water intake. Each boiler asks 30 water a minute, the pump gives 60.
 */
function line(boilers: number, dry = false): { sim: Sim; pump: number; boilers: number[] } {
  const sim = wetSim();
  const p = sim.place('pump', 521, 507, 3);
  if (!p.ok) throw new Error(`pump: ${p.reason}`);
  if (!dry) wire(sim, p.id!);
  expect(sim.placeBelts('conduit', Array.from({ length: 12 }, (_, k) => [520 - k, 507, 3] as [number, number, Rot]))).toBe(12);
  const ids: number[] = [];
  for (const bx of [516, 512, 508].slice(0, boilers)) {
    grantCost(sim, 'steam_boiler');
    const b = sim.place('steam_boiler', bx, 504, 0); // its water intake at (bx + 2, 505), from the south
    if (!b.ok) throw new Error(`boiler: ${b.reason}`);
    ids.push(b.id!);
    expect(sim.placeBelts('conduit', [[bx + 2, 507, 0], [bx + 2, 506, 0]])).toBe(1); // off the line's side: a tee
  }
  sim.run(20);
  return { sim, pump: p.id!, boilers: ids };
}

const at = (sim: Sim, x: number, y: number) => pressureAt(sim, x, y)!;

describe('a water network’s pressure (D155)', () => {
  it('fed: a pump (60) for a boiler (30) — twice what it asks, enough', () => {
    const { sim, pump, boilers } = line(1);
    const n = at(sim, 515, 507);
    expect(n.pumps).toEqual([{ ent: pump, full: 60_000, now: 60_000 }]);
    expect(n.drinkers).toEqual([{ ent: boilers[0], ask: 30_000 }]);
    expect([n.supply, n.demand, n.pressure, n.state]).toEqual([60_000, 30_000, 2000, 'ok']);
  });

  it('tight: the pump for two boilers — 60 for 60, just enough', () => {
    const { sim } = line(2);
    const r = readPressure(sim), n = pressureAt(sim, 512, 507, r)!;
    expect([n.supply, n.demand, n.pressure, n.state]).toEqual([60_000, 60_000, 1000, 'tight']);
    // The whole network: the line, its tees and their branches read the same.
    expect(r.nets.length).toBe(1);
    expect(pressureAt(sim, 514, 506, r)).toBe(n);
    expect(pressureAt(sim, 520, 507, r)).toBe(n);
  });

  it('starved: three boilers on one pump — short; what to add: a pump more, or one high-pressure pump', () => {
    const { sim } = line(3);
    const n = at(sim, 510, 507);
    expect([n.demand, n.pressure, n.state]).toEqual([90_000, 666, 'low']);
    const fix = pressureFix(n, ['pump', 'hp_pump']);
    expect(fix.short).toBe(Math.ceil((90_000 * BAL.pressure.ok) / 1000) - 60_000);
    expect(fix.more).toEqual([{ id: 'pump', n: 1 }, { id: 'hp_pump', n: 1 }]);
    expect(fix.unpowered).toBe(false);
  });

  it('dry: a pump with no power gives nothing — its pumps lack power; idle: nothing drinks', () => {
    const d = at(line(1, true).sim, 515, 507);
    expect([d.supply, d.nominal, d.state]).toEqual([0, 60_000, 'dry']);
    expect(pressureFix(d, ['pump']).unpowered).toBe(true);
    const i = at(line(0).sim, 515, 507);
    expect([i.demand, i.pressure, i.state]).toEqual([0, PRESSURE_MAX, 'idle']);
    expect(pressureFix(i, ['pump']).more).toEqual([]);
  });

  it('the states by the thresholds', () => {
    expect(pressureState(60, 30, 2000)).toBe('ok');
    expect(pressureState(10, 8, BAL.pressure.ok)).toBe('ok');
    expect(pressureState(10, 10, BAL.pressure.ok - 1)).toBe('tight');
    expect(pressureState(10, 10, BAL.pressure.tight)).toBe('tight');
    expect(pressureState(9, 10, BAL.pressure.tight - 1)).toBe('low');
    expect(pressureState(0, 10, 0)).toBe('dry');
    expect(pressureState(0, 0, 0)).toBe('idle');
  });

  it('a brickworks asks its recipe’s water at its speed; two networks read apart', () => {
    const sim = wetSim();
    sim.done.add(BUILDINGS.brickworks.unlock); sim.rebuildDerived();
    grantCost(sim, 'brickworks');
    const k = sim.place('brickworks', 516, 505, 0); // water in at (517, 506), from the south
    expect(k.ok).toBe(true);
    const p = sim.place('pump', 521, 507, 3);
    wire(sim, p.id!);
    expect(sim.placeBelts('conduit', [[520, 507, 3], [519, 507, 3], [518, 507, 3], [517, 507, 0]])).toBe(4);
    // A second pump's line, open-ended, on its own.
    const q = sim.place('pump', 521, 503, 3);
    expect(q.ok).toBe(true);
    expect(sim.placeBelts('conduit', [[520, 503, 3], [519, 503, 3]])).toBe(2);
    sim.run(10);
    const r = readPressure(sim);
    expect(r.nets.length).toBe(2);
    const a = pressureAt(sim, 518, 507, r)!, b = pressureAt(sim, 519, 503, r)!;
    expect(a).not.toBe(b);
    expect(a.drinkers).toEqual([{ ent: k.id, ask: 30_000 }]);
    expect(b.drinkers).toEqual([]);
  });
});

describe('the pressure gauge (D155)', () => {
  it('in the content: a 1 × 1 conduit fitting with the Steam plan, set by a click, no tier for the upgrade tool', () => {
    expect(BUILDINGS.pressure_gauge.kind).toBe('conduit');
    expect(buildingsUnlockedBy('steam').sort()).toEqual(['conduit', 'pressure_gauge', 'pump', 'steam_boiler']);
    expect(isDragDef('pressure_gauge')).toBe(false);
    expect(isDragDef('conduit')).toBe(true);
    for (const [it] of BUILDINGS.pressure_gauge.cost) expect(['iron_plate', 'glass', 'copper_wire']).toContain(it);
    // No pace of its own (its conduit's: compile.ts): the upgrade tool, which tiers line pieces by their pace, never takes it for a faster conduit.
    expect(BUILDINGS.pressure_gauge).not.toHaveProperty('belt');
    expect(buildingIdx('pressure_gauge')).toBeGreaterThan(buildingIdx('assembly_bench')); // appended: saves keep their building indices
  });

  it('set into a conduit: turned as the line runs, refused off one; the line stays one chain and keeps its water', () => {
    const { sim } = line(1);
    sim.run(300);
    expect(sim.canPlace('pressure_gauge', 505, 520, 0).reason).toBe('needs_conduit');
    const c0 = sim.graph.chainByTile.get(515 + 507 * 1024)!;
    const tiles = Array.from(c0.tiles), content = c0.content;
    grantCost(sim, 'pressure_gauge');
    const g = sim.place('pressure_gauge', 515, 507, 0); // turned north in hand: it takes the line's way, west
    expect(g.ok, String(g.reason)).toBe(true);
    expect(sim.entityAt(515, 507)!.rot).toBe(3);
    sim.ensureCompiled();
    const c1 = sim.graph.chainByTile.get(515 + 507 * 1024)!;
    expect(Array.from(c1.tiles)).toEqual(tiles);
    expect(c1.content).toBe(content);
    expect(at(sim, 515, 507).state).toBe('ok');
    // A gauge on a gauge is refused; a conduit dragged along the line through it keeps it.
    expect(sim.canPlace('pressure_gauge', 515, 507, 3).ok).toBe(false);
    expect(sim.planBelts('conduit', [[516, 507, 3], [515, 507, 3], [514, 507, 3]])[1]).toMatchObject({ skip: true, def: 'pressure_gauge' });
  });

  it('it changes nothing of the flows: the same water drunk with or without it; online = offline to the bit', () => {
    const plain = line(2).sim, gauged = line(2).sim;
    grantCost(gauged, 'pressure_gauge');
    expect(gauged.place('pressure_gauge', 517, 507, 3).ok).toBe(true);
    const w0 = plain.consumed[WATER()]!, g0 = gauged.consumed[WATER()]!;
    plain.run(3000); gauged.run(3000);
    expect(gauged.consumed[WATER()]! - g0).toBe(plain.consumed[WATER()]! - w0);
    expect(gauged.stock[WATER()]).toBe(plain.stock[WATER()]);
    // The twin: a base with a gauge caught up as it runs.
    const a = line(2).sim, b = line(2).sim;
    for (const s of [a, b]) { grantCost(s, 'pressure_gauge'); expect(s.place('pressure_gauge', 517, 507, 3).ok).toBe(true); }
    const N = 30 * 600;
    a.run(N);
    catchUp(b, N, { noDirect: true });
    expect(b.hash()).toBe(a.hash());
    // Reading it changes nothing.
    const h = a.hash();
    readPressure(a);
    expect(a.hash()).toBe(h);
  });
});
