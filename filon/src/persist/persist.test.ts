import { describe, it, expect } from 'vitest';
import { CENTER, WORLD_EPOCH0 } from '@/sim/constants';
import { foundScenario } from '@/sim/scenarios';
import { serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import { Sim } from '@/sim/state';
import { isWater } from '@/sim/types';
import { MapGen } from '@/sim/world/mapgen';
import { CIRQUE_V1, MAP_VERSION, WORLD_SEED } from '@/content/world';
import { MemoryKV } from './kv';
import { fromText, intact, seal, toText, unseal, type Envelope } from './envelope';
import { migrate, SaveTooNew } from './migrate';
import { PREV_EVERY_MS, SaveSlots } from './slots';
import { catchUpTo, forecast, openSaved, owedTicks, worldMs } from './colony';
import { deserialize } from '@/sim/serialize';
import { remapSave } from '@/sim/save-remap';
import { BUILDING_IDS, N_ITEMS, itemIdx } from '@/content/registry';
import { catchUp } from '@/sim/offline/catchup';
import { effectiveCost } from '@/sim/research/runtime';

const { sim } = foundScenario('smelter', { playerSeed: 3, near: WORLD_EPOCH0 + 500, name: 'Essai' });
sim.run(600);
const data = serialize(sim);
const T0 = 1_800_000_000_000;

describe('the save envelope', () => {
  it('gzip round trip: the payload opens to the very save', async () => {
    const e = await seal(data, { savedAt: T0, seq: 1 });
    expect(intact(e)).toBe(true);
    expect(e.payload.length).toBeLessThan(JSON.stringify(data).length / 2);
    expect(await unseal(e)).toEqual(JSON.parse(JSON.stringify(data)));
  });

  it('one changed byte is caught: the slot is damaged, never loaded', async () => {
    const e = await seal(data, { savedAt: T0, seq: 1 });
    for (const at of [0, 17, e.payload.length - 1]) {
      const bad: Envelope = { ...e, payload: e.payload.slice() };
      bad.payload[at] = bad.payload[at]! ^ 0x10;
      expect(intact(bad)).toBe(false);
      await expect(unseal(bad)).rejects.toThrow();
    }
  });

  it('the export file is the envelope as text; a damaged file is refused', async () => {
    const e = await seal(data, { savedAt: T0, seq: 4 });
    const text = toText(e);
    const back = fromText(text)!;
    expect(back.seq).toBe(4);
    expect(await unseal(back)).toEqual(await unseal(e));
    const o = JSON.parse(text) as { payload: string };
    const mid = o.payload.length >> 1;
    const flipped = o.payload.slice(0, mid) + (o.payload[mid] === 'A' ? 'B' : 'A') + o.payload.slice(mid + 1);
    expect(fromText(JSON.stringify({ ...o, payload: flipped }))).toBeNull();
    expect(fromText('not a save')).toBeNull();
  });
});

describe('save slots', () => {
  it('saves alternate between a and b; the newest whole one wins', async () => {
    const kv = new MemoryKV();
    const slots = new SaveSlots(kv);
    expect(await slots.loadNewest()).toBeNull();
    await slots.save(data, T0);
    await slots.save(data, T0 + 30_000);
    const info = await slots.list();
    expect(info.filter((s) => s.slot === 'a' || s.slot === 'b').map((s) => [s.slot, s.seq])).toEqual([['a', 1], ['b', 2]]);
    const again = new SaveSlots(kv);
    expect((await again.loadNewest())?.slot).toBe('b');
  });

  it('a damaged slot falls back to the other, and the next save goes over the damaged one', async () => {
    const kv = new MemoryKV();
    const slots = new SaveSlots(kv);
    await slots.save(data, T0);
    await slots.save(data, T0 + 1);
    { const p = (kv.raw('b') as Envelope).payload; p[5] = p[5]! ^ 1; }
    const reopened = new SaveSlots(kv);
    const best = await reopened.loadNewest();
    expect([best?.slot, best?.env.seq]).toEqual(['a', 1]);
    const next = await reopened.save(data, T0 + 2);
    expect(next.seq).toBe(3); // past the damaged slot's number too
    expect((await kv.get<Envelope>('b'))?.seq).toBe(3);
  });

  it('with a and b both damaged, `prev` still opens', async () => {
    const kv = new MemoryKV();
    const slots = new SaveSlots(kv);
    await slots.save(data, T0);
    { const p = (kv.raw('a') as Envelope).payload; p[3] = p[3]! ^ 1; }
    expect((await new SaveSlots(kv).loadNewest())?.slot).toBe('prev');
  });

  it('`prev` is refreshed at most every ten minutes', async () => {
    const kv = new MemoryKV();
    const slots = new SaveSlots(kv);
    await slots.save(data, T0);
    await slots.save(data, T0 + PREV_EVERY_MS - 1);
    expect((await kv.get<Envelope>('prev'))?.seq).toBe(1);
    await slots.save(data, T0 + PREV_EVERY_MS);
    expect((await kv.get<Envelope>('prev'))?.seq).toBe(3);
  });

  it('a wipe keeps a pre-wipe copy and leaves no base to open', async () => {
    const kv = new MemoryKV();
    const slots = new SaveSlots(kv);
    await slots.save(data, T0);
    await slots.wipe();
    expect(await new SaveSlots(kv).loadNewest()).toBeNull();
    expect((await slots.get('pre-wipe'))?.seq).toBe(1);
  });
});

describe('migrations', () => {
  it('steps run in order, one version at a time', () => {
    const steps = { 1: (d: Record<string, unknown>) => ({ ...d, a: 1 }), 2: (d: Record<string, unknown>) => ({ ...d, b: (d.a as number) + 1 }) };
    const r = migrate({ v: 1 }, 3, steps);
    expect(r.from).toBe(1);
    expect(r.data).toEqual({ v: 3, a: 1, b: 2 });
    expect(migrate({ v: SAVE_VERSION }).from).toBe(SAVE_VERSION);
  });

  it('1 → 2 (D57): a ribbon’s parcels become cells packed from its head, the rest to the Heart; conduits keep their runs', () => {
    const ribbon = BUILDING_IDS.indexOf('ribbon' as never), conduit = BUILDING_IDS.indexOf('conduit' as never);
    const ore = itemIdx('iron_ore'), water = itemIdx('water');
    const stock = new Array<number>(N_ITEMS).fill(0);
    const v1 = {
      v: 1, stock,
      chains: [
        // 3 tiles; 4.5 iron ore in two runs: 3 fit (from the head), 1 whole and a half go to the Heart.
        { tier: ribbon, head: 100, len: 3, runs: [ore, 2000, 0, 0, ore, 2500, 5, 9], credit: [1000, 1000] },
        { tier: conduit, head: 200, len: 2, runs: [water, 700, 0, 3] },
      ],
    };
    const { data, from } = migrate(v1);
    expect(from).toBe(1);
    expect(data.v).toBe(SAVE_VERSION);
    const [r, c] = data.chains;
    expect(r!.cells).toEqual([ore + 1, ore + 1, ore + 1]);
    expect(r!.runs).toBeUndefined();
    expect((r as { credit?: unknown }).credit).toBeUndefined();
    expect(data.stock[ore]).toBe(1500);
    expect(c!.runs).toEqual([water, 700, 0, 3]);
    expect(c!.cells).toBeUndefined();
  });

  it('3 → 4 (D62): the 3×3 trade posts come down, refunded, their containers to the Heart, their streams and orders gone', () => {
    const { sim } = foundScenario('tutorial', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' });
    const post = [...sim.ents.sorted()].find((e) => BUILDING_IDS[e.def] === 'trade_post')!;
    expect(post).toBeTruthy();
    expect(sim.trade.orders.length).toBeGreaterThan(0);
    const plates = itemIdx('iron_plate');
    const d = { ...JSON.parse(JSON.stringify(serialize(sim))), v: 3 };
    const { data } = migrate(d);
    expect(data.content!.buildings).toContain('trade_post_3x3');
    expect(data.trade!.orders).toEqual([]);
    const r = remapSave(data);
    expect(r.data.trade!.cargo).toEqual([]); // the post gone, its cargo with it
    expect(r.note?.removed).toEqual([{ id: 'trade_post_3x3', n: 1, refunded: true }]);
    const back = deserialize(r.data, sim.grid.source);
    expect([...back.ents.sorted()].some((e) => BUILDING_IDS[e.def] === 'trade_post')).toBe(false);
    expect(back.stock[plates]).toBeGreaterThanOrEqual(sim.stock[plates]! + 40_000); // its 40 plates back
  });

  it('4 → 5 (D64): the export streams go; a post\'s cargo is what it buys, what is on its way and the purchases its container holds', () => {
    const { sim } = foundScenario('tutorial', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' });
    const post = [...sim.ents.sorted()].find((e) => BUILDING_IDS[e.def] === 'trade_post')!;
    const ore = itemIdx('iron_ore'), plates = itemIdx('iron_plate'), glass = itemIdx('glass'), copper = itemIdx('copper_ore');
    const d = JSON.parse(JSON.stringify(serialize(sim)));
    const { cargo: _cargo, ...trade } = d.trade;
    // A v4 post: it sold ore by a stream, bought plates by an order, glass is on its way, and its
    // store holds ore (to sell) and copper (left of a cancelled purchase).
    const store = Array.from({ length: d.stock.length }, () => 0);
    store[ore] = 5000; store[copper] = 3000;
    const v4 = {
      ...d, v: 4,
      stores: [...d.stores.filter(([id]: [number]) => id !== post.id), [post.id, store]],
      trade: { ...trade, exports: [[post.id, [ore, -1]]], orders: [{ id: 9, post: post.id, item: plates, perMin: 4, maxCents: 900, active: true }], inflight: [{ post: post.id, item: glass, mu: 2000, arrive: sim.tick + 600, colony: 0 }] },
    };
    const { data, from } = migrate(v4);
    expect(from).toBe(4);
    expect('exports' in data.trade!).toBe(false);
    expect(data.trade!.cargo).toEqual([[post.id, [plates, glass, copper].sort((a, b) => a - b)]]);
    const back = deserialize(remapSave(data).data, sim.grid.source);
    expect(back.cargoOf(post.id)).toEqual([plates, glass, copper].sort((a, b) => a - b));
  });

  it('5 → 6 (D75): the 1×1 pylons come down, refunded, their wires with them', () => {
    const { sim } = foundScenario('late', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' });
    const pylons = [...sim.ents.sorted()].filter((e) => BUILDING_IDS[e.def] === 'pylon');
    expect(pylons.length).toBeGreaterThan(0);
    const plates = itemIdx('iron_plate');
    const d = { ...JSON.parse(JSON.stringify(serialize(sim))), v: 5 };
    const { data } = migrate(d);
    expect(data.content!.buildings).toContain('pylon_1x1');
    expect(data.content!.buildings).not.toContain('pylon');
    const r = remapSave(data);
    expect(r.note?.removed).toEqual([{ id: 'pylon_1x1', n: pylons.length, refunded: true }]);
    const back = deserialize(r.data, sim.grid.source);
    expect([...back.ents.sorted()].some((e) => BUILDING_IDS[e.def] === 'pylon')).toBe(false);
    for (const p of pylons) expect(back.linksOf(p.id)).toEqual([]);
    expect(back.stock[plates]).toBeGreaterThanOrEqual(sim.stock[plates]! + 8_000 * pylons.length); // 8 plates each back
  });

  it('7 → 8 (D72): a project started under the spread penalty is rebased on its table cost, its progress kept', () => {
    const base = effectiveCost('en_bigwind');
    const d = { ...JSON.parse(JSON.stringify(data)), v: 7 };
    // Started at ×2 by what the claim owned elsewhere; a quarter of its (doubled) time has run.
    d.projects = [{
      id: 'en_bigwind', lab: 0, cost: base.cost.flatMap((c) => [c.item, c.mu * 2]), paid: base.cost.map((c) => c.mu / 2),
      dur: base.ticks * 2, el: (base.ticks * 2 * 1000) / 4, tokens: base.tokens * 2, tokUsed: base.tokens / 2,
    }, { id: 'respec:en', lab: 0, cost: [], paid: [], dur: 600, el: 1000, notes: 50 }];
    const { data: m } = migrate(d);
    const back = deserialize(remapSave(m).data, sim.grid.source);
    const p = back.projects.find((q) => q.id === 'en_bigwind')!;
    expect(p.cost).toEqual(base.cost);
    expect(p.dur).toBe(base.ticks);
    expect(p.el).toBe((base.ticks * 1000) / 4); // the same share of its new time
    expect(p.tokens).toBe(base.tokens);
    expect(p.tokUsed).toBe(base.tokens / 4); // what it already did, taken as paid
    expect(back.projects.find((q) => q.id === 'respec:en')).toMatchObject({ dur: 600, el: 1000, notes: 50 });
  });

  it('a save from a newer build is refused, a missing step too', () => {
    expect(() => migrate({ v: SAVE_VERSION + 1 })).toThrow(SaveTooNew);
    expect(() => migrate({ v: 1 }, 3, {})).toThrow(/no migration/);
  });
});

describe('opening the base and paying the time owed', () => {
  it('time owed is whole ticks behind the wall clock, never negative', () => {
    const w = worldMs(sim);
    expect(owedTicks(sim, w + 12_345)).toBe(123);
    expect(owedTicks(sim, w - 5_000)).toBe(0);
  });

  it('the base opens to the state it was saved in', async () => {
    const slots = new SaveSlots(new MemoryKV());
    await slots.save(data, T0);
    const opened = await openSaved(slots);
    expect(opened?.note).toBeNull();
    expect(opened?.sim.hash()).toBe(sim.hash());
  });

  it('eight hours away: the catch-up runs them and the base produced', async () => {
    const slots = new SaveSlots(new MemoryKV());
    await slots.save(data, T0);
    const { sim: back } = (await openSaved(slots))!;
    const t0 = back.tick;
    const report = catchUpTo(back, worldMs(back) + 8 * 3600_000)!;
    expect(back.tick - t0).toBe(8 * 36_000);
    expect(report.toTick - report.fromTick).toBe(8 * 36_000);
    expect(report.produced.some((mu) => mu > 0)).toBe(true);
    expect(catchUpTo(back, worldMs(back))).toBeNull();
  });

  it('the forecast is what happens: a copy runs the absence, the base itself does not move', () => {
    const live = deserialize(JSON.parse(JSON.stringify(serialize(sim))), sim.grid.source);
    const h0 = live.hash();
    const f = forecast(live, 8 * 36_000);
    expect(live.hash()).toBe(h0);
    expect(f.report.toTick - f.report.fromTick).toBe(8 * 36_000);
    const real = catchUp(live, 8 * 36_000);
    expect(live.hash()).toBe(f.sim.hash());
    expect(Array.from(real.produced)).toEqual(Array.from(f.report.produced));
    expect(real.creditsDelta).toBe(f.report.creditsDelta);
  });
});

describe('the land a base was founded on (D63)', () => {
  it('a save from before map versions (no `mapV`) reopens on map 1 at the same hash; a base founded today saves its map', async () => {
    const old = new Sim({ worldSeed: WORLD_SEED, playerSeed: 3, source: new MapGen(WORLD_SEED, 3, 1), foundingEpoch: WORLD_EPOCH0 + 500, colonyName: 'Ancienne' });
    // A pump on the shore of map 1's lake, on the cirque's floor (map 2 has sand there).
    old.done.add('tr3');
    old.rebuildDerived();
    old.grant('iron_plate', 50); old.grant('glass', 20);
    const px = CENTER + CIRQUE_V1.lake.dx - 4, py = CENTER + CIRQUE_V1.lake.dy;
    expect(old.place('pump', px, py, 0).ok).toBe(true);
    old.run(300);
    const saved = serialize(old);
    expect(saved.mapV).toBe(1);
    const { mapV: _v, ...before } = saved; // as written before the field existed
    const slots = new SaveSlots(new MemoryKV());
    await slots.save(before as SaveData, T0);
    const back = (await openSaved(slots))!.sim;
    expect(back.grid.source.mapV).toBe(1);
    expect(back.hash()).toBe(old.hash());
    expect(isWater(back.grid.terrain(px + 1, py))).toBe(true); // the lake is still there
    back.run(600); old.run(600);
    expect(back.hash()).toBe(old.hash());
    expect(serialize(back).mapV).toBe(1); // and it keeps its map from now on
    // Today's bases: today's map, written in the save.
    expect(data.mapV).toBe(MAP_VERSION);
    const slots2 = new SaveSlots(new MemoryKV());
    await slots2.save(data, T0);
    expect((await openSaved(slots2))!.sim.grid.source.mapV).toBe(MAP_VERSION);
  });
});

