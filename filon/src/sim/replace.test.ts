// replace.test.ts — placing over what stands there (Mindustry-style replacement): a building
// replaces the buildings of its replace group that lie wholly inside its footprint, refunding
// them first; ribbon drags keep the routing blocks they run through and lay a junction where
// they cut straight across another ribbon line. Each placement is one logged `place`, so a
// replay redoes the same replacements.
import { describe, it, expect } from 'vitest';
import { BUILDING_IDS, itemIdx } from '@/content/registry';
import { filterOf } from './cfg';
import { replay } from './commands';
import { testSim, drillToHearth, line, stockedSilo, wire, IRON, SAND } from './testkit';
import type { Sim } from './state';
import type { Rot } from './types';

const PLATE = (): number => itemIdx('iron_plate');
const WIRE = (): number => itemIdx('copper_wire');
const GEAR = (): number => itemIdx('gear');
const defAt = (sim: Sim, x: number, y: number): string | undefined => {
  const e = sim.entityAt(x, y);
  return e ? BUILDING_IDS[e.def] : undefined;
};
/** Research given for the test (outside commands: such a colony is not replayed). */
const unlock = (sim: Sim, ...ids: string[]): void => {
  for (const id of ids) sim.done.add(id);
  sim.rebuildDerived();
};
/** The ribbon of `drillToHearth`: (512,504) west, then (511,504..509) south into the Hearth. */
const DRILL_LINE: Array<[number, number, Rot]> = [[512, 504, 3], ...line(511, 504, 2, 6)];

describe('replacement', () => {
  it('a router placed over a ribbon takes its place: ribbon refunded, router paid, one place logged, items keep flowing, the replay agrees', () => {
    const sim = testSim();
    drillToHearth(sim);
    sim.run(600);
    const ribbon = sim.entityAt(511, 507)!;
    expect(BUILDING_IDS[ribbon.def]).toBe('ribbon');
    const plate0 = sim.stock[PLATE()]!, wire0 = sim.stock[WIRE()]!;
    const log0 = sim.log.length, ev0 = sim.events.length;
    expect(sim.canPlace('router', 511, 507, 0)).toMatchObject({ ok: true, replaces: [ribbon.id] });
    const r = sim.place('router', 511, 507, 0);
    expect(r.ok, r.reason).toBe(true);
    expect(sim.ents.get(ribbon.id)).toBeUndefined();
    expect(sim.entityAt(511, 507)!.id).toBe(r.id);
    // The ribbon was free, so nothing comes back; the router's plate is paid.
    expect(sim.stock[PLATE()]! - plate0).toBe(-1000);
    expect(sim.stock[WIRE()]! - wire0).toBe(0);
    // One command, one structure event.
    // Asked facing north, it follows the south-going ribbon it replaces: in at its back.
    expect(sim.log.slice(log0).map((l) => l.cmd)).toEqual([{ k: 'place', def: 'router', x: 511, y: 507, rot: 2, cfg: 0 }]);
    expect(sim.events.slice(ev0).filter((e) => e.k === 'structure')).toHaveLength(1);
    const ore0 = sim.stock[IRON()]!;
    sim.run(1800);
    expect(sim.stock[IRON()]! - ore0).toBeGreaterThan(20_000);
    // A replay of the log redoes the replacement: the same colony, bit for bit.
    const b = testSim();
    replay(b, sim.log, sim.tick);
    expect(b.hash()).toBe(sim.hash());
  });

  it('a router placed in the middle of a jammed line: each side keeps the items standing on it, none jump to the far end', () => {
    // A silo of iron ore north into a dead-end line of 12 squares, (512,507) → (512,496): it fills
    // and jams, and its items coalesce into one run at the head (exact, canonical).
    const sim = testSim();
    stockedSilo(sim, 512, 508, 0, 'iron_ore', 300);
    sim.placeBelts('ribbon', line(512, 507, 0, 12));
    sim.run(900);
    const items = (x: number, y: number): number => (sim.chainAt(x, y)?.content ?? 0) / 1000;
    expect(items(512, 500)).toBe(12); // full: one item a square
    const ore0 = sim.stock[IRON()]!;
    expect(sim.place('router', 512, 501, 0).ok).toBe(true); // over (512,501): 6 squares behind it, 5 ahead
    sim.ensureCompiled();
    // Behind the router, the six squares keep their six items; ahead, five; the square it took
    // goes back to the Heart. Nothing over a ribbon's room, nothing vanishes.
    expect(items(512, 504)).toBe(6);
    expect(items(512, 498)).toBe(5);
    expect(sim.stock[IRON()]! - ore0).toBe(1000);
    for (const c of sim.graph.chains) expect(c.content).toBeLessThanOrEqual(c.capMu);
  });

  it('a swift ribbon dragged over a ribbon line upgrades it in place (refund + pay), and the line still delivers', () => {
    const sim = testSim();
    unlock(sim, 'dn1');
    sim.grant('gear', 20);
    drillToHearth(sim);
    sim.run(600);
    const old = DRILL_LINE.map(([x, y]) => sim.entityAt(x, y)!.id);
    const plate0 = sim.stock[PLATE()]!, gear0 = sim.stock[GEAR()]!;
    const plan = sim.planBelts('swift_ribbon', DRILL_LINE);
    expect(plan.map((s) => [s.def, s.skip, s.ok, s.replaces.length])).toEqual(DRILL_LINE.map(() => ['swift_ribbon', false, true, 1]));
    expect(sim.placeBelts('swift_ribbon', DRILL_LINE)).toBe(7);
    for (const [x, y, r] of DRILL_LINE) {
      expect(defAt(sim, x, y)).toBe('swift_ribbon');
      expect(sim.entityAt(x, y)!.rot).toBe(r);
    }
    for (const id of old) expect(sim.ents.get(id)).toBeUndefined();
    expect(plate0 - sim.stock[PLATE()]!).toBe(7000); // 7 paid, none back (the basic ribbon is free)
    expect(gear0 - sim.stock[GEAR()]!).toBe(7000);
    // The same drag again: the very same ribbon in the same direction is skipped, nothing refused.
    expect(sim.planBelts('swift_ribbon', DRILL_LINE).every((s) => s.skip && s.ok)).toBe(true);
    expect(sim.placeBelts('swift_ribbon', DRILL_LINE)).toBe(0);
    const ore0 = sim.stock[IRON()]!;
    sim.run(1800);
    expect(sim.stock[IRON()]! - ore0).toBeGreaterThan(20_000);
  });

  it('a distributor placed over a 2×2 of ribbons and routers replaces all four', () => {
    const sim = testSim();
    unlock(sim, 'dn5');
    sim.grant('gear', 10);
    const ids = [
      sim.place('router', 520, 520, 0).id!,
      sim.place('ribbon', 521, 520, 1).id!,
      sim.place('ribbon', 520, 521, 2).id!,
      sim.place('router', 521, 521, 0).id!,
    ];
    const plate0 = sim.stock[PLATE()]!, wire0 = sim.stock[WIRE()]!, gear0 = sim.stock[GEAR()]!;
    const c = sim.canPlace('distributor', 520, 520, 0);
    expect(c.ok, c.reason).toBe(true);
    expect(c.replaces).toEqual([...ids].sort((a, b) => a - b));
    const d = sim.place('distributor', 520, 520, 0);
    expect(d.ok).toBe(true);
    for (const id of ids) expect(sim.ents.get(id)).toBeUndefined();
    for (const [x, y] of [[520, 520], [521, 520], [520, 521], [521, 521]] as const) expect(sim.entityAt(x, y)!.id).toBe(d.id);
    // Refunds: 1 + 1 plates (the ribbons were free); the distributor costs 4 plates and 2 wires.
    expect(plate0 - sim.stock[PLATE()]!).toBe(2000);
    expect(wire0 - sim.stock[WIRE()]!).toBe(2000);
    expect(gear0 - sim.stock[GEAR()]!).toBe(0);
  });

  it('every replace group replaces within itself: a pylon over a pole, a deep bore over a dome drill, a conduit turned', () => {
    const sim = testSim();
    unlock(sim, 'tr3', 'tr4', 'ex5');
    for (const [it, n] of [['ceramic', 100], ['thermal_core', 10], ['gear', 30]] as const) sim.grant(it, n);
    const mast = sim.place('mast', 520, 520, 0);
    expect(sim.place('pylon', 520, 520, 0)).toMatchObject({ ok: true, replaces: [mast.id] });
    const drill = sim.place('drill', 509, 499, 0);
    expect(drill.ok, drill.reason).toBe(true);
    expect(sim.place('deep_bore', 509, 499, 0)).toMatchObject({ ok: true, replaces: [drill.id] });
    const pipe = sim.place('conduit', 524, 520, 0);
    expect(sim.place('conduit', 524, 520, 1)).toMatchObject({ ok: true, replaces: [pipe.id] });
  });

  it('refused: another group, a partial overlap, the very same building, and the Hearth — always occupied', () => {
    const sim = testSim();
    unlock(sim, 'dn5', 'tr3');
    sim.grant('gear', 10);
    sim.grant('ceramic', 10);
    // Another group: a kiln, a mast or a conduit over a ribbon.
    sim.place('ribbon', 520, 520, 1);
    expect(sim.canPlace('kiln', 520, 520, 0).reason).toBe('occupied');
    expect(sim.canPlace('mast', 520, 520, 0).reason).toBe('occupied');
    expect(sim.canPlace('conduit', 520, 520, 1).reason).toBe('occupied');
    // A partial overlap: a distributor half over a kiln, or half over another distributor; a
    // router (or a one-tile ribbon drag) on one tile of a distributor.
    expect(sim.place('kiln', 527, 514, 0).ok).toBe(true); // inside the Hearth's level-1 zone (r 18)
    expect(sim.canPlace('distributor', 526, 514, 0).reason).toBe('occupied');
    const dist = sim.place('distributor', 524, 524, 0);
    expect(dist.ok, dist.reason).toBe(true);
    expect(sim.canPlace('distributor', 525, 524, 0).reason).toBe('occupied');
    expect(sim.canPlace('router', 525, 525, 0).reason).toBe('occupied');
    expect(sim.placeBelts('ribbon', [[525, 525, 1]])).toBe(0);
    expect(sim.entityAt(525, 525)!.id).toBe(dist.id);
    // The very same building: nothing to do. Turning a distributor changes nothing either; turning
    // a router does (it takes in at its back only), so that is a replacement.
    expect(sim.canPlace('ribbon', 520, 520, 1).reason).toBe('occupied');
    expect(sim.canPlace('distributor', 524, 524, 0).reason).toBe('occupied');
    expect(sim.canPlace('distributor', 524, 524, 1).reason).toBe('occupied');
    sim.place('router', 522, 520, 0);
    expect(sim.canPlace('router', 522, 520, 0).reason).toBe('occupied');
    expect(sim.canPlace('router', 522, 520, 1).reason).toBe('ok');
    // The Hearth is never replaced, nor rebuilt.
    expect(sim.canPlace('router', 512, 512, 0).reason).toBe('occupied');
    expect(sim.canPlace('distributor', 509, 509, 0).reason).toBe('occupied');
    expect(sim.placeBelts('ribbon', [[512, 509, 2], [512, 510, 2]])).toBe(1); // only the tile off the Hearth
    expect(sim.canPlace('hearth', 520, 530, 0).reason).toBe('not_buildable');
    expect(sim.entityAt(512, 512)!.id).toBe(sim.hearthId);
  });

  it('affordability counts the refund: a stock too low on its own, plus what is replaced, is enough', () => {
    const sim = testSim();
    unlock(sim, 'dn5');
    // A 2×2 of routers (a plate each, refunded when replaced) under a distributor (4 plates, 2 wires).
    const rts = [[520, 520], [521, 520], [520, 521], [521, 521]].map(([x, y]) => sim.place('router', x!, y!, 0).id!).sort((a, b) => a - b);
    sim.stock[PLATE()] = 0;
    sim.stock[WIRE()] = 2000;
    expect(sim.canPlace('distributor', 530, 520, 0).reason).toBe('unaffordable'); // no plate on its own…
    expect(sim.canPlace('distributor', 520, 520, 0)).toMatchObject({ ok: true, replaces: rts }); // …4 come back
    sim.stock[WIRE()] = 1000; // the routers give no wire back: still short of one
    expect(sim.canPlace('distributor', 520, 520, 0)).toMatchObject({ ok: false, reason: 'unaffordable', replaces: rts });
    sim.stock[WIRE()] = 2000;
    expect(sim.place('distributor', 520, 520, 0).ok).toBe(true);
    expect(sim.stock[PLATE()]).toBe(0); // 0 + 4 − 4
    expect(sim.stock[WIRE()]).toBe(0); // 2 − 2
  });

  it('a drag shares one budget: its plan runs out of materials exactly where laying it does', () => {
    const sim = testSim();
    unlock(sim, 'dn1');
    sim.placeBelts('ribbon', line(520, 520, 1, 5));
    sim.grant('gear', 3); // a swift ribbon costs a plate and a gear; each plain one gives its plate back
    const plan = sim.planBelts('swift_ribbon', line(520, 520, 1, 5));
    expect(plan.map((s) => s.ok ? 'ok' : s.reason)).toEqual(['ok', 'ok', 'ok', 'unaffordable', 'unaffordable']);
    expect(sim.placeBelts('swift_ribbon', line(520, 520, 1, 5))).toBe(3);
    expect([520, 521, 522, 523, 524].map((x) => defAt(sim, x, 520))).toEqual(['swift_ribbon', 'swift_ribbon', 'swift_ribbon', 'ribbon', 'ribbon']);
    expect(sim.stock[GEAR()]).toBe(0);
  });

  it('a ribbon drag through routing blocks, a junction and a bridge keeps them; a one-tile click replaces a router', () => {
    const sim = testSim();
    unlock(sim, 'dn5');
    sim.grant('gear', 10);
    const router = sim.place('router', 517, 520, 0).id!;
    const kept = [router, sim.place('crossing', 519, 520, 0).id!, sim.place('sorter', 521, 520, 1).id!, sim.place('skybridge', 523, 520, 1).id!, sim.place('distributor', 525, 520, 0).id!];
    const path = line(515, 520, 1, 12); // (515..526, 520) east
    const plan = sim.planBelts('ribbon', path);
    expect(plan.filter((s) => s.skip).map((s) => [s.x, s.def])).toEqual([[517, 'router'], [519, 'crossing'], [521, 'sorter'], [523, 'skybridge'], [525, 'distributor'], [526, 'distributor']]);
    expect(sim.placeBelts('ribbon', path)).toBe(6);
    for (const id of kept) expect(sim.ents.get(id)).toBeDefined();
    // A click (a one-tile drag) on the router replaces it; on the distributor it does not fit.
    expect(sim.placeBelts('ribbon', [[517, 520, 1]])).toBe(1);
    expect(defAt(sim, 517, 520)).toBe('ribbon');
    expect(sim.ents.get(router)).toBeUndefined();
    expect(sim.placeBelts('ribbon', [[525, 520, 1]])).toBe(0);
    // Re-dragging a line through its router: nothing to lay, and the line still delivers.
    const s2 = testSim();
    drillToHearth(s2);
    expect(s2.place('router', 511, 507, 0).ok).toBe(true);
    expect(s2.placeBelts('ribbon', DRILL_LINE)).toBe(0);
    expect(defAt(s2, 511, 507)).toBe('router');
    const ore0 = s2.stock[IRON()]!;
    s2.run(2400);
    expect(s2.stock[IRON()]! - ore0).toBeGreaterThan(20_000);
  });

  it('a ribbon drag straight across a ribbon line lays a junction there, and both lines still deliver', () => {
    const sim = testSim();
    // Line B: sand drill east of the Hearth, west into its east inlet (514,511).
    const sandDrill = sim.place('sand_collector', 522, 510, 3);
    expect(sandDrill.ok).toBe(true);
    expect(sim.placeBelts('ribbon', line(521, 511, 3, 7))).toBe(7);
    // Line A: iron drill north-east, south across line B at (517,511), then west into (514,513).
    const ironDrill = sim.place('drill', 516, 502, 2);
    expect(ironDrill.ok).toBe(true);
    wire(sim, [sandDrill.id!, ironDrill.id!]); // both drills on the Hearth's grid (D25)
    sim.run(600);
    const path: Array<[number, number, Rot]> = [...line(517, 504, 2, 9), [517, 513, 3], [516, 513, 3], [515, 513, 3]];
    const plan = sim.planBelts('ribbon', path);
    expect(plan.filter((s) => s.def === 'crossing').map((s) => [s.x, s.y, s.replaces.length])).toEqual([[517, 511, 1]]);
    const log0 = sim.log.length;
    expect(sim.placeBelts('ribbon', path)).toBe(12);
    // The log holds the plan's placements one by one, the junction as a junction.
    expect(sim.log.slice(log0).map((l) => l.cmd)).toEqual(plan.filter((s) => !s.skip).map((s) => ({ k: 'place', def: s.def, x: s.x, y: s.y, rot: s.rot, cfg: 0 })));
    expect(defAt(sim, 517, 511)).toBe('crossing');
    sim.ensureCompiled();
    expect(sim.chainAt(518, 511)).toBe(sim.chainAt(516, 511)); // line B runs through as one ribbon
    expect(sim.chainAt(517, 510)).toBe(sim.chainAt(517, 512)); // and so does line A
    const ore0 = sim.stock[IRON()]!, sand0 = sim.stock[SAND()]!;
    sim.run(2400);
    expect(sim.stock[IRON()]! - ore0).toBeGreaterThan(20_000);
    expect(sim.stock[SAND()]! - sand0).toBeGreaterThan(20_000);
    const b = testSim();
    replay(b, sim.log, sim.tick);
    expect(b.hash()).toBe(sim.hash());
  });

  it('a junction only where the drag runs straight across: not at an end, not at a bend, not for a click', () => {
    const sim = testSim();
    sim.placeBelts('ribbon', line(520, 515, 2, 10)); // (520, 515..524) south
    const at = (path: Array<[number, number, Rot]>, x: number, y: number): [string, boolean, number] => {
      const s = sim.planBelts('ribbon', path).find((p) => p.x === x && p.y === y)!;
      return [s.def, s.skip, s.replaces.length];
    };
    expect(at(line(517, 520, 1, 7), 520, 520)).toEqual(['crossing', false, 1]); // straight across
    expect(at(line(520, 518, 1, 3), 520, 518)).toEqual(['ribbon', false, 1]); // the drag starts on the line: turned
    expect(at(line(517, 522, 1, 4), 520, 522)).toEqual(['ribbon', false, 1]); // ends on it: turned
    expect(at([[520, 516, 2], [520, 517, 2], [520, 518, 1], [521, 518, 1]], 520, 518)).toEqual(['ribbon', false, 1]); // a bend on it
    expect(at([[520, 516, 2], [520, 517, 2], [520, 518, 1], [521, 518, 1]], 520, 517)).toEqual(['ribbon', true, 0]); // along it: kept
    expect(at([[520, 520, 1]], 520, 520)).toEqual(['ribbon', false, 1]); // a click turns it
  });

  it('re-placing a sorter with another rotation keeps its chosen item (settings given explicitly win)', () => {
    const sim = testSim();
    const s = sim.place('sorter', 520, 520, 0);
    expect(sim.setForkFilter(s.id!, 0, 'iron_ore')).toBe(true);
    expect(sim.canPlace('sorter', 520, 520, 0).reason).toBe('occupied'); // the very same: nothing to do
    const turned = sim.place('sorter', 520, 520, 1);
    expect(turned).toMatchObject({ ok: true, replaces: [s.id] });
    const e = sim.ents.get(turned.id!)!;
    expect(e.rot).toBe(1);
    expect(filterOf(e.cfg, 0)).toBe(IRON());
    // The kept item is logged with the placement, so a replay does not have to infer it.
    expect(sim.log[sim.log.length - 1]!.cmd).toEqual({ k: 'place', def: 'sorter', x: 520, y: 520, rot: 1, cfg: e.cfg });
    const cleared = sim.place('sorter', 520, 520, 2, 0);
    expect(filterOf(sim.ents.get(cleared.id!)!.cfg, 0)).toBe(-1);
    const b = testSim();
    replay(b, sim.log, sim.tick);
    expect(b.hash()).toBe(sim.hash());
  });
});
