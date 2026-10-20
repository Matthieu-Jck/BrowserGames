// bridge-pairs.test.ts — skybridge ends go in pairs, in order along their line (D160; owner,
// 2026-10-20: « if you put three or more bridges in a row, it makes something weird. bridge blocs
// should go in pair »): three ends in a row make a pair and a lone end, four two pairs; the drag
// planner lays pairs only, chained bridge after bridge; a line over two pairs keeps its pace (D121);
// an old save whose middle end leapt on to a third loads with nothing lost; offline as online.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { WORLD_EPOCH0 } from './constants';
import { isSpanTile } from './flow/chain';
import { catchUp } from './offline/catchup';
import { deserialize, serialize, type SaveData } from './serialize';
import { Sim } from './state';
import { learnPlans, line, stockedSilo, testSim, testSource } from './testkit';
import { T } from './types';
import { FlatSource, tileIndex } from './world/grid';

/** The compiled leaps between the bridges at these x on row y, as [from x, to x]. */
const leaps = (sim: Sim, y: number): Array<[number, number]> => {
  sim.ensureCompiled();
  return [...sim.graph.jumps].filter(([t]) => Math.floor(t / 1024) === y).map(([t, g]) => [t % 1024, g % 1024] as [number, number]).sort((a, b) => a[0] - b[0]);
};

describe('skybridge ends go in pairs (D160)', () => {
  it('in order along their line: three in a row a pair and a lone end, four two pairs, five two pairs and a lone end', () => {
    const sim = testSim();
    sim.grant('iron_plate', 50);
    const xs = [520, 522, 524, 526, 528];
    for (const [n, want] of [[3, [[520, 522]]], [4, [[520, 522], [524, 526]]], [5, [[520, 522], [524, 526]]]] as const) {
      const s = testSim();
      s.grant('iron_plate', 50);
      for (const x of xs.slice(0, n)) expect(s.place('skybridge', x, 530, 1).ok).toBe(true);
      expect(leaps(s, 530)).toEqual(want);
    }
    // Beyond reach (4 tiles) no pair: each end alone.
    expect(sim.place('skybridge', 520, 530, 1).ok).toBe(true);
    expect(sim.place('skybridge', 525, 530, 1).ok).toBe(true);
    expect(leaps(sim, 530)).toEqual([]);
  });

  it('the drag planner lays pairs only: two obstacles a tile apart take two pairs chained; behind a lone start it lays none', () => {
    const ponds = (): Sim => {
      const sim = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24, source: new FlatSource([], [{ x: 523, y: 526, w: 2, h: 5, t: T.Shallow }, { x: 527, y: 526, w: 2, h: 5, t: T.Shallow }]) });
      learnPlans(sim);
      sim.grant('iron_plate', 100);
      return sim;
    };
    const drag = line(520, 528, 1, 12); // x 520–531
    const sim = ponds();
    expect(sim.planBelts('ribbon', drag).map((s) => (s.leapt ? 'leapt' : s.ok ? s.def : s.reason)).slice(2, 10))
      .toEqual(['skybridge', 'leapt', 'leapt', 'skybridge', 'skybridge', 'leapt', 'leapt', 'skybridge']);
    expect(sim.placeBelts('ribbon', drag)).toBe(8);
    expect(leaps(sim, 528)).toEqual([[522, 525], [526, 529]]);
    // A lone start just behind: the first pond's start would be its far end — no leap there.
    const lone = ponds();
    expect(lone.place('skybridge', 519, 528, 1).ok).toBe(true);
    const plan = lone.planBelts('ribbon', line(520, 528, 1, 12)).map((s) => (s.leapt ? 'leapt' : s.ok ? s.def : s.reason));
    expect(plan.slice(2, 6)).toEqual(['ribbon', 'terrain', 'terrain', 'ribbon']);
  });
});

/** A line north from a silo of iron ore over two pairs in a row (516→513, 512→509), into an incinerator at (500, 506). */
function twoPairs(): Sim {
  const sim = testSim();
  sim.grant('iron_plate', 50);
  stockedSilo(sim, 500, 520, 0, 'iron_ore', 1000); // out at (500, 519)
  expect(sim.placeBelts('ribbon', line(500, 519, 0, 3))).toBe(3); // 519–517
  for (const y of [516, 513, 512, 509]) expect(sim.place('skybridge', 500, y, 0).ok).toBe(true);
  expect(sim.placeBelts('ribbon', line(500, 508, 0, 2))).toBe(2); // 508, 507
  expect(sim.place('incinerator', 500, 506, 0).ok).toBe(true);
  return sim;
}
const ore = (sim: Sim): number => sim.consumed[itemIdx('iron_ore')]! / 1000;

describe('a line over two pairs in a row (D160, D121)', () => {
  it('one chain, a cell over each tile of both gaps; an item a step, 60 a minute', () => {
    const sim = twoPairs();
    sim.ensureCompiled();
    const c = sim.chainAt(500, 519)!;
    expect(c).toBe(sim.chainAt(500, 507));
    expect(c.tiles.length).toBe(13); // 9 world tiles, 4 cells over the gaps
    expect(Array.from(c.tiles).filter(isSpanTile)).toHaveLength(4);
    expect(sim.graph.jumps.get(tileIndex(500, 516))).toBe(tileIndex(500, 513));
    expect(sim.graph.jumps.get(tileIndex(500, 512))).toBe(tileIndex(500, 509));
    expect(sim.graph.jumps.has(tileIndex(500, 513))).toBe(false); // the first pair's far end hands on as a ribbon
    let first = -1;
    for (let k = 0; k < 400 && first < 0; k++) { sim.step(); if (ore(sim) > 0) first = sim.tick; }
    expect(first).toBeGreaterThanOrEqual(120);
    const o0 = ore(sim);
    sim.run(6000);
    expect(ore(sim) - o0).toBeGreaterThanOrEqual(598);
  });

  it('offline as online, bit for bit', () => {
    const a = twoPairs(), b = twoPairs();
    for (const sim of [a, b]) sim.run(600);
    a.run(12_000);
    catchUp(b, 12_000, { noDirect: true });
    expect(ore(b)).toBe(ore(a));
    expect(b.hash()).toBe(a.hash());
  });
});

describe('a save from before D160 (three ends in a row)', () => {
  it('loads with nothing lost: the old line over two leaps gives its items to the Heart, the middle end is the first pair’s far end', () => {
    // Three ends 3 apart: before D160 the middle one leapt on to the third (two leaps in a row).
    const sim = testSim();
    sim.grant('iron_plate', 50);
    stockedSilo(sim, 500, 520, 0, 'iron_ore', 1000);
    expect(sim.placeBelts('ribbon', line(500, 519, 0, 3))).toBe(3);
    for (const y of [516, 513, 510]) expect(sim.place('skybridge', 500, y, 0).ok).toBe(true);
    expect(sim.placeBelts('ribbon', line(500, 509, 0, 2))).toBe(2);
    expect(sim.place('incinerator', 500, 507, 0).ok).toBe(true);
    sim.ensureCompiled();
    expect(sim.graph.jumps.get(tileIndex(500, 516))).toBe(tileIndex(500, 513));
    expect(sim.graph.jumps.has(tileIndex(500, 513))).toBe(false);
    // The save as a build from before wrote it: the line one chain over both leaps (519 → 508, 15
    // cells), full of ore. Nothing compiles to it now: its 15 items go to the Heart, none lost.
    const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
    const tier = d.chains[0]!.tier;
    d.chains = [{ tier, head: tileIndex(500, 508), len: 15, cells: Array.from({ length: 15 }, () => itemIdx('iron_ore') + 1) }];
    const stock = d.stock[itemIdx('iron_ore')]!;
    const back = deserialize(d, testSource());
    expect(back.stock[itemIdx('iron_ore')]! - stock).toBe(15_000);
    expect(back.ents.size).toBe(sim.ents.size); // nothing taken down
    // It runs: the ore climbs over the first pair and waits at its far end (nothing past it to hand on to).
    back.run(3000);
    expect(back.chainAt(500, 513)!.cells.some((v) => v > 0)).toBe(true);
  });
});
