// links.test.ts — explicit power wires (D25): the wire rule (range edge to edge, slots, who
// may be wired), the commands and their replay, grids as the wires' components (nothing by
// proximity), the new pillar's auto-wire, wires carried over a replacement, the Hearth's solar
// panel, save → load, online ≈ offline on a wired grid over a whole day, and the land under a
// wire (D78: how far its ends may stand apart in level, what may rise between them).
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { WORLD_SEED } from '@/content/world';
import { buildingIdx, itemIdx, N_ITEMS } from '@/content/registry';
import { computeMods } from '../research/modifiers';
import { replay } from '../commands';
import { buildDemo, hearthNetwork, powerLine } from '../dev';
import { catchUp } from '../offline/catchup';
import { serialize, deserialize } from '../serialize';
import { Sim } from '../state';
import { grantCost, learnPlans, testSim, testSource, wire, drillToHearth, line, stockedSilo, IRON, SAND } from '../testkit';
import { St, T, type Ent, type Rot } from '../types';
import { MapGen } from '../world/mapgen';
import { FlatSource } from '../world/grid';
import { WORLD_EPOCH0 } from '../constants';
import type { MachineNode } from '../flow/nodes';
import { PowerLinks, climbOf, gap2, linkCheck, wireObstacle, wireSteep, type LandLevel } from './links';

/** A loose entity for the pure rule (no colony needed). */
let nextId = 100;
const ent = (def: string, x: number, y: number, rot: Rot = 0): Ent => ({ id: nextId++, def: buildingIdx(def), x, y, rot, cfg: 0, builtAt: 0 });
const BASE = computeMods(new Set());
const XP4 = computeMods(new Set(['xp_swift', 'xp_bigsilo', 'xp_bridges', 'xp4']));

/** The grid of an entity in the compiled graph (undefined: none). */
const gridOf = (sim: Sim, id: number): number | undefined => { sim.ensureCompiled(); return sim.graph.netOfEnt.get(id); };

describe('power wires: the rule', () => {
  it('reach is measured footprint edge to footprint edge, with integer squared distances', () => {
    const a = ent('mast', 500, 500), b = ent('mast', 507, 500), c = ent('mast', 508, 500);
    expect(gap2(a, b)).toBe(36); // a gap of 6 tiles between the two masts
    expect(gap2(a, c)).toBe(49);
    expect(gap2(ent('hearth', 510, 510), ent('drill', 511, 502, 2))).toBe(36); // 504 → 510: 6
    expect(gap2(ent('drill', 0, 0), ent('drill', 2, 0))).toBe(0); // touching
  });

  it('a pole reaches 6 tiles, the Hearth 8, a 2×2 pylon 40 (60 with Reinforced Pylons, D75); the longer end decides', () => {
    const L = new PowerLinks();
    const m = ent('mast', 500, 500);
    expect(linkCheck(m, ent('mast', 507, 500), L, BASE)).toBe('ok');
    expect(linkCheck(m, ent('mast', 508, 500), L, BASE)).toBe('range');
    expect(linkCheck(m, ent('mast', 505, 505), L, BASE)).toBe('ok'); // gap (4, 4): 32 ≤ 36
    expect(linkCheck(m, ent('mast', 506, 505), L, BASE)).toBe('range'); // gap (5, 4): 41
    expect(linkCheck(m, ent('drill', 507, 500), L, BASE)).toBe('ok');
    expect(linkCheck(m, ent('drill', 508, 500), L, BASE)).toBe('range');
    const h = ent('hearth', 510, 510);
    expect(linkCheck(h, ent('workshop', 523, 510), L, BASE)).toBe('ok'); // 515 → 523: 8
    expect(linkCheck(h, ent('workshop', 524, 510), L, BASE)).toBe('range');
    const p = ent('pylon', 600, 600); // 2×2: 600–601
    expect(linkCheck(p, ent('mast', 642, 600), L, BASE)).toBe('ok'); // a pole hangs on a pylon's 40 (edge to edge: 602 → 642)
    expect(linkCheck(ent('mast', 642, 600), p, L, BASE)).toBe('ok'); // either end reaching is enough
    expect(linkCheck(p, ent('mast', 643, 600), L, BASE)).toBe('range');
    expect(linkCheck(p, ent('pylon', 662, 600), L, XP4)).toBe('ok'); // 60 with xp4
    expect(linkCheck(p, ent('pylon', 663, 600), L, XP4)).toBe('range');
  });

  it('who may be wired: one end a pillar or the Hearth, the other anything that makes, uses or stores power', () => {
    const L = new PowerLinks();
    const m = ent('mast', 500, 500);
    expect(linkCheck(m, ent('wind_flower', 502, 500), L, BASE)).toBe('ok');
    expect(linkCheck(m, ent('accumulator', 502, 500), L, BASE)).toBe('ok');
    expect(linkCheck(m, ent('observatory', 502, 500), L, BASE)).toBe('ok');
    expect(linkCheck(m, ent('kiln', 502, 500), L, BASE)).toBe('not_linkable'); // burns coal, no power
    expect(linkCheck(m, ent('ribbon', 502, 500), L, BASE)).toBe('not_linkable');
    expect(linkCheck(ent('drill', 500, 500), ent('workshop', 502, 500), L, BASE)).toBe('needs_pillar');
    expect(linkCheck(m, m, L, BASE)).toBe('self');
    expect(linkCheck(m, undefined, L, BASE)).toBe('missing');
  });

  it('slots: a pole holds 8 wires, a pylon 4, the Hearth 6; a full end refuses', () => {
    const L = new PowerLinks();
    const m = ent('mast', 500, 500);
    const others = Array.from({ length: 9 }, (_, i) => ent('mast', 500 + (i % 3) * 2 - 2, 503 + Math.floor(i / 3)));
    for (let i = 0; i < 8; i++) { expect(linkCheck(m, others[i], L, BASE)).toBe('ok'); L.add(m.id, others[i]!.id); }
    expect(linkCheck(m, others[8], L, BASE)).toBe('slots');
    expect(linkCheck(others[8], m, L, BASE)).toBe('slots_other');
    expect(linkCheck(m, others[0], L, BASE)).toBe('already');
    const p = ent('pylon', 520, 520);
    for (let i = 0; i < 4; i++) L.add(p.id, 9000 + i);
    expect(linkCheck(p, ent('mast', 522, 520), L, BASE)).toBe('slots');
    const h = ent('hearth', 510, 510);
    for (let i = 0; i < 6; i++) L.add(h.id, 9100 + i);
    expect(linkCheck(h, ent('drill', 511, 502, 2), L, BASE)).toBe('slots');
  });

  it('the wire table keeps both ends sorted and lists each wire once, canonically', () => {
    const L = new PowerLinks();
    L.add(5, 2); L.add(2, 9); L.add(7, 2);
    expect(L.of(2)).toEqual([5, 7, 9]);
    expect(L.pairs()).toEqual([[2, 5], [2, 7], [2, 9]]);
    expect(L.add(2, 5)).toBe(false);
    expect(L.drop(2)).toEqual([5, 7, 9]);
    expect(L.size).toBe(0);
    L.add(1, 3); L.add(3, 4);
    expect(L.prune((id) => id !== 3)).toBe(2);
    expect(L.pairs()).toEqual([]);
  });
});

describe('power wires in a colony', () => {
  it('an unwired building gets nothing, even right beside the Hearth: no power by proximity', () => {
    const sim = testSim();
    const d = sim.place('drill', 511, 502, 2); // 6 tiles from the Hearth's edge, on the iron
    expect(d.ok).toBe(true);
    sim.run(600);
    expect(gridOf(sim, d.id!)).toBeUndefined();
    expect(sim.graph.nodeByEnt.get(d.id!)!.status).toBe(St.Unpowered);
    expect(sim.produced[IRON()]).toBe(0);
    wire(sim, d.id!); // the Hearth reaches 8 tiles
    sim.run(600);
    expect(gridOf(sim, d.id!)).toBe(gridOf(sim, sim.hearthId));
    expect(sim.produced[IRON()]).toBeGreaterThan(0);
  });

  it('Hearth → mast → mast → workshop powers the workshop; cutting the middle mast splits the grid', () => {
    const sim = testSim();
    const m1 = sim.place('mast', 520, 512, 0), m2 = sim.place('mast', 525, 512, 0);
    const w = sim.place('workshop', 528, 512, 0); // in the zone (r 18), beyond m1's 6 tiles
    expect(m1.ok && m2.ok && w.ok).toBe(true);
    // Each new mast wired itself to the nearest pillar or Hearth in reach: Hearth – m1 – m2.
    expect(sim.linksOf(sim.hearthId)).toEqual([m1.id]);
    expect(sim.linksOf(m2.id!)).toEqual([m1.id]);
    sim.setRecipe(w.id!, 'circuit');
    sim.ensureCompiled();
    const node = sim.graph.nodeByEnt.get(w.id!) as MachineNode;
    node.inBuf[0] = 6000; node.inBuf[1] = 2000; // two crafts' worth: copper wire, glass (sandbox write)
    sim.run(50);
    expect(node.status).toBe(St.Unpowered);
    expect(sim.produced[itemIdx('circuit')]).toBe(0);
    expect(sim.link(m2.id!, w.id!).ok).toBe(true);
    sim.run(300);
    expect(gridOf(sim, w.id!)).toBe(gridOf(sim, sim.hearthId));
    expect(sim.produced[itemIdx('circuit')]).toBe(2000);
    // Take m1 down: its wires go with it; m2 and the workshop are a grid of their own, unpowered.
    expect(sim.remove(520, 512)).toBe(true);
    expect(sim.linksOf(sim.hearthId)).toEqual([]);
    expect(sim.linksOf(m2.id!)).toEqual([w.id]);
    sim.run(10);
    const g = gridOf(sim, w.id!)!;
    expect(g).toBe(gridOf(sim, m2.id!));
    expect(g).not.toBe(gridOf(sim, sim.hearthId));
    expect(sim.netPower[g]!.renew).toBe(0);
    expect(sim.ctx.sat[g]).toBe(0);
  });

  it('link and unlink are commands: refusals are not logged, and a replay rebuilds the same wires', () => {
    const a = testSim();
    const d = drillToHearth(a);
    const m = a.place('mast', 520, 512, 0);
    const s = a.place('sand_collector', 522, 510, 3); // on the sand, beside the mast
    a.run(100);
    const n = a.log.length;
    expect(a.link(m.id!, s.id!)).toEqual({ ok: true, reason: 'ok' });
    expect(a.link(m.id!, s.id!)).toEqual({ ok: false, reason: 'already' });
    expect(a.link(d, s.id!)).toEqual({ ok: false, reason: 'needs_pillar' });
    expect(a.log.slice(n).map((l) => l.cmd)).toEqual([{ k: 'link', a: m.id, b: s.id }]);
    a.run(200);
    expect(a.unlink(s.id!, m.id!)).toBe(true);
    expect(a.unlink(s.id!, m.id!)).toBe(false);
    a.run(200);
    expect(a.link(m.id!, s.id!).ok).toBe(true);
    a.run(300);
    expect(a.log.filter((l) => l.cmd.k === 'link' || l.cmd.k === 'unlink').length).toBe(4); // + drillToHearth's
    const b = testSim();
    replay(b, a.log, a.tick);
    expect(b.links.pairs()).toEqual(a.links.pairs());
    expect(b.hash()).toBe(a.hash());
  });

  it('a new pillar wires itself to the nearest pillar or Hearth with a free slot (then the lowest id), or to nothing', () => {
    const sim = testSim();
    // Out of everyone's reach: no wire.
    const far = sim.place('mast', 540, 512, 0);
    expect(sim.linksOf(far.id!)).toEqual([]);
    // Two masts at the same distance from a third: the lower id wins.
    const a = sim.place('mast', 546, 512, 0);
    expect(sim.linksOf(a.id!)).toEqual([far.id]);
    const b = sim.place('mast', 546, 518, 0); // far is out of its reach (gap (5, 5))
    expect(sim.linksOf(b.id!)).toEqual([a.id]);
    const c = sim.place('mast', 546, 515, 0); // gaps: a 2, b 2 (a tie: a has the lower id), far 29
    expect(sim.linksOf(c.id!)).toEqual([a.id]);
    // A full Hearth is passed over for the next nearest pillar with a free slot.
    const ring = ([[504, 504], [516, 504], [504, 516], [516, 516], [503, 512], [519, 512]] as const).map(([x, y]) => sim.place('mast', x, y, 0).id!);
    for (const id of ring) if (!sim.links.has(sim.hearthId, id)) expect(sim.link(sim.hearthId, id).ok).toBe(true);
    expect(sim.links.degree(sim.hearthId)).toBe(6);
    const last = sim.place('mast', 512, 505, 0); // 4 tiles above the Hearth, whose six wires are taken
    expect(sim.linksOf(last.id!)).toEqual([ring[1]]); // the mast at (516, 504): a gap of 3
  });

  it('a pylon placed over a pole takes its wires over, as many as its 4 slots hold (pillars first)', () => {
    const sim = testSim();
    sim.done.add('tr4'); sim.rebuildDerived();
    sim.grant('ceramic', 4); sim.grant('glass', 20); sim.grant('copper_wire', 20); sim.grant('iron_plate', 40);
    grantCost(sim, 'pylon'); // its price today (D123)
    const c = sim.place('mast', 520, 512, 0);
    expect(sim.linksOf(c.id!)).toEqual([sim.hearthId]);
    const flowers = ([[522, 510], [522, 513], [517, 516], [520, 506]] as const).map(([x, y]) => {
      const f = sim.place('wind_flower', x, y, 0);
      expect(f.ok, f.reason).toBe(true);
      expect(sim.link(c.id!, f.id!).ok).toBe(true);
      return f.id!;
    });
    expect(sim.links.degree(c.id!)).toBe(5);
    const p = sim.place('pylon', 520, 512, 0);
    expect(p).toMatchObject({ ok: true, replaces: [c.id] });
    expect(sim.ents.get(c.id!)).toBeUndefined();
    expect(sim.linksOf(c.id!)).toEqual([]);
    // The Hearth (a pillar) first, then the flowers by id: the last one is cut.
    expect(sim.linksOf(p.id!)).toEqual([sim.hearthId, flowers[0], flowers[1], flowers[2]]);
    expect(sim.linksOf(flowers[3]!)).toEqual([]);
    expect(gridOf(sim, flowers[0]!)).toBe(gridOf(sim, sim.hearthId));
    expect(gridOf(sim, flowers[3]!)).toBeUndefined();
    // The same, replayed: the placement is one logged command, its wires follow from it.
    sim.run(100);
    const b = testSim();
    b.done.add('tr4'); b.rebuildDerived();
    replay(b, sim.log, sim.tick);
    expect(b.links.pairs()).toEqual(sim.links.pairs());
    expect(b.hash()).toBe(sim.hash());
  });

  it('the Hearth’s own solar panel follows the sun (a share at noon, a ramp at dawn, nothing at night) on top of its isotope core, the most of it (D101); both grow with its level', () => {
    const sim = testSim(); // founded at noon of a world day
    sim.run(1);
    const g = gridOf(sim, sim.hearthId)!;
    const core = BAL.hearthCoreKw[0]!, sun = BAL.hearthSolarKw[0]!;
    expect(core * 100).toBeGreaterThanOrEqual(65 * (core + sun)); // about 70 % steady at noon
    expect(sim.netPower[g]!.renew).toBe(sun + core);
    sim.run(12 * 600); // epoch 36: the night — the core alone
    expect(sim.netPower[g]!.renew).toBe(core);
    sim.run(12 * 600); // epoch 48 = day epoch 12: first light, 150 ‰
    expect(sim.netPower[g]!.renew).toBe(Math.floor((sun * 150) / 1000) + core);
    // Level 2: the next row of both, once the graph is compiled again.
    sim.hearthLevel = 2;
    sim.dirty = true;
    sim.run(1);
    expect(sim.netPower[gridOf(sim, sim.hearthId)!]!.renew).toBe(Math.floor((BAL.hearthSolarKw[1]! * 150) / 1000) + BAL.hearthCoreKw[1]!);
    // A Solar Farm (en_solarfarm, D70): 600 kW in full sun, nothing at night (no panel keeps a night floor).
    const farm = testSim();
    farm.done.add('en_solarfarm');
    farm.rebuildDerived();
    grantCost(farm, 'solar_farm');
    const f = farm.place('solar_farm', 516, 504, 0);
    expect(f.ok, f.reason).toBe(true);
    expect(farm.link(farm.hearthId, f.id!).ok).toBe(true);
    farm.run(1);
    expect(farm.netPower[gridOf(farm, farm.hearthId)!]!.renew).toBe(sun + 600 + core);
    farm.run(12 * 600);
    expect(farm.netPower[gridOf(farm, farm.hearthId)!]!.renew).toBe(core);
  });

  it('save → load keeps the wires (and the colony continues bit for bit)', () => {
    const sim = testSim();
    drillToHearth(sim);
    const m = sim.place('mast', 520, 512, 0);
    const s = sim.place('sand_collector', 522, 510, 3);
    wire(sim, s.id!, m.id!);
    sim.placeBelts('ribbon', line(521, 511, 3, 7));
    sim.run(700);
    const copy = deserialize(serialize(sim), sim.grid.source);
    expect(copy.links.pairs()).toEqual(sim.links.pairs());
    expect(copy.hash()).toBe(sim.hash());
    sim.run(1500); copy.run(1500);
    expect(copy.hash()).toBe(sim.hash());
    expect(copy.stock[SAND()]).toBe(sim.stock[SAND()]);
  });

  it('online ≈ offline on a wired grid over a whole day (sun, wind, a coal generator at night)', () => {
    // The turbine stands in the lee of a low rock (D95: the wind from the north-west to the north
    // in this world), so on most nights the wind cannot carry the drills and the coal burns.
    const src = testSource();
    const base = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24, source: new FlatSource(src.deposits, [...src.rocks, { x: 515, y: 513, w: 5, h: 2, t: T.Rock1, level: 1 }]) });
    learnPlans(base);
    for (const [it, n] of [['iron_plate', 200], ['glass', 40], ['copper_wire', 40]] as const) base.grant(it, n);
    drillToHearth(base);
    const m = base.place('mast', 520, 512, 0);
    const sand = base.place('sand_collector', 522, 510, 3);
    const wind = base.place('wind_flower', 517, 516, 0);
    const brazier = base.place('brazier', 507, 517, 0); // its inlet faces (507,519)
    expect(m.ok && sand.ok && wind.ok && brazier.ok).toBe(true);
    wire(base, [sand.id!, wind.id!], m.id!);
    wire(base, brazier.id!);
    base.placeBelts('ribbon', line(521, 511, 3, 7));
    // A second iron drill (facing east, side-loading the first one's line) and a third (into its
    // tail): with them the night's demand (3 × 90 + 30 kW) outruns the Heart's core (210 kW since
    // D101) and the wind, so the coal generator burns.
    const d2 = base.place('drill', 508, 500, 1);
    expect(d2.ok, d2.reason).toBe(true);
    wire(base, d2.id!);
    expect(base.placeBelts('ribbon', [...line(510, 500, 2, 5), [510, 505, 1]])).toBe(6);
    const d3 = base.place('drill', 513, 502, 2); // its output faces (514, 504)
    expect(d3.ok, d3.reason).toBe(true);
    wire(base, d3.id!);
    expect(base.placeBelts('ribbon', [[514, 504, 3], [513, 504, 3]])).toBe(2);
    // Coal from a silo under the coal generator: out (507,520) → one ribbon square up into its inlet.
    stockedSilo(base, 507, 520, 0, 'coal', 400);
    expect(base.placeBelts('ribbon', [[507, 519, 0]])).toBe(1);
    base.run(20);
    const save = serialize(base);
    const a = deserialize(save, base.grid.source), b = deserialize(save, base.grid.source);
    const day = 36 * 600;
    a.run(day);
    catchUp(b, day, { noDirect: true });
    expect(b.tick).toBe(a.tick);
    expect(b.links.pairs()).toEqual(a.links.pairs());
    for (let i = 0; i < N_ITEMS; i++) {
      const x = a.stock[i]! / 1000, y = b.stock[i]! / 1000;
      const flow = (a.produced[i]! + a.consumed[i]!) / 1000;
      expect(Math.abs(x - y), `item ${i}: online ${x} vs offline ${y}`).toBeLessThanOrEqual(Math.max(2, 0.005 * flow));
    }
    // It did work: ore and sand came in by day, coal burnt at night.
    expect(a.stock[IRON()]! - save.stock[IRON()]!).toBeGreaterThan(100_000);
    expect(a.stock[SAND()]! - save.stock[SAND()]!).toBeGreaterThan(50_000);
    expect(a.consumed[itemIdx('coal')]!).toBeGreaterThan(0);
  });

  it('the demo base is wired whole: every building that makes or uses power is on the Hearth’s grid', () => {
    const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: 1, source: new MapGen(WORLD_SEED, 1), foundingEpoch: WORLD_EPOCH0 + 24 });
    const ids = buildDemo(sim);
    const home = gridOf(sim, sim.hearthId);
    for (const k of ['drillA', 'drillB', 'sand', 'coal', 'coal2', 'workshop', 'observatory', 'trade', 'brazier', 'wind0', 'wind1', 'wind2', 'wind3']) {
      expect(ids[k], k).toBeGreaterThan(0);
      expect(gridOf(sim, ids[k]!), k).toBe(home);
    }
    expect(hearthNetwork(sim).size).toBeGreaterThan(14);
    // powerLine on something already wired does nothing.
    expect(powerLine(sim, ids.drillA!)).toBe(0);
    sim.run(1200);
    expect(sim.produced[IRON()]!).toBeGreaterThan(20_000);
  });
});

describe('power wires: the land (D78)', () => {
  /** Level 0 everywhere but `lv` over columns x0–x1 (and `far` from column `from` on). */
  const ridge = (x0: number, x1: number, lv: number, from = Infinity, far = 0): LandLevel => (x) => (x >= from ? far : x >= x0 && x <= x1 ? lv : 0);
  const steep = (a: Ent, b: Ent, land: LandLevel): boolean => wireSteep(a, b, land);

  it('a pole and the Hearth hold their wires one terrace up, a pylon three, any other building none', () => {
    expect(climbOf(buildingIdx('mast'))).toBe(1);
    expect(climbOf(buildingIdx('hearth'))).toBe(1);
    expect(climbOf(buildingIdx('pylon'))).toBe(3);
    expect(climbOf(buildingIdx('drill'))).toBe(0);
  });

  it('the ends stand at most the taller end’s climb apart: a pole one terrace, a pylon three', () => {
    const stepAt = (x0: number, lv: number): LandLevel => (x) => (x >= x0 ? lv : 0);
    const pole = ent('mast', 500, 500), pole2 = ent('mast', 502, 500), drill = ent('drill', 502, 500);
    expect(steep(pole, pole2, stepAt(502, 1))).toBe(false);
    expect(steep(pole, pole2, stepAt(502, 2))).toBe(true);
    expect(steep(pole, drill, stepAt(502, 1))).toBe(false); // a building on the terrace above a pole
    expect(steep(pole, drill, stepAt(502, 2))).toBe(true);
    const py = ent('pylon', 500, 500), py2 = ent('pylon', 520, 500);
    expect(steep(py, py2, stepAt(520, 3))).toBe(false); // « quelques hauteurs de différence » : the point of a pylon
    expect(steep(py, py2, stepAt(520, 4))).toBe(true);
    expect(steep(ent('mast', 500, 500), py2, stepAt(520, 3))).toBe(false); // a pole hangs on a pylon three terraces up
    expect(linkCheck(pole, pole2, new PowerLinks(), BASE, stepAt(502, 2))).toBe('steep');
  });

  it('two poles on the floor wire across a one-terrace ridge, not a two-terrace one; the first tile above the wire is named', () => {
    const a = ent('mast', 500, 500), b = ent('mast', 506, 500), L = new PowerLinks();
    expect(wireObstacle(a, b, ridge(502, 504, 1))).toBeNull();
    expect(wireObstacle(a, b, ridge(502, 504, 2))).toEqual([502, 500]);
    expect(wireObstacle(b, a, ridge(502, 504, 2))).toEqual([504, 500]); // walking from the other end
    expect(linkCheck(a, b, L, BASE, ridge(502, 504, 2))).toBe('blocked');
    expect(linkCheck(a, b, L, BASE)).toBe('ok'); // without the land, the land is not read
    // Touching footprints have no land between them.
    expect(wireObstacle(a, ent('mast', 501, 500), ridge(502, 504, 5))).toBeNull();
  });

  it('two pylons on the floor clear a three-terrace hill, never a mountain; the line rides above their grounds', () => {
    const a = ent('pylon', 500, 500), b = ent('pylon', 530, 500);
    expect(wireObstacle(a, b, ridge(510, 515, 3))).toBeNull();
    expect(wireObstacle(a, b, ridge(510, 515, 4))).toEqual([510, 501]); // centre to centre: the row between the pylons' two
    expect(wireObstacle(b, a, ridge(510, 515, 5))).toEqual([515, 501]);
    // One end three terraces up: the wire climbs with the land, three above the line between their grounds.
    expect(wireObstacle(a, b, ridge(520, 520, 4, 530, 3))).toBeNull();
    expect(wireObstacle(a, b, ridge(520, 520, 5, 530, 3))).toEqual([520, 501]);
    // A diagonal wire reads the tiles it passes over, not only its ends' rows and columns.
    const c = ent('pylon', 500, 500), d = ent('pylon', 520, 520);
    const hump: LandLevel = (x, y) => (x >= 509 && x <= 512 && y >= 509 && y <= 512 ? 4 : 0);
    expect(wireObstacle(c, d, hump)).not.toBeNull();
    expect(wireObstacle(c, ent('pylon', 520, 500), hump)).toBeNull(); // the same hill beside the wire
  });

  it('in a colony: a pole’s wire stops at a two-terrace ridge, a pylon’s at a four-terrace mountain', () => {
    const land = (lv: number): Sim => {
      const sim = new Sim({
        worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24,
        source: new FlatSource([], [{ x: 505, y: 519, w: 4, h: 5, t: T.Rock4, level: lv }]),
      });
      sim.done.add('tr4'); sim.rebuildDerived(); // the pylon's research
      sim.grant('iron_plate', 200); sim.grant('copper_wire', 100); sim.grant('ceramic', 20);
      grantCost(sim, 'pylon', 4);
      return sim;
    };
    const pair = (sim: Sim, def: string, ax: number, bx: number, y: number): [number, number] => {
      const a = sim.place(def, ax, y, 0), b = sim.place(def, bx, y, 0);
      expect(a.ok, a.reason).toBe(true);
      expect(b.ok, b.reason).toBe(true);
      for (const r of [a, b]) sim.links.drop(r.id!); // the reach-out wire each new pillar strung
      return [a.id!, b.id!];
    };
    for (const [lv, pole, pylon] of [[1, 'ok', 'ok'], [2, 'blocked', 'ok'], [3, 'blocked', 'ok'], [4, 'blocked', 'blocked']] as const) {
      const sim = land(lv);
      const [m1, m2] = pair(sim, 'mast', 503, 510, 521); // a 6-tile gap, across the ridge
      expect(sim.canLink(m1, m2).reason, `poles over ${lv}`).toBe(pole);
      const [p1, p2] = pair(sim, 'pylon', 493, 515, 520); // a 20-tile gap, across it too
      expect(sim.canLink(p1, p2).reason, `pylons over ${lv}`).toBe(pylon);
    }
  });
});
