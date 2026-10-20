// blueprint.test.ts — blueprints (D154, systems/blueprint.ts): a capture keeps relative places,
// rotations, settings and the wires between its pieces; a paste turned (or mirrored) lays the
// buildings with their ports facing the right way, so a smelter line pasted turned makes what the
// original makes; pieces that cannot go are skipped and shown; the paste is paid whole or not at
// all, off the claim's land by kites; the library lives in the save; the upgrade tool lifts an
// area's ribbons one tier through the replacement; and a replay of it all reproduces the hash.
import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { buildingIdx, costOf, itemIdx } from '@/content/registry';
import { filterOf, recipeOf } from './cfg';
import { replay } from './commands';
import { CENTER } from './constants';
import { ReservoirNode } from './flow/nodes';
import { deserialize, serialize } from './serialize';
import type { Sim } from './state';
import { layout, mirrorBlocker, mirrorRot, planPaste, type Blueprint } from './systems/blueprint';
import { grantCost, line, steadyPower, stockedSilo, testSim, testSource, wire } from './testkit';
import type { Rot } from './types';

/** The Electric Smelting learnt, outside commands (engine tests start with the plans only). */
function learn(sim: Sim, ...more: string[]): void {
  for (const id of ['dn3', 'dn_esmelt', ...more]) sim.done.add(id);
  sim.rebuildDerived();
}

/** Stock a silo with ore (outside commands, as `stockedSilo`: such a colony is not replayed). */
function stock(sim: Sim, id: number, item: string, n: number): void {
  sim.ensureCompiled();
  const it = itemIdx(item);
  sim.stores.get(id)![it] = n * 1000;
  (sim.graph.nodeByEnt.get(id) as ReservoirNode).locked = it;
}

/** What a silo holds of an item (whole items). */
const held = (sim: Sim, id: number, item: string): number => Math.floor((sim.stores.get(id)?.[itemIdx(item)] ?? 0) / 1000);

/**
 * A smelter line flowing north at x 520: a feed silo (520, 507), two ribbons, an electric smelter
 * (520, 503) on plates, two ribbons, an end silo (520, 499); a pole (522, 504) wired to the
 * smelter, on a pole (516, 508) by the Core. Returns the ids.
 */
function smelterLine(sim: Sim): { feed: number; smelter: number; end: number; mast: number } {
  steadyPower(sim);
  learn(sim);
  grantCost(sim, 'electric_smelter'); grantCost(sim, 'silo', 2); grantCost(sim, 'mast', 2);
  const feed = stockedSilo(sim, 520, 507, 0, 'iron_ore', 2000);
  const sm = sim.place('electric_smelter', 520, 503, 0);
  if (!sm.ok) throw new Error(`smelter: ${sm.reason}`);
  expect(sim.setRecipe(sm.id!, 'arc_plate')).toBe(true);
  const end = sim.place('silo', 520, 499, 0);
  if (!end.ok) throw new Error(`end silo: ${end.reason}`);
  expect(sim.placeBelts('ribbon', line(520, 506, 0, 2))).toBe(2);
  expect(sim.placeBelts('ribbon', line(520, 502, 0, 2))).toBe(2);
  const spine = sim.place('mast', 516, 508, 0); // wires itself to the Core (D25)
  const mast = sim.place('mast', 522, 504, 0); // and this one to the spine
  expect(spine.ok && mast.ok).toBe(true);
  expect(sim.linksOf(mast.id!)).toContain(spine.id!);
  wire(sim, sm.id!, mast.id!);
  return { feed, smelter: sm.id!, end: end.id!, mast: mast.id! };
}

describe('blueprints (D154)', () => {
  it('a capture keeps each piece\'s place from the corner, its rotation, its settings and the wires between pieces', () => {
    const sim = testSim();
    const ids = smelterLine(sim);
    const bp = sim.capture(520, 499, 522, 508)!;
    expect(bp).not.toBeNull();
    expect([bp.w, bp.h]).toEqual([3, 10]);
    const at = (x: number, y: number) => bp.pieces.findIndex((p) => p.x === x && p.y === y);
    expect(bp.pieces[at(0, 0)]).toMatchObject({ def: 'silo', rot: 0 });
    expect(bp.pieces[at(0, 4)]).toMatchObject({ def: 'electric_smelter', rot: 0, recipe: 'arc_plate' });
    expect(bp.pieces[at(0, 2)]).toMatchObject({ def: 'ribbon', rot: 0 });
    expect(bp.pieces[at(2, 5)]).toMatchObject({ def: 'mast' });
    expect(bp.pieces).toHaveLength(8);
    // The pole's wire to the smelter comes (both inside); its wire to the spine outside does not.
    expect(bp.wires).toEqual([[Math.min(at(0, 4), at(2, 5)), Math.max(at(0, 4), at(2, 5))]]);
    expect(bp.icon).toBe('electric_smelter'); // the main building: not a line piece
    // A box catching part of a building takes it whole; the Core never comes.
    expect(sim.capture(521, 504, 521, 504)!.pieces).toEqual([{ def: 'electric_smelter', x: 0, y: 0, rot: 0, recipe: 'arc_plate' }]);
    expect(sim.capture(CENTER, CENTER, CENTER, CENTER)).toBeNull();
    expect(ids.end).toBeGreaterThan(0);
  });

  it('a router\'s per-side items turn and mirror with it; a sorter\'s one item stays', () => {
    const sim = testSim();
    grantCost(sim, 'router'); grantCost(sim, 'sorter');
    const r = sim.place('router', 530, 500, 1); // facing east
    const s = sim.place('sorter', 531, 500, 1);
    expect(r.ok && s.ok).toBe(true);
    sim.setForkFilter(r.id!, 0, 'iron_ore'); // north side: ore
    sim.setForkFilter(r.id!, 2, 'coal'); // south side: coal
    sim.setForkFilter(s.id!, 0, 'glass');
    const bp = sim.capture(530, 500, 531, 500)!;
    const turned = layout(bp, 600, 600, 1, false).pieces;
    const rt = turned.find((p) => p.def === buildingIdx('router'))!, st = turned.find((p) => p.def === buildingIdx('sorter'))!;
    expect(rt.rot).toBe(2); // east, turned clockwise: south
    expect(filterOf(rt.cfg, 1)).toBe(itemIdx('iron_ore')); // north → east
    expect(filterOf(rt.cfg, 3)).toBe(itemIdx('coal')); // south → west
    expect(filterOf(st.cfg, 0)).toBe(itemIdx('glass'));
    expect(rt.x).toBe(st.x); // a row turned is a column
    expect(st.y).toBe(rt.y + 1);
    const mirrored = layout(bp, 600, 600, 0, true).pieces;
    const rm = mirrored.find((p) => p.def === buildingIdx('router'))!, sm = mirrored.find((p) => p.def === buildingIdx('sorter'))!;
    expect(rm.rot).toBe(3); // east mirrored: west
    expect(sm.x).toBe(rm.x - 1); // and the sorter on its west side now
    expect(filterOf(rm.cfg, 0)).toBe(itemIdx('iron_ore')); // north and south stay
    expect(filterOf(rm.cfg, 2)).toBe(itemIdx('coal'));
  });

  it('mirroring: line pieces and symmetric machines have a twin; a machine with its exit on one side does not', () => {
    expect(mirrorRot(buildingIdx('ribbon'), 1)).toBe(3);
    expect(mirrorRot(buildingIdx('ribbon'), 0)).toBe(0);
    expect(mirrorRot(buildingIdx('router'), 3)).toBe(1);
    // A 3 × 3 machine with its three entrances along the back and its exit in the middle of the front.
    const sym = Object.entries(BUILDINGS).find(([, b]) => b.kind === 'machine' && b.w === 3 && b.h === 3
      && b.ports.length === 4 && b.ports.filter((p) => p.io === 'out' && p.x === 1).length === 1)![0];
    expect(mirrorRot(buildingIdx(sym), 0)).toBe(0);
    expect(mirrorRot(buildingIdx(sym), 1)).toBe(3);
    // The electric smelter: in at (0, 1), out at (0, 0) — mirrored they would sit at x 1, which no turn gives.
    expect(mirrorRot(buildingIdx('electric_smelter'), 0)).toBeNull();
    const sim = testSim();
    smelterLine(sim);
    const bp = sim.capture(520, 499, 522, 508)!;
    expect(mirrorBlocker(bp)).toBe('electric_smelter');
    // Asked anyway, the paste is not mirrored (the shell refuses the key and says why).
    expect(planPaste(sim, bp, 600, 600, 0, true).layout.pieces).toEqual(layout(bp, 600, 600, 0, false).pieces);
  });

  it('a smelter line pasted turned a quarter makes what the original makes: its ports face the right way, its wire strung', () => {
    const sim = testSim();
    const o = smelterLine(sim);
    const bp = sim.capture(520, 499, 522, 508)!;
    grantCost(sim, 'electric_smelter'); grantCost(sim, 'silo', 2); grantCost(sim, 'mast');
    const plan = planPaste(sim, bp, 520, 515, 1, false);
    expect(plan.skipped).toBe(0);
    expect(plan.short.size).toBe(0);
    const r = sim.paste(bp, 520, 515, 1, false);
    expect(r.placed).toBe(8);
    expect(r.wired).toBe(1);
    // Laid east: feed silo at (516, 514), the smelter at (520, 514) turned to face east on its recipe, the end silo at (524, 514).
    const feed = sim.entityAt(516, 514)!, smelter = sim.entityAt(520, 514)!, end = sim.entityAt(524, 514)!;
    expect([feed.def, smelter.def, end.def]).toEqual([buildingIdx('silo'), buildingIdx('electric_smelter'), buildingIdx('silo')]);
    expect(smelter.rot).toBe(1);
    expect(recipeOf(smelter.cfg)).toBe(o.smelter && recipeOf(sim.ents.get(o.smelter)!.cfg));
    expect(sim.entityAt(518, 514)!.rot).toBe(1); // its ribbons run east
    const mast = sim.entityAt(520, 516)!;
    expect(sim.linksOf(mast.id)).toContain(smelter.id); // the blueprint's wire
    expect(sim.linksOf(mast.id).length).toBeGreaterThan(1); // and the pole reached the grid by itself (D25)
    stock(sim, feed.id, 'iron_ore', 2000);
    sim.run(600 * 10);
    const made = held(sim, o.end, 'iron_plate'), pasted = held(sim, end.id, 'iron_plate');
    expect(made).toBeGreaterThan(80); // 10 a minute, after its start
    expect(Math.abs(pasted - made)).toBeLessThanOrEqual(1);
  });

  it('pieces that cannot go are skipped and shown; the rest is laid', () => {
    const sim = testSim();
    smelterLine(sim);
    const bp = sim.capture(520, 499, 522, 508)!;
    grantCost(sim, 'electric_smelter'); grantCost(sim, 'silo', 3); grantCost(sim, 'mast');
    // A silo standing where the pasted end silo goes (it is no replacement: occupied).
    expect(sim.place('silo', 525, 515, 0).ok).toBe(true);
    const plan = planPaste(sim, bp, 520, 515, 1, false);
    expect(plan.skipped).toBe(1);
    expect(plan.reason).toBe('occupied');
    const bad = plan.pieces.filter((p) => !p.ok);
    expect(bad.map((p) => p.def)).toEqual([buildingIdx('silo')]);
    const r = sim.paste(bp, 520, 515, 1, false);
    expect(r.placed).toBe(7);
    expect(r.skipped).toBe(1);
    expect(r.reason).toBe('occupied');
    // Pasted again on itself: every piece already stands, turned alike — kept, nothing laid, nothing paid.
    const before = Array.from(sim.stock);
    const again = planPaste(sim, bp, 520, 515, 1, false);
    expect(again.kept).toBe(7);
    expect(again.n).toBe(0);
    expect(sim.paste(bp, 520, 515, 1, false).placed).toBe(0);
    expect(Array.from(sim.stock)).toEqual(before);
  });

  it('the paste is paid whole or not at all: short of anything, nothing is laid and the shortfall is told', () => {
    const sim = testSim();
    smelterLine(sim);
    const bp = sim.capture(520, 499, 522, 508)!;
    // Nothing granted for the copy: the Core holds what the line left (a pole's worth, maybe), not a smelter's.
    const plan = planPaste(sim, bp, 520, 515, 1, false);
    expect(plan.short.size).toBeGreaterThan(0);
    const need = new Map<number, number>();
    for (const id of ['electric_smelter', 'silo', 'silo', 'mast', 'ribbon', 'ribbon', 'ribbon', 'ribbon']) for (const c of costOf(buildingIdx(id))) need.set(c.item, (need.get(c.item) ?? 0) + c.mu);
    expect(new Map([...plan.cost].sort((a, b) => a[0] - b[0]))).toEqual(new Map([...need].sort((a, b) => a[0] - b[0])));
    const n = sim.ents.map.size, log = sim.log.length;
    const r = sim.paste(bp, 520, 515, 1, false);
    expect(r.placed).toBe(0);
    expect(r.short?.size).toBeGreaterThan(0);
    expect(sim.ents.map.size).toBe(n);
    expect(sim.log.length).toBe(log);
    // Granted what it lacks: laid whole, and the Core pays exactly its cost.
    for (const [item, mu] of plan.short) sim.stock[item] = sim.stock[item]! + mu;
    const before = Array.from(sim.stock);
    expect(sim.paste(bp, 520, 515, 1, false).placed).toBe(8);
    for (const [item, mu] of need) expect(before[item]! - sim.stock[item]!).toBe(mu);
  });

  it('off the claim\'s land, drones build the pasted pieces as by hand (`builtAt`)', () => {
    const sim = testSim();
    sim.done.add('xp_swift'); sim.rebuildDerived();
    grantCost(sim, 'swift_ribbon', 20);
    expect(sim.placeBelts('swift_ribbon', line(530, 520, 1, 3))).toBe(3);
    const bp = sim.capture(530, 520, 532, 520)!;
    const far = CENTER + 70;
    expect(sim.land.covers(far, CENTER)).toBe(false);
    const r = sim.paste(bp, far, CENTER, 0, false);
    expect(r.placed).toBe(3);
    for (const id of r.ids) expect(sim.ents.get(id)!.builtAt).toBeGreaterThan(sim.tick);
  });

  it('the library lives in the save: saved, renamed, deleted by commands, kept through save and load, not hashed', () => {
    const sim = testSim();
    smelterLine(sim);
    const bp = sim.capture(520, 499, 522, 508)!;
    const h0 = sim.hash();
    const a = sim.saveBlueprint(bp, '  Fonderie   ×1  ');
    const b = sim.saveBlueprint(bp, 'Deux');
    expect([a, b]).toEqual([1, 2]);
    expect(sim.saveBlueprint(bp, '   ')).toBe(0); // a name is needed
    expect(sim.renameBlueprint(b, 'Ligne de plaques')).toBe(true);
    expect(sim.blueprints.map((x) => x.name)).toEqual(['Fonderie ×1', 'Ligne de plaques']);
    expect(sim.hash()).toBe(h0); // the base's notes, not its state
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    expect(back.blueprints).toEqual(sim.blueprints);
    expect(back.hash()).toBe(sim.hash());
    expect(back.deleteBlueprint(a)).toBe(true);
    expect(back.blueprints.map((x) => x.id)).toEqual([2]);
    expect(back.saveBlueprint(bp, 'Trois')).toBe(3); // ids never come back
    // A malformed entry is dropped at load, the rest kept; a base without any writes none.
    const data = serialize(back);
    data.blueprints!.push({ id: 9, name: 'x', icon: 'silo', w: 0, h: 1, pieces: [], wires: [] } as Blueprint);
    expect(deserialize(data, testSource()).blueprints.map((x) => x.id)).toEqual([2, 3]);
    expect('blueprints' in serialize(testSim())).toBe(false);
    // A blueprint from the library pastes as the clipboard does.
    grantCost(back, 'electric_smelter'); grantCost(back, 'silo', 2); grantCost(back, 'mast');
    expect(back.paste(back.blueprints[0]!, 520, 515, 1, false).placed).toBe(8);
  });

  it('the upgrade tool lifts an area\'s ribbons one tier, refunding the old ones; a junction or a traction step stays', () => {
    const sim = testSim();
    sim.done.add('xp_swift'); sim.rebuildDerived();
    expect(sim.placeBelts('ribbon', line(530, 500, 1, 6))).toBe(6);
    grantCost(sim, 'router');
    expect(sim.place('router', 536, 500, 1).ok).toBe(true);
    const plan = sim.planUpgrade(530, 500, 536, 500);
    expect(plan.n).toBe(6); // the router is no ribbon
    const swift = costOf(buildingIdx('swift_ribbon'));
    for (const c of swift) expect(plan.cost.get(c.item)).toBe(c.mu * 6);
    // Short of gears: nothing changes.
    const r0 = sim.upgradeArea(530, 500, 536, 500);
    expect(r0.placed).toBe(0);
    expect(sim.entityAt(530, 500)!.def).toBe(buildingIdx('ribbon'));
    grantCost(sim, 'swift_ribbon', 6);
    const r = sim.upgradeArea(530, 500, 536, 500);
    expect(r.placed).toBe(6);
    for (let x = 530; x < 536; x++) expect(sim.entityAt(x, 500)).toMatchObject({ def: buildingIdx('swift_ribbon'), rot: 1 });
    // Swift is the top tier unlocked: nothing more to do until the express ribbon is learnt.
    expect(sim.planUpgrade(530, 500, 536, 500).n).toBe(0);
    sim.done.add('xp_express'); sim.rebuildDerived();
    expect(sim.planUpgrade(530, 500, 536, 500).n).toBe(6);
  });

  it('a replay of copies, pastes, upgrades and the library reproduces the hash (each piece its own logged command)', () => {
    const run = (sim: Sim): void => {
      sim.done.add('xp_swift'); sim.rebuildDerived(); // outside commands, in both colonies alike
    };
    const a = testSim();
    run(a);
    a.grant('iron_plate', 200); a.grant('gear', 50); a.grant('copper_wire', 50);
    expect(a.placeBelts('ribbon', line(530, 500, 1, 5))).toBe(5);
    expect(a.place('router', 535, 500, 1).ok).toBe(true);
    expect(a.place('mast', 533, 502, 0).ok).toBe(true);
    a.run(50);
    const bp = a.capture(530, 500, 535, 502)!;
    expect(a.saveBlueprint(bp, 'Rangée')).toBe(1);
    expect(a.paste(bp, 540, 510, 1 as Rot, false).placed).toBe(7);
    a.run(30);
    expect(a.paste(a.blueprints[0]!, 520, 530, 2 as Rot, true).placed).toBe(7);
    expect(a.upgradeArea(530, 500, 535, 500).placed).toBe(5);
    a.renameBlueprint(1, 'Rangée vive');
    a.run(100);
    const b = testSim();
    run(b);
    replay(b, a.log, a.tick);
    expect(b.hash()).toBe(a.hash());
    expect(b.blueprints).toEqual(a.blueprints);
  });
});
