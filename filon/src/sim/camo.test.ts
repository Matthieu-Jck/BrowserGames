// camo.test.ts — the camouflaged ribbon (D109): it runs where no other piece may (a neighbouring
// base's open land, D110; never through what stands there), costs the same on any land (no remote ×3; the kite's delay stays), a drag buries by
// itself what the land refuses and nothing else, it never climbs a step, it carries 40 a minute
// online and in the catch-up alike, the Gleaners walk over it without seeing it, and it replays
// and saves like any ribbon.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { buildingDef, buildingIdx, costOf, itemIdx } from '@/content/registry';
import { CENTER, WORLD, WORLD_EPOCH0 } from './constants';
import { replay } from './commands';
import { catchUp } from './offline/catchup';
import { deserialize, serialize } from './serialize';
import { Sim } from './state';
import { line, learnPlans, stockedSilo, testSim, testSource } from './testkit';
import { FlatSource } from './world/grid';
import { PARCEL, PARCEL_COLS, parcelAt, parcelRect, ringOf } from './world/land';
import { T, type Rot } from './types';

const CAMO = 'camo_ribbon';

/** A test colony with the camouflaged ribbon learnt (outside the commands, as the plans), plates and sand to spare. */
function camoSim(learn = true): Sim {
  const sim = testSim();
  if (learn) { sim.done.add('xp_camo'); sim.rebuildDerived(); }
  sim.grant('iron_plate', 500);
  sim.grant('sand', 500);
  return sim;
}

/**
 * A neighbouring base's parcel (D110) whose west neighbour is free land (CrierBelt's, not held), and
 * a row of it (`row`) where nothing of that base stands from 7 tiles west of it to its east edge,
 * surveyed: a drag can run east from the free parcel straight across its open land.
 */
function neighbourParcel(sim: Sim): { p: number; x0: number; y0: number; row: number } {
  for (let q = 0; q < PARCEL_COLS * PARCEL_COLS; q++) {
    if (sim.land.neighbour(q) < 0 || ringOf(q) > 8 || q % PARCEL_COLS === 0) continue;
    const w = q - 1;
    if (sim.land.holds(w) || sim.land.neighbour(w) >= 0) continue;
    const { x0, y0 } = parcelRect(q);
    if (x0 - PARCEL < 2 || x0 + 2 * PARCEL > WORLD - 2) continue;
    for (let row = y0 + 1; row < y0 + PARCEL - 1; row++) {
      let free = true;
      for (let x = x0 - 7; x < x0 + PARCEL && free; x++) if (sim.neighbours.at(x, row)) free = false;
      if (!free) continue;
      sim.explored.push([x0, row, 40]);
      return { p: q, x0, y0, row };
    }
  }
  throw new Error('no neighbouring base\'s parcel beside free land with an open row');
}

describe('the camouflaged ribbon (D109)', () => {
  it('runs across a neighbouring base\'s open land, where every other piece is refused; never through its buildings', () => {
    const sim = camoSim(false);
    sim.done.add('xp_swift'); sim.rebuildDerived();
    const { p, x0, row } = neighbourParcel(sim);
    const x = x0 + 5, y = row;
    expect(sim.canPlace('ribbon', x, y, 1).reason).toBe('neighbour_land');
    expect(sim.canPlace('swift_ribbon', x, y, 1).reason).toBe('neighbour_land');
    expect(sim.canPlace(CAMO, x, y, 1).reason).toBe('locked');
    sim.done.add('xp_camo'); sim.rebuildDerived();
    const c = sim.canPlace(CAMO, x, y, 1);
    expect(c.reason).toBe('ok');
    expect(c.delay).toBeGreaterThan(0); // a kite flies it out, as any piece off the claim's land
    // Everything else keeps the rule: a pole, a traction ribbon, a junction.
    expect(sim.canPlace('mast', x + 4, y, 0).reason).toBe('neighbour_land');
    expect(sim.canPlace('traction_ribbon', x + 8, y, 1).reason).toBe('neighbour_land');
    expect(sim.place(CAMO, x, y, 1).ok).toBe(true);
    // What the neighbour has standing on its land is its own: occupied, for the buried ribbon too.
    const { x0: px, y0: py } = parcelRect(p);
    let built: [number, number] | null = null;
    for (let ty = py; ty < py + PARCEL && !built; ty++) for (let tx = px; tx < px + PARCEL && !built; tx++) if (sim.neighbours.at(tx, ty)) built = [tx, ty];
    if (built) {
      sim.explored.push([built[0], built[1], 4]);
      expect(sim.canPlace(CAMO, built[0], built[1], 1).reason).toBe('occupied');
    }
  });

  it('costs the same on any land (no remote surcharge): its plates and sand; a swift ribbon pays ×3 off the claim', () => {
    const sim = camoSim();
    sim.done.add('xp_swift'); sim.rebuildDerived();
    sim.explored.push([CENTER + 2 * PARCEL, CENTER, 12]);
    const base = costOf(buildingIdx(CAMO));
    expect(base.map((c) => [c.item, c.mu])).toEqual([[itemIdx('iron_plate'), 1000], [itemIdx('sand'), 2000]]);
    const home = sim.canPlace(CAMO, CENTER + 6, CENTER + 6, 0);
    // East of the starting square, ring 2: free land (CrierBelt's), never a neighbouring base's.
    const fx = CENTER + 2 * PARCEL, fy = CENTER;
    expect(sim.land.covers(fx, fy)).toBe(false);
    const away = sim.canPlace(CAMO, fx, fy, 0);
    expect(home.ok && away.ok).toBe(true);
    expect(away.cost).toEqual(home.cost);
    expect(home.delay).toBe(0);
    expect(away.delay).toBeGreaterThan(0);
    const swift = sim.canPlace('swift_ribbon', fx, fy, 0);
    expect(swift.cost.map((c) => c.mu)).toEqual(costOf(buildingIdx('swift_ribbon')).map((c) => c.mu * BAL.remoteBeltCostMult));
    // The building's own numbers: slower than the plain ribbon.
    expect(buildingDef(buildingIdx(CAMO)).belt!.perMin).toBe(40);
    expect(buildingDef(buildingIdx(CAMO)).belt!.perMin).toBeLessThan(buildingDef(buildingIdx('ribbon')).belt!.perMin);
  });

  it('a drag buries by itself the pieces its land refuses, and only those', () => {
    const run = (learn: boolean) => {
      const sim = camoSim(learn);
      const { p, x0, row } = neighbourParcel(sim);
      // From the free parcel west of it, 30 tiles east: 7 on free land, then 23 across the neighbour's.
      const path = line(x0 - 7, row, 1, 30);
      const plan = sim.planBelts('ribbon', path);
      return { sim, plan, p, x0, row };
    };
    const { sim, plan, p, x0, row } = run(true);
    for (const st of plan) {
      const theirs = parcelAt(st.x, st.y) === p;
      expect(st.ok).toBe(true);
      expect(st.def).toBe(theirs ? CAMO : 'ribbon');
    }
    expect(plan.filter((st) => st.def === CAMO)).toHaveLength(PARCEL);
    const laid = sim.placeBelts('ribbon', line(x0 - 7, row, 1, 30));
    expect(laid).toBe(30);
    expect(sim.entityAt(x0 + 3, row)!.def).toBe(buildingIdx(CAMO));
    expect(sim.entityAt(x0 - 3, row)!.def).toBe(buildingIdx('ribbon'));
    // Not learnt: the neighbour's tiles stay refused, the drag is laid in part.
    const without = run(false).plan;
    expect(without.filter((st) => !st.ok && st.reason === 'neighbour_land')).toHaveLength(PARCEL);
    expect(without.some((st) => st.def === CAMO)).toBe(false);
  });

  it('a plain drag over free land stays plain (it costs nothing even off the claim)', () => {
    const sim = camoSim();
    const fx = CENTER + 2 * PARCEL - 5, fy = CENTER + 3;
    sim.explored.push([fx + 5, fy, 12]);
    const plan = sim.planBelts('ribbon', line(fx, fy, 1, 10));
    expect(plan.every((st) => st.ok && st.def === 'ribbon')).toBe(true);
    expect(plan.some((st) => !sim.land.covers(st.x, st.y))).toBe(true);
  });

  it('never climbs a step: facing a terrace it wants a traction ribbon, which a drag lays where the land allows', () => {
    // A terrace (level 1 rock) east of the Heart, on the claim's land.
    const rock = { x: CENTER + 12, y: CENTER - 4, w: 6, h: 9, t: T.Rock1 };
    const lv = new Sim({ worldSeed: 7, playerSeed: 11, source: new FlatSource([], [rock]), foundingEpoch: WORLD_EPOCH0 + 24 });
    learnPlans(lv);
    lv.done.add('xp_camo'); lv.rebuildDerived();
    lv.grant('iron_plate', 200); lv.grant('sand', 200); lv.grant('copper_wire', 200);
    const y = CENTER;
    expect(lv.canPlace(CAMO, rock.x - 1, y, 1).reason).toBe('needs_lift');
    const plan = lv.planBelts(CAMO, line(rock.x - 4, y, 1, 6));
    const step = plan.find((st) => st.x === rock.x - 1)!;
    expect(step.def).toBe('traction_ribbon');
    expect(step.ok).toBe(true);
    expect(plan.filter((st) => st.x !== rock.x - 1).every((st) => st.def === CAMO)).toBe(true);
  });

  it('carries 40 a minute, online and in the catch-up alike', () => {
    const build = (): { sim: Sim; to: number } => {
      const sim = camoSim();
      stockedSilo(sim, CENTER - 12, CENTER + 12, 0, 'iron_plate', 2000);
      expect(sim.placeBelts(CAMO, line(CENTER - 12, CENTER + 11, 0, 10))).toBe(10);
      const to = sim.place('silo', CENTER - 12, CENTER, 0);
      expect(to.ok).toBe(true);
      sim.run(600); // warmed up: the line full
      return { sim, to: to.id! };
    };
    const on = build(), off = build();
    const plate = itemIdx('iron_plate');
    const before = on.sim.stores.get(on.to)![plate]!;
    on.sim.run(6000);
    const perMin = (on.sim.stores.get(on.to)![plate]! - before) / 1000 / 10;
    expect(perMin).toBeGreaterThanOrEqual(39);
    expect(perMin).toBeLessThanOrEqual(41);
    catchUp(off.sim, 6000, { noDirect: true });
    expect(off.sim.hash()).toBe(on.sim.hash());
  });

  it('replays and saves like any ribbon', () => {
    const sim = camoSim();
    const { x0, row } = neighbourParcel(sim);
    expect(sim.placeBelts('ribbon', line(x0 - 3, row, 1, 12))).toBe(12);
    sim.run(3000);
    const fresh = camoSim();
    neighbourParcel(fresh);
    replay(fresh, sim.log.slice(fresh.log.length), sim.tick);
    expect(fresh.hash()).toBe(sim.hash());
    const back = deserialize(serialize(sim), testSource());
    expect(back.hash()).toBe(sim.hash());
    expect([...back.ents.map.values()].filter((e) => e.def === buildingIdx(CAMO))).toHaveLength(9);
  });
});

/** A desert with a Crown (as gleaners.test.ts): a ring of rock round the centre, its foot at r 15; sand past it. */
class DesertSource extends FlatSource {
  readonly crownOuter = 15;
  constructor(rocks: ReadonlyArray<{ x: number; y: number; w: number; h: number; t: number }> = []) {
    const c = CENTER;
    super([], [
      { x: c - 14, y: c - 14, w: 29, h: 4, t: T.Rock1 }, { x: c - 14, y: c + 11, w: 29, h: 4, t: T.Rock1 },
      { x: c - 14, y: c - 14, w: 4, h: 29, t: T.Rock1 }, { x: c + 11, y: c - 14, w: 4, h: 29, t: T.Rock1 },
      ...rocks,
    ]);
  }
}

/** Day epoch 0 of world day 1: the night's first minute. */
const NIGHT = WORLD_EPOCH0 + 36;
const ti = (x: number, y: number): number => y * WORLD + x;

describe('the camouflaged ribbon and the Gleaners (D109)', () => {
  /**
   * A pocket of sand out in the desert, x 541…547, y 501…507, rock on its north, east and south
   * sides, and on its west side (x 540) a column of `side` (each piece facing west, out into the
   * desert: facing the rock at either end it would want a traction ribbon); a lone plain ribbon tile in its middle.
   */
  const pocket = (side: string): Sim => {
    const sim = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: NIGHT, source: new DesertSource([
      { x: 540, y: 500, w: 9, h: 1, t: T.Rock1 }, { x: 540, y: 508, w: 9, h: 1, t: T.Rock1 }, { x: 548, y: 500, w: 1, h: 9, t: T.Rock1 },
    ]) });
    learnPlans(sim);
    sim.done.add('xp_camo'); sim.rebuildDerived();
    sim.grant('iron_plate', 200); sim.grant('sand', 200);
    sim.explored.push([540, 504, 30]);
    for (let y = 501; y <= 507; y++) expect(sim.placeBelts(side, [[540, y, 3 as Rot]])).toBe(1);
    expect(sim.placeBelts('ribbon', [[544, 504, 0 as Rot]])).toBe(1);
    sim.run(200); // the kites land (off the claim's land)
    sim.ensureCompiled();
    return sim;
  };

  it('they never see it: a buried line beside the open desert is guarded, never exposed', () => {
    const sim = pocket(CAMO);
    const g = sim.graph.glean;
    const line7 = [501, 502, 503, 504, 505, 506, 507].map((y) => ti(540, y));
    for (const t of line7) {
      expect(g.exposed.includes(t)).toBe(false);
      expect(g.guarded.includes(t)).toBe(true);
      expect(g.glass.includes(t)).toBe(false);
    }
  });

  it('they walk over it: a buried line closes no pocket, a plain one does', () => {
    const plain = pocket('ribbon'), buried = pocket(CAMO);
    const probe = ti(544, 504);
    expect(plain.graph.glean.exposed.includes(probe)).toBe(false); // the pocket is closed in: out of their reach
    expect(plain.graph.glean.guarded.includes(probe)).toBe(true);
    expect(buried.graph.glean.exposed.includes(probe)).toBe(true); // open to the desert over the buried line
  });

  it('takes nothing off a buried line through a whole night', () => {
    const sim = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: NIGHT, source: new DesertSource() });
    learnPlans(sim);
    sim.done.add('xp_camo'); sim.rebuildDerived();
    sim.grant('iron_plate', 200); sim.grant('sand', 200);
    stockedSilo(sim, 530, 520, 0, 'glass', 4000);
    expect(sim.placeBelts(CAMO, line(530, 519, 0, 20))).toBe(20);
    expect(sim.place('silo', 530, 498, 0).ok).toBe(true);
    sim.run(12 * 600 + 1200); // the dark hours and then some
    expect(sim.gleaned[itemIdx('glass')]).toBe(0);
  });
});
