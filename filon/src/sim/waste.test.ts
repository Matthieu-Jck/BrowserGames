// waste.test.ts — the machines' waste (D125): a smelter puts out a slag every ten plates through the
// same output, in turn with its plates; the Core takes it like any item; a slag at the head of a line
// into a machine that does not take it jams the line, and a sorter sending it to an incinerator frees
// it; the catch-up matches ticking on a mixed line; a save keeps the count and the bin, and a save
// from before D125 keeps the machine's buffers with an empty bin.
import { describe, it, expect } from 'vitest';
import { itemIdx, CRECIPES } from '@/content/registry';
import { RECIPES } from '@/content/recipes';
import { grantCost, line, steadyPower, stockedSilo, testSim, testSource, wire } from './testkit';
import { catchUp } from './offline/catchup';
import { MachineNode, type MachineSnap } from './flow/nodes';
import { deserialize, serialize } from './serialize';
import { St } from './types';
import type { Sim } from './state';

const PLATE = (): number => itemIdx('iron_plate');
const SLAG = (): number => itemIdx('slag');
const SCRAP = (): number => itemIdx('scrap');
const held = (sim: Sim, item: number): number => sim.stock[item]! / 1000;
const machineAt = (sim: Sim, id: number): MachineNode => { sim.ensureCompiled(); return sim.graph.nodeByEnt.get(id) as MachineNode; };

/**
 * A smelter north of the Core on iron plates, fed by two silos (`ore` iron ore south of it, `coal`
 * coal east), its plates by ribbon west then south into the Core's north input (511, 510). Returns
 * the smelter's id.
 */
function kilnToCore(sim: Sim, ore: number, coal: number): number {
  const k = sim.place('kiln', 512, 503, 0);
  if (!k.ok) throw new Error(`kiln ${k.reason}`);
  sim.setRecipe(k.id!, 'iron_plate');
  stockedSilo(sim, 512, 507, 0, 'iron_ore', ore);
  stockedSilo(sim, 516, 505, 3, 'coal', coal);
  const n = sim.placeBelts('ribbon', line(512, 506, 0, 2)) + sim.placeBelts('ribbon', [[515, 505, 3], [514, 505, 3], [513, 505, 0]])
    + sim.placeBelts('ribbon', [[512, 502, 3], ...line(511, 502, 2, 8)]);
  if (n !== 14) throw new Error(`belts ${n}`);
  return k.id!;
}

/** The same, with a sorter on the plates line (511, 503) sending the plates on and the rest aside, into an incinerator (510, 503). */
function sortedKiln(sim: Sim, ore: number, coal: number): { kiln: number; sorter: number; pit: number } {
  const kiln = kilnToCore(sim, ore, coal);
  const s = sim.place('sorter', 511, 503, 2);
  if (!s.ok) throw new Error(`sorter ${s.reason}`);
  sim.setForkFilter(s.id!, 0, 'iron_plate');
  const p = sim.place('incinerator', 510, 503, 0);
  if (!p.ok) throw new Error(`incinerator ${p.reason}`);
  return { kiln, sorter: s.id!, pit: p.id! };
}

/**
 * A smelter's plates by ribbon west and down to a press (508, 506) turned south, whose input faces
 * the line's head (509, 505); the press's gears (and its scrap) into an incinerator under it.
 * Returns the ids.
 */
function kilnToPress(sim: Sim, ore: number, coal: number): { kiln: number; press: number } {
  const k = sim.place('kiln', 512, 503, 0);
  if (!k.ok) throw new Error(`kiln ${k.reason}`);
  sim.setRecipe(k.id!, 'iron_plate');
  stockedSilo(sim, 512, 507, 0, 'iron_ore', ore);
  stockedSilo(sim, 516, 505, 3, 'coal', coal);
  sim.placeBelts('ribbon', line(512, 506, 0, 2));
  sim.placeBelts('ribbon', [[515, 505, 3], [514, 505, 3], [513, 505, 0]]);
  const n = sim.placeBelts('ribbon', [[512, 502, 3], [511, 502, 3], [510, 502, 3], ...line(509, 502, 2, 4)]);
  if (n !== 7) throw new Error(`plate belts ${n}`);
  sim.done.add('tr1'); // the press is Mechanics' (granted outside commands, like the testkit's plans)
  sim.rebuildDerived();
  grantCost(sim, 'press');
  const p = sim.place('press', 508, 506, 2);
  if (!p.ok) throw new Error(`press ${p.reason}`);
  sim.setRecipe(p.id!, 'gear');
  wire(sim, p.id!);
  if (!sim.place('incinerator', 509, 508, 0).ok) throw new Error('incinerator');
  return { kiln: k.id!, press: p.id! };
}

/**
 * A smelter whose output port is set straight against a press's input (D39, no ribbon): the press
 * takes plates, never slag, so the smelter's first slag stays in its bin and stops it there. The
 * press's gears into an incinerator above it. Returns the ids.
 */
function kilnIntoPress(sim: Sim): { kiln: number; press: number } {
  const k = sim.place('kiln', 512, 503, 0);
  if (!k.ok) throw new Error(`kiln ${k.reason}`);
  sim.setRecipe(k.id!, 'iron_plate');
  stockedSilo(sim, 512, 507, 0, 'iron_ore', 200);
  stockedSilo(sim, 516, 505, 3, 'coal', 200);
  sim.placeBelts('ribbon', line(512, 506, 0, 2));
  sim.placeBelts('ribbon', [[515, 505, 3], [514, 505, 3], [513, 505, 0]]);
  sim.done.add('tr1');
  sim.rebuildDerived();
  grantCost(sim, 'press');
  const p = sim.place('press', 512, 501, 0);
  if (!p.ok) throw new Error(`press ${p.reason}`);
  sim.setRecipe(p.id!, 'gear');
  wire(sim, p.id!);
  if (!sim.place('incinerator', 512, 500, 0).ok) throw new Error('incinerator');
  return { kiln: k.id!, press: p.id! };
}

describe('the machines’ waste (D125)', () => {
  it('the content: metal smelting gives slag, the press scrap, glass none; recycling recipes take them', () => {
    expect(RECIPES.iron_plate.waste).toEqual(['slag', 10]);
    expect(RECIPES.copper_plate.waste[0]).toBe('slag');
    expect(RECIPES.steel.waste[0]).toBe('slag');
    expect(RECIPES.gear.waste[0]).toBe('scrap');
    expect('waste' in RECIPES.glass).toBe(false);
    const c = CRECIPES.find((r) => r.id === 'iron_plate')!;
    expect(c.waste).toEqual({ item: SLAG(), every: 10 });
    expect(RECIPES.slag_brick.ins.some(([i]) => i === 'slag')).toBe(true);
    expect(RECIPES.steel_scrap.ins.some(([i]) => i === 'scrap')).toBe(true);
  });

  it('a smelter puts out a slag every ten plates through its plates’ output; the Core takes it like any item', () => {
    const sim = testSim();
    kilnToCore(sim, 100, 100);
    const slag0 = sim.produced[SLAG()]!, plates0 = held(sim, PLATE()), held0 = held(sim, SLAG());
    sim.run(12_000); // 100 plates at 10 a minute, and the line's way
    expect(held(sim, PLATE()) - plates0).toBe(100);
    expect(held(sim, SLAG()) - held0).toBe(10);
    expect((sim.produced[SLAG()]! - slag0) / 1000).toBe(10);
  });

  it('nothing vanishes: what the base holds of slag is what was made (the bin and the ribbons counted)', () => {
    const sim = testSim();
    kilnToCore(sim, 40, 40);
    for (let k = 0; k < 30; k++) {
      sim.run(97);
      expect(sim.totalHeld(SLAG())).toBe(sim.produced[SLAG()]! - sim.consumed[SLAG()]!);
    }
  });

  it('a slag at the head of a line into a press jams it; a sorter to an incinerator frees it', () => {
    const sim = testSim();
    const { kiln, press } = kilnToPress(sim, 200, 200);
    sim.run(6000); // ten minutes: the first slag (the 10th craft) reached the press and stuck there
    const k = machineAt(sim, kiln), p = machineAt(sim, press);
    expect(k.status).toBe(St.Blocked);
    expect(p.status).toBe(St.Starved);
    const gears = sim.produced[itemIdx('gear')]!;
    expect(gears / 1000).toBeLessThan(6); // the plates before the slag only
    sim.run(1200);
    expect(sim.produced[itemIdx('gear')]).toBe(gears); // still jammed
    // A sorter at the line's head: plates straight on into the press, the rest aside into a pit.
    const s = sim.place('sorter', 509, 505, 2);
    expect(s.ok).toBe(true);
    sim.setForkFilter(s.id!, 0, 'iron_plate');
    expect(sim.place('incinerator', 508, 505, 0).ok).toBe(true);
    const burnt0 = sim.consumed[SLAG()]!;
    sim.run(6000);
    expect(sim.produced[itemIdx('gear')]! - gears).toBeGreaterThan(20 * 1000);
    expect(sim.consumed[SLAG()]! - burnt0).toBeGreaterThanOrEqual(5 * 1000);
    expect(machineAt(sim, kiln).status).not.toBe(St.Blocked);
    // The press's own waste: scrap, burnt with its gears in the pit under it.
    expect(sim.produced[SCRAP()]!).toBeGreaterThan(0);
  });

  it('a slag its output cannot hand on stays in its bin and stops it there (Blocked, the bin named)', () => {
    const sim = testSim();
    const { kiln, press } = kilnIntoPress(sim);
    sim.run(6000);
    const k = machineAt(sim, kiln);
    expect(k.status).toBe(St.Blocked);
    expect(k.wBuf).toBe(1000);
    expect(k.wItem).toBe(SLAG());
    expect(k.outBuf[0]).toBe(3000); // its plates wait behind the slag
    expect(machineAt(sim, press).status).toBe(St.Starved);
  });

  it('offline as online: a mixed line sorted into a pit and the Core (2 h, the silos running dry)', () => {
    const make = (): Sim => { const s = testSim(); sortedKiln(s, 800, 900); s.run(50); return s; };
    const a = make(), b = make();
    a.run(72_000);
    const rep = catchUp(b, 72_000, { noDirect: true });
    expect(rep.mode).toBe('exact'); // the waste's count keeps the line's period within the warm-up
    expect(b.tick).toBe(a.tick);
    expect(b.consumed[SLAG()]).toBe(a.consumed[SLAG()]);
    expect(b.stock[PLATE()]).toBe(a.stock[PLATE()]);
    expect(b.stock[SLAG()]).toBe(0);
    expect(a.consumed[SLAG()]! / 1000).toBe(80);
    expect(b.hash()).toBe(a.hash());
  });

  it('offline as online: a smelter, its sorter and a press on steady power (1 h)', () => {
    const make = (): Sim => {
      const s = testSim();
      steadyPower(s);
      kilnToPress(s, 2000, 2000);
      const so = s.place('sorter', 509, 505, 2);
      s.setForkFilter(so.id!, 0, 'iron_plate');
      s.place('incinerator', 508, 505, 0);
      s.run(50);
      return s;
    };
    const a = make(), b = make();
    a.run(36_000);
    const rep = catchUp(b, 36_000, { noDirect: true });
    expect(b.produced[itemIdx('gear')]).toBe(a.produced[itemIdx('gear')]);
    expect(b.consumed[SLAG()]).toBe(a.consumed[SLAG()]);
    expect(b.hash()).toBe(a.hash());
    expect(rep.mode).toBe('exact'); // a scrap every two gears: the press's line still repeats in three minutes
    expect(rep.warmups).toBeLessThan(40);
  });

  it('a save keeps the waste count and the bin mid-cycle; the copy runs on as the original', () => {
    const sim = testSim();
    const { kiln } = kilnIntoPress(sim);
    sim.run(6000);
    const k = machineAt(sim, kiln);
    expect(k.wBuf).toBeGreaterThan(0);
    const copy = deserialize(serialize(sim), testSource());
    const kc = machineAt(copy, kiln);
    expect([kc.wc, kc.wBuf, kc.wItem]).toEqual([k.wc, k.wBuf, k.wItem]);
    expect(copy.hash()).toBe(sim.hash());
    sim.run(600); copy.run(600);
    expect(copy.hash()).toBe(sim.hash());
  });

  it('a save from before D125 restores a smelter’s buffers as they were, its bin empty and its count fresh', () => {
    const sim = testSim();
    const kiln = kilnToCore(sim, 100, 100);
    sim.run(500);
    const save = serialize(sim);
    // An old save's machine state: no waste fields.
    save.nodes = save.nodes.map(([ent, s]) => {
      if (ent !== kiln) return [ent, s];
      const { wc: _wc, wBuf: _wb, wItem: _wi, ...old } = s as MachineSnap;
      return [ent, old];
    });
    const before = machineAt(sim, kiln);
    const copy = deserialize(save, testSource());
    const k = machineAt(copy, kiln);
    expect([...k.inBuf]).toEqual([...before.inBuf]);
    expect([...k.outBuf]).toEqual([...before.outBuf]);
    expect(k.p).toBe(before.p);
    expect([k.wc, k.wBuf]).toEqual([0, 0]);
    copy.run(6000);
    expect(copy.stock[SLAG()]!).toBeGreaterThan(0);
  });

  it('taking a machine down refunds its waste bin to the Core', () => {
    const sim = testSim();
    const { kiln } = kilnIntoPress(sim);
    sim.run(6000);
    const k = machineAt(sim, kiln);
    const bin = k.wBuf;
    expect(bin).toBeGreaterThan(0);
    const slag0 = sim.stock[SLAG()]!;
    expect(sim.remove(512, 503)).toBeTruthy();
    expect(sim.stock[SLAG()]! - slag0).toBe(bin);
  });
});
