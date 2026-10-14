import { describe, it, expect } from 'vitest';
import { buildingIdx, itemIdx } from '@/content/registry';
import { WORLD_SEED } from '@/content/world';
import { afterFee, valueCents } from '@/market/pricing';
import { BAL } from '@/content/balance';
import { testSim, drillToHearth, line, steadyPower, wire, IRON } from './testkit';
import { WORLD_EPOCH0 } from './constants';
import { buildDemo, connect } from './dev';
import { worldPorts } from './entities';
import { catchUp } from './offline/catchup';
import { serialize, deserialize } from './serialize';
import { deliveryTicks, orderTrades, throughputMu, type ImportOrder } from './trade';
import { containerFull, containerMu, handsOut, nextToHearth, waitingMu } from './systems/trade';
import { Sim } from './state';
import { MapGen } from './world/mapgen';

const PLATE = (): number => itemIdx('iron_plate');
const COPPER = (): number => itemIdx('copper_ore');

/** A colony with a trade post against the Hearth's east side (it sells from, and delivers into, the Hearth). */
function postSim(): { sim: Sim; post: number } {
  const sim = testSim();
  const r = sim.place('trade_post', 515, 510, 0);
  if (!r.ok) throw new Error(`trade post: ${r.reason}`);
  return { sim, post: r.id! };
}

/**
 * Its north-west outlet (515,510) set to `item`, and a ribbon from it round into the Hearth's
 * north inlet (512,510): the post's purchases of it come out there (D43).
 */
function outletToHearth(sim: Sim, post: number, item: string): void {
  expect(sim.setPortItem(post, 4, item)).toBe(true);
  sim.placeBelts('ribbon', [[515, 509, 3], [514, 509, 3], [513, 509, 3], [512, 509, 2]]);
}

describe('trade posts', () => {
  it('a post against the Hearth sells its stream from the stock at the epoch’s bid, minus the fee, keeping a reserve', () => {
    const { sim, post } = postSim();
    expect(nextToHearth(sim, sim.ents.get(post)!)).toBe(true);
    expect(sim.setExport(post, 0, 'iron_plate')).toBeNull();
    const stock0 = sim.stock[PLATE()]!, credits0 = sim.credits, bid = sim.prices.bid[PLATE()]!;
    const mu = Math.min(throughputMu(1), stock0 - BAL.tradeHearthReserve * 1000);
    sim.run(600); // one epoch: the boundary sells
    expect(sim.stock[PLATE()]).toBe(stock0 - mu);
    expect(sim.credits - credits0).toBe(afterFee(valueCents(mu, bid, 'sell'), 'sell', sim.mods.tradeFee));
    expect(sim.trade.soldTotal[PLATE()]).toBe(mu);
    expect(sim.events.some((e) => e.k === 'trade' && e.post === post && e.soldMu === mu)).toBe(true);
  });

  it('a standing order buys at the ask under its max; the goods land in the container after the lift and the colony’s delay, and leave by its outlet', () => {
    const { sim, post } = postSim();
    outletToHearth(sim, post, 'copper_ore');
    const ask = sim.prices.ask[COPPER()]!;
    const id = sim.addImport(post, 'copper_ore', 10, ask * 2);
    expect(typeof id).toBe('number');
    const credits0 = sim.credits, chime0 = sim.stock[COPPER()]!;
    sim.run(600);
    const cost = afterFee(valueCents(10_000, ask, 'buy'), 'buy', sim.mods.tradeFee);
    expect(credits0 - sim.credits).toBe(cost);
    expect(sim.trade.inflight).toHaveLength(1);
    const ship = sim.trade.inflight[0]!;
    const src = sim.market.sources(COPPER())[0]!;
    expect(ship.arrive).toBe(600 + deliveryTicks(1, src.delayMin, sim.mods));
    expect(ship.arrive % 600).toBe(0);
    sim.run(ship.arrive - sim.tick - 1);
    expect(sim.stores.get(post)![COPPER()]).toBe(0); // not yet
    sim.run(1);
    expect(sim.stores.get(post)![COPPER()]).toBeGreaterThan(0); // in its container, not in the Hearth next door
    expect(sim.stock[COPPER()]).toBe(chime0);
    expect(sim.events.some((e) => e.k === 'delivered' && e.item === COPPER())).toBe(true);
    sim.run(300);
    expect(sim.stock[COPPER()]).toBeGreaterThanOrEqual(chime0 + 10_000); // out by its outlet, along the ribbon, into the Hearth
  });

  it('an order buys nothing while no outlet takes its item out: no ocelle spent; set one, and it buys', () => {
    const { sim, post } = postSim();
    const o = sim.addImport(post, 'copper_ore', 10, sim.prices.ask[COPPER()]! * 2);
    expect(typeof o).toBe('number');
    const credits0 = sim.credits;
    sim.run(1800);
    expect(sim.credits).toBe(credits0);
    expect(sim.trade.inflight).toHaveLength(0);
    outletToHearth(sim, post, 'copper_ore');
    sim.run(600);
    expect(sim.credits).toBeLessThan(credits0);
    expect(sim.trade.inflight).toHaveLength(1);
  });

  it('a full container holds its deliveries in the air and stops the orders, nothing paid; emptied by its outlet, it takes them again', () => {
    const { sim, post } = postSim();
    sim.grantCredits(5_000_000);
    expect(sim.setPortItem(post, 4, 'copper_ore')).toBe(true);
    sim.placeBelts('ribbon', [[515, 509, 0], [515, 508, 0]]); // a dead end: two items, then nothing leaves
    expect(typeof sim.addImport(post, 'copper_ore', 50, 1_000_000)).toBe('number');
    const e = sim.ents.get(post)!;
    let held = -1;
    for (let k = 0; k < 60 && held < 0; k++) {
      sim.run(600);
      if (sim.trade.inflight.some((s) => s.arrive <= sim.tick)) held = sim.tick;
    }
    expect(held).toBeGreaterThan(0);
    expect(containerFull(sim, e)).toBe(true);
    expect(waitingMu(sim, e)).toBeLessThanOrEqual(containerMu(sim));
    const credits = sim.credits, inflight = sim.trade.inflight.length;
    sim.run(3 * 600);
    expect(sim.credits).toBe(credits); // nothing bought, nothing paid
    expect(sim.trade.inflight.length).toBeLessThanOrEqual(inflight);
    // Its outlet led into the Hearth: the container empties, the deliveries land, the order buys again.
    sim.remove(515, 508); sim.remove(515, 509);
    outletToHearth(sim, post, 'copper_ore');
    sim.run(60 * 600);
    expect(sim.stock[COPPER()]).toBeGreaterThan(100_000);
    expect(sim.credits).toBeLessThan(credits);
  });

  it('the demo’s post, against the Heart, takes a purchase out by a ribbon into it (the smoke’s order); no pole of the demo stands in front of a port', () => {
    // The breadth-first power lines (D45) once put a pole on this post's free outlet: `connect`
    // found no way out, and the order bought nothing ('outlet'). Its other outlet faces a corner
    // of the Heart, where no inlet is: no direct insertion there (D39).
    const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: 1, source: new MapGen(WORLD_SEED, 1), foundingEpoch: WORLD_EPOCH0 + 777 });
    const post = buildDemo(sim).trade!;
    expect(nextToHearth(sim, sim.ents.get(post)!)).toBe(true);
    const mast = buildingIdx('mast');
    for (const e of sim.ents.map.values()) for (const p of worldPorts(e)) expect(sim.entityAt(p.fx, p.fy)?.def, `port ${p.idx} of ${e.id}`).not.toBe(mast);
    for (const k of [4, 5]) expect(sim.setPortItem(post, k, 'copper_ore')).toBe(true);
    expect(connect(sim, post, sim.hearthId)).toBeGreaterThan(0);
    sim.ensureCompiled();
    expect(handsOut(sim, sim.ents.get(post)!, COPPER())).toBe(true);
    const o = sim.addImport(post, 'copper_ore', 10, sim.prices.ask[COPPER()]! * 2);
    expect(typeof o).toBe('number');
    const chime0 = sim.stock[COPPER()]!;
    for (let k = 0; k < 14 && sim.stock[COPPER()]! < chime0 + 10_000; k++) sim.run(5 * 600);
    expect(sim.stock[COPPER()]).toBeGreaterThanOrEqual(chime0 + 10_000);
  });

  it('a full Hearth that a stream sells down takes its blocked line again — offline too, at the same moment', () => {
    // The Hearth full of iron ore, a drill's line into it jammed; the post against it sells ore
    // every minute, so the line flows again. Offline, the boundary's sale moves a level that has
    // no flow: the catch-up must look at it again (`moved`).
    const make = (): Sim => {
      const { sim, post } = postSim();
      steadyPower(sim);
      drillToHearth(sim);
      sim.grant('iron_ore', Math.ceil((sim.hearthCap() - sim.stock[IRON()]!) / 1000));
      sim.run(300); // the line jams
      expect(sim.setExport(post, 0, 'iron_ore')).toBeNull();
      return sim;
    };
    const a = make(), b = make();
    const span = 3 * 36_000;
    a.run(span);
    catchUp(b, span, { noDirect: true });
    expect(a.trade.soldTotal[IRON()]).toBeGreaterThan(100_000);
    expect(b.trade.soldTotal[IRON()]).toBe(a.trade.soldTotal[IRON()]);
    expect(b.stock[IRON()]).toBe(a.stock[IRON()]);
    expect(b.hash()).toBe(a.hash());
  });

  it('an order pauses above its max price and resumes only 3 % below it', () => {
    const o: ImportOrder = { id: 1, post: 1, item: 0, perMin: 1, maxCents: 1000, active: true };
    expect(orderTrades(o, 1000)).toBe(true);
    expect(orderTrades(o, 1001)).toBe(false);
    o.active = false;
    expect(orderTrades(o, 1000)).toBe(false);
    expect(orderTrades(o, 980)).toBe(false);
    expect(orderTrades(o, 970)).toBe(true);
  });

  it('a post lifts at most its throughput per minute, orders first, then streams', () => {
    const { sim, post } = postSim();
    sim.grant('iron_plate', 1000);
    sim.grantCredits(1_000_000);
    sim.setExport(post, 0, 'iron_plate');
    outletToHearth(sim, post, 'copper_ore');
    sim.addImport(post, 'copper_ore', 50, 1_000_000);
    sim.run(600);
    const a = sim.trade.activity.get(post)!;
    expect(a.boughtMu).toBe(50_000);
    expect(a.soldMu).toBe(throughputMu(1) - 50_000);
  });

  it('one trade post until Second Wharf; a removed post takes its streams and orders with it', () => {
    const { sim, post } = postSim();
    expect(sim.canPlace('trade_post', 505, 517, 0).reason).toBe('limit');
    sim.setExport(post, 0, 'iron_plate');
    sim.addImport(post, 'copper_ore', 5, 100_000);
    const e = sim.ents.get(post)!;
    expect(sim.remove(e.x, e.y)).toBe(true);
    expect(sim.trade.orders).toHaveLength(0);
    expect(sim.trade.exports.has(post)).toBe(false);
    for (const id of ['cm1', 'cm2', 'cm3']) sim.done.add(id);
    sim.rebuildDerived();
    expect(sim.place('trade_post', 515, 510, 0).ok).toBe(true);
    expect(sim.canPlace('trade_post', 505, 517, 0).ok).toBe(true);
  });

  it('spot trades: sold from the Hearth along the depth, bought into the post after its delays; refused without a post', () => {
    const bare = testSim();
    expect(bare.spotTrade('iron_plate', 'sell', 10)).toEqual({ refused: 'no_post' });
    const { sim, post } = postSim();
    const q = sim.quoteSpot(PLATE(), 'sell', 50);
    const before = sim.credits;
    const r = sim.spotTrade('iron_plate', 'sell', 50);
    expect(r).toEqual({ cents: q.cents });
    expect(sim.credits - before).toBe(q.cents);
    expect(sim.spotTrade('iron_plate', 'sell', 100_000)).toEqual({ refused: 'stock' });
    expect(sim.spotTrade('copper_ore', 'buy', 5)).toEqual({ refused: 'no_outlet' }); // it could never come out
    outletToHearth(sim, post, 'copper_ore');
    sim.ensureCompiled();
    expect(sim.spotTrade('copper_ore', 'buy', containerMu(sim) / 1000 + 1)).toEqual({ refused: 'container' });
    const buy = sim.spotTrade('copper_ore', 'buy', 5);
    expect('cents' in buy && buy.cents < 0).toBe(true);
    expect(sim.trade.inflight).toHaveLength(1);
  });

  it('trading during an absence matches ticking (the same ocelles, the same goods)', () => {
    // A drill feeds iron ore by ribbon into a post away from the Hearth; the post also imports.
    const make = (): Sim => {
      const sim = testSim();
      steadyPower(sim); // the drill runs day and night: one steady regime
      const d = sim.place('drill', 511, 502, 1); // east output
      if (!d.ok) throw new Error(`drill ${d.reason}`);
      wire(sim, d.id!);
      const p = sim.place('trade_post', 516, 499, 0);
      if (!p.ok) throw new Error(`post ${p.reason}`);
      // Drill output (513,502) east → the post's west inlet (516,500).
      sim.placeBelts('ribbon', [...line(513, 502, 1, 2), [515, 502, 0], [515, 501, 0], [515, 500, 1]]);
      expect(sim.setExport(p.id!, 0, 'iron_ore')).toBeNull();
      // Its sand comes out by its north-west outlet onto a dead end: six squares, then the
      // container fills and the order stops (D43) — at the same lift online and offline.
      expect(sim.setPortItem(p.id!, 4, 'sand')).toBe(true);
      sim.placeBelts('ribbon', line(516, 498, 0, 6));
      sim.grantCredits(500_000);
      expect(typeof sim.addImport(p.id!, 'sand', 3, 1_000_000)).toBe('number');
      sim.run(30);
      return sim;
    };
    const a = make(), b = make();
    const span = 4 * 36_000;
    a.run(span);
    catchUp(b, span, { noDirect: true });
    expect(a.trade.soldTotal[IRON()]).toBeGreaterThan(100_000);
    expect(b.trade.soldTotal[IRON()]).toBe(a.trade.soldTotal[IRON()]);
    expect(a.trade.boughtTotal[itemIdx('sand')]).toBeGreaterThan(100_000);
    expect(b.trade.boughtTotal[itemIdx('sand')]).toBe(a.trade.boughtTotal[itemIdx('sand')]);
    expect(b.credits).toBe(a.credits);
    expect(b.trade.ledger.length).toBeGreaterThan(100);
    expect(b.trade.ledger).toEqual(a.trade.ledger); // the same ledger, line for line (plan §10, M6)
    expect(b.hash()).toBe(a.hash());
  });

  it('save → load with goods in flight continues bit for bit', () => {
    const { sim, post } = postSim();
    sim.setExport(post, 0, 'iron_plate');
    outletToHearth(sim, post, 'copper_ore');
    sim.addImport(post, 'copper_ore', 4, 1_000_000);
    sim.run(600 * 3 + 123);
    expect(sim.trade.inflight.length).toBeGreaterThan(0);
    const copy = deserialize(serialize(sim), sim.grid.source);
    expect(copy.hash()).toBe(sim.hash());
    sim.run(600 * 40);
    copy.run(600 * 40);
    expect(copy.hash()).toBe(sim.hash());
    expect(copy.credits).toBe(sim.credits);
  });
});
