import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { buildingIdx, itemIdx } from '@/content/registry';
import { PLAN_IDS } from '@/content/research';
import { MAP_VERSION, WORLD_SEED } from '@/content/world';
import { CENTER, WORLD_EPOCH0 } from './constants';
import { worldPorts } from './entities';
import { faceRate, faceRot, faceTiles } from './face';
import { catchUp } from './offline/catchup';
import { Sim } from './state';
import { steadyPower, TEST_VENT, wire } from './testkit';
import { isFloor, isRock, opposite, T, type Rot } from './types';
import { FlatSource } from './world/grid';
import { MapGen } from './world/mapgen';
import { parcelAt, ringOf } from './world/land';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const CUTTER = (): number => buildingIdx('face_cutter');

/** A new base on the real land of player `seed` (today's map). */
const landSim = (seed: number, mapV = MAP_VERSION): Sim =>
  new Sim({ worldSeed: WORLD_SEED, playerSeed: seed, source: new MapGen(WORLD_SEED, seed, mapV), foundingEpoch: WORLD_EPOCH0 + 24 });

/** Where face cutters can stand along a land's vein, a cutter's back on two face tiles each (top-left, rot). */
function cutterSpots(sim: Sim): Array<[number, number, Rot]> {
  const V = sim.grid.source.quartzVein!;
  const out: Array<[number, number, Rot]> = [];
  for (let i = 0; i + 1 < V.n; i += 2) {
    // The two face tiles i, i + 1; the cutter's footprint on the floor in front of them.
    const fx = V.x + i * V.dx, fy = V.y + i * V.dy;
    const x = V.look === 1 ? fx + 1 : fx, y = V.look === 2 ? fy + 1 : fy;
    out.push([x, y, V.look]);
  }
  return out;
}

describe('the quartz vein (map 3, D87)', () => {
  it('every land of today has one: a wall of quartz in a parcel beside the starting square, floor at its foot, looking at the camera', () => {
    for (const seed of SEEDS) {
      const gen = new MapGen(WORLD_SEED, seed);
      const V = gen.quartzVein!;
      expect(V, `player ${seed}`).toBeTruthy();
      expect(V.n).toBe(8);
      expect([1, 2], `player ${seed}: the face looks east or south`).toContain(V.look);
      const sim = landSim(seed);
      const g = sim.grid, back = opposite(V.look);
      const parcels = new Set<number>();
      for (let i = 0; i < V.n; i++) {
        const x = V.x + i * V.dx, y = V.y + i * V.dy;
        const where = `player ${seed}: face tile ${i} (${x},${y})`;
        expect(isRock(g.terrain(x, y)), where).toBe(true);
        expect(g.level(x, y), where).toBe(1);
        expect(g.ore(x, y), where).toBe(itemIdx('quartz'));
        expect(g.capMuPerEpoch(x, y), where).toBe(BAL.depositRich.quartz! * 10);
        // Floor two tiles deep in front of it (a cutter's footprint), level 0, no rock or water.
        for (let k = 1; k <= 2; k++) {
          const px = x + k * [0, 1, 0, -1][V.look]!, py = y + k * [-1, 0, 1, 0][V.look]!;
          expect(isFloor(g.terrain(px, py)), `${where}: floor ${k} in front`).toBe(true);
          expect(g.level(px, py), `${where}: level 0 in front`).toBe(0);
          parcels.add(parcelAt(px, py));
        }
        parcels.add(parcelAt(x, y));
        void back;
      }
      // One parcel, the ring round the starting square (D74: 3×3 parcels of 23 tiles), beside it.
      expect([...parcels].length, `player ${seed}: one parcel`).toBe(1);
      expect(ringOf([...parcels][0]!), `player ${seed}: the parcel beside the start`).toBe(sim.land.reach + 1);
      // Never in the cirque: no quartz within the Crown.
      for (let i = 0; i < V.n; i++) {
        const x = V.x + i * V.dx, y = V.y + i * V.dy;
        expect((x - CENTER) ** 2 + (y - CENTER) ** 2, `player ${seed}`).toBeGreaterThan((gen.crownReach + 1) ** 2);
      }
    }
  });

  it('four face cutters stand along it, each on two face tiles at 15 a minute, turned by themselves to the wall', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const sim = landSim(seed);
      const spots = cutterSpots(sim);
      expect(spots.length).toBe(4);
      for (const [x, y, rot] of spots) {
        expect(faceTiles(sim.grid, CUTTER(), x, y, rot).length, `player ${seed} (${x},${y})`).toBe(2);
        expect(faceRate(sim.grid, CUTTER(), x, y, rot), `player ${seed}`).toEqual({ item: itemIdx('quartz'), rateEp: 10_000 });
        // Asked the wrong way round, it turns its back to the wall.
        expect(faceRot(sim.grid, CUTTER(), x, y, opposite(rot)), `player ${seed}`).toBe(rot);
      }
    }
  });

  it('no quartz on the lands founded before it (maps 1–2: a land never changes under a base)', () => {
    for (const mapV of [1, 2]) {
      const gen = new MapGen(WORLD_SEED, 3, mapV);
      expect(gen.quartzVein).toBeNull();
    }
  });

  it('its parcel costs what a first purchase can pay', () => {
    const prices: number[] = [];
    for (const seed of SEEDS.slice(0, 12)) {
      const sim = landSim(seed);
      const V = sim.grid.source.quartzVein!;
      prices.push(sim.landPrice(parcelAt(V.x, V.y)));
    }
    if (process.env.VEIN_REPORT) console.log('vein parcel prices (◉):', prices.map((c) => Math.round(c / 100)).join(' '));
    for (const c of prices) expect(c).toBeLessThan(60_000);
  });
});

/**
 * A flat test world with a quartz wall north-east of the Hearth: rock at level 1 on rows 500–501
 * (x 516–519), quartz in its south face (row 501), the floor below it; quartz on bare floor too
 * (x 520–521, rows 505–506), which no drill may take. Every plan and the face cutter's node learnt
 * outside commands (such a colony is not replayed, as `testSim`'s plans).
 */
function wallSim(): Sim {
  const Q = itemIdx('quartz');
  const src = new FlatSource(
    [{ x: 516, y: 501, w: 4, h: 1, item: Q, rich: 750 }, { x: 520, y: 505, w: 2, h: 2, item: Q, rich: 750 }],
    [{ x: 516, y: 500, w: 4, h: 2, t: T.Rock1, level: 1 }, { ...TEST_VENT, t: T.Vent }],
  );
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: src, foundingEpoch: WORLD_EPOCH0 + 24 });
  for (const id of [...PLAN_IDS, 'ex_quartz']) sim.done.add(id);
  sim.rebuildDerived();
  return sim;
}

describe('the face cutter (D87)', () => {
  it('stands on the floor at the wall\'s foot, its back to the face, never on it; it turns its back to the wall by itself', () => {
    const sim = wallSim();
    sim.grant('iron_plate', 200); sim.grant('glass', 50); sim.grant('copper_wire', 50);
    // On the rock: no (it is no rock building); off the wall: no face behind it.
    expect(sim.canPlace('face_cutter', 516, 500, 2).reason).toBe('terrain');
    expect(sim.canPlace('face_cutter', 516, 504, 2).reason).toBe('needs_face');
    // Facing the wall (its back away from it): the ghost and the placement turn it round.
    expect(sim.placementRot('face_cutter', 516, 502, 0)).toBe(2);
    const r = sim.place('face_cutter', 516, 502, 0);
    expect(r.ok, r.reason).toBe(true);
    expect(sim.ents.get(r.id!)!.rot).toBe(2);
    expect(sim.log.at(-1)!.cmd).toMatchObject({ k: 'place', def: 'face_cutter', rot: 2 });
    // A drill never takes a face ore, not even off the floor.
    expect(sim.canPlace('drill', 520, 505, 0).reason).toBe('needs_deposit');
  });

  it('cuts 5 a minute per face tile it touches (10 on two), into a ribbon from its front; the face stays a wall', () => {
    const sim = wallSim();
    steadyPower(sim);
    sim.grant('iron_plate', 200); sim.grant('glass', 50); sim.grant('copper_wire', 50);
    const one = sim.place('face_cutter', 518, 502, 2).id!; // one face tile left of its back… (x 518–519)
    const r = sim.place('face_cutter', 516, 502, 2);
    expect(r.ok, r.reason).toBe(true);
    wire(sim, [r.id!, one]);
    // Its output into a ribbon down to the Hearth's east input (515, 512) → (514, 512).
    const out = worldPorts(sim.ents.get(r.id!)!).find((p) => p.io === 'out')!;
    const path: Array<[number, number, Rot]> = [];
    for (let y = out.fy; y < 512; y++) path.push([out.fx, y, 2]);
    for (let x = out.fx; x > 515; x--) path.push([x, 512, 3]);
    path.push([515, 512, 3]);
    expect(sim.placeBelts('ribbon', path)).toBe(path.length);
    sim.ensureCompiled();
    const before = sim.stock[itemIdx('quartz')]!;
    sim.run(20 * 600);
    const perMin = (sim.stock[itemIdx('quartz')]! - before) / 1000 / 20;
    expect(perMin).toBeGreaterThan(9);
    expect(perMin).toBeLessThanOrEqual(10);
    // The other cutter, its output nowhere, touches two face tiles too (x 518, 519): 15 a minute when it can hand on.
    expect(faceRate(sim.grid, buildingIdx('face_cutter'), 518, 502, 2).rateEp).toBe(10_000);
    // An excavator would leave the face standing: no mark takes on a face tile.
    expect(sim.designate([501 * 1024 + 517])).toBe(0);
    expect(sim.designate([500 * 1024 + 517])).toBe(1);
  });

  it('the catch-up cuts what ticking cuts (an hour, bit for bit)', () => {
    const build = (sim: Sim): void => {
      steadyPower(sim);
      sim.grant('iron_plate', 200); sim.grant('glass', 50); sim.grant('copper_wire', 50);
      const r = sim.place('face_cutter', 516, 502, 2);
      wire(sim, r.id!);
      const out = worldPorts(sim.ents.get(r.id!)!).find((p) => p.io === 'out')!;
      const path: Array<[number, number, Rot]> = [];
      for (let y = out.fy; y < 512; y++) path.push([out.fx, y, 2]);
      for (let x = out.fx; x > 515; x--) path.push([x, 512, 3]);
      path.push([515, 512, 3]);
      sim.placeBelts('ribbon', path);
      sim.run(300);
    };
    const on = wallSim(), off = wallSim();
    build(on); build(off);
    on.run(36_000);
    catchUp(off, 36_000, { noDirect: true });
    expect(off.tick).toBe(on.tick);
    expect(Array.from(off.stock)).toEqual(Array.from(on.stock));
    expect(off.hash()).toBe(on.hash());
    expect(on.stock[itemIdx('quartz')]! / 1000).toBeGreaterThan(530);
  });
});
