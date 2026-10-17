import { describe, it, expect } from 'vitest';
import { buildingIdx, itemIdx } from '@/content/registry';
import { worldPorts } from './entities';
import { testSim, drillToHearth, line, steadyPower, stockedSilo, wire, IRON } from './testkit';
import { catchUp } from './offline/catchup';
import { tileIndex } from './world/grid';
import type { Sim } from './state';
import type { Rot } from './types';

/** Items of one kind riding the chain through a tile (items). */
const onChain = (sim: Sim, x: number, y: number, item: number): number => {
  const c = sim.chainAt(x, y);
  let t = 0;
  for (const r of c?.contents() ?? []) if (r.item === item) t += r.mu;
  return t / 1000;
};

/**
 * A silo of iron ore at (512,508) hands it out north, one ribbon square (512,507) into a routing
 * block at (512,506) facing north; three short dead-end lines leave it: straight on (north),
 * east, west. (The silo's other outlet, (513,508), faces an empty square.)
 */
function splitter(def: string, frontLen = 8, rot: Rot = 0): { sim: Sim; id: number } {
  const sim = testSim();
  stockedSilo(sim, 512, 508, 0, 'iron_ore', 300);
  sim.placeBelts('ribbon', [[512, 507, 0]]);
  const r = sim.place(def, 512, 506, rot);
  if (!r.ok) throw new Error(`${def}: ${r.reason}`);
  sim.placeBelts('ribbon', line(512, 505, 0, frontLen)); // straight on
  sim.placeBelts('ribbon', line(513, 506, 1, 8)); // east side
  sim.placeBelts('ribbon', line(511, 506, 3, 8)); // west side
  return { sim, id: r.id! };
}
const front = (s: Sim): number => onChain(s, 512, 504, IRON());
const sides = (s: Sim): number => onChain(s, 516, 506, IRON()) + onChain(s, 508, 506, IRON());

describe('logistics (routing blocks)', () => {
  it('a router hands items straight into a building’s port (no ribbon needed) — the Hearth here', () => {
    const sim = testSim();
    drillToHearth(sim);
    expect(sim.remove(511, 509)).toBe(true);
    expect(sim.place('router', 511, 509, 2).ok).toBe(true); // facing south: in from the line, out into the Hearth
    const ore0 = sim.stock[IRON()]!;
    sim.run(1800);
    expect(sim.stock[IRON()]! - ore0).toBeGreaterThan(20_000);
  });

  it('routers hand on to routers (a chain of two still delivers)', () => {
    const sim = testSim();
    drillToHearth(sim);
    sim.remove(511, 508); sim.remove(511, 509);
    expect(sim.place('router', 511, 508, 2).ok).toBe(true); // both facing south, down the line
    expect(sim.place('router', 511, 509, 2).ok).toBe(true);
    const ore0 = sim.stock[IRON()]!;
    sim.run(2400);
    expect(sim.stock[IRON()]! - ore0).toBeGreaterThan(20_000);
  });

  it('a router fed straight by a drill hands on parts of items, and a one-tile ribbon after it never jams on them', () => {
    // A poor iron patch (9.6/min: 16 milli-items a tick, so the parts never add up to round items,
    // as on most players' land) → drill facing east → router (in at its back) → one ribbon square
    // → a silo's inlet. A part must go into a ribbon holding the rest of that item: it once stuck
    // at 997 milli-items, the next part bigger than the room left and a router's part held whole.
    const sim = testSim([{ x: 518, y: 518, w: 2, h: 2, item: IRON(), rich: 240 }]);
    const d = sim.place('drill', 518, 518, 1); // out at (519,518) → (520,518)
    expect(d.ok, d.reason).toBe(true);
    wire(sim, d.id!);
    expect(sim.place('router', 520, 518, 1).ok).toBe(true);
    expect(sim.placeBelts('ribbon', [[521, 518, 1]])).toBe(1);
    const silo = sim.place('silo', 522, 518, 1); // inlets on its west side: (522,518|519)
    expect(silo.ok, silo.reason).toBe(true);
    sim.run(600 * 6);
    const held = sim.stores.get(silo.id!)![IRON()]!;
    expect(held / 1000).toBeGreaterThan(40); // ~9.6/min for 6 min, minus the trip
    sim.run(600);
    expect(sim.stores.get(silo.id!)![IRON()]! - held).toBeGreaterThan(6_000); // and it still flows
  });

  it('buildings set port to port pass items straight on, no ribbon: a silo into a wire mill, the mill into the Heart', () => {
    const sim = testSim();
    // A silo of copper ore (facing south: out at (511|512, 507)) over a wire mill (facing south:
    // in at (512,508), out at (512,509)) over the Heart's north input (512,510).
    stockedSilo(sim, 511, 506, 2, 'copper_ore', 30);
    const mill = sim.place('wire_mill', 512, 508, 2);
    expect(mill.ok, mill.reason).toBe(true);
    expect(sim.setRecipe(mill.id!, 'copper_wire')).toBe(true);
    wire(sim, mill.id!);
    const w0 = sim.stock[itemIdx('copper_wire')]!;
    sim.run(1800);
    expect(sim.graph.chains.length).toBe(0); // not one ribbon
    expect(sim.stock[itemIdx('copper_wire')]! - w0).toBeGreaterThan(20_000);
  });

  it('a router takes in at its back only, deals out front and sides in turn, and a side filter keeps that side for one item', () => {
    const a = splitter('router');
    a.sim.run(900);
    expect(front(a.sim)).toBeGreaterThan(2);
    expect(onChain(a.sim, 516, 506, IRON())).toBeGreaterThan(2); // east
    expect(onChain(a.sim, 508, 506, IRON())).toBeGreaterThan(2); // west
    // East kept for sand (no research needed): the iron goes front and west only.
    const b = splitter('router');
    expect(b.sim.setForkFilter(b.id, 1, 'sand')).toBe(true);
    b.sim.run(900);
    expect(onChain(b.sim, 516, 506, IRON())).toBe(0);
    expect(front(b.sim) + onChain(b.sim, 508, 506, IRON())).toBeGreaterThan(5);
    // Turned round, the line now runs into its front: nothing goes in.
    const c = splitter('router', 8, 2);
    c.sim.run(900);
    expect(front(c.sim) + sides(c.sim)).toBe(0);
  });

  it('a drill feeding the last square straight ahead does not stall the line that side-loads it: whole items, turn by turn (owner’s bug, 2026-10-13)', () => {
    // A coal patch east of the Heart; a drill on it hands west into the one-square ribbon (515,512)
    // that enters the Heart's east inlet. A line full of coal from a silo comes down x = 515 and
    // turns into that square from its side. The drill's part of an item used to sit there for good,
    // never leaving room for the line's whole items: only the drill delivered.
    const sim = testSim([{ x: 516, y: 509, w: 4, h: 6, item: itemIdx('coal'), rich: 300 }]);
    let drill = 0;
    for (const [x, y, rot] of [[516, 511, 0], [516, 511, 1], [516, 511, 2], [516, 511, 3], [516, 512, 0], [516, 512, 1], [516, 512, 2], [516, 512, 3]] as Array<[number, number, Rot]>) {
      const ports = worldPorts({ def: buildingIdx('drill'), x, y, rot });
      if (!ports.some((p) => p.io === 'out' && p.fx === 515 && p.fy === 512 && p.dir === 3)) continue;
      const r = sim.place('drill', x, y, rot);
      if (r.ok) { drill = r.id!; break; }
    }
    expect(drill).toBeGreaterThan(0);
    wire(sim, drill);
    stockedSilo(sim, 515, 503, 2, 'coal', 400); // hands out south into (515,505)
    expect(sim.placeBelts('ribbon', [...line(515, 505, 2, 7), [515, 512, 3]])).toBe(8);
    const coal0 = sim.stock[itemIdx('coal')]!;
    sim.run(2400);
    const got = (sim.stock[itemIdx('coal')]! - coal0) / 1000;
    expect(got).toBeGreaterThan(150); // the ribbon's pace (60/min over 4 min), not the drill's (~12/min)
  });

  it('a ribbon drag across the line just behind a router lays a junction there, and the line still feeds the router through it', () => {
    const sim = testSim();
    drillToHearth(sim);
    expect(sim.remove(511, 509)).toBe(true);
    expect(sim.place('router', 511, 509, 2).ok).toBe(true); // facing south: in from the line, out into the Heart
    // A line dragged east across (511,508), the square behind the router: a junction goes there.
    const path = line(508, 508, 1, 7);
    expect(sim.planBelts('ribbon', path).filter((s) => s.def === 'crossing').map((s) => [s.x, s.y])).toEqual([[511, 508]]);
    expect(sim.placeBelts('ribbon', path)).toBe(7);
    const ore0 = sim.stock[IRON()]!;
    sim.run(1800);
    expect(sim.stock[IRON()]! - ore0).toBeGreaterThan(20_000);
  });

  it('junctions set against a router pass its lines straight through: a store’s outlet into its back, its front and sides out', () => {
    const a = splitter('router');
    expect(a.sim.place('crossing', 512, 507, 0).ok).toBe(true); // silo outlet → junction → the router's back
    expect(a.sim.place('crossing', 512, 505, 0).ok).toBe(true); // front → junction → the front line
    expect(a.sim.place('crossing', 513, 506, 0).ok).toBe(true); // east side → junction → the east line
    a.sim.run(900);
    expect(front(a.sim)).toBeGreaterThan(2);
    expect(onChain(a.sim, 516, 506, IRON())).toBeGreaterThan(2); // east, past its junction
    expect(onChain(a.sim, 508, 506, IRON())).toBeGreaterThan(2); // west
    // Online and offline still agree.
    const b = splitter('router');
    for (const [x, y] of [[512, 507], [512, 505], [513, 506]] as const) b.sim.place('crossing', x, y, 0);
    a.sim.run(1200);
    catchUp(b.sim, 2100, { noDirect: true });
    expect(b.sim.hash()).toBe(a.sim.hash());
  });

  it('a sorter sends its item straight on and everything else to the sides; the inverted sorter the opposite', () => {
    const a = splitter('sorter');
    a.sim.setForkFilter(a.id, 0, 'iron_ore');
    a.sim.run(900);
    expect(front(a.sim)).toBeGreaterThan(3);
    expect(sides(a.sim)).toBe(0);

    const b = splitter('sorter');
    b.sim.setForkFilter(b.id, 0, 'sand'); // ore is "the others"
    b.sim.run(900);
    expect(front(b.sim)).toBe(0);
    expect(sides(b.sim)).toBeGreaterThan(3);

    const c = splitter('inverted_sorter');
    c.sim.setForkFilter(c.id, 0, 'iron_ore');
    c.sim.run(900);
    expect(front(c.sim)).toBe(0);
    expect(sides(c.sim)).toBeGreaterThan(3);
  });

  it('an overflow gate fills straight on first, then spills to the sides; an underflow gate the opposite', () => {
    // Fed by one ribbon: the front takes nearly all of it (a tick when its tail is packed spills).
    const o = splitter('overflow_gate', 12);
    o.sim.run(100); // ~8 items through: the 12-square front line is not full yet
    expect(front(o.sim)).toBeGreaterThan(3);
    expect(front(o.sim)).toBeGreaterThan(2 * sides(o.sim));
    const spilled = sides(o.sim);
    o.sim.run(3000); // the dead-end front line is full by now: everything goes aside
    expect(sides(o.sim)).toBeGreaterThan(spilled + 5);

    const u = splitter('underflow_gate');
    u.sim.run(100); // ~8 items through: the 16 side squares are not full yet
    expect(sides(u.sim)).toBeGreaterThan(3);
    expect(sides(u.sim)).toBeGreaterThan(4 * front(u.sim));
  });

  it('a ribbon fed from its side by a router is drawn as a bend (the graph says where it is fed from)', () => {
    const sim = testSim();
    drillToHearth(sim);
    sim.remove(511, 509);
    sim.place('router', 511, 509, 0);
    sim.placeBelts('ribbon', [[510, 509, 2 as Rot]]); // west of the router, heading south
    sim.ensureCompiled();
    expect(sim.graph.feedDirs.get(tileIndex(510, 509))).toBe(1 << 1); // fed from its east side
    expect(sim.graph.feedDirs.get(tileIndex(511, 508))! & (1 << 0)).toBeTruthy(); // the line above: fed from the north
  });

  it('routing blocks run the same offline as online (sorter → router → Hearth; a silo emptying beside)', () => {
    const make = (): Sim => {
      const sim = testSim();
      steadyPower(sim); // the drill runs day and night: one steady regime
      drillToHearth(sim);
      sim.remove(511, 507); sim.remove(511, 509);
      const s = sim.place('sorter', 511, 507, 2);
      if (!s.ok) throw new Error(`sorter ${s.reason}`);
      sim.setForkFilter(s.id!, 0, 'iron_ore');
      sim.place('router', 511, 509, 0);
      // A silo's outlets empty it by themselves (the unloader retired, D117): onto a dead-end line.
      stockedSilo(sim, 522, 520, 0, 'sand', 50);
      sim.placeBelts('ribbon', line(522, 519, 0, 6));
      sim.run(20);
      return sim;
    };
    const a = make(), b = make();
    a.run(2 * 36_000);
    catchUp(b, 2 * 36_000, { noDirect: true });
    expect(b.stock[IRON()]).toBe(a.stock[IRON()]);
    expect(b.hash()).toBe(a.hash());
  });
});
