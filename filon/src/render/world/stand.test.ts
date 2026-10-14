// stand.test.ts — where a building stands (D44) and how it sorts with the cliffs: on the floor at 0;
// on the mountains on the rock top, at the one height function's level (relief.ts `tileTop`), the
// highest under its footprint; after every column under it (by its front tile, never its centre),
// past the rock no higher than it as far as its shadow can fall, but never past a higher column
// or a building on the floor ahead, and behind the lifted buildings in front of it. Kept with its
// entity object for the other views (wires, lights, picking).
import { describe, it, expect } from 'vitest';
import { buildingIdx } from '@/content/registry';
import { Entities, footprint } from '@/sim/entities';
import { Grid, tileIndex, type TerrainSource } from '@/sim/world/grid';
import { CHUNK } from '@/sim/constants';
import { T, type Ent, type Rot } from '@/sim/types';
import { tileTop } from '../relief';
import { buildingZ, computeStands, footLevel, liftOf, rockZ, standLevel, standOf, type StandWorld } from './stand';

/** A test land: terrain and the land's level (D45) per world tile. */
class Field implements TerrainSource {
  constructor(private readonly at: (x: number, y: number) => { t: number; l: number }) {}
  fill(cx: number, cy: number, terrain: Uint8Array, _ore: Uint8Array, _rich: Uint16Array, _height?: Uint8Array, _biome?: Uint8Array, level?: Uint8Array): void {
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const { t, l } = this.at(cx * CHUNK + i, cy * CHUNK + j);
        terrain[j * CHUNK + i] = t;
        if (level) level[j * CHUNK + i] = l;
      }
    }
  }
}

/**
 * A rock plateau (x 480–539, y 470–499) on a sandy floor at land level 3 (a level-6 top), with a
 * higher shoulder (land level 4: a level-8 top) from x = `high` eastwards across it.
 */
function world(high = 10_000): StandWorld & { grid: Grid; ents: Entities; put(def: string, x: number, y: number, rot?: Rot): Ent } {
  const grid = new Grid(new Field((x, y) => {
    const rock = x >= 480 && x < 540 && y >= 470 && y < 500;
    return { t: rock ? T.Rock2 : T.Sand, l: rock ? (x >= high ? 4 : 3) : 0 };
  }));
  const ents = new Entities();
  const put = (def: string, x: number, y: number, rot: Rot = 0): Ent => {
    const e = ents.add({ def: buildingIdx(def), x, y, rot, cfg: 0, builtAt: 0 });
    const [w, h] = footprint(e.def, e.rot);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid.occ[tileIndex(i, j)] = e.id;
    return e;
  };
  return { grid, ents, put };
}

describe('stand: how high a building stands', () => {
  it('on the floor at 0; on the mountains on the rock top, the one height function, the highest under its footprint', () => {
    const w = world(520);
    const floor = w.put('mast', 470, 480), rock = w.put('mast', 500, 485), wide = w.put('wind_flower', 519, 485);
    const st = computeStands(w);
    expect(st.has(floor.id)).toBe(false);
    expect(liftOf(floor)).toBe(0);
    expect(tileTop(w.grid, 500, 485)).toBe(6);
    expect(st.get(rock.id)?.level).toBe(6);
    expect(standOf(rock)).toBe(st.get(rock.id));
    expect(liftOf(rock)).toBe(6);
    expect(liftOf({ ...rock })).toBe(0); // kept with the entity object itself
    // Astride two terraces: the higher one, never sunk into it.
    const tops = [tileTop(w.grid, 519, 485), tileTop(w.grid, 520, 485), tileTop(w.grid, 519, 486), tileTop(w.grid, 520, 486)];
    expect(new Set(tops).size).toBeGreaterThan(1);
    expect(st.get(wide.id)?.level).toBe(Math.max(...tops));
    expect(footLevel((x, y) => tileTop(w.grid, x, y), 519, 485, 2, 2)).toBe(Math.max(...tops));
  });

  it('the ghost asks the same: where a building in hand would stand (ribbons lie flat)', () => {
    const w = world(520);
    const e = w.put('wind_flower', 518, 485);
    const st = computeStands(w);
    expect(standLevel(w.grid, buildingIdx('wind_flower'), 518, 485, 0)).toBe(st.get(e.id)!.level);
    expect(standLevel(w.grid, buildingIdx('mast'), 470, 480, 0)).toBe(0);
    expect(standLevel(w.grid, buildingIdx('ribbon'), 500, 485, 0)).toBe(0);
  });
});

describe('stand: how it sorts with the cliffs', () => {
  it('after every column under its footprint — its front corner included, which its centre key would miss', () => {
    const w = world();
    const t = w.put('wind_flower', 500, 485);
    const z = computeStands(w).get(t.id)!.z;
    const [fw, fh] = footprint(t.def, t.rot);
    for (let j = t.y; j < t.y + fh; j++) for (let i = t.x; i < t.x + fw; i++) expect(z).toBeGreaterThan(rockZ(i, j));
    expect(buildingZ(t.x, t.y, fw, fh)).toBeLessThan(rockZ(t.x + 1, t.y + 1)); // why a lifted building cannot sort by its centre
  });

  it('on a flat top, past the rock its shadow falls on; and its shadow (key − 0.3) after that rock too', () => {
    const w = world();
    const t = w.put('wind_flower', 500, 485), p = w.put('mast', 490, 480);
    const st = computeStands(w);
    const z = st.get(t.id)!.z, zp = st.get(p.id)!.z;
    expect(z - 0.3).toBeGreaterThan(rockZ(t.x + 4, t.y + 1)); // two tiles east of its footprint
    expect(z - 0.3).toBeGreaterThan(rockZ(t.x + 2, t.y + 3));
    expect(zp - 0.3).toBeGreaterThan(rockZ(p.x + 2, p.y));
    expect(z).toBeLessThan(rockZ(t.x + 20, t.y + 20)); // not without end
  });

  it('rock in front of it that stands higher still hides it', () => {
    const w = world(506);
    const t = w.put('wind_flower', 500, 485);
    const st = computeStands(w).get(t.id)!;
    let k = 2;
    while (tileTop(w.grid, t.x + k, t.y + 1) <= st.level) k++;
    expect(k).toBeLessThan(8);
    expect(st.z).toBeLessThan(rockZ(t.x + k, t.y + 1));
  });

  it('a building on the floor ahead stays in front of it; a ribbon there changes nothing', () => {
    const a = world(), b = world(), c = world();
    const ta = a.put('wind_flower', 535, 485), tb = b.put('wind_flower', 535, 485), tc = c.put('wind_flower', 535, 485);
    const kiln = b.put('kiln', 541, 485);
    c.put('ribbon', 541, 486, 1);
    const za = computeStands(a).get(ta.id)!.z, zb = computeStands(b).get(tb.id)!.z, zc = computeStands(c).get(tc.id)!.z;
    const [kw, kh] = footprint(kiln.def, kiln.rot);
    expect(zb).toBeLessThan(buildingZ(kiln.x, kiln.y, kw, kh));
    expect(zb).toBeLessThan(za);
    expect(zc).toBe(za);
  });

  it('lifted buildings keep their order: the one in front sorts after the one behind and its shadow', () => {
    for (const high of [10_000, 514]) { // on a flat top, and with higher rock just ahead of the front one
      const w = world(high);
      const back = w.put('wind_flower', 505, 485), front = w.put('wind_flower', 509, 485), pole = w.put('mast', 507, 487);
      const st = computeStands(w);
      const zb = st.get(back.id)!.z, zf = st.get(front.id)!.z, zp = st.get(pole.id)!.z;
      expect(zf).toBeGreaterThan(zb);
      expect(zf).toBeGreaterThan(zb - 0.3);
      expect(zp).toBeGreaterThan(zb); // the pole stands ahead of the back turbine (sum 994 > 992)
    }
  });
});
