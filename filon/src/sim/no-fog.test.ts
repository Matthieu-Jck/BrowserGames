// no-fog.test.ts — there is no fog of war (D148; owner, 2026-10-19: « make it so that there's no fog
// of war anywhere »): the whole world is known from the founding, for every base. A fresh base places
// anywhere the other rules allow, however far out (a kite flies the materials there, D60); it buys
// land wherever the land's own rules allow (next to its land, or anywhere with Far Claim, D70); and
// nothing it builds, buys or raises leaves a trace of exploration: the save holds no `explored`, and
// the command log replays to the same state. (D117's fog lifted round each building, parcel and Core
// level; this replaces its tests.)
import { describe, it, expect } from 'vitest';
import { replay } from './commands';
import { CENTER, WORLD } from './constants';
import { serialize } from './serialize';
import { testSim } from './testkit';
import { isFloor } from './types';
import { inWorld, tileIndex } from './world/grid';
import { parcelAt } from './world/land';
import type { Sim } from './state';

/** The free floor tile nearest (x, y), on land no neighbouring base holds (D110: a pole never stands there). */
function openTile(sim: Sim, x: number, y: number): [number, number] {
  for (let r = 0; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx, ty = y + dy;
        if (!inWorld(tx, ty) || sim.grid.occ[tileIndex(tx, ty)] !== 0 || !isFloor(sim.grid.terrain(tx, ty))) continue;
        if (sim.land.neighbour(parcelAt(tx, ty)) >= 0) continue;
        return [tx, ty];
      }
    }
  }
  throw new Error(`no open tile near ${x},${y}`);
}

describe('no fog of war (D148)', () => {
  it('a fresh base places anywhere on open land, out to the world’s far corners', () => {
    const sim = testSim(undefined, { plans: false });
    sim.grant('iron_plate', 100);
    sim.grant('copper_wire', 50);
    for (const [x, y] of [[CENTER + 300, CENTER], [CENTER, CENTER - 480], [6, 6], [WORLD - 7, WORLD - 7], [WORLD - 7, 9]] as const) {
      const [tx, ty] = openTile(sim, x, y);
      const c = sim.canPlace('mast', tx, ty, 0);
      expect(c.ok, `${tx},${ty}: ${c.reason}`).toBe(true);
      expect(c.delay).toBeGreaterThan(0); // off the claim's land: a kite flies it out
      expect(sim.place('mast', tx, ty, 0).ok).toBe(true);
    }
  });

  it('land is bought anywhere the land’s own rules allow: next to the claim’s, or anywhere with Far Claim', () => {
    const sim = testSim();
    // A parcel some ten rings out, held by no neighbouring base.
    const [fx, fy] = openTile(sim, CENTER + 230, CENTER - 230);
    const p = parcelAt(fx, fy);
    expect(sim.land.neighbour(p)).toBeLessThan(0);
    sim.grantCredits(sim.landPrice(p) * 2);
    expect(sim.buyLand(p)).toBe('far'); // adjacency still holds (D60)
    sim.done.add('xp_far');
    sim.rebuildDerived();
    expect(sim.mods.flags.has('farClaims')).toBe(true);
    expect(sim.buyLand(p)).toBeNull();
    expect(sim.land.covers(fx, fy)).toBe(true);
  });

  it('building, buying land and raising the Core leave no exploration behind: the save has no `explored`, a replay the same hash', () => {
    const sim = testSim();
    sim.grant('iron_plate', 100);
    sim.grant('copper_wire', 50);
    const [x, y] = openTile(sim, CENTER + 200, CENTER + 40);
    expect(sim.place('mast', x, y, 0).ok).toBe(true);
    const east = parcelAt(CENTER + 40, CENTER);
    sim.grantCredits(sim.landPrice(east));
    expect(sim.buyLand(east)).toBeNull();
    sim.run(600); // the kite lands
    const save = serialize(sim) as unknown as Record<string, unknown>;
    expect('explored' in save).toBe(false);
    expect('explored' in sim).toBe(false);
    const c = testSim();
    replay(c, sim.log, sim.tick);
    expect(c.hash()).toBe(sim.hash());
  });
});
