// land.test.ts — the claim's land in parcels (docs/land.md, D60): the grid and the starting
// square (3 × 3 parcels of 23 tiles round the cirque, D74), the price from what a parcel holds,
// buying and leasing, a lease lapsing (its machine dormant, nothing lost) online and in the
// catch-up alike, the commands' replay, saves, the migration from the influence zones and the one
// from 16-tile parcels.
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
import { PARCEL, PARCEL_COLS, parcelAt, parcelCentre, parcelRect, ringOf } from './world/land';
import { migrate, zonesToParcels } from '@/persist/migrate';
import { remapSave } from './save-remap';

/** A parcel east of the starting square (ring 2: it touches it), bare sand. */
const EAST = parcelAt(CENTER + 2 * PARCEL, CENTER);
/** A kiln's origin on EAST. */
const KX = CENTER + 2 * PARCEL - 2, KY = CENTER - 2;
/** The parcel west of the starting square, and the one north. */
const WEST = parcelAt(CENTER - 2 * PARCEL, CENTER), NORTH = parcelAt(CENTER, CENTER - 2 * PARCEL);
/** The 16-tile grid of saves 3–8 (D60), as it was: parcels centred on the Heart's tile (512 = 32 × 16), 65 a side. */
const at16 = (x: number, y: number): number => Math.floor((y + 8) / 16) * 65 + Math.floor((x + 8) / 16);

/** A test colony with ocelles to spend and the Land Registry (leases). */
function landSim(): Sim {
  const sim = testSim();
  sim.done.add('tr4');
  sim.rebuildDerived();
  sim.grantCredits(1_000_000);
  return sim;
}

describe('land in parcels', () => {
  it('cuts the world in squares centred on the Heart; the starting square is the 3 × 3 round the cirque', () => {
    const home = parcelAt(CENTER, CENTER);
    const r = parcelRect(home);
    expect([r.x1 - r.x0, r.y1 - r.y0]).toEqual([PARCEL, PARCEL]);
    expect(CENTER - r.x0).toBe(r.x1 - 1 - CENTER); // the Heart's tile exactly in the middle (an odd side)
    expect(parcelCentre(home)).toEqual([CENTER, CENTER]);
    const sim = testSim();
    // Nine parcels (owner, 2026-10-15, D74): ±34 tiles, where the Crown reaches 29–33 (36 at the tarn's peak).
    expect(sim.land.reach).toBe(1);
    let held = 0;
    for (let p = 0; p < PARCEL_COLS * PARCEL_COLS; p++) if (sim.land.inStart(p)) held++;
    expect(held).toBe(9);
    expect(sim.land.covers(CENTER + 34, CENTER - 34)).toBe(true);
    expect(sim.land.covers(CENTER - 34, CENTER + 34)).toBe(true);
    expect(sim.land.covers(CENTER + 35, CENTER)).toBe(false);
    expect(sim.land.covers(CENTER, CENTER - 35)).toBe(false);
    expect(ringOf(EAST)).toBe(2);
    expect(sim.land.touches(EAST)).toBe(true);
    // Every tile of the world in one parcel, the edge ones cut short.
    expect(parcelAt(0, 0)).toBe(0);
    expect(parcelAt(1023, 1023)).toBe(PARCEL_COLS * PARCEL_COLS - 1);
    expect(parcelRect(0).x0).toBe(0);
  });

  it('prices a parcel by what it holds, then the growth; a neighbouring base’s is not for sale', () => {
    const sim = landSim();
    // A deposit raises the price.
    const ore = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: sim.foundingEpoch, source: testSource([{ x: CENTER + 40, y: CENTER - 4, w: 8, h: 8, item: itemIdx('copper_ore'), rich: 500 }]) });
    const bare = sim.landPrice(EAST), rich = ore.landPrice(EAST);
    expect(bare).toBe(BAL.land.base + PARCEL * PARCEL * BAL.land.tile.floor!);
    // 64 copper tiles (value 4 ◉) at a richness of 500: `depositPerValue` × the value each.
    expect(rich).toBe(bare + 64 * Math.floor((BAL.land.depositPerValue * 400 * 500) / (100 * 500)));
    // Each parcel bought makes the next dearer.
    expect(sim.buyLand(EAST)).toBe(null);
    expect(sim.landPrice(WEST)).toBe(Math.floor((bare * BAL.land.growth) / 1000));
    // A neighbouring base's parcel (D110), past the ring round the starting square: neither sold nor leased.
    let nb = -1;
    for (let p = 0; p < PARCEL_COLS * PARCEL_COLS && nb < 0; p++) if (sim.land.neighbour(p) >= 0) nb = p;
    expect(nb).toBeGreaterThan(-1);
    expect(ringOf(nb)).toBeGreaterThan(sim.land.reach + 1);
    expect(sim.buyBlock(nb)).toBe('neighbour');
    expect(sim.leaseBlock(nb)).toBe('neighbour');
    expect(sim.landPrice(WEST)).toBeGreaterThanOrEqual(landContent(sim, WEST)); // no markup anywhere: the content price grown
  });

  it('buys a parcel: a kiln may stand there; a parcel held is not sold twice; the purse must pay', () => {
    const sim = testSim();
    const x = KX, y = KY;
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
    const k = sim.place('kiln', KX, KY, 0);
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
      const k = sim.place('kiln', KX, KY, 0);
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

  it('a neighbouring base\'s land takes no ribbon without Neighbour Treaties, its buildings none even with them (D110)', () => {
    const sim = landSim();
    let p = -1;
    for (let q = 0; q < PARCEL_COLS * PARCEL_COLS && p < 0; q++) if (sim.land.neighbour(q) >= 0 && ringOf(q) < 8) p = q;
    expect(p).toBeGreaterThan(-1);
    const { x0, y0, x1, y1 } = parcelRect(p);
    // An open tile of its land, and one under its buildings.
    let open: [number, number] | null = null, taken: [number, number] | null = null;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (sim.neighbours.at(x, y)) taken ??= [x, y];
      else open ??= [x, y];
    }
    expect(open && taken).toBeTruthy();
    expect(sim.canPlace('mast', open![0], open![1], 0).reason).toBe('neighbour_land');
    expect(sim.canPlace('mast', taken![0], taken![1], 0).reason).toBe('neighbour_land');
    sim.done.add('xp_treaties'); sim.rebuildDerived();
    expect(sim.canPlace('mast', open![0], open![1], 0).reason).toBe('ok');
    expect(sim.canPlace('mast', taken![0], taken![1], 0).reason).toBe('occupied');
    // Never bought: the base stays.
    expect(sim.buyLand(p)).toBe('neighbour');
    expect(sim.land.neighbour(p)).toBeGreaterThanOrEqual(0);
  });

  it('buying, leasing and giving a lease up are commands: the log replays to the same land', () => {
    const sim = landSim();
    expect(sim.buyLand(EAST)).toBe(null);
    expect(sim.rentLand(WEST)).toBe(null);
    sim.run(LEASE_TICKS + EPOCH);
    expect(sim.endLease(WEST)).toBe(null);
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
    sim.rentLand(NORTH);
    sim.place('kiln', KX, KY, 0);
    const d = serialize(sim);
    const back = deserialize(JSON.parse(JSON.stringify(d)), testSource());
    expect(back.hash()).toBe(sim.hash());
    // The same base before land was parcels: no `land`, the reclaimed tiles instead. Version 3's
    // grant is on the 16-tile grid of its time; the chain carries it on to today's.
    const { land: _land, ...v2 } = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
    const up = zonesToParcels({ ...v2, v: 2, claimed: [5] }) as unknown as typeof d;
    expect(up.land!.bought).toEqual([]);
    expect(up.land!.granted).toContain(at16(KX, KY));
    expect('claimed' in up).toBe(false);
    const { data } = migrate({ ...v2, v: 2, claimed: [5] } as { v: number });
    expect(data.land!.granted).toContain(EAST);
    const old = deserialize(remapSave(data).data, testSource());
    const kiln = [...old.ents.map.values()].find((e) => e.def === buildingIdx('kiln'))!;
    expect(old.isDormant(kiln)).toBe(false);
    expect(old.buyLand(EAST)).toBe('held'); // granted: held, not sold again
    expect(old.landPrice(WEST)).toBe(testSim().landPrice(WEST));
  });

  it('8 → 9 (D74): a base on 16-tile parcels keeps its purchases, its leases and every machine awake on the 23-tile grid', () => {
    const sim = landSim();
    // Today: a kiln on the parcel east (bought), one on the parcel west (in the old 5 × 5 square, ±40).
    expect(sim.buyLand(EAST)).toBe(null);
    expect(sim.buyLand(WEST)).toBe(null);
    const east = sim.place('kiln', KX, KY, 0).id!;
    const west = sim.place('kiln', CENTER - 38, CENTER - 2, 0).id!;
    const d = JSON.parse(JSON.stringify(serialize(sim))) as Record<string, unknown>;
    // The same base as version 8 saved it: the east kiln on a bought 16-tile parcel (ring 3), the
    // west one inside the old starting square, a lease north of it (ring 3).
    const lease16 = at16(CENTER, CENTER - 48);
    const v8 = { ...d, v: 8, land: { bought: [at16(KX, KY)], granted: [], leases: [[lease16, 12_345, 777]], paid: [[at16(KX, KY), 50_000]] } };
    const credits = d.credits as number;
    const { data } = migrate(v8);
    expect(data.land!.bought).toEqual([EAST]); // where its middle (CENTER + 48) now falls
    expect(data.land!.paid).toEqual([[EAST, 50_000]]);
    expect(data.land!.leases).toEqual([[NORTH, 12_345, 777]]);
    expect(data.land!.granted).toEqual([WEST]); // the west kiln stood on the old grant: its parcel is the claim's
    expect(data.credits).toBe(credits);
    const back = deserialize(remapSave(data).data, testSource());
    for (const id of [east, west]) expect(back.isDormant(back.ents.get(id)!)).toBe(false);
    expect(back.land.holds(NORTH)).toBe(true);
  });
});
