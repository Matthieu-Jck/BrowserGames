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

/** A colony with a trade post (5×5: its pad and flame apron, D62) against the Hearth's east side (it sells from the Hearth's stock). */
function postSim(): { sim: Sim; post: number } {
  const sim = testSim();
  const r = sim.place('trade_post', 515, 510, 0);
  if (!r.ok) throw new Error(`trade post: ${r.reason}`);
  return { sim, post: r.id! };
}

/**
 * A ribbon from its exit (517,510, facing north) round into the Hearth's north inlet (512,510):
 * whatever the post bought comes out there, in turn (D43, D62).
 */
function exitToHearth(sim: Sim): void {
  sim.placeBelts('ribbon', [[517, 509, 3], [516, 509, 3], [515, 509, 3], [514, 509, 3], [513, 509, 3], [512, 509, 2]]);
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
    exitToHearth(sim);
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

  it('an order buys nothing while the exit leads nowhere: no ocelle spent; laid into the Hearth, it buys', () => {
    const { sim, post } = postSim();
    const o = sim.addImport(post, 'copper_ore', 10, sim.prices.ask[COPPER()]! * 2);
    expect(typeof o).toBe('number');
    const credits0 = sim.credits;
    sim.run(1800);
    expect(sim.credits).toBe(credits0);
    expect(sim.trade.inflight).toHaveLength(0);
    exitToHearth(sim);
    sim.run(600);
    expect(sim.credits).toBeLessThan(credits0);
    expect(sim.trade.inflight).toHaveLength(1);
  });

  it('a full container holds its deliveries in the air and stops the orders, nothing paid; emptied by its outlet, it takes them again', () => {
    const { sim, post } = postSim();
    sim.grantCredits(5_000_000);
    sim.placeBelts('ribbon', [[517, 509, 0], [517, 508, 0]]); // a dead end off the exit: two items, then nothing leaves
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
    // Its exit led into the Hearth: the container empties, the deliveries land, the order buys again.
    sim.remove(517, 508); sim.remove(517, 509);
    exitToHearth(sim);
    sim.run(60 * 600);
    expect(sim.stock[COPPER()]).toBeGreaterThan(100_000);
    expect(sim.credits).toBeLessThan(credits);
  });

  it('the demo’s post, against the Heart, takes a purchase out by a ribbon into it (the smoke’s order); no pole of the demo stands in front of a port', () => {
    // The breadth-first power lines (D45) once put a pole on this post's free outlet: `connect`
    // found no way out, and the order bought nothing ('outlet'). Its exit takes whatever it bought.
    const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: 1, source: new MapGen(WORLD_SEED, 1), foundingEpoch: WORLD_EPOCH0 + 777 });
    const post = buildDemo(sim).trade!;
    expect(nextToHearth(sim, sim.ents.get(post)!)).toBe(true);
    const mast = buildingIdx('mast');
    for (const e of sim.ents.map.values()) for (const p of worldPorts(e)) expect(sim.entityAt(p.fx, p.fy)?.def, `port ${p.idx} of ${e.id}`).not.toBe(mast);
    expect(sim.setPortItem(post, 1, 'copper_ore')).toBe(false); // no item to set: the exit hands out every purchase
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
    exitToHearth(sim);
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
    const { sim } = postSim();
    const q = sim.quoteSpot(PLATE(), 'sell', 50);
    const before = sim.credits;
    const r = sim.spotTrade('iron_plate', 'sell', 50);
    expect(r).toEqual({ cents: q.cents });
    expect(sim.credits - before).toBe(q.cents);
    expect(sim.spotTrade('iron_plate', 'sell', 100_000)).toEqual({ refused: 'stock' });
    expect(sim.spotTrade('copper_ore', 'buy', 5)).toEqual({ refused: 'no_outlet' }); // it could never come out
    exitToHearth(sim);
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
      // Drill output (513,502) east → round the apron → the post's entrance (518,503) from the south.
      sim.placeBelts('ribbon', [...line(513, 502, 1, 2), [515, 502, 2], [515, 503, 2], ...line(515, 504, 1, 3), [518, 504, 0]]);
      expect(sim.setExport(p.id!, 0, 'iron_ore')).toBeNull();
      // Its sand comes out of its exit (518,499) onto a dead end: six squares, then the container
      // fills and the order stops (D43) — at the same lift online and offline.
      sim.placeBelts('ribbon', line(518, 498, 0, 6));
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
    exitToHearth(sim);
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

  it('the pad keeps its flame apron clear: one entrance, one exit, nothing built a tile round its deck (D62)', () => {
    const { sim, post } = postSim();
    const e = sim.ents.get(post)!;
    const ports = worldPorts(e);
    expect(ports.filter((p) => p.io === 'in')).toHaveLength(1);
    expect(ports.filter((p) => p.io === 'out')).toHaveLength(1);
    // The apron is the post's own ground: a pole on it is refused, one tile past it stands.
    expect(sim.canPlace('mast', e.x + 4, e.y + 1, 0).reason).toBe('occupied');
    expect(sim.canPlace('mast', e.x + 5, e.y + 1, 0).ok).toBe(true);
  });

  it('two purchases leave its one exit in turn, into the Hearth; an absence buys and pays the same (D62)', () => {
    const make = (): Sim => {
      const { sim, post } = postSim();
      exitToHearth(sim);
      sim.grantCredits(2_000_000);
      expect(typeof sim.addImport(post, 'copper_ore', 6, 1_000_000)).toBe('number');
      expect(typeof sim.addImport(post, 'iron_plate', 4, 1_000_000)).toBe('number');
      sim.run(30);
      return sim;
    };
    const a = make(), b = make();
    const cu0 = a.stock[COPPER()]!, pl0 = a.stock[PLATE()]!;
    const span = 3 * 36_000;
    a.run(span);
    catchUp(b, span, { noDirect: true });
    // Both came out of the one exit and into the Hearth.
    expect(a.stock[COPPER()]! - cu0).toBeGreaterThan(500_000);
    expect(a.stock[PLATE()]! - pl0).toBeGreaterThan(300_000);
    // Offline the same purchases, the same ocelles; what has left the container lags by at most
    // the known gap of a store drained by an outlet (docs/offline.md, Known gaps: ≤ 40 items).
    for (const it of [COPPER(), PLATE()]) {
      expect(b.trade.boughtTotal[it]).toBe(a.trade.boughtTotal[it]);
      expect(Math.abs(b.stock[it]! - a.stock[it]!)).toBeLessThanOrEqual(40_000);
    }
    expect(b.credits).toBe(a.credits);
  });
});
