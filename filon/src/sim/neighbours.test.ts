// neighbours.test.ts — the neighbouring bases (D110, sim/world/neighbours.ts): drawn from the seeds
// alone and the same in every order asked; few, and none within three rings of the Heart's parcel
// (`minRing`); map 4's holdings of parcels side by side, off what the land guarantees; each a working
// base — its chain of extractors, makers, store and pad linked by ribbons, every building that takes
// part in power on its own grid by the claim's rule of reach — wholly on its own open floor, which
// digging never moves; the Gleaners keep off it; an older save's lease or building on its land makes
// the base give way (the parcel granted), once.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { BUILDING_KIND, buildingDef, buildingIdx } from '@/content/registry';
import { WORLD_SEED } from '@/content/world';
import { WORLD } from './constants';
import { footprint } from './entities';
import { deserialize, serialize } from './serialize';
import { Sim } from './state';
import { testSim, testSource } from './testkit';
import { isFloor, T } from './types';
import { MapGen } from './world/mapgen';
import { PARCEL_COLS, parcelAt, parcelRect, ringOf } from './world/land';
import { gleanLand } from './world/reach';
import { gap2, linkable } from './power/links';
import type { Holding } from './world/neighbours';

const map4 = (ps = 4242): Sim => new Sim({ worldSeed: WORLD_SEED, playerSeed: ps, source: new MapGen(WORLD_SEED, ps, 4), foundingEpoch: 29453760 });

/** Every base of a land, by hub. */
function bases(sim: Sim): Holding[] {
  const out = new Map<number, Holding>();
  for (let p = 0; p < PARCEL_COLS * PARCEL_COLS; p++) { const h = sim.neighbours.holdingOf(p); if (h) out.set(h.hub, h); }
  return [...out.values()].sort((a, b) => a.hub - b.hub);
}

/** A base's layout as plain numbers (to compare two readings). */
const sig = (sim: Sim, h: Holding): string => {
  const L = sim.neighbours.layout(h);
  return `${h.colony}:${h.parcels}|${L.structs.map((s) => `${s.def},${s.x},${s.y},${s.rot}`).join(';')}|${L.ribbons.map((r) => `${r.item}:${[...r.tiles]}`).join(';')}|${L.flag}`;
};

describe('neighbouring bases (D110)', () => {
  it('map 4: a few holdings of parcels side by side, none within three rings of the Heart\'s, the same whatever order they are asked in', () => {
    const a = map4(), b = map4();
    const all = bases(a);
    expect(all.length).toBeGreaterThan(5);
    expect(all.length).toBeLessThan(30); // was some sixty before the owner found too many (D110)
    expect(all.some((h) => h.parcels.length >= 2)).toBe(true);
    for (const h of all) {
      for (const p of h.parcels) {
        expect(ringOf(p)).toBeGreaterThanOrEqual(BAL.land.neighbours.minRing);
        const r = parcelRect(p);
        expect(a.grid.source.keepsClear!(r.x0, r.y0, r.x1, r.y1)).toBe(false);
      }
      // Each parcel joins one already in it, side by side.
      for (let i = 1; i < h.parcels.length; i++) {
        const p = h.parcels[i]!;
        expect(h.parcels.slice(0, i).some((q) => Math.abs(p - q) === 1 || Math.abs(p - q) === PARCEL_COLS)).toBe(true);
      }
    }
    // Asked backwards on another reading of the same seeds: the same bases, laid out the same.
    const back = new Map<number, Holding>();
    for (let p = PARCEL_COLS * PARCEL_COLS - 1; p >= 0; p--) { const h = b.neighbours.holdingOf(p); if (h) back.set(h.hub, h); }
    expect([...back.keys()].sort((x, y) => x - y)).toEqual(all.map((h) => h.hub));
    for (const h of [...all].reverse().slice(0, 8)) expect(sig(b, b.neighbours.holdingOf(h.hub)!)).toBe(sig(a, h));
  });

  it('a base works: its chain into a lift pad, ribbons between, its own grid, a flag — wholly on its own open floor, a building on every parcel', () => {
    const sim = map4();
    for (const h of bases(sim).slice(0, 12)) {
      const L = sim.neighbours.layout(h);
      const ids = L.structs.map((s) => s.def);
      expect(ids).toContain(buildingIdx('trade_post'));
      expect(L.flag).not.toBeNull();
      expect(L.ribbons.length).toBeGreaterThan(1);
      // Its grid: every building that takes part in power is wired, each wire with a mast at one end, within its reach.
      const wired = new Set(L.wires.flat()), mast = buildingIdx('mast'), R = buildingDef(mast).pole!.range;
      for (const [i, j] of L.wires) {
        const a = L.structs[i]!, b = L.structs[j]!;
        expect(a.def === mast || b.def === mast).toBe(true);
        expect(gap2(a, b)).toBeLessThanOrEqual(R * R);
      }
      const powered = L.structs.filter((s, i) => linkable(s.def) && s.def !== mast).map((s) => L.structs.indexOf(s));
      expect(powered.filter((i) => !wired.has(i)).length).toBeLessThanOrEqual(1);
      // Its Core (owner: « ils devraient avoir un cœur », « plus petit »): 3 × 3 at its heart, its grid
      // all joined to it, a line running into it.
      expect(L.core).toBeGreaterThanOrEqual(0);
      const core = L.structs[L.core]!, [cw, ch] = footprint(core.def, core.rot);
      expect([cw, ch]).toEqual([3, 3]);
      expect(h.parcels).toContain(parcelAt(core.x + 1, core.y + 1)); // the hub's middle, unless that is a pocket of floor
      const reach = new Set([L.core]);
      for (let grew = true; grew;) { grew = false; for (const [i, j] of L.wires) if (reach.has(i) !== reach.has(j)) { reach.add(i); reach.add(j); grew = true; } }
      for (const i of wired) expect(reach.has(i)).toBe(true);
      expect(L.ribbons.some((r) => {
        const n = r.tiles.length - 3, x = r.tiles[n]! + [0, 1, 0, -1][r.tiles[n + 2]!]!, y = r.tiles[n + 1]! + [-1, 0, 1, 0][r.tiles[n + 2]!]!;
        return x >= core.x && y >= core.y && x < core.x + cw && y < core.y + ch;
      })).toBe(true);
      for (const p of h.parcels) expect(sim.neighbours.structsOn(p).length).toBeGreaterThan(0);
      for (const s of L.structs) {
        const [w, hh] = footprint(s.def, s.rot);
        for (let y = s.y; y < s.y + hh; y++) for (let x = s.x; x < s.x + w; x++) {
          expect(h.parcels).toContain(parcelAt(x, y));
          const m = sim.grid.made0(x, y);
          expect(m.level).toBe(0);
          expect(isFloor(m.terrain)).toBe(true);
          expect(sim.neighbours.at(x, y)).toBe(true);
        }
      }
      // A ribbon tile turns towards the next.
      for (const r of L.ribbons) for (let i = 0; i + 3 < r.tiles.length; i += 3) {
        const dx = r.tiles[i + 3]! - r.tiles[i]!, dy = r.tiles[i + 4]! - r.tiles[i + 1]!;
        expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
        expect([[0, -1], [1, 0], [0, 1], [-1, 0]][r.tiles[i + 2]!]).toEqual([dx, dy]);
      }
    }
  });

  it('digging the land never moves a base: it stands on the land as its source made it', () => {
    const sim = map4();
    const h = bases(sim)[0]!;
    const before = sig(sim, h);
    const s = sim.neighbours.layout(h).structs[0]!;
    sim.grid.setTerrain(s.x, s.y, T.Rock2);
    sim.grid.setLevel(s.x, s.y, 2);
    sim.neighbours.forget();
    expect(sig(sim, h)).toBe(before);
  });

  it('maps 1–3 and test worlds keep the sister claims\' scattered parcels, one base each', () => {
    const sim = testSim();
    const all = bases(sim);
    expect(all.length).toBeGreaterThan(50);
    for (const h of all) expect(h.parcels).toEqual([h.hub]);
    const m3 = new Sim({ worldSeed: WORLD_SEED, playerSeed: 4242, source: new MapGen(WORLD_SEED, 4242, 3), foundingEpoch: 29453760 });
    expect(bases(m3).every((h) => h.parcels.length === 1)).toBe(true);
  });

  it('the Gleaners keep off a base\'s land: blocked tiles close the desert like the claim\'s fences', () => {
    const sim = testSim();
    // A ribbon tile with open sand all round: exposed; walled in by blocked tiles round a small pocket: not.
    const t = 300 * WORLD + 300;
    const open = gleanLand(sim.grid, [t], () => false, 10, 40);
    expect([...open.exposed]).toEqual([t]);
    const ring = new Set<number>();
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 3) ring.add(t + dy * WORLD + dx);
    const walled = gleanLand(sim.grid, [t], () => false, 10, 40, [], undefined, (u) => ring.has(u));
    expect(walled.exposed.length).toBe(0);
  });

  it('an older save gives way: a lease on a base\'s land, or a building on its tiles, makes the parcel the claim\'s; once', () => {
    const sim = testSim();
    const [a, b] = bases(sim).filter((h) => ringOf(h.hub) < 10);
    expect(a && b).toBeTruthy();
    // As an older base had them: a lease on a's parcel, a mast standing on one of b's buildings.
    sim.land.leases.set(a!.hub, { next: sim.tick + 1000, cents: 100 });
    const s = sim.neighbours.layout(b!).structs[0]!;
    const mast = sim.ents.add({ def: buildingIdx('mast'), x: s.x, y: s.y, rot: 0, cfg: 0, builtAt: 0, portItems: [] });
    sim.grid.occ[s.y * WORLD + s.x] = mast.id;
    const saved = serialize(sim);
    const back = deserialize(saved, testSource());
    expect(back.land.granted.has(a!.hub)).toBe(true);
    expect(back.land.leases.has(a!.hub)).toBe(false);
    expect(back.land.granted.has(b!.hub)).toBe(true);
    expect(back.land.neighbour(b!.hub)).toBe(-1);
    expect(back.neighbours.at(s.x, s.y)).toBe(false);
    // Saved again and reopened: nothing more to give.
    const again = deserialize(serialize(back), testSource());
    expect([...again.land.granted].sort()).toEqual([...back.land.granted].sort());
    expect(BUILDING_KIND[back.ents.get(mast.id)!.def]).toBe('pole');
  });
});
