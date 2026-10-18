// waste.test.ts — the machines' waste (D125, D139). Only the steel line leaves any (D139: the
// smelters and the press on gears melt and stamp clean): the steel mill a slag every five steels, the
// press a scrap every five pipe crafts, through the same output as their product, in turn with it.
// The Core takes none in (D139): a line carrying steel and slag into it jams at the first slag, and so
// does a routing block or a machine set against it; a sorter laid over the jammed tile takes the slag
// in, and with an incinerator on its side the line runs. A slag at the head of a line into a machine
// that does not take it jams that line likewise. The catch-up matches ticking on a mixed line, sorted
// or jammed at the Core; a save keeps the count and the bin, and a save from before D125 keeps the
// machine's buffers with an empty bin; a removal's refund still goes home.
import { describe, it, expect } from 'vitest';
import { CORE_TAKES, ITEM_IDS, N_ITEMS, itemDef, itemIdx, CRECIPES } from '@/content/registry';
import { RECIPES } from '@/content/recipes';
import { grantCost, line, steadyPower, stockedSilo, testSim, testSource, wire } from './testkit';
import { catchUp } from './offline/catchup';
import { ForkNode, MachineNode, type MachineSnap } from './flow/nodes';
import { coreRefusals, machineRefusals, refusedAt } from './readouts/core-door';
import { deserialize, serialize } from './serialize';
import { St } from './types';
import { tileIndex } from './world/grid';
import type { Sim } from './state';

const STEEL = (): number => itemIdx('steel');
const PIPE = (): number => itemIdx('pipe');
const SLAG = (): number => itemIdx('slag');
const SCRAP = (): number => itemIdx('scrap');
const held = (sim: Sim, item: number): number => sim.stock[item]! / 1000;
const machineAt = (sim: Sim, id: number): MachineNode => { sim.ensureCompiled(); return sim.graph.nodeByEnt.get(id) as MachineNode; };
const forkAt = (sim: Sim, id: number): ForkNode => { sim.ensureCompiled(); return sim.graph.nodeByEnt.get(id) as ForkNode; };

/** The steel line's research (granted outside commands, like the testkit's plans), steady power. */
function steelWorks(sim: Sim): void {
  sim.done.add('tr1'); // the press
  sim.done.add('dn_steel'); // the steel mill, the press's pipes
  sim.rebuildDerived();
  steadyPower(sim);
}

/**
 * A steel mill north of the Core on steel, fed by two silos (`plates` iron plates south of it,
 * `coal` coal east), wired; its steel by ribbon west then south into the Core's north input (511,
 * 510), the line's last tile (511, 509). Returns the mill's id.
 */
function millToCore(sim: Sim, plates: number, coal: number): number {
  steelWorks(sim);
  grantCost(sim, 'steel_mill');
  const k = sim.place('steel_mill', 512, 503, 0);
  if (!k.ok) throw new Error(`mill ${k.reason}`);
  sim.setRecipe(k.id!, 'steel');
  wire(sim, k.id!);
  stockedSilo(sim, 512, 507, 0, 'iron_plate', plates);
  stockedSilo(sim, 516, 505, 3, 'coal', coal);
  const n = sim.placeBelts('ribbon', line(512, 506, 0, 2)) + sim.placeBelts('ribbon', [[515, 505, 3], [514, 505, 3], [513, 505, 0]])
    + sim.placeBelts('ribbon', [[512, 502, 3], ...line(511, 502, 2, 8)]);
  if (n !== 14) throw new Error(`belts ${n}`);
  return k.id!;
}

/** The same, with a sorter on the steel's line (511, 503) sending the steel on and the rest aside, into an incinerator (510, 503). */
function sortedMill(sim: Sim, plates: number, coal: number): { mill: number; sorter: number; pit: number } {
  const mill = millToCore(sim, plates, coal);
  const s = sim.place('sorter', 511, 503, 2);
  if (!s.ok) throw new Error(`sorter ${s.reason}`);
  sim.setForkFilter(s.id!, 0, 'steel');
  const p = sim.place('incinerator', 510, 503, 0);
  if (!p.ok) throw new Error(`incinerator ${p.reason}`);
  return { mill, sorter: s.id!, pit: p.id! };
}

/**
 * A mill's steel by ribbon west and down to a press on pipes (508, 506) turned south, whose input
 * faces the line's head (509, 505); the press's pipes (and its scrap) into an incinerator under it.
 * Returns the ids.
 */
function millToPress(sim: Sim, plates: number, coal: number): { mill: number; press: number } {
  steelWorks(sim);
  grantCost(sim, 'steel_mill');
  const k = sim.place('steel_mill', 512, 503, 0);
  if (!k.ok) throw new Error(`mill ${k.reason}`);
  sim.setRecipe(k.id!, 'steel');
  wire(sim, k.id!);
  stockedSilo(sim, 512, 507, 0, 'iron_plate', plates);
  stockedSilo(sim, 516, 505, 3, 'coal', coal);
  sim.placeBelts('ribbon', line(512, 506, 0, 2));
  sim.placeBelts('ribbon', [[515, 505, 3], [514, 505, 3], [513, 505, 0]]);
  const n = sim.placeBelts('ribbon', [[512, 502, 3], [511, 502, 3], [510, 502, 3], ...line(509, 502, 2, 4)]);
  if (n !== 7) throw new Error(`steel belts ${n}`);
  grantCost(sim, 'press');
  const p = sim.place('press', 508, 506, 2);
  if (!p.ok) throw new Error(`press ${p.reason}`);
  sim.setRecipe(p.id!, 'pipe');
  wire(sim, p.id!);
  if (!sim.place('incinerator', 509, 508, 0).ok) throw new Error('incinerator');
  return { mill: k.id!, press: p.id! };
}

/**
 * A mill whose output port is set straight against a press's input (D39, no ribbon): the press
 * takes steel, never slag, so the mill's first slag stays in its bin and stops it there. The
 * press's pipes into an incinerator above it. Returns the ids.
 */
function millIntoPress(sim: Sim): { mill: number; press: number } {
  steelWorks(sim);
  grantCost(sim, 'steel_mill');
  const k = sim.place('steel_mill', 512, 503, 0);
  if (!k.ok) throw new Error(`mill ${k.reason}`);
  sim.setRecipe(k.id!, 'steel');
  wire(sim, k.id!);
  stockedSilo(sim, 512, 507, 0, 'iron_plate', 200);
  stockedSilo(sim, 516, 505, 3, 'coal', 200);
  sim.placeBelts('ribbon', line(512, 506, 0, 2));
  sim.placeBelts('ribbon', [[515, 505, 3], [514, 505, 3], [513, 505, 0]]);
  grantCost(sim, 'press');
  const p = sim.place('press', 512, 501, 0);
  if (!p.ok) throw new Error(`press ${p.reason}`);
  sim.setRecipe(p.id!, 'pipe');
  wire(sim, p.id!);
  if (!sim.place('incinerator', 512, 500, 0).ok) throw new Error('incinerator');
  return { mill: k.id!, press: p.id! };
}

/**
 * A press on pipes set straight against the Core's south input (511, 514; D39), fed by a silo of
 * steel set straight against its input: its pipes go in, its first scrap stays in its bin.
 */
function pressIntoCore(sim: Sim, steel: number): number {
  steelWorks(sim);
  grantCost(sim, 'press');
  const p = sim.place('press', 511, 515, 0);
  if (!p.ok) throw new Error(`press ${p.reason}`);
  sim.setRecipe(p.id!, 'pipe');
  wire(sim, p.id!);
  stockedSilo(sim, 511, 517, 0, 'steel', steel);
  return p.id!;
}

describe('the machines’ waste (D125, D139)', () => {
  it('the content: only the steel line leaves waste — the smelters and the press on gears none; recycling takes it', () => {
    const wasteful = Object.entries(RECIPES).filter(([, r]) => 'waste' in r).map(([id]) => id).sort();
    expect(wasteful).toEqual(['pipe', 'steel', 'steel_scrap']);
    expect(RECIPES.steel.waste).toEqual(['slag', 5]);
    expect(RECIPES.pipe.waste).toEqual(['scrap', 5]);
    for (const id of ['iron_plate', 'arc_plate', 'copper_plate', 'arc_copper', 'glass', 'arc_glass', 'gear'] as const) expect('waste' in RECIPES[id], id).toBe(false);
    const c = CRECIPES.find((r) => r.id === 'steel')!;
    expect(c.waste).toEqual({ item: SLAG(), every: 5 });
    expect(RECIPES.slag_brick.ins.some(([i]) => i === 'slag')).toBe(true);
    expect(RECIPES.steel_scrap.ins.some(([i]) => i === 'scrap')).toBe(true);
  });

  it('the Core takes every item but the waste, by kind (D139)', () => {
    for (let i = 0; i < N_ITEMS; i++) expect(CORE_TAKES.has(i), ITEM_IDS[i]).toBe(itemDef(i).kind !== 'waste');
    expect(CORE_TAKES.has(SLAG())).toBe(false);
    expect(CORE_TAKES.has(SCRAP())).toBe(false);
    const sim = testSim();
    sim.ensureCompiled();
    expect(sim.graph.hearth!.accepts).toBe(CORE_TAKES);
  });

  it('a mill puts out a slag every five steels through its output; the Core refuses it, so the line jams at the first (D139)', () => {
    const sim = testSim();
    const mill = millToCore(sim, 100, 100);
    const slag0 = held(sim, SLAG());
    sim.run(12_000); // twenty minutes: fifty steels' plates, were the line to run
    expect(held(sim, STEEL()), 'the four steels before the fifth craft’s slag').toBe(4);
    expect(held(sim, SLAG())).toBe(slag0);
    expect(sim.produced[SLAG()]).toBe(2000); // the line filled behind the first, the second waits in the mill's bin
    // It waits on the line's last tile, at the Core's door; the line and the mill stopped behind it.
    expect(coreRefusals(sim).map((r) => [r.tile, ITEM_IDS[r.item], r.dir, r.by])).toEqual([[tileIndex(511, 509), 'slag', 2, 'core']]);
    expect(refusedAt(sim, sim.chainAt(511, 503))).toEqual({ item: SLAG(), by: 'core' });
    expect(machineAt(sim, mill).status).toBe(St.Blocked);
  });

  it('nothing vanishes: what the base holds of slag is what was made (the bin and the ribbons counted)', () => {
    const sim = testSim();
    millToCore(sim, 40, 40);
    for (let k = 0; k < 30; k++) {
      sim.run(197);
      expect(sim.totalHeld(SLAG())).toBe(sim.produced[SLAG()]! - sim.consumed[SLAG()]!);
    }
  });

  it('a sorter laid over the jammed tile takes the slag in (not the Core); an incinerator on its side and the line runs', () => {
    const sim = testSim();
    const mill = millToCore(sim, 100, 100);
    sim.run(6000);
    expect(coreRefusals(sim)).toHaveLength(1);
    const slag0 = sim.stock[SLAG()]!, steel0 = sim.stock[STEEL()]!;
    const s = sim.place('sorter', 511, 509, 2);
    expect(s.ok).toBe(true);
    sim.setForkFilter(s.id!, 0, 'steel');
    const f = forkAt(sim, s.id!);
    expect([ITEM_IDS[f.item], f.mu]).toEqual(['slag', 1000]);
    expect(sim.stock[SLAG()]).toBe(slag0); // a routing block keeps the item on its tile (compile.ts)
    sim.run(600);
    expect(forkAt(sim, s.id!).item).toBe(SLAG()); // nowhere to put it yet: the Core refuses it
    expect(sim.place('incinerator', 510, 509, 0).ok).toBe(true);
    sim.run(6000);
    expect(sim.consumed[SLAG()]!).toBeGreaterThanOrEqual(5000);
    expect(sim.stock[STEEL()]! - steel0).toBeGreaterThan(20_000);
    expect(sim.stock[SLAG()]).toBe(slag0);
    expect(coreRefusals(sim)).toEqual([]);
    expect(machineAt(sim, mill).status).not.toBe(St.Blocked);
  });

  it('a routing block handing into the Core holds the slag it cannot give: refused there too (D139)', () => {
    const sim = testSim();
    millToCore(sim, 100, 100);
    expect(sim.remove(511, 509)).toBeTruthy();
    const r = sim.place('router', 511, 509, 2);
    expect(r.ok).toBe(true);
    sim.run(12_000);
    expect(held(sim, STEEL())).toBe(4);
    expect(held(sim, SLAG())).toBe(0);
    const f = forkAt(sim, r.id!);
    expect([ITEM_IDS[f.item], f.mu]).toEqual(['slag', 1000]);
    expect(coreRefusals(sim).map((x) => [x.ent, ITEM_IDS[x.item], x.dir, x.by])).toEqual([[r.id, 'slag', 2, 'core']]);
  });

  it('a machine set against the Core keeps its scrap in its bin and stops (D139: its outlet straight into an intake)', () => {
    const sim = testSim();
    const press = pressIntoCore(sim, 100);
    sim.run(12_000);
    expect(held(sim, PIPE()), 'four crafts’ pipes before the fifth’s scrap').toBe(8);
    expect(held(sim, SCRAP())).toBe(0);
    const m = machineAt(sim, press);
    expect([m.wBuf, ITEM_IDS[m.wItem]]).toEqual([1000, 'scrap']);
    expect(m.status).toBe(St.Blocked);
    expect(coreRefusals(sim).map((x) => [x.ent, ITEM_IDS[x.item], x.by])).toEqual([[press, 'scrap', 'core']]);
  });

  it('the debug grant takes no waste into the Core either (D139)', () => {
    const sim = testSim();
    const n = sim.log.length;
    sim.grant('slag', 5);
    sim.grant('scrap', 5);
    expect([held(sim, SLAG()), held(sim, SCRAP())]).toEqual([0, 0]);
    expect(sim.log.length).toBe(n);
    sim.grant('steel', 5);
    expect(held(sim, STEEL())).toBe(5);
  });

  it('a slag at the head of a line into a press jams it; a sorter to an incinerator frees it', () => {
    const sim = testSim();
    const { mill, press } = millToPress(sim, 400, 400);
    sim.run(9000); // fifteen minutes: the first slag (the 5th craft) reached the press and stuck there
    expect(machineAt(sim, mill).status).toBe(St.Blocked);
    expect(machineAt(sim, press).status).toBe(St.Starved);
    expect(machineRefusals(sim).map((r) => [r.tile, ITEM_IDS[r.item], r.by])).toEqual([[tileIndex(509, 505), 'slag', press]]);
    const pipes = sim.produced[PIPE()]!;
    expect(pipes / 1000).toBeLessThan(10); // the steels before the slag only
    sim.run(1200);
    expect(sim.produced[PIPE()]).toBe(pipes); // still jammed
    // A sorter at the line's head (it takes the slag waiting there): steel straight on into the press, the rest aside into a pit.
    const s = sim.place('sorter', 509, 505, 2);
    expect(s.ok).toBe(true);
    sim.setForkFilter(s.id!, 0, 'steel');
    expect(sim.place('incinerator', 508, 505, 0).ok).toBe(true);
    const burnt0 = sim.consumed[SLAG()]!;
    sim.run(9000);
    expect(sim.produced[PIPE()]! - pipes).toBeGreaterThan(40 * 1000);
    expect(sim.consumed[SLAG()]! - burnt0).toBeGreaterThanOrEqual(5 * 1000);
    expect(machineAt(sim, mill).status).not.toBe(St.Blocked);
    // The press's own waste: scrap, burnt with its pipes in the pit under it.
    expect(sim.produced[SCRAP()]!).toBeGreaterThan(0);
    expect(machineRefusals(sim)).toEqual([]);
  });

  it('a slag its output cannot hand on stays in its bin and stops it there (Blocked, the bin named)', () => {
    const sim = testSim();
    const { mill, press } = millIntoPress(sim);
    sim.run(9000);
    const k = machineAt(sim, mill);
    expect(k.status).toBe(St.Blocked);
    expect(k.wBuf).toBe(1000);
    expect(k.wItem).toBe(SLAG());
    expect(machineAt(sim, press).status).toBe(St.Starved);
  });

  it('a sorted line: the steel into the Core, the slag burnt, none of it in the Core', () => {
    const sim = testSim();
    sortedMill(sim, 100, 100);
    sim.run(12_000);
    expect(held(sim, STEEL())).toBe(50);
    expect(sim.consumed[SLAG()]).toBe(10_000);
    expect(held(sim, SLAG())).toBe(0);
    expect(coreRefusals(sim)).toEqual([]);
  });

  it('offline as online: a mixed line sorted into a pit and the Core (2 h, the silos running dry)', () => {
    const make = (): Sim => { const s = testSim(); sortedMill(s, 800, 900); s.run(50); return s; };
    const a = make(), b = make();
    a.run(72_000);
    const rep = catchUp(b, 72_000, { noDirect: true });
    expect(rep.mode).toBe('exact'); // the waste's count keeps the line's period within the warm-up
    expect(b.tick).toBe(a.tick);
    expect(b.consumed[SLAG()]).toBe(a.consumed[SLAG()]);
    expect(b.stock[STEEL()]).toBe(a.stock[STEEL()]);
    expect(b.stock[SLAG()]).toBe(0);
    expect(a.consumed[SLAG()]! / 1000).toBe(80);
    expect(b.hash()).toBe(a.hash());
  });

  it('offline as online: a mixed line jammed at the Core by its first slag (D139), and that line sorted (1 h each)', () => {
    const make = (sorted: boolean): Sim => { const s = testSim(); if (sorted) sortedMill(s, 400, 400); else millToCore(s, 400, 400); s.run(50); return s; };
    for (const sorted of [false, true]) {
      const a = make(sorted), b = make(sorted);
      a.run(36_000);
      catchUp(b, 36_000, { noDirect: true });
      expect(b.tick).toBe(a.tick);
      expect(b.stock[STEEL()], `sorted ${sorted}`).toBe(a.stock[STEEL()]);
      expect(b.stock[SLAG()]).toBe(0);
      expect(coreRefusals(b)).toEqual(coreRefusals(a));
      expect(b.hash(), `sorted ${sorted}`).toBe(a.hash());
    }
    const jammed = make(false);
    jammed.run(36_000);
    expect(jammed.stock[STEEL()]! / 1000).toBe(4);
    expect(coreRefusals(jammed)).toHaveLength(1);
  });

  it('offline as online: a mill, its sorter and a press on pipes on steady power (1 h)', () => {
    const make = (): Sim => {
      const s = testSim();
      millToPress(s, 2000, 2000);
      const so = s.place('sorter', 509, 505, 2);
      s.setForkFilter(so.id!, 0, 'steel');
      s.place('incinerator', 508, 505, 0);
      s.run(50);
      return s;
    };
    const a = make(), b = make();
    a.run(36_000);
    const rep = catchUp(b, 36_000, { noDirect: true });
    expect(b.produced[PIPE()]).toBe(a.produced[PIPE()]);
    expect(b.consumed[SLAG()]).toBe(a.consumed[SLAG()]);
    expect(b.hash()).toBe(a.hash());
    expect(rep.mode).toBe('exact');
    expect(rep.warmups).toBeLessThan(40);
  });

  it('a save keeps the waste count and the bin mid-cycle; the copy runs on as the original', () => {
    const sim = testSim();
    const { mill } = millIntoPress(sim);
    sim.run(9000);
    const k = machineAt(sim, mill);
    expect(k.wBuf).toBeGreaterThan(0);
    const copy = deserialize(serialize(sim), testSource());
    const kc = machineAt(copy, mill);
    expect([kc.wc, kc.wBuf, kc.wItem]).toEqual([k.wc, k.wBuf, k.wItem]);
    expect(copy.hash()).toBe(sim.hash());
    sim.run(600); copy.run(600);
    expect(copy.hash()).toBe(sim.hash());
  });

  it('a save from before D125 restores a mill’s buffers as they were, its bin empty and its count fresh', () => {
    const sim = testSim();
    const mill = millToCore(sim, 100, 100);
    sim.run(500);
    const save = serialize(sim);
    // An old save's machine state: no waste fields.
    save.nodes = save.nodes.map(([ent, s]) => {
      if (ent !== mill) return [ent, s];
      const { wc: _wc, wBuf: _wb, wItem: _wi, ...old } = s as MachineSnap;
      return [ent, old];
    });
    const before = machineAt(sim, mill);
    const copy = deserialize(save, testSource());
    const k = machineAt(copy, mill);
    expect([...k.inBuf]).toEqual([...before.inBuf]);
    expect([...k.outBuf]).toEqual([...before.outBuf]);
    expect(k.p).toBe(before.p);
    expect([k.wc, k.wBuf]).toEqual([0, 0]);
    copy.run(9000);
    expect(copy.produced[SLAG()]!).toBeGreaterThan(0);
  });

  it('taking a machine down refunds its waste bin to the Core (a removal goes home: D139 refuses the lines, not this)', () => {
    const sim = testSim();
    const { mill } = millIntoPress(sim);
    sim.run(9000);
    const k = machineAt(sim, mill);
    const bin = k.wBuf;
    expect(bin).toBeGreaterThan(0);
    const slag0 = sim.stock[SLAG()]!;
    expect(sim.remove(512, 503)).toBeTruthy();
    expect(sim.stock[SLAG()]! - slag0).toBe(bin);
  });
});
