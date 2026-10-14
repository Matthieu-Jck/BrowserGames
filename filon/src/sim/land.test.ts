// land.test.ts — the claim's land in parcels (docs/land.md, D60): the grid and the starting
// square, the price from what a parcel holds, buying and leasing, a lease lapsing (its machine
// dormant, nothing lost) online and in the catch-up alike, the commands' replay, saves and the
// migration from the influence zones.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { buildingIdx, itemIdx } from '@/content/registry';
import { CENTER, EPOCH } from './constants';
import { replay } from './commands';
import { catchUp } from './offline/catchup';
import { deserialize, serialize } from './serialize';
import { LEASE_TICKS, landContent } from './systems/land';
import { Sim } from './state';
import { testSim, testSource } from './testkit';
import { PARCEL, PARCEL_COLS, parcelAt, parcelRect, ringOf } from './world/land';
import { zonesToParcels } from '@/persist/migrate';

/** A parcel east of the starting square (ring 3), bare sand. */
const EAST = parcelAt(CENTER + 3 * PARCEL, CENTER);

/** A test colony with ocelles to spend and the Land Registry (leases). */
function landSim(): Sim {
  const sim = testSim();
  sim.done.add('tr4');
  sim.rebuildDerived();
  sim.grantCredits(1_000_000);
  return sim;
}

describe('land in parcels', () => {
  it('cuts the world in squares centred on the Heart; the starting square holds the Crown', () => {
    const home = parcelAt(CENTER, CENTER);
    const r = parcelRect(home);
    expect([r.x1 - r.x0, r.y1 - r.y0]).toEqual([PARCEL, PARCEL]);
    expect(CENTER - r.x0).toBe(r.x1 - CENTER); // the Heart's tile in the middle
    const sim = testSim();
    // The template's Crown foot (r 34): five parcels a side.
    expect(sim.land.reach).toBe(2);
    expect(sim.land.covers(CENTER + 39, CENTER - 39)).toBe(true);
    expect(sim.land.covers(CENTER + 40, CENTER)).toBe(false);
    expect(ringOf(EAST)).toBe(3);
    expect(PARCEL_COLS * PARCEL).toBeGreaterThanOrEqual(1024);
  });

  it('prices a parcel by what it holds, then the growth, the Heart and a sister claim', () => {
    const sim = landSim();
    // A deposit raises the price.
    const ore = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: sim.foundingEpoch, source: testSource([{ x: CENTER + 44, y: CENTER - 4, w: 8, h: 8, item: itemIdx('copper_ore'), rich: 500 }]) });
    const bare = sim.landPrice(EAST), rich = ore.landPrice(EAST);
    expect(bare).toBe(BAL.land.base + PARCEL * PARCEL * BAL.land.tile.floor!);
    expect(rich).toBeGreaterThan(bare + 64 * 1000);
    // Each parcel bought makes the next dearer.
    expect(sim.buyLand(EAST)).toBe(null);
    const next = parcelAt(CENTER - 3 * PARCEL, CENTER);
    expect(sim.landPrice(next)).toBe(Math.floor((bare * BAL.land.growth) / 1000));
    // A sister claim's parcel, past the ring round the starting square: dearer.
    let sister = -1;
    for (let p = 0; p < PARCEL_COLS * PARCEL_COLS && sister < 0; p++) if (sim.land.sister(p) >= 0) sister = p;
    expect(sister).toBeGreaterThan(-1);
    expect(ringOf(sister)).toBeGreaterThan(sim.land.reach + 1);
    expect(sim.landPrice(sister)).toBeGreaterThan(landContent(sim, sister));
  });

  it('buys a parcel: a kiln may stand there; a parcel held is not sold twice; the purse must pay', () => {
    const sim = testSim();
    const x = CENTER + 3 * PARCEL - 2, y = CENTER - 2;
    sim.explored.push([x, y, 8]); // surveyed
    expect(sim.canPlace('kiln', x, y, 0).reason).toBe('outside_zone');
    sim.grantCredits(sim.landPrice(EAST) - sim.credits - 1);
    expect(sim.buyLand(EAST)).toBe('credits');
    sim.grantCredits(1);
    expect(sim.buyLand(EAST)).toBe(null);
    expect(sim.credits).toBe(0);
    expect(sim.canPlace('kiln', x, y, 0).reason).toBe('ok');
    expect(sim.buyLand(EAST)).toBe('held');
    expect(sim.buyLand(parcelAt(CENTER, CENTER))).toBe('held');
  });

  it('leases a parcel by the hour once the Land Registry is in; a lease the purse cannot pay lapses, its machine dormant', () => {
    const sim = testSim();
    sim.grantCredits(1_000_000);
    expect(sim.rentLand(EAST)).toBe('locked');
    sim.done.add('tr4');
    sim.rebuildDerived();
    const rent = sim.landRent(EAST);
    expect(rent).toBe(Math.floor((sim.landPrice(EAST) * BAL.land.rentPermille) / 1000));
    expect(sim.rentLand(EAST)).toBe(null);
    const k = sim.place('kiln', CENTER + 3 * PARCEL - 2, CENTER - 2, 0);
    expect(k.ok).toBe(true);
    // Two hours paid (the first at once), then a purse that holds less than the third.
    sim.credits = rent + rent - 1;
    sim.run(LEASE_TICKS);
    expect(sim.land.leases.has(EAST)).toBe(true);
    expect(sim.credits).toBe(rent - 1);
    sim.run(LEASE_TICKS);
    expect(sim.land.leases.has(EAST)).toBe(false);
    expect(sim.credits).toBe(rent - 1);
    const kiln = sim.ents.get(k.id!)!;
    expect(sim.isDormant(kiln)).toBe(true);
    expect(sim.ents.get(k.id!)).toBeTruthy(); // nothing vanishes
    // Bought outright, it wakes.
    sim.grantCredits(sim.landPrice(EAST));
    expect(sim.buyLand(EAST)).toBe(null);
    expect(sim.isDormant(kiln)).toBe(false);
  });

  it('a lease lapses in the catch-up at the same hour as online, with the same purse and the same base', () => {
    const build = (): Sim => {
      const sim = landSim();
      sim.rentLand(EAST);
      const k = sim.place('kiln', CENTER + 3 * PARCEL - 2, CENTER - 2, 0);
      sim.setRecipe(k.id!, 'iron_plate');
      sim.credits = 3 * sim.land.leases.get(EAST)!.cents + 5;
      sim.run(EPOCH);
      return sim;
    };
    const on = build(), off = build();
    on.run(4 * LEASE_TICKS);
    const rep = catchUp(off, 4 * LEASE_TICKS, { noDirect: true });
    expect(on.land.leases.has(EAST)).toBe(false);
    expect(off.land.leases.has(EAST)).toBe(false);
    expect(off.credits).toBe(on.credits);
    expect(rep.incidents.some((i) => i.kind === 'leaseLapsed' && i.parcel === EAST)).toBe(true);
    expect(off.hash()).toBe(on.hash());
  });

  it('a sister claim\'s parcel takes no ribbon until the claim holds it', () => {
    const sim = landSim();
    let p = -1;
    for (let q = 0; q < PARCEL_COLS * PARCEL_COLS && p < 0; q++) if (sim.land.sister(q) >= 0 && ringOf(q) < 8) p = q;
    expect(p).toBeGreaterThan(-1);
    const { x0, y0 } = parcelRect(p);
    sim.explored.push([x0 + 8, y0 + 8, 12]); // surveyed
    expect(sim.canPlace('mast', x0 + 4, y0 + 4, 0).reason).toBe('sister_land');
    expect(sim.buyLand(p)).toBe(null);
    expect(sim.land.sister(p)).toBe(-1);
    expect(sim.canPlace('mast', x0 + 4, y0 + 4, 0).reason).toBe('ok');
  });

  it('buying, leasing and giving a lease up are commands: the log replays to the same land', () => {
    const sim = landSim();
    expect(sim.buyLand(EAST)).toBe(null);
    const west = parcelAt(CENTER - 3 * PARCEL, CENTER);
    expect(sim.rentLand(west)).toBe(null);
    sim.run(LEASE_TICKS + EPOCH);
    expect(sim.endLease(west)).toBe(null);
    const c = testSim();
    c.done.add('tr4');
    c.rebuildDerived();
    replay(c, sim.log, sim.tick);
    expect([...c.land.bought]).toEqual([EAST]);
    expect(c.land.leases.size).toBe(0);
    expect(c.hash()).toBe(sim.hash());
  });

  it('saves keep the land; an older save is granted the parcels its buildings stand on (v3)', () => {
    const sim = landSim();
    sim.buyLand(EAST);
    sim.rentLand(parcelAt(CENTER, CENTER - 3 * PARCEL));
    sim.place('kiln', CENTER + 3 * PARCEL - 2, CENTER - 2, 0);
    const d = serialize(sim);
    const back = deserialize(JSON.parse(JSON.stringify(d)), testSource());
    expect(back.hash()).toBe(sim.hash());
    // The same base before land was parcels: no `land`, the reclaimed tiles instead.
    const { land: _land, ...v2 } = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
    const up = zonesToParcels({ ...v2, v: 2, claimed: [5] }) as unknown as typeof d;
    expect(up.land!.bought).toEqual([]);
    expect(up.land!.granted).toContain(EAST);
    expect('claimed' in up).toBe(false);
    const old = deserialize({ ...up, v: d.v }, testSource());
    const kiln = [...old.ents.map.values()].find((e) => e.def === buildingIdx('kiln'))!;
    expect(old.isDormant(kiln)).toBe(false);
    expect(old.buyLand(EAST)).toBe('held'); // granted: held, not sold again
    expect(old.landPrice(parcelAt(CENTER - 3 * PARCEL, CENTER))).toBe(testSim().landPrice(parcelAt(CENTER - 3 * PARCEL, CENTER)));
  });
});
