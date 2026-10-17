import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { buildingIdx, costOf, itemIdx, N_ITEMS } from '@/content/registry';
import { testSim, drillToHearth, line, wire, stockedSilo, IRON, COPPER } from '../testkit';
import { runPhases } from './step';
import { St } from '../types';
import type { Sim } from '../state';

const held = (sim: Sim): number[] => Array.from({ length: N_ITEMS }, (_, i) => sim.totalHeld(i));

describe('flow engine', () => {
  it('a drill delivers its capped rate to the Hearth through a ribbon', () => {
    const sim = testSim();
    drillToHearth(sim);
    const before = sim.stock[IRON()]!;
    sim.run(600 * 10);
    const got = (sim.stock[IRON()]! - before) / 1000;
    // 20/min for 10 min, minus what is still on the ribbon / in the drill buffer.
    expect(got).toBeGreaterThan(195);
    expect(got).toBeLessThanOrEqual(200);
    expect(sim.produced[IRON()]! / 1000).toBeCloseTo(200, 0);
  });

  it('the Heart’s intake counts what its ports take in, never what commands spend (the HUD’s rates)', () => {
    const sim = testSim();
    drillToHearth(sim);
    const ore = IRON(), s0 = sim.stock[ore]!;
    sim.run(1200);
    expect(sim.hearthIn[ore]!).toBeGreaterThan(30000);
    expect(sim.hearthIn[ore]!).toBe(sim.stock[ore]! - s0); // nothing else came in, nothing went out
    // A building paid from the Heart lowers its stock, not its intake; taking it down refunds, not counted either.
    const cost = costOf(buildingIdx('silo'));
    expect(cost.length).toBeGreaterThan(0);
    const before = sim.hearthIn.slice();
    const r = sim.place('silo', 504, 520, 0);
    expect(r.ok, r.reason).toBe(true);
    expect(sim.remove(504, 520)).toBe(true);
    for (const c of cost) expect(sim.hearthIn[c.item]).toBe(before[c.item]);
  });

  it('conserves items exactly: Δheld = produced − consumed', () => {
    const sim = testSim();
    drillToHearth(sim);
    sim.ensureCompiled();
    const h0 = held(sim);
    const p0 = [...sim.produced], c0 = [...sim.consumed];
    sim.run(3000);
    const h1 = held(sim);
    for (let i = 0; i < N_ITEMS; i++) {
      expect(h1[i]! - h0[i]!, `item ${i}`).toBe((sim.produced[i]! - p0[i]!) - (sim.consumed[i]! - c0[i]!));
    }
  });

  it('an item arrives whole, the ribbon transit time after its last part left the drill', () => {
    const sim = testSim();
    drillToHearth(sim);
    sim.ensureCompiled();
    const chain = sim.chainAt(511, 509)!;
    expect(chain.length).toBe(7);
    let firstArrival = -1;
    const start = sim.stock[IRON()]!;
    for (let t = 0; t < 400 && firstArrival < 0; t++) {
      sim.step();
      if (sim.stock[IRON()]! > start) firstArrival = sim.tick;
    }
    // The drill makes one item in 30 ticks (20/min); the item then rides the 7 tiles one a step (a
    // ribbon steps every 10 ticks on the world's beat, D57): onto the first tile, 6 steps to the
    // head, a 7th into the Hearth, after waiting at most one beat for the first.
    expect(chain.stepTicks).toBe(10);
    expect(firstArrival).toBeGreaterThanOrEqual(30 + 6 * 10);
    expect(firstArrival).toBeLessThanOrEqual(30 + 8 * 10 + 2);
    // And it lands whole: the Hearth counts one more item, not a slice of one.
    expect(sim.stock[IRON()]! - start).toBe(1000);
  });

  it('a dead-end ribbon fills to capacity, then the drill stops (backpressure)', () => {
    const sim = testSim();
    wire(sim, sim.place('drill', 511, 502, 2).id!);
    sim.placeBelts('ribbon', [[512, 504, 3], ...line(511, 504, 2, 3)]); // ends in the air at (511,507)
    sim.run(600 * 30);
    const chain = sim.chainAt(511, 506)!;
    const full = 4 * BAL.beltDensity; // 4 tiles, one item per square
    expect(chain.content).toBe(full * 1000);
    // The full ribbon + 5 in the drill buffer, and nothing more was ever produced.
    expect(sim.produced[IRON()]).toBe((full + BAL.drillBufItems) * 1000);
    const drill = sim.graph.nodeByEnt.get(sim.entityAt(511, 502)!.id)!;
    expect(drill.status).toBe(St.Blocked);
  });

  it('a mixed ribbon whose head item is refused blocks everything behind it', () => {
    const sim = testSim();
    // Copper drill and iron drill side-load one ribbon that ends in a wire mill (copper only).
    const copper = sim.place('drill', 511, 522, 0); // on copper, output N at (511,521)
    expect(copper.ok).toBe(true);
    const mill = sim.place('wire_mill', 511, 516, 0); // 1×2 at (511,516..517), input S at (511,517) facing (511,518)
    expect(mill.ok).toBe(true);
    sim.setRecipe(mill.id!, 'copper_wire');
    wire(sim, [copper.id!, mill.id!]);
    sim.placeBelts('ribbon', line(511, 521, 0, 4)); // (511,521)->(511,518) moving N into the mill input
    sim.placeBelts('ribbon', [[511, 515, 0]]);       // mill output → Hearth south input (511,514)
    sim.run(600 * 3);
    const wireAfterChime = sim.produced[itemIdx('copper_wire')]!;
    expect(wireAfterChime).toBeGreaterThan(0);
    // Now push iron onto the line from the side: a silo of iron facing west at (513..514,
    // 519..520) hands it out through (513,519) onto one ribbon square that side-loads (511,519).
    stockedSilo(sim, 513, 519, 3, 'iron_ore', 10);
    sim.placeBelts('ribbon', [[512, 519, 3]]);
    sim.run(600 * 3);
    const wire1 = sim.produced[itemIdx('copper_wire')]!;
    sim.run(600 * 5);
    // Once an iron reached the head the line is frozen: no more wire, no more copper mined.
    expect(sim.produced[itemIdx('copper_wire')]).toBe(wire1);
    const jam = sim.chainAt(511, 519)!;
    expect(jam.itemAt(jam.length - 1)).toBe(IRON()); // the iron stands at the head, refused
    expect(sim.produced[COPPER()]! / 1000).toBeLessThan(3 * 20 + 3 * 20);
  });

  it('with no power a drill produces nothing; a wire from a mast on the Hearth grid fixes it', () => {
    const sim = testSim([{ x: 552, y: 504, w: 2, h: 2, item: IRON(), rich: 500 }]);
    expect(sim.place('drill', 552, 504, 0).reason).toBe('outside_zone'); // just past the starting square
    // On the claim's land, beyond the Hearth's 8-tile reach, and wired to nothing.
    const d = sim.place('drill', 516, 498, 0);
    expect(d.ok).toBe(true);
    sim.run(600);
    const node = sim.graph.nodeByEnt.get(d.id!)!;
    expect(node.net).toBe(-1);
    expect(node.status).toBe(St.Unpowered);
    expect(sim.produced[IRON()]).toBe(0);
    // Two poles chain the Hearth's grid towards it (each new mast wires itself to the nearest
    // pillar or Hearth); nothing reaches the drill by proximity: it still needs its own wire.
    const m1 = sim.place('mast', 512, 507, 0), m2 = sim.place('mast', 515, 502, 0);
    expect(sim.linksOf(m1.id!)).toEqual([sim.hearthId, m2.id!]);
    sim.run(600);
    expect(sim.graph.nodeByEnt.get(d.id!)!.net).toBe(-1);
    expect(sim.produced[IRON()]).toBe(0);
    wire(sim, d.id!, m2.id!);
    sim.run(600);
    expect(sim.graph.nodeByEnt.get(d.id!)!.net).toBe(0);
    // Its output is not connected: it fills its 5-item buffer and stops.
    expect(sim.produced[IRON()]).toBe(5000);
    expect(sim.graph.nodeByEnt.get(d.id!)!.status).toBe(St.Blocked);
  });

  it('runs the same whatever order the nodes are processed in', () => {
    const a = testSim(), b = testSim();
    for (const s of [a, b]) { drillToHearth(s); s.place('drill', 513, 498, 0); s.ensureCompiled(); }
    // Step b with a reversed node list: every phase reads start-of-tick state only.
    for (let t = 0; t < 1500; t++) {
      a.step();
      b.ensureCompiled();
      b.ctx.now = b.tick;
      b.powerTick();
      runPhases(b.graph, [...b.graph.nodes].reverse(), b.ctx);
      b.tick++;
      if (b.tick % 600 === 0) { b.tradeEpoch(); b.expertiseEpoch((n) => b.ctx.sat[n] ?? 0); } // the epoch boundary of Sim.step (D93: the expertises' minute)
    }
    expect(b.hash()).toBe(a.hash());
  });

  it('is deterministic: the same commands give the same state hash', () => {
    const mk = (): string => { const s = testSim(); drillToHearth(s); s.run(2000); return s.hash(); };
    expect(mk()).toBe(mk());
  });

  it('a fork splits evenly and never starves an unblocked output', () => {
    const sim = testSim();
    wire(sim, sim.place('drill', 511, 502, 2).id!);
    // ribbon (512,504) W → fork at (511,504); outputs: west (510,504) and south (511,505).
    sim.placeBelts('ribbon', [[512, 504, 3]]);
    expect(sim.place('router', 511, 504, 3).ok).toBe(true); // facing west: in at its back (east)
    sim.placeBelts('ribbon', line(510, 504, 3, 12)); // a 12-tile dead end: room for 12 items
    sim.placeBelts('ribbon', line(511, 505, 2, 5)); // into the Hearth north input (511,510)
    sim.run(300);
    const west = sim.chainAt(509, 504)!, south = sim.chainAt(511, 507)!;
    // Half a minute in (west not full yet): an even split.
    expect(Math.abs(west.pushedTotal - south.pushedTotal)).toBeLessThanOrEqual(1000);
    // The west branch is a dead end: once full, everything goes south.
    sim.run(600 * 6);
    expect(west.content).toBe(west.capMu);
    const southRate = south.pushedTotal;
    sim.run(600);
    expect((south.pushedTotal - southRate) / 1000).toBeGreaterThanOrEqual(19);
  });
});

describe('recompiling ribbons', () => {
  it('a re-laid chain with the same ends and middle keeps exactly its items (none duplicated)', () => {
    const sim = testSim();
    const ORE = itemIdx('iron_ore');
    // Chain A: (504,516) → E → S → S → E → head (506,518); tiles[2] = (505,517).
    expect(sim.placeBelts('ribbon', [[504, 516, 1], [505, 516, 2], [505, 517, 2], [505, 518, 1], [506, 518, 1]])).toBe(5);
    sim.ensureCompiled();
    const a = sim.chainAt(505, 517)!;
    // Two runs (two items): packed at the head, the second sits on (505,518), a tile B drops.
    for (let k = 0; k < 4; k++) a.push(ORE, 1000, sim.tick + a.transit);
    for (let k = 0; k < 3; k++) a.push(COPPER(), 1000, sim.tick + a.transit);
    sim.run(80);
    const before = sim.totalHeld(ORE) + sim.totalHeld(COPPER());
    // Chain B, laid in one go: same tail, middle and head, other path: (504,516) S → E → E → S.
    expect(sim.remove(505, 516)).toBe(true);
    expect(sim.remove(505, 518)).toBe(true);
    sim.placeBelts('ribbon', [[504, 516, 2], [504, 517, 1], [505, 517, 1], [506, 517, 2], [506, 518, 1]]);
    sim.ensureCompiled();
    expect(sim.chainAt(504, 517)).toBe(sim.chainAt(506, 518));
    expect(sim.totalHeld(ORE) + sim.totalHeld(COPPER())).toBe(before);
  });
});
