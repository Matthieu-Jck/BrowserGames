// tees-d152.test.ts — conduits that share their water (D152; owner, 2026-10-19: « we also need
// conduits that share the water between multiple paths »): a conduit dragged off the side of another
// draws water off it there, a tee; the tee's water is shared evenly among the ways that can take it,
// a full way's share going to the others; two lines join where one runs into another's side; the
// drag keeps the pipe it starts or ends on; online and offline agree to the bit.
import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { RECIPES } from '@/content/recipes';
import { itemIdx } from '@/content/registry';
import { WORLD_EPOCH0 } from './constants';
import { Chain } from './flow/chain';
import { shareFluid } from './flow/node';
import { GeneratorNode } from './flow/nodes';
import { catchUp } from './offline/catchup';
import { serialize, deserialize } from './serialize';
import { Sim } from './state';
import { grantCost, learnPlans, stockedSilo, testSource, wire } from './testkit';
import { FlatSource, tileIndex } from './world/grid';
import { T, type Rot } from './types';

const WATER = (): number => itemIdx('water');

/** A pond east of the Hearth (shallow water on the floor, x 522–525, y 502–507): where the pumps stand. */
const POND = { x: 522, y: 502, w: 4, h: 6, t: T.Shallow } as const;

const wetSource = (): FlatSource => { const base = testSource(); return new FlatSource(base.deposits, [...base.rocks, POND]); };

function wetSim(): Sim {
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: wetSource(), foundingEpoch: WORLD_EPOCH0 + 24 });
  learnPlans(sim);
  sim.grant('iron_plate', 400); sim.grant('glass', 80); sim.grant('copper_wire', 80);
  return sim;
}

const at = (sim: Sim, x: number, y: number): Chain => { sim.ensureCompiled(); return sim.graph.chainByTile.get(tileIndex(x, y))!; };
const lay = (sim: Sim, path: Array<[number, number, Rot]>): void => { expect(sim.placeBelts('conduit', path)).toBe(path.length); };

/** A pump on the pond's shore at (521, 505), its outlet west into (520, 505), wired. Returns its id. */
function pump(sim: Sim, y = 505): number {
  const p = sim.place('pump', 521, y, 3);
  if (!p.ok) throw new Error(`pump: ${p.reason}`);
  wire(sim, p.id!);
  return p.id!;
}

describe('shareFluid (D152)', () => {
  const run = (free: number, caps: number[], rot = 0): number[] => {
    const es = caps.map((_, i) => i), c = Float64Array.from(caps), out = new Float64Array(caps.length);
    const given = shareFluid(es, rot, free, c, out);
    expect(given).toBe([...out].reduce((a, b) => a + b, 0));
    return [...out];
  };

  it('splits evenly among the ways that can take it', () => {
    expect(run(100, [400, 400])).toEqual([50, 50]);
    expect(run(99, [400, 400, 400])).toEqual([33, 33, 33]);
  });

  it('a way that takes less hands the rest to the others; nothing is handed past what they take', () => {
    expect(run(100, [10, 400])).toEqual([10, 90]);
    expect(run(100, [0, 400, 400])).toEqual([0, 50, 50]);
    expect(run(100, [20, 30, 400])).toEqual([20, 30, 50]);
    expect(run(100, [10, 20])).toEqual([10, 20]); // all full: the rest stays where it is
    expect(run(100, [0, 0])).toEqual([0, 0]);
  });

  it('what does not divide goes a milli-item a way in turn from the rotation', () => {
    expect(run(101, [400, 400], 0)).toEqual([51, 50]);
    expect(run(101, [400, 400], 1)).toEqual([50, 51]);
    expect(run(2, [400, 400, 400], 2)).toEqual([1, 0, 1]);
    // Over n ticks each way gets the same.
    const sum = [0, 0, 0];
    for (let r = 0; r < 3; r++) run(100, [400, 400, 400], r).forEach((v, i) => { sum[i] = sum[i]! + v; });
    expect(sum).toEqual([100, 100, 100]);
  });
});

describe('conduit tees (D152)', () => {
  it('a conduit off the side of a line draws its water there: the tee ends its chain and hands on both ways', () => {
    const sim = wetSim();
    pump(sim);
    lay(sim, [[520, 505, 3], [519, 505, 3], [518, 505, 3], [517, 505, 3]]); // the main line, west
    lay(sim, [[520, 506, 2], [520, 507, 2], [520, 508, 2]]); // a branch south off its first tile
    const tee = at(sim, 520, 505), main = at(sim, 518, 505), branch = at(sim, 520, 507);
    expect(sim.graph.tees.get(tileIndex(520, 505))).toBe(1 << 2); // it hands out of its south side
    expect(sim.graph.drawsFrom.get(tileIndex(520, 506))).toBe(tileIndex(520, 505));
    expect(tee.lastTile).toBe(tileIndex(520, 505)); // the tee ends its chain
    expect(tee).not.toBe(main);
    expect(tee.outE.map((e) => sim.graph.nodes[sim.graph.eDst[e]!])).toEqual([main, branch]); // its way on first
    expect(sim.graph.feedDirs.get(tileIndex(520, 506))).toBe(1 << 0); // the branch is fed from its north
    // Two lines side by side, the same way: never a tee.
    lay(sim, [[519, 507, 3], [518, 507, 3]]);
    expect(sim.graph.drawsFrom.has(tileIndex(519, 507))).toBe(false);
  });

  it('the water is shared evenly while both ways take it; a full way passes its share to the other', () => {
    const sim = wetSim();
    pump(sim);
    lay(sim, [[520, 505, 3], [519, 505, 3], [518, 505, 3], [517, 505, 3], [516, 505, 3], [515, 505, 3], [514, 505, 3]]); // long, open-ended
    lay(sim, [[520, 506, 2], [520, 507, 2]]); // short, open-ended: fills first
    const main = at(sim, 519, 505), branch = at(sim, 520, 506);
    sim.run(30); // the pump and the tee under way
    const m0 = main.pushedTotal, b0 = branch.pushedTotal;
    sim.run(20);
    // 60 a minute is 100 milli-items a tick: 50 each way.
    expect(main.pushedTotal - m0).toBe(1000);
    expect(branch.pushedTotal - b0).toBe(1000);
    // Once the short way is full, the long one takes all of it.
    sim.run(200);
    expect(branch.content).toBe(branch.capMu);
    const m1 = main.pushedTotal;
    sim.run(20);
    expect(main.pushedTotal - m1).toBe(2000);
  });

  it('three ways: a cross shares its water in thirds, fair over three ticks', () => {
    const sim = wetSim();
    pump(sim);
    // The main line west, a branch north and one south off its second tile, each into an incinerator (it takes all).
    lay(sim, [[520, 505, 3], [519, 505, 3], [518, 505, 3]]);
    lay(sim, [[519, 504, 0], [519, 503, 0]]);
    lay(sim, [[519, 506, 2], [519, 507, 2]]);
    for (const [x, y] of [[517, 505], [519, 502], [519, 508]] as const) { grantCost(sim, 'incinerator'); expect(sim.place('incinerator', x, y, 0).ok).toBe(true); }
    sim.ensureCompiled();
    expect(sim.graph.tees.get(tileIndex(519, 505))).toBe((1 << 0) | (1 << 2));
    sim.run(60);
    const w0 = sim.consumed[WATER()]!;
    const ways = [at(sim, 518, 505), at(sim, 519, 504), at(sim, 519, 506)];
    const p0 = ways.map((c) => c.pushedTotal);
    sim.run(30);
    const got = ways.map((c, i) => c.pushedTotal - p0[i]!);
    expect(got.reduce((a, b) => a + b, 0)).toBe(3000);
    for (const g of got) expect(g).toBe(1000); // 33, 33, 34 in turn: the same over three ticks
    expect(Math.abs(sim.consumed[WATER()]! - w0 - 3000)).toBeLessThanOrEqual(3); // burnt at the far ends, a transit behind
    // The tee counts what each way took (the inspector's bars).
    const tee = at(sim, 519, 505);
    expect(tee.shared.length).toBe(3);
    expect(Math.max(...tee.shared) - Math.min(...tee.shared)).toBeLessThanOrEqual(2);
  });

  it('two lines join where one runs into the other’s side: a second pump feeds the line', () => {
    const sim = wetSim();
    pump(sim, 505);
    pump(sim, 507);
    grantCost(sim, 'incinerator');
    expect(sim.place('incinerator', 516, 505, 0).ok).toBe(true);
    lay(sim, [[520, 505, 3], [519, 505, 3], [518, 505, 3], [517, 505, 3]]);
    lay(sim, [[520, 507, 3], [519, 507, 0], [519, 506, 0]]); // into the line's side at (519, 505)
    sim.ensureCompiled();
    expect(sim.graph.tees.size).toBe(0);
    sim.run(100);
    const w0 = sim.consumed[WATER()]!;
    sim.run(50);
    expect(sim.consumed[WATER()]! - w0).toBe(50 * 200); // both pumps' water, 100 a tick each
  });

  it('the drag keeps the pipe it starts on (a tee) and the pipe it ends on (a join), only where the line goes on', () => {
    const sim = wetSim();
    pump(sim);
    lay(sim, [[520, 505, 3], [519, 505, 3], [518, 505, 3]]);
    // Off the side of (519, 505), south: the start is kept as it runs.
    const plan = sim.planBelts('conduit', [[519, 505, 2], [519, 506, 2], [519, 507, 2]]);
    expect(plan[0]).toMatchObject({ skip: true, tee: 'split', rot: 3 });
    expect(sim.placeBelts('conduit', [[519, 505, 2], [519, 506, 2], [519, 507, 2]])).toBe(2);
    expect(sim.entityAt(519, 505)!.rot).toBe(3);
    sim.ensureCompiled();
    expect(sim.graph.tees.get(tileIndex(519, 505))).toBe(1 << 2);
    // The line's last tile hands on to nothing: a drag off it turns it, as before (a bend, no stub).
    const end = sim.planBelts('conduit', [[518, 505, 2], [518, 506, 2]]);
    expect(end[0]!.tee).toBeUndefined();
    expect(end[0]!.skip).toBe(false);
    // A drag that ends on a line's side keeps that tile: the waters join.
    lay(sim, [[517, 505, 3], [516, 505, 3]]); // the line goes on past (518, 505)
    const join = sim.planBelts('conduit', [[517, 507, 0], [517, 506, 0], [517, 505, 0]]);
    expect(join[2]).toMatchObject({ skip: true, tee: 'join', rot: 3 });
    // A one-tile drag on a pipe still turns it.
    expect(sim.planBelts('conduit', [[519, 505, 2]])[0]!.skip).toBe(false);
  });

  it('a line with a bend is no tee; a base with a tee goes on alike through a save', () => {
    const sim = wetSim();
    pump(sim);
    lay(sim, [[520, 505, 3], [519, 505, 3], [518, 505, 2], [518, 506, 2]]);
    sim.ensureCompiled();
    expect(sim.graph.tees.size).toBe(0);
    lay(sim, [[520, 506, 2], [520, 507, 2]]);
    sim.run(300);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), wetSource());
    expect(back.hash()).toBe(sim.hash());
    back.ensureCompiled();
    expect([...back.graph.tees]).toEqual([[tileIndex(520, 505), 1 << 2]]);
    sim.run(600); back.run(600);
    expect(back.hash()).toBe(sim.hash());
  });
});

/**
 * One pump, a tee, a steam boiler and a brickworks (the twin's base): the pump at (521, 505) into the
 * tee (520, 505); the main line west then north into the boiler's water intake (518, 504); the branch
 * south off the tee, west and north into the brickworks' (519, 508). The boiler's coal from a silo set
 * against its coal intake; the brickworks' sand by a ribbon from a silo, its bricks into an
 * incinerator set against its outlet. A server asks the grid for more than the Core gives.
 */
function teeBase(): { sim: Sim; boiler: number; works: number } {
  const sim = wetSim();
  sim.done.add(BUILDINGS.brickworks.unlock); sim.done.add(RECIPES.brick.unlock);
  sim.rebuildDerived();
  grantCost(sim, 'steam_boiler'); grantCost(sim, 'brickworks'); grantCost(sim, 'incinerator'); grantCost(sim, 'silo', 2);
  const b = sim.place('steam_boiler', 516, 503, 0); // 516–518 × 503–504: coal in at (516, 504) S, water at (518, 504) S
  if (!b.ok) throw new Error(`boiler: ${b.reason}`);
  stockedSilo(sim, 516, 505, 0, 'coal', 3000);
  const k = sim.place('brickworks', 518, 507, 0); // 518–519 × 507–508: sand in at (518, 508) S, water at (519, 508) S, bricks out at (518, 507) N
  if (!k.ok) throw new Error(`brickworks: ${k.reason}`);
  sim.setRecipe(k.id!, 'brick');
  const inc = sim.place('incinerator', 518, 506, 0);
  if (!inc.ok) throw new Error(`incinerator: ${inc.reason}`);
  stockedSilo(sim, 516, 510, 0, 'sand', 1000); // its outlet (517, 510) into the ribbon at (517, 509)
  if (sim.placeBelts('ribbon', [[517, 509, 1], [518, 509, 0]]) !== 2) throw new Error('ribbon');
  const p = pump(sim);
  lay(sim, [[520, 505, 3], [519, 505, 3], [518, 505, 0]]);
  lay(sim, [[520, 506, 2], [520, 507, 2], [520, 508, 2], [520, 509, 3], [519, 509, 0]]);
  wire(sim, [b.id!, k.id!]);
  sim.done.add('an_servers');
  sim.rebuildDerived();
  grantCost(sim, 'server');
  const s = sim.place('server', 506, 517, 0);
  if (!s.ok) throw new Error(`server: ${s.reason}`);
  wire(sim, s.id!);
  void p;
  sim.run(1200);
  return { sim, boiler: b.id!, works: k.id! };
}

describe('a pump feeds a boiler and a brickworks through a tee (D152)', () => {
  it('both drink from the one pump', () => {
    const { sim, boiler, works } = teeBase();
    sim.ensureCompiled();
    expect(sim.graph.tees.get(tileIndex(520, 505))).toBe(1 << 2);
    const gen = sim.graph.nodeByEnt.get(boiler) as GeneratorNode;
    expect(gen.water).toBeGreaterThan(0);
    const w0 = sim.consumed[WATER()]!, b0 = sim.produced[itemIdx('brick')]!;
    sim.run(6000);
    expect(sim.produced[itemIdx('brick')]! - b0).toBeGreaterThan(100 * 1000); // ~15 bricks a minute, 30 water
    expect(sim.consumed[WATER()]! - w0).toBeGreaterThan(300 * 1000);
    expect(sim.graph.nodeByEnt.get(works)!.status).not.toBe(undefined);
  });

  it('online = offline, to the bit, over a day and a half', () => {
    const a = teeBase().sim, b = teeBase().sim;
    expect(a.hash()).toBe(b.hash());
    const w0 = a.consumed[WATER()]!;
    const N = 54 * 600;
    a.run(N);
    catchUp(b, N, { noDirect: true });
    expect(b.tick).toBe(a.tick);
    expect(b.hash()).toBe(a.hash());
    expect(b.consumed[WATER()]! - w0).toBe(a.consumed[WATER()]! - w0);
    expect(a.consumed[WATER()]! - w0).toBeGreaterThan(500 * 1000);
  });
});
