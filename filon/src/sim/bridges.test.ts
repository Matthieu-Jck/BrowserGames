import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { testSim, testSource, line, stockedSilo } from './testkit';
import { catchUp } from './offline/catchup';
import { isSpanTile } from './flow/chain';
import { deserialize, serialize } from './serialize';
import type { Sim } from './state';

/**
 * A silo of sand handing out north into a swift ribbon (120/min) that ends in an incinerator at
 * (500, 510); `bridged`: the middle of the line is a pair of bridges leaping two tiles.
 */
function swiftLine(bridged: boolean): Sim {
  const sim = testSim();
  sim.done.add('xp_swift'); // swift ribbons (a research): granted outside the commands, as steadyPower's
  sim.rebuildDerived();
  sim.grant('gear', 50); // their cost
  stockedSilo(sim, 500, 520, 0, 'sand', 1000);
  if (bridged) {
    expect(sim.placeBelts('swift_ribbon', line(500, 519, 0, 3))).toBe(3);
    expect(sim.place('skybridge', 500, 516, 0).ok).toBe(true);
    expect(sim.place('skybridge', 500, 513, 0).ok).toBe(true);
    expect(sim.placeBelts('swift_ribbon', line(500, 512, 0, 2))).toBe(2);
  } else {
    expect(sim.placeBelts('swift_ribbon', line(500, 519, 0, 9))).toBe(9);
  }
  expect(sim.place('incinerator', 500, 510, 0).ok).toBe(true);
  return sim;
}

const burnt = (sim: Sim): number => sim.consumed[itemIdx('sand')]! / 1000;

describe('bridges go at the pace of their line (owner, 2026-10-13)', () => {
  it('a swift line through a pair of bridges carries as much as a plain swift line', () => {
    const plain = swiftLine(false), bridged = swiftLine(true);
    for (const sim of [plain, bridged]) sim.run(600); // the line fills
    const p0 = burnt(plain), b0 = burnt(bridged);
    plain.run(3000); bridged.run(3000); // five minutes: 600 items at 120/min
    const p = burnt(plain) - p0, b = burnt(bridged) - b0;
    expect(p).toBeGreaterThanOrEqual(590);
    expect(Math.abs(b - p)).toBeLessThanOrEqual(2);
  });

  it('the bridges ride in the swift line itself, at its speed', () => {
    const sim = swiftLine(true);
    sim.ensureCompiled();
    const c = sim.chainAt(500, 516);
    expect(c).toBe(sim.chainAt(500, 519));
    expect(c?.ticksPerTile).toBe(4); // the swift ribbon's, not a basic ribbon's 6
  });

  it('offline as online', () => {
    const a = swiftLine(true), b = swiftLine(true);
    for (const sim of [a, b]) sim.run(600);
    a.run(6000);
    catchUp(b, 6000, { noDirect: true });
    expect(burnt(b)).toBe(burnt(a));
    expect(b.hash()).toBe(a.hash());
  });

  it('a bridge is entered from straight behind only: a line at its side stops there (owner, 2026-10-13)', () => {
    const run = (side: boolean): number => {
      const sim = testSim();
      stockedSilo(sim, 500, 520, 0, 'sand', 200);
      // The bridges face north; the feed comes up from behind, or turns in from the west side.
      if (side) {
        expect(sim.placeBelts('ribbon', [[500, 519, 0], [500, 518, 3], [499, 518, 0], [499, 517, 1]])).toBe(4);
        expect(sim.place('skybridge', 500, 517, 0).ok).toBe(true);
      } else {
        expect(sim.placeBelts('ribbon', line(500, 519, 0, 2))).toBe(2);
        expect(sim.place('skybridge', 500, 517, 0).ok).toBe(true);
      }
      expect(sim.place('skybridge', 500, 514, 0).ok).toBe(true);
      expect(sim.place('incinerator', 500, 513, 0).ok).toBe(true);
      sim.run(3000);
      return burnt(sim);
    };
    expect(run(false)).toBeGreaterThan(20);
    expect(run(true)).toBe(0);
  });
});

/**
 * A plain ribbon north from a silo of iron ore: 3 ribbons, a skybridge pair over a 3-tile gap, 2
 * ribbons, a junction (the line rides over it), 2 ribbons, an incinerator.
 */
function leapLine(end = true): Sim {
  const sim = testSim();
  stockedSilo(sim, 500, 520, 0, 'iron_ore', 1000); // out at (500, 519)
  expect(sim.placeBelts('ribbon', line(500, 519, 0, 3))).toBe(3); // 519…517
  expect(sim.place('skybridge', 500, 516, 0).ok).toBe(true);
  expect(sim.place('skybridge', 500, 512, 0).ok).toBe(true); // the gap: 515…513
  expect(sim.placeBelts('ribbon', line(500, 511, 0, 2))).toBe(2); // 511, 510
  expect(sim.place('crossing', 500, 509, 0).ok).toBe(true);
  expect(sim.placeBelts('ribbon', line(500, 508, 0, 2))).toBe(2); // 508, 507
  if (end) expect(sim.place('incinerator', 500, 506, 0).ok).toBe(true);
  return sim;
}

const ore = (sim: Sim): number => sim.consumed[itemIdx('iron_ore')]! / 1000;
/** Items on the line's cells over its leaps (the skybridge's gap, the junction). */
const overLeaps = (sim: Sim): number => {
  let n = 0;
  for (const c of sim.graph.chains) c.tiles.forEach((t, i) => { if (isSpanTile(t) && c.cells[i]) n++; });
  return n;
};

describe('a leap takes its length in time (D121, owner, 2026-10-17: « la vitesse sur le bridge, la junction, est plus rapide »)', () => {
  it('the line has a cell over each tile it passes over: three over the gap, one over the junction', () => {
    const sim = leapLine();
    sim.ensureCompiled();
    const c = sim.chainAt(500, 519)!;
    expect(c).toBe(sim.chainAt(500, 507));
    expect(c.tiles.length).toBe(3 + 2 + 3 + 2 + 1 + 2); // the 9 world tiles and the 4 cells over the leaps
    expect(Array.from(c.tiles).filter(isSpanTile)).toHaveLength(4);
    expect(c.lastTile).toBe(c.tiles[c.tiles.length - 1]);
  });

  it('an item crosses the gap and the junction a tile a step, and the line still carries one item a step', () => {
    const sim = leapLine();
    sim.run(3); // the first item comes out
    let first = -1;
    for (let k = 0; k < 400 && first < 0; k++) { sim.step(); if (ore(sim) > 0) first = sim.tick; }
    // 14 cells at a step (10 ticks) each, give or take the steps' phase: the leaps no longer cost one step each.
    expect(first).toBeGreaterThanOrEqual(130);
    const c0 = ore(sim);
    sim.run(6000); // ten minutes at 60/min
    expect(ore(sim) - c0).toBeGreaterThanOrEqual(598);
    expect(overLeaps(sim)).toBe(4); // a full line: an item over each
  });

  it('offline as online through the leaps', () => {
    const a = leapLine(), b = leapLine();
    for (const sim of [a, b]) sim.run(600);
    a.run(36_000);
    catchUp(b, 36_000, { noDirect: true });
    expect(ore(b)).toBe(ore(a));
    expect(b.hash()).toBe(a.hash());
  });

  it('a blocked line waits over its leaps too, a full cell over each tile of the gap and the junction, online and offline (owner: « les objets devraient pouvoir patienter sur le pont »)', () => {
    const a = leapLine(false), b = leapLine(false); // no incinerator: the line ends at (500, 507)
    for (const sim of [a, b]) sim.run(100); // a few items out, the line filling
    a.run(36_000);
    catchUp(b, 36_000, { noDirect: true });
    for (const sim of [a, b]) {
      const c = sim.chainAt(500, 519)!;
      expect(c.cells.length).toBe(13); // 9 world tiles and the 4 cells over the leaps
      expect(c.cells.every((v) => v > 0)).toBe(true); // the line backed up to the silo, the leaps full too
      expect(overLeaps(sim)).toBe(4);
    }
    expect(b.hash()).toBe(a.hash());
    // Unblocked, it starts again: the items that waited over the leaps go on.
    for (const sim of [a, b]) {
      expect(sim.place('incinerator', 500, 506, 0).ok).toBe(true);
      sim.run(600);
      expect(ore(sim)).toBeGreaterThanOrEqual(55);
    }
    expect(b.hash()).toBe(a.hash());
  });

  it('a save keeps the items over the leaps; a save from before D121 puts its items back on their tiles', () => {
    const sim = leapLine();
    sim.run(900);
    const onLine = (s: Sim): number => s.graph.chains.reduce((n, c) => n + c.cells.reduce((k, v) => k + (v ? 1 : 0), 0), 0);
    const stock = sim.stock[itemIdx('iron_ore')]!;
    expect(overLeaps(sim)).toBe(4);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    expect(back.hash()).toBe(sim.hash());
    expect(overLeaps(back)).toBe(4);
    // The same save as an older version wrote it: no cells over the leaps, the line's length and
    // head its world tiles'. Its items go back on those tiles, none to the Heart, the leaps empty.
    const old = JSON.parse(JSON.stringify(serialize(sim)));
    let world = 0;
    for (const sc of old.chains) {
      const c = sim.graph.chains.find((x) => x.tier === sc.tier && x.tiles[x.tiles.length - 1] === sc.head && x.tiles.length === sc.len)!;
      if (c.fluid || !Array.from(c.tiles).some(isSpanTile)) continue;
      sc.cells = sc.cells.filter((_: number, i: number) => !isSpanTile(c.tiles[i]!));
      sc.head = c.lastTile;
      sc.len = sc.cells.length;
      world += sc.cells.filter((v: number) => v > 0).length;
    }
    expect(world).toBeGreaterThan(5);
    const legacy = deserialize(old, testSource());
    expect(onLine(legacy)).toBe(onLine(sim) - 4);
    expect(overLeaps(legacy)).toBe(0);
    expect(legacy.stock[itemIdx('iron_ore')]!).toBe(stock);
  });
});

