import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BAL } from '@/content/balance';
import { timed } from '@/core/cpu-time';
import { COLONY_PROFILES } from '@/content/colonies';
import { ITEMS } from '@/content/items';
import { ITEM_IDS, N_ITEMS, itemIdx } from '@/content/registry';
import type { ItemDef } from '@/content/types';
import { CIRQUE, UNIQUE_BIOMES, WORLD_SEED, tileCapsPerMin } from '@/content/world';
import { makeColonies, tradeByItem } from './colonies';
import { MarketEngine } from './engine';
import { windowEvent, type EventWorld } from './events';
import { afterFee, lnEquilibrium, noiseAt, noiseSeedOf, rampAt, valueCents } from './pricing';
import { LocalMarketService } from './service';
import type { MarketConfig, MarketEpochIn } from './types';

/** A founding epoch in 2026 that is aligned on nothing (blocks, hours and windows start mid-way). */
const F = 29_853_761;
const calm = (over: Partial<MarketConfig> = {}): MarketConfig => ({ worldSeed: WORLD_SEED, foundingEpoch: F, events: false, firstTrade: false, noise: false, ...over });
const flows = (perMin: Record<string, number>): Float64Array => {
  const a = new Float64Array(N_ITEMS);
  for (const [id, n] of Object.entries(perMin)) a[itemIdx(id)] = n * 1000;
  return a;
};
const item = (svc: LocalMarketService, id: string) => svc.snapshot().items.find((x) => x.item === id)!;
const def = (id: string): ItemDef => ITEMS[id as keyof typeof ITEMS] as ItemDef;
/** Settle epochs [from, to) with the same per-epoch input. */
function run(svc: LocalMarketService, from: number, to: number, input: Omit<MarketEpochIn, 'epoch'> = {}): void {
  for (let e = from; e < to; e++) svc.settle({ ...input, epoch: e });
}

describe('market: price formation', () => {
  it('exporting 0.1 Q, 0.5 Q and Q pushes the equilibrium to r ≈ 0.93, 0.695 and 0.48', () => {
    const Q = 600;
    expect(Math.exp(lnEquilibrium(Q, Q, 0.1 * Q, 0))).toBeCloseTo(0.93, 2);
    expect(Math.exp(lnEquilibrium(Q, Q, 0.5 * Q, 0))).toBeCloseTo(0.695, 2);
    expect(Math.exp(lnEquilibrium(Q, Q, Q, 0))).toBeCloseTo(0.48, 2);
    // Imports push the other way, symmetric in the excess demand.
    expect(Math.exp(lnEquilibrium(Q, Q, 0, 0.1 * Q))).toBeGreaterThan(1.05);
    expect(lnEquilibrium(Q, Q, 0, 0)).toBe(0);
  });

  it('plates: 60/min bring ≈ 151 ◉/min and 300/min ≈ 563 ◉/min at mid price — 5× the flow, ≈ 3.7× the revenue', () => {
    const V = def('iron_plate').value!, Q = def('iron_plate').depth;
    expect([V, Q]).toEqual([2.7, 600]);
    const revenue = (x: number): number => x * V * Math.exp(lnEquilibrium(Q, Q, x, 0));
    expect(revenue(60)).toBeCloseTo(151, 0);
    expect(Math.abs(revenue(300) - 563)).toBeLessThan(2);
    expect(revenue(300) / revenue(60)).toBeCloseTo(3.7, 1);
  });

  it('a market fed 60 plates/min settles on that equilibrium: ≈ 151 ◉/min at mid price', () => {
    const svc = new LocalMarketService(calm());
    run(svc, F, F + 36 * 60, { sold: flows({ iron_plate: 60 }) });
    const p = item(svc, 'iron_plate');
    expect(p.flow.sold).toBeCloseTo(60, 9);
    expect(p.depth.supply).toBe(p.depth.demand); // growth deepens the market without tilting it
    expect(p.eq).toBeCloseTo(Math.exp(lnEquilibrium(p.depth.supply, p.depth.demand, 60, 0)), 3);
    expect(p.eq).toBeCloseTo(0.93, 2);
    expect(Math.abs((60 * p.mid) / 100 - 151)).toBeLessThan(1.5);
  });

  it('a sell-then-buy round trip at 8 % fees loses ≈ 20 % (spread + fees kill buy-and-resell)', () => {
    const svc = new LocalMarketService(calm());
    const table = svc.prices();
    const loss = (id: string): number => {
      const i = itemIdx(id);
      const got = afterFee(valueCents(1_000_000, table.bid[i]!, 'sell'), 'sell', 80); // sell 1 000
      const perItem = afterFee(table.ask[i]!, 'buy', 80);
      return 1 - got / perItem / 1000; // what buying back with the proceeds returns
    };
    // Commons (4 % spread) lose ≈ 18–19 %, uniques (10 %) ≈ 23 %: whole-cent rounding adds a little.
    for (const id of ['iron_plate', 'glass', 'circuit', 'copper_ore', 'robot_arm']) {
      expect(loss(id), id).toBeGreaterThan(0.18);
      expect(loss(id), id).toBeLessThan(0.195);
    }
    for (const id of ['sporeglass', 'lumen_moss', 'singing_quartz']) {
      expect(loss(id), id).toBeGreaterThan(0.225);
      expect(loss(id), id).toBeLessThan(0.235);
    }
    expect((loss('iron_plate') + loss('sporeglass')) / 2).toBeCloseTo(0.2, 1);
  });

  it('prices are integer cents, ask above bid, inside [0.25 V, 4 V] however hard the player dumps or buys', () => {
    const dump = { sold: flows({ iron_plate: 100 * 600, resonator: 50 }), bought: flows({ copper_ore: 100 * 150, sporeglass: 2000 }) };
    for (const svc of [new LocalMarketService(calm()), new LocalMarketService({ worldSeed: WORLD_SEED, foundingEpoch: F })]) {
      run(svc, F, F + 3 * 1440, dump);
      const out = svc.settle({ epoch: F + 3 * 1440 });
      for (let i = 0; i < N_ITEMS; i++) {
        expect(Number.isInteger(out.bid[i]) && Number.isInteger(out.ask[i])).toBe(true);
        const d = ITEMS[ITEM_IDS[i]!] as ItemDef;
        if (!(d.depth > 0)) { expect([out.bid[i], out.ask[i]]).toEqual([0, 0]); continue; }
        expect(out.ask[i]!).toBeGreaterThan(out.bid[i]!);
      }
      for (const it of svc.snapshot().items) {
        expect(it.mid, it.item).toBeGreaterThanOrEqual(Math.floor(0.25 * it.value * 100));
        expect(it.mid, it.item).toBeLessThanOrEqual(Math.ceil(4 * it.value * 100));
      }
    }
    // Without noise the dumped and the bought-out goods end on the bounds (within what 6 τ leaves).
    const svc = new LocalMarketService(calm());
    run(svc, F, F + 3 * 1440, dump);
    for (const [id, r] of [['iron_plate', 0.25], ['resonator', 0.25], ['copper_ore', 4], ['sporeglass', 4]] as const) {
      const bound = r * def(id).value! * 100;
      expect(Math.abs(item(svc, id).mid - bound), id).toBeLessThanOrEqual(Math.max(1, 0.005 * bound));
    }
  });

  it('the noise has unit σ before scaling, decorrelates over ≈ 12 h, and is σ = 0.06 (commons) / 0.12 (uniques) in the price', () => {
    const seed = noiseSeedOf(WORLD_SEED), N = 120_000;
    let n = 0, s = 0, s2 = 0, c60 = 0, c720 = 0, c2880 = 0;
    for (const id of ['iron_ore', 'glass', 'circuit', 'lens', 'robot_arm', 'resonator', 'salt', 'ceramic']) {
      const i = itemIdx(id), u = new Float64Array(N);
      for (let t = 0; t < N; t++) u[t] = noiseAt(seed, i, F + t);
      for (let t = 0; t < N; t++) { n++; s += u[t]!; s2 += u[t]! * u[t]!; }
      for (let t = 0; t + 2880 < N; t++) { c60 += u[t]! * u[t + 60]!; c720 += u[t]! * u[t + 720]!; c2880 += u[t]! * u[t + 2880]!; }
    }
    const v = s2 / n - (s / n) ** 2, m = n - 8 * 2880;
    expect(Math.sqrt(v)).toBeGreaterThan(0.85);
    expect(Math.sqrt(v)).toBeLessThan(1.15);
    expect(c60 / m / v).toBeGreaterThan(0.9);
    const r12h = c720 / m / v;
    expect(r12h).toBeGreaterThan(0.25); // 1/e ≈ 0.37 near 12 h, like an OU process with τ = 12 h
    expect(r12h).toBeLessThan(0.55);
    expect(c2880 / m / v).toBeLessThan(0.2);
    // In a calm market the price is exactly V·exp(σ·u(t)): the engine's cached lattice = the pure noise.
    const svc = new LocalMarketService(calm({ noise: true }));
    for (let e = F; e < F + 400; e++) {
      const out = svc.settle({ epoch: e });
      for (const [id, sigma] of [['iron_plate', 0.06], ['sky_resin', 0.12]] as const) {
        const i = itemIdx(id), P = def(id).value! * Math.exp(sigma * noiseAt(seed, i, e + 1));
        expect(out.bid[i]).toBe(Math.max(1, Math.floor(P * (1 - (id === 'sky_resin' ? 0.1 : 0.04) / 2) * 100)));
      }
    }
  });
});

describe('market: spot trades', () => {
  it('a spot sale of 9 000 plates averages 0.787·P and leaves −25 % on the price, which fades back over hours', () => {
    const svc = new LocalMarketService(calm());
    const q = svc.quote('iron_plate', 'sell', 9_000_000);
    const bid = svc.prices().bid[itemIdx('iron_plate')]!;
    expect(q.ok).toBe(true);
    expect(q.factor).toBeCloseTo(0.787, 3);
    expect(q.shock).toBeCloseTo(0.75, 9);
    expect(q.totalCents).toBe(Math.floor(9000 * bid * q.factor));
    expect(q.unitCents).toBe(Math.round(bid * q.factor));
    const mid0 = item(svc, 'iron_plate').mid;
    svc.book('iron_plate', 'sell', 9_000_000);
    svc.settle({ epoch: F });
    expect(item(svc, 'iron_plate').mid).toBe(Math.round(mid0 * 0.75));
    run(svc, F + 1, F + 361); // τ = 6 h later: ln 0.75 · e^−1
    expect(item(svc, 'iron_plate').mid / mid0).toBeCloseTo(Math.exp(Math.log(0.75) * Math.exp(-1)), 2);
    run(svc, F + 361, F + 48 * 60);
    expect(Math.abs(item(svc, 'iron_plate').mid - mid0)).toBeLessThanOrEqual(1);
  });

  it('buying at once is the mirror: the average climbs as P·(K/L)·(e^(L/K) − 1) and the price rises', () => {
    const svc = new LocalMarketService(calm());
    const ask = svc.prices().ask[itemIdx('iron_plate')]!;
    const q = svc.quote('iron_plate', 'buy', 9_000_000);
    expect(q.factor).toBeCloseTo(2 * (Math.exp(0.5) - 1), 9);
    expect(q.totalCents).toBe(Math.ceil(9000 * ask * q.factor));
    expect(q.shock).toBeCloseTo(1 / 0.75, 9);
    // A huge purchase is capped at the 4 V ceiling.
    const huge = svc.quote('iron_plate', 'buy', 10_000_000_000);
    expect(huge.unitCents).toBeLessThanOrEqual(Math.ceil(4 * ask));
    expect(huge.unitCents).toBeGreaterThan(3.5 * ask);
  });

  it('quote is pure; booked trades continue along the depth curve, so splitting a sale inside an epoch gains nothing', () => {
    const a = new LocalMarketService(calm()), b = new LocalMarketService(calm());
    expect(a.quote('glass', 'sell', 4_000_000)).toEqual(a.quote('glass', 'sell', 4_000_000));
    const whole = a.book('glass', 'sell', 3_000_000).totalCents;
    let parts = 0;
    for (let k = 0; k < 3; k++) parts += b.book('glass', 'sell', 1_000_000).totalCents;
    expect(Math.abs(parts - whole)).toBeLessThanOrEqual(3);
    a.settle({ epoch: F });
    b.settle({ epoch: F });
    expect(b.prices()).toEqual(a.prices());
    // Market Sense (slippage 700 ‰) widens the depth: less slippage, a smaller shock.
    const c = new LocalMarketService(calm());
    expect(c.quote('iron_plate', 'sell', 9_000_000, 700).factor).toBeGreaterThan(c.quote('iron_plate', 'sell', 9_000_000).factor);
    // A trade reported in settle (not booked) shocks the price the same way.
    const d = new LocalMarketService(calm()), e = new LocalMarketService(calm());
    d.book('iron_plate', 'sell', 9_000_000);
    d.settle({ epoch: F });
    e.settle({ epoch: F, spot: flows({ iron_plate: 9000 }) });
    expect(e.prices()).toEqual(d.prices());
    // Water is not traded.
    expect(c.quote('water', 'sell', 1000).ok).toBe(false);
  });

  it('the trade post fee is the trade post\'s: price after fee rounds in its favour', () => {
    expect(afterFee(10_000, 'sell', 80)).toBe(9200);
    expect(afterFee(10_000, 'buy', 80)).toBe(10_800);
    expect(afterFee(999, 'sell', 80)).toBe(919);
    expect(afterFee(999, 'buy', 80)).toBe(1079);
    expect(valueCents(1500, 277, 'sell')).toBe(415);
    expect(valueCents(1500, 277, 'buy')).toBe(416);
  });
});

describe('market: the colonies', () => {
  it('forty colonies with the §6 profiles, Port-Écume, Sept-Cornes and Hameau-Lilas among them, every name unique', () => {
    const cols = makeColonies(WORLD_SEED);
    expect(cols).toHaveLength(40);
    const count: Record<string, number> = {};
    for (const c of cols) count[c.profile] = (count[c.profile] ?? 0) + 1;
    expect(count).toEqual({ mining: 7, foundry: 6, glasshouse: 6, wind: 5, saltport: 5, ember: 5, scholar: 4, drifter: 2 });
    for (const [p, n] of Object.entries(count)) expect(COLONY_PROFILES[p as keyof typeof COLONY_PROFILES].count).toBe(n);
    const fr = cols.map((c) => c.name.fr), en = cols.map((c) => c.name.en);
    expect(new Set(fr).size).toBe(40);
    expect(new Set(en).size).toBe(40);
    for (const n of ['Port-Écume', 'Sept-Cornes', 'Hameau-Lilas']) expect(fr).toContain(n);
    expect(cols.find((c) => c.name.fr === 'Port-Écume')!.needs).toContain('glass');
    for (const c of cols) {
      expect(c.name.fr).toMatch(/^[\p{L}]+-[\p{L}]+$/u);
      expect(c.delayMin).toBe(BAL.market.delayMin[c.band]);
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
    }
    const bands = (p: string): Set<string> => new Set(cols.filter((c) => c.profile === p).map((c) => c.band));
    expect(bands('mining')).toEqual(new Set(['near']));
    expect(bands('glasshouse')).toEqual(new Set(['medium']));
    expect(bands('ember')).toEqual(new Set(['far']));
    expect(bands('drifter')).toEqual(new Set(['veryFar']));
    expect(bands('foundry')).toEqual(new Set(['near', 'medium'])); // « proche–moyen »: some of each
    expect(bands('saltport')).toEqual(new Set(['medium', 'far'])); // « moyen–lointain »
    // Glasshouses alternate sporeglass and lumen moss; the same seed gives the same world.
    expect(cols.filter((c) => c.profile === 'glasshouse').map((c) => c.unique)).toEqual(['sporeglass', 'lumen_moss', 'sporeglass', 'lumen_moss', 'sporeglass', 'lumen_moss']);
    expect(makeColonies(WORLD_SEED)).toEqual(cols);
    expect(makeColonies(WORLD_SEED + 1).map((c) => c.name.fr)).not.toEqual(fr);
  });

  it('every tradable good has an NPC supplier and buyer; imports come from the nearest supplier first', () => {
    const trade = tradeByItem(makeColonies(WORLD_SEED));
    const svc = new LocalMarketService(calm());
    for (const it of svc.snapshot().items) {
      const tr = trade[it.idx]!;
      expect(tr.sources.length, it.item).toBeGreaterThan(0);
      expect(tr.buyers.length, it.item).toBeGreaterThan(0);
      for (let k = 1; k < tr.sources.length; k++) expect(tr.sources[k]!.delayMin).toBeGreaterThanOrEqual(tr.sources[k - 1]!.delayMin);
      expect(tr.sources.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 9);
      expect(svc.sources(it.item)).toEqual(tr.sources);
    }
    const copper = svc.sources('copper_ore')[0]!;
    expect(copper.delayMin).toBe(BAL.market.delayMin.near); // a mining camp, near
    expect(svc.snapshot().colonies[copper.colony]!.profile).toBe('mining');
    expect(svc.sources('resin_canvas')[0]!.delayMin).toBe(BAL.market.delayMin.veryFar); // only the drifter guilds weave it
    expect(svc.sources('water')).toEqual([]);
  });

  it('at day 0 every tradable good is balanced at r = 1 with depth Q (T3/T4 markets start at 20 % and ramp up)', () => {
    const svc = new LocalMarketService(calm());
    for (const it of svc.snapshot().items) {
      const d = def(it.item);
      const ramp = d.tier >= 3 ? 0.2 : 1;
      expect(it.depth.supply, it.item).toBeCloseTo(d.depth * ramp, 9);
      expect(it.depth.demand, it.item).toBeCloseTo(d.depth * ramp, 9);
      expect(it.eq).toBe(1);
      expect(Math.abs(it.mid - d.value! * 100)).toBeLessThanOrEqual(0.5);
    }
    const ramps = [rampAt(1, 0), rampAt(2, 10), rampAt(3, 0), rampAt(3, 15), rampAt(3, 30), rampAt(4, 22.5), rampAt(4, 45), rampAt(4, 90)];
    [1, 1, 0.2, 0.6, 1, 0.6, 1, 1].forEach((v, k) => expect(ramps[k]).toBeCloseTo(v, 12));
  });

  it('the player\'s trade is drawn between colonies: exports to the buyers, imports from the nearest supplier', () => {
    const svc = new LocalMarketService(calm());
    run(svc, F, F + 120, { sold: flows({ iron_plate: 60 }), bought: flows({ copper_ore: 10 }) });
    const snap = svc.snapshot();
    const exp = snap.trade.filter((t) => t.exportCpm > 0).map((t) => snap.colonies[t.colony]!.profile);
    expect(new Set(exp)).toEqual(new Set(['saltport'])); // the salt ports buy plates
    const imp = snap.trade.filter((t) => t.importCpm > 0);
    expect(imp.map((t) => t.colony)).toEqual([svc.sources('copper_ore')[0]!.colony]);
    // ≈ 10 copper/min × 4 ◉, smoothed over an hour: close to its steady 4 000 cents/min after 2 h.
    expect(imp[0]!.importCpm).toBeGreaterThan(3000);
    expect(imp[0]!.importCpm).toBeLessThan(4100);
  });
});

describe('market: events and the Gazette', () => {
  const world = (seed: number): EventWorld => {
    const eng = new MarketEngine({ worldSeed: seed, foundingEpoch: F });
    return { tradable: eng.items, uniques: eng.items.filter((i) => eng.unique[i]), trade: eng.trade, colonies: eng.colonies };
  };

  it('two colonies of one world see the same events at the same epoch, whenever they were founded', () => {
    const a = new LocalMarketService({ worldSeed: WORLD_SEED, foundingEpoch: F });
    const b = new LocalMarketService({ worldSeed: WORLD_SEED, foundingEpoch: F + 2000 });
    const notOwn = (e: { scripted: boolean }): boolean => !e.scripted;
    run(a, F, F + 2000);
    const seenA: string[] = [], seenB: string[] = [];
    for (let e = F + 2000; e < F + 2000 + 3 * 1440; e++) {
      const oa = a.settle({ epoch: e }), ob = b.settle({ epoch: e });
      for (const [o, seen] of [[oa, seenA], [ob, seenB]] as const) {
        for (const ev of o.started.filter(notOwn)) seen.push(`start ${ev.id} ${e + 1}`);
        for (const ev of o.ended.filter(notOwn)) seen.push(`end ${ev.id} ${e + 1}`);
        for (const ev of o.announced.filter(notOwn)) seen.push(`news ${ev.id} ${e + 1}`);
      }
      if (e % 97 === 0) expect(b.snapshot().events.active.filter(notOwn)).toEqual(a.snapshot().events.active.filter(notOwn));
    }
    expect(seenA.length).toBeGreaterThan(0);
    expect(seenB).toEqual(seenA);
  });

  it('different windows draw different events, and ≈ 35 % of windows hold one', () => {
    const w = world(WORLD_SEED);
    const W0 = Math.floor(F / 360), N = 20_000;
    const evs = Array.from({ length: N }, (_, k) => windowEvent(WORLD_SEED, W0 + k, w));
    const share = evs.filter(Boolean).length / N;
    expect(share).toBeGreaterThan(0.33);
    expect(share).toBeLessThan(0.37);
    const sig = new Set(evs.filter(Boolean).map((e) => `${e!.kind} ${e!.item} ${e!.tier} ${e!.start % 360} ${e!.end - e!.start}`));
    expect(sig.size).toBeGreaterThan(0.8 * evs.filter(Boolean).length);
    const kinds = new Set(evs.filter(Boolean).map((e) => e!.kind));
    expect(kinds).toEqual(new Set(['shortage', 'boom', 'glut', 'storm', 'caravan']));
    for (const e of evs) {
      if (!e) continue;
      expect(e.start - e.announce).toBeGreaterThanOrEqual(60); // the Gazette: 1–3 h ahead
      expect(e.start - e.announce).toBeLessThanOrEqual(180);
      expect(Math.floor(e.start / 360)).toBe(Number(e.id.slice(1)));
      const [h0, h1] = BAL.market.events[e.kind].hours;
      expect(e.end - e.start).toBeGreaterThanOrEqual(h0 * 60);
      expect(e.end - e.start).toBeLessThanOrEqual(h1 * 60);
      if (e.kind === 'storm') expect(e.item).toBe('charged_cell');
      if (e.kind === 'caravan') expect(def(e.item!).kind).toBe('unique');
      if (e.kind === 'boom') expect(e.item).toBeNull();
    }
    // Another world, other events; the same world, the same events.
    expect(Array.from({ length: 200 }, (_, k) => windowEvent(WORLD_SEED + 1, W0 + k, world(WORLD_SEED + 1))))
      .not.toEqual(evs.slice(0, 200));
    expect(Array.from({ length: 200 }, (_, k) => windowEvent(WORLD_SEED, W0 + k, w))).toEqual(evs.slice(0, 200));
  });

  it('the scripted Port-Écume bulb shortage is announced at founding, starts 20 min later, lasts 2 h and lifts the bulb price', () => {
    const svc = new LocalMarketService(calm({ firstTrade: true }));
    const snap = svc.snapshot();
    const ev = snap.events.announced.find((e) => e.id === 'first-trade')!;
    expect(ev).toMatchObject({ kind: 'shortage', side: 'demand', mult: 2, item: 'glass', start: F + 20, end: F + 140, announce: F, scripted: true });
    expect(snap.colonies[ev.colony]!.name.fr).toBe('Port-Écume');
    const V = def('glass').value! * 100;
    for (let e = F; e < F + 19; e++) expect(svc.settle({ epoch: e }).started).toEqual([]);
    expect(svc.settle({ epoch: F + 19 }).started.map((e) => e.id)).toEqual(['first-trade']);
    expect(svc.snapshot().events.active.map((e) => e.id)).toEqual(['first-trade']);
    run(svc, F + 20, F + 80);
    expect(item(svc, 'glass').mid).toBeGreaterThan(1.4 * V); // demand ×2 → r* = 2^(1/1.4) ≈ 1.64
    run(svc, F + 80, F + 139);
    expect(svc.settle({ epoch: F + 139 }).ended.map((e) => e.id)).toEqual(['first-trade']);
    run(svc, F + 140, F + 260);
    expect(Math.abs(item(svc, 'glass').mid - V)).toBeLessThan(0.02 * V);
  });
});

describe('market: service contract', () => {
  it('save → load (through JSON) → the same future settles, quotes and snapshot', () => {
    const cfg: MarketConfig = { worldSeed: WORLD_SEED, foundingEpoch: F };
    const a = new LocalMarketService(cfg);
    const input = (e: number): MarketEpochIn => ({
      epoch: e,
      sold: flows({ iron_plate: 40 + (e % 7) * 5, glass: e % 3 === 0 ? 30 : 0, robot_arm: 0.5 }),
      bought: flows({ copper_ore: 12, sporeglass: e % 11 === 0 ? 4 : 0 }),
    });
    for (let e = F; e < F + 1003; e++) a.settle(input(e));
    a.book('circuit', 'sell', 500_000);
    a.book('lens', 'buy', 20_000);
    const save = JSON.parse(JSON.stringify(a.save()));
    const b = LocalMarketService.load(save, cfg);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.quote('circuit', 'sell', 100_000)).toEqual(a.quote('circuit', 'sell', 100_000));
    for (let e = F + 1003; e < F + 3000; e++) {
      if (e % 400 === 0) for (const s of [a, b]) s.book('iron_plate', 'sell', 2_000_000);
      expect(b.settle(input(e))).toEqual(a.settle(input(e)));
    }
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.save()).toEqual(a.save());
    expect(() => LocalMarketService.load({ ...save, v: 2 }, cfg)).toThrow();
  });

  it('a stale epoch changes nothing, and a gap is settled as trade-free epochs', () => {
    const a = new LocalMarketService({ worldSeed: WORLD_SEED, foundingEpoch: F });
    const b = new LocalMarketService({ worldSeed: WORLD_SEED, foundingEpoch: F });
    a.settle({ epoch: F });
    const before = a.prices();
    expect(a.settle({ epoch: F, sold: flows({ iron_plate: 600 }) })).toMatchObject({ ...before, started: [], ended: [] });
    expect(a.prices()).toEqual(before);
    a.settle({ epoch: F + 500, sold: flows({ iron_plate: 60 }) });
    run(b, F, F + 500);
    b.settle({ epoch: F + 500, sold: flows({ iron_plate: 60 }) });
    expect(a.save()).toEqual(b.save());
    expect(a.epoch).toBe(F + 501);
  });

  it('a week offline — 10 080 settles in a row — takes under 0.5 s of CPU', () => {
    const svc = new LocalMarketService({ worldSeed: WORLD_SEED, foundingEpoch: F });
    const sold = flows({ iron_plate: 120, glass: 40, circuit: 6, charged_cell: 1, robot_arm: 0.5 });
    const bought = flows({ copper_ore: 20, sporeglass: 4, embersalt: 3 });
    // CPU time, not the wall's: other test runs on the machine do not count (core/cpu-time.ts).
    const { ms, wall } = timed(() => { for (let e = F; e < F + 10_080; e++) svc.settle({ epoch: e, sold, bought }); });
    expect(ms, `${Math.round(ms)} ms of CPU (${Math.round(wall)} ms on the wall)`).toBeLessThan(500);
  });

  it('the board: margin per machine at the bid / ask, ◉ per raw tile-minute, and the player\'s price impact (120 plates/min ≈ −13 %)', () => {
    const svc = new LocalMarketService(calm());
    const t = svc.prices(), bid = (id: string): number => t.bid[itemIdx(id)]! / 100, ask = (id: string): number => t.ask[itemIdx(id)]! / 100;
    const [plate] = svc.board(['iron_plate'], 0.04, { flows: { iron_plate: 120 } });
    // A smelter: 10 plates/min from 10 iron + 10 coal (6 s a plate, D97), no grid power (it burns the coal).
    expect(plate!.cycles).toBe(10);
    expect(plate!.revenue).toBeCloseTo(10 * bid('iron_plate'), 9);
    expect(plate!.inputs).toBeCloseTo(10 * bid('iron_ore') + 10 * bid('coal'), 9);
    expect(plate!.energy).toBe(0);
    expect(plate!.tiles).toBeCloseTo(10 / 5 + 10 / 3, 9);
    expect(plate!.perTile).toBeCloseTo(plate!.revenue / (10 / 5 + 10 / 3), 9);
    expect(plate!.impact).toBeCloseTo(Math.exp(lnEquilibrium(600, 600, 120, 0)) - 1, 6);
    expect(plate!.impact).toBeCloseTo(-0.134, 2);
    // Bought inputs cost the ask and use no tiles; the machine's power costs kW × c_E.
    const [joint] = svc.board(['gear'], 0.04, { home: new Set<string>() });
    expect(joint!.inputs).toBeCloseTo(12 * 3 * ask('iron_plate'), 9);
    expect(joint!.energy).toBeCloseTo(60 * 0.04, 9); // the press (D70: gears are its one recipe)
    expect(joint!.margin).toBeCloseTo(12 * bid('gear') - 36 * ask('iron_plate') - 2.4, 9);
    expect(joint!.tiles).toBe(0);
    expect(joint!.perTile).toBeNull();
    // The cell charger's 600 kW·min per craft is its 300 kW, counted once.
    expect(svc.board(['charged_cell'], 0.04)[0]!.energy).toBeCloseTo(300 * 0.04, 9);
    // The board's tile caps are the drills' deposit caps (CIRQUE `rich` is in 10 mu per epoch per tile).
    const caps = tileCapsPerMin();
    for (const d of CIRQUE.deposits) if (d.item !== 'copper_ore') expect(caps[d.item], d.item).toBe(d.rich / 100);
    for (const u of Object.values(UNIQUE_BIOMES)) expect(caps[u.item], u.item).toBe(1);
    // Rows come sorted by ◉ per raw tile-minute.
    const rows = svc.board(['iron_plate', 'glass', 'copper_wire', 'gear', 'circuit', 'ceramic', 'robot_arm'], 0.04);
    const per = rows.filter((r) => r.perTile !== null).map((r) => r.perTile!);
    expect(per).toEqual([...per].sort((x, y) => y - x));
  });

  it('src/market never uses Math.random, the clock or performance timers (determinism guard)', () => {
    const dir = join(__dirname);
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      readFileSync(join(dir, f), 'utf8').split('\n').forEach((l, k) => {
        const code = l.replace(/\/\/.*$/, '');
        if (/Math\.random|Date\.|new Date\b|performance\.|setTimeout|setInterval/.test(code)) offenders.push(`${f}:${k + 1}: ${l.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
