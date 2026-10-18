// levels.test.ts — the land's levels (D45): a ribbon, a port or a wire meets only its own level;
// a traction ribbon climbs or comes down one; a building stands on level ground. Placement
// refuses a line piece facing a step it cannot take (D77): a plain ribbon, a traction ribbon
// facing two terraces, a conduit.
import { describe, it, expect } from 'vitest';
import { BUILDING_IDS, itemIdx } from '@/content/registry';
import { WORLD_EPOCH0 } from './constants';
import { Sim } from './state';
import { deserialize, serialize } from './serialize';
import { learnPlans, line, stockedSilo } from './testkit';
import { T, type Rot } from './types';
import { FlatSource } from './world/grid';

/** The ridge of soft rock (level 1) across x 509–515, y 503–504, and a level-3 crag further east. */
const RIDGE = [{ x: 509, y: 503, w: 7, h: 2, t: T.Rock1, level: 1 }, { x: 530, y: 500, w: 3, h: 3, t: T.Rock3, level: 3 }];

/** A flat base with the ridge and the crag (`flat`: without them, the same base before the land rose). */
function ridgeSim(flat = false): Sim {
  const sim = new Sim({
    worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24,
    source: new FlatSource([], flat ? [] : RIDGE),
  });
  learnPlans(sim);
  sim.grant('iron_plate', 200); sim.grant('copper_wire', 100);
  return sim;
}

/**
 * Copper ore from a silo north of the ridge, down x = 512 to the Heart's north inlet (512,510);
 * `climb`: the ridge's edges take traction ribbons. Without them the line is laid on the flat
 * land and the ridge raised under it after (a save reloaded): a base laid before D77 refused it.
 */
function overTheRidge(climb: boolean): Sim {
  const sim = ridgeSim(!climb);
  stockedSilo(sim, 512, 496, 2, 'copper_ore', 200); // hands out south into (512,498)
  const up = climb ? 'traction_ribbon' : 'ribbon';
  const path: Array<[string, Array<[number, number, Rot]>]> = [
    ['ribbon', line(512, 498, 2, 4)],   // level 0, to (512,501)
    [up, [[512, 502, 2]]],              // level 0, facing the ridge
    ['ribbon', [[512, 503, 2]]],        // level 1, on the rock
    [up, [[512, 504, 2]]],              // level 1, facing the floor again
    ['ribbon', line(512, 505, 2, 5)],   // level 0, into the Heart
  ];
  for (const [def, tiles] of path) for (const [x, y, r] of tiles) expect(sim.place(def, x, y, r).ok, `${def} ${x},${y}`).toBe(true);
  return climb ? sim : deserialize(serialize(sim), new FlatSource([], RIDGE));
}

describe('the land’s levels (D45)', () => {
  it('a line climbs over a ridge only on traction ribbons; plain ribbons laid before D77 end at the cliff', () => {
    const COPPER = itemIdx('copper_ore');
    const over = overTheRidge(true);
    const c0 = over.stock[COPPER]!;
    over.run(1800);
    expect(over.stock[COPPER]! - c0).toBeGreaterThan(5000); // the line's pace through the traction ribbons (D141): plenty arrive

    const stuck = overTheRidge(false);
    const s0 = stuck.stock[COPPER]!;
    stuck.run(1800);
    expect(stuck.stock[COPPER]! - s0).toBe(0);
  });

  it('an elevator takes two tiles: a traction step right after or right before another is refused, one flat tile between is fine', () => {
    // Terraces east of the Heart: x 520 at level 1 (one tile deep), x 521–522 at level 2, x 523–524 at level 3.
    const sim = new Sim({
      worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24,
      source: new FlatSource([], [
        { x: 520, y: 500, w: 1, h: 4, t: T.Rock1, level: 1 }, { x: 521, y: 500, w: 2, h: 4, t: T.Rock1, level: 2 }, { x: 523, y: 500, w: 2, h: 4, t: T.Rock2, level: 3 },
      ]),
    });
    learnPlans(sim);
    sim.grant('iron_plate', 200); sim.grant('copper_wire', 100);
    // Up onto the one-tile terrace, then straight up again: the second step has no flat tile in front of the first.
    expect(sim.place('traction_ribbon', 519, 500, 1).ok).toBe(true);
    expect(sim.canPlace('traction_ribbon', 520, 500, 1).reason).toBe('lift_room');
    expect(sim.canPlace('ribbon', 520, 500, 1).reason).toBe('needs_lift'); // a plain ribbon would end against the cliff (D77)
    // The other order: the upper step first, then the one feeding it.
    expect(sim.place('traction_ribbon', 520, 501, 1).ok).toBe(true);
    expect(sim.canPlace('traction_ribbon', 519, 501, 1).reason).toBe('lift_room');
    // On the two-tile terrace there is room: a step, a flat ribbon, a step.
    expect(sim.place('traction_ribbon', 520, 502, 1).ok).toBe(true);
    expect(sim.place('ribbon', 521, 502, 1).ok).toBe(true);
    expect(sim.place('traction_ribbon', 522, 502, 1).ok).toBe(true);
  });

  it('a building stands on level ground; ribbons and poles stand on the rock too', () => {
    const sim = ridgeSim();
    expect(sim.canPlace('silo', 508, 502, 0).reason).toBe('uneven'); // a corner on the ridge
    expect(sim.canPlace('ribbon', 510, 503, 1).ok).toBe(true); // along the ridge
    expect(sim.canPlace('mast', 511, 504, 0).ok).toBe(true);
  });

  it('a line piece facing a step it cannot take is refused (D77)', () => {
    const sim = ridgeSim();
    sim.done.add('xp_swift'); sim.done.add('tr3'); // swift ribbons and conduits (research): granted outside the commands
    // Facing the wall from the floor, and facing the drop from the ridge's top: only a traction ribbon.
    expect(sim.canPlace('ribbon', 512, 502, 2).reason).toBe('needs_lift');
    expect(sim.canPlace('ribbon', 512, 504, 2).reason).toBe('needs_lift');
    expect(sim.canPlace('ribbon', 512, 503, 0).reason).toBe('needs_lift');
    expect(sim.canPlace('swift_ribbon', 512, 502, 2).reason).toBe('needs_lift');
    expect(sim.canPlace('traction_ribbon', 512, 502, 2).ok).toBe(true);
    expect(sim.canPlace('traction_ribbon', 512, 504, 2).ok).toBe(true);
    // Its back or its side to a cliff is fine: it is fed from its sides, or runs along the foot.
    expect(sim.canPlace('ribbon', 512, 502, 0).ok).toBe(true);
    expect(sim.canPlace('ribbon', 512, 502, 1).ok).toBe(true);
    expect(sim.canPlace('ribbon', 512, 505, 2).ok).toBe(true);
    // Three terraces at once: no elevator climbs that.
    expect(sim.canPlace('traction_ribbon', 529, 501, 1).reason).toBe('steep');
    expect(sim.canPlace('ribbon', 529, 501, 1).reason).toBe('needs_lift');
    // A conduit keeps to its level; a skybridge leaps to the next one on its level, past the ridge.
    expect(sim.canPlace('conduit', 512, 502, 2).reason).toBe('cliff');
    expect(sim.canPlace('skybridge', 512, 502, 2).ok).toBe(true);
  });

  it('a ribbon drag over the ridge takes its steps with traction ribbons by itself (D73)', () => {
    const sim = ridgeSim();
    const path = line(512, 500, 2, 8); // y 500–507 down x = 512: the ridge at y 503–504
    const plan = sim.planBelts('ribbon', path);
    expect(plan.map((s) => (s.ok ? s.def : s.reason))).toEqual(['ribbon', 'ribbon', 'traction_ribbon', 'ribbon', 'traction_ribbon', 'ribbon', 'ribbon', 'ribbon']);
    expect(sim.placeBelts('ribbon', path)).toBe(8);
    expect([502, 503, 504].map((y) => BUILDING_IDS[sim.entityAt(512, y)!.def])).toEqual(['traction_ribbon', 'ribbon', 'traction_ribbon']);
    // Before traction is learnt, the steps are left out and say why (D77).
    const early = ridgeSim();
    early.done.delete('traction');
    early.rebuildDerived();
    expect(early.planBelts('ribbon', path).map((s) => (s.ok ? 'ok' : s.reason))).toEqual(['ok', 'ok', 'needs_lift', 'ok', 'needs_lift', 'ok', 'ok', 'ok']);
    // Dragged over the ridge, the traction ribbon fits every tile: on the flat it is a ribbon at its line's pace (D141).
    expect(sim.planBelts('traction_ribbon', line(513, 500, 2, 8)).every((s) => s.ok)).toBe(true);
  });

  it('a wire climbs one terrace at most', () => {
    const sim = ridgeSim();
    const low = sim.place('mast', 516, 503, 0), mid = sim.place('mast', 514, 503, 0), foot = sim.place('mast', 529, 501, 0), crag = sim.place('mast', 531, 501, 0);
    for (const r of [low, mid, foot, crag]) expect(r.ok, r.reason).toBe(true);
    sim.run(600); // out of the zone: by kite
    for (const r of [low, mid, foot, crag]) sim.links.drop(r.id!); // the reach-out wires each new pole strung
    expect(sim.canLink(mid.id!, low.id!).reason).toBe('ok'); // 1 → 0, two tiles apart: one terrace
    expect(sim.canLink(foot.id!, crag.id!).reason).toBe('steep'); // 0 → 3, two tiles apart
  });
});
