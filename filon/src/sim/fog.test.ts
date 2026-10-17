// fog.test.ts — the fog lifts as the claim grows (D117; the survey beacon retired, owner 2026-10-17:
// « On va supprimer le survey beacon, je n'aime pas »): round the Core by its level, round every
// parcel the claim comes to hold (the parcel and a margin), and round every building it stands up —
// a pylon as far as its wires reach, any other building `BAL.buildReveal` and its half-size, a line
// piece nothing — so a pole line walks the fog back. The list of discs grows only at the fog's edge.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { buildingDef, buildingIdx, revealOf } from '@/content/registry';
import { replay } from './commands';
import { CENTER } from './constants';
import { testSim } from './testkit';
import { parcelAt, parcelRect } from './world/land';
import type { Sim } from './state';

/** A test base with every plan, the pylon (Land Registry) and plenty to build with. */
function fogSim(): Sim {
  const sim = testSim();
  sim.done.add('tr4');
  sim.rebuildDerived();
  for (const [it, n] of [['iron_plate', 2000], ['glass', 400], ['copper_wire', 400], ['ceramic', 100]] as const) sim.grant(it, n);
  return sim;
}

/** The first tile east of the Heart, along its row, still in the fog. */
const edgeEast = (sim: Sim): number => { let x = CENTER; while (sim.revealed(x, CENTER)) x++; return x; };

describe('the fog (D117: no survey beacon)', () => {
  it('lifts round the Core by its level: the founding’s reach, then farther at each level', () => {
    const sim = fogSim();
    expect(sim.explored).toEqual([[CENTER, CENTER, BAL.coreReveal[0]]]);
    expect(edgeEast(sim)).toBe(CENTER + BAL.coreReveal[0]! + 1);
    expect(sim.upgradeHearth().ok).toBe(true);
    expect(sim.explored.at(-1)).toEqual([CENTER, CENTER, BAL.coreReveal[1]]);
    expect(edgeEast(sim)).toBe(CENTER + BAL.coreReveal[1]! + 1);
  });

  it('every building lifts it round itself but the line pieces; a pylon as far as its wires reach', () => {
    expect(revealOf(buildingDef(buildingIdx('pylon')))).toBe(40);
    expect(revealOf(buildingDef(buildingIdx('mast')))).toBe(BAL.buildReveal);
    expect(revealOf(buildingDef(buildingIdx('kiln')))).toBe(BAL.buildReveal + 1);
    for (const id of ['ribbon', 'traction_ribbon', 'router', 'sorter', 'crossing', 'skybridge', 'conduit', 'fence']) expect(revealOf(buildingDef(buildingIdx(id))), id).toBe(0);
  });

  it('a building in the clear adds no disc; a ribbon at the fog’s edge none either; a pole there lifts it', () => {
    const sim = fogSim();
    const n0 = sim.explored.length;
    expect(sim.place('mast', CENTER + 8, CENTER + 8, 0).ok).toBe(true); // deep in the clear
    expect(sim.explored.length).toBe(n0);
    const x = edgeEast(sim) - 1;
    expect(sim.placeBelts('ribbon', [[x, CENTER, 1]])).toBe(1);
    expect(sim.explored.length).toBe(n0);
    expect(sim.revealed(x + 6, CENTER)).toBe(false);
    expect(sim.place('mast', x - 1, CENTER + 1, 0).ok).toBe(true);
    expect(sim.explored.length).toBe(n0 + 1);
    expect(sim.revealed(x - 1 + BAL.buildReveal, CENTER + 1)).toBe(true);
    expect(sim.revealed(x + BAL.buildReveal, CENTER + 1)).toBe(false);
  });

  it('a pole line walks the fog back: each pole, wired to the last at the edge, lifts the next stretch', () => {
    const sim = fogSim();
    const start = edgeEast(sim);
    let prev = sim.place('mast', start - 1, CENTER, 0).id!;
    for (let k = 0; k < 8; k++) {
      // The farthest revealed tile a wire reaches (6 tiles).
      const last = sim.ents.get(prev)!;
      const x = last.x + 6;
      expect(sim.revealed(x, CENTER), `pole ${k}`).toBe(true);
      const r = sim.place('mast', x, CENTER, 0);
      expect(r.ok, r.reason).toBe(true);
      if (!sim.links.has(prev, r.id!)) expect(sim.link(prev, r.id!).reason).toBe('ok'); // a pole placed in reach wires itself
      expect(sim.links.has(prev, r.id!)).toBe(true);
      prev = r.id!;
    }
    // Eight poles 6 tiles apart: the fog's edge 48 tiles farther out, one disc a pole.
    expect(edgeEast(sim)).toBe(start + 48 + BAL.buildReveal);
    // The command log replays to the same fog (the grants are in it).
    const c = testSim();
    c.done.add('tr4');
    c.rebuildDerived();
    replay(c, sim.log, sim.tick);
    expect(c.explored).toEqual(sim.explored);
    expect(c.hash()).toBe(sim.hash());
  });

  it('a parcel newly held lifts it whole and a margin round it', () => {
    const sim = fogSim();
    const p = parcelAt(CENTER + 40, CENTER); // the first ring past the starting square, east
    expect(sim.revealed(CENTER + 57, CENTER)).toBe(false);
    sim.grantCredits(sim.landPrice(p));
    expect(sim.buyLand(p)).toBe(null);
    const { x0, y0, x1, y1 } = parcelRect(p);
    for (let y = y0 - 4; y < y1 + 4; y++) for (let x = x0 - 4; x < x1 + 4; x++) expect(sim.revealed(x, y), `${x},${y}`).toBe(true);
  });
});
