import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { RESEARCH_IDS, buildingIdx, itemIdx } from '@/content/registry';
import { researchNode } from '@/content/research';
import { WORLD_SEED } from '@/content/world';
import { afterFee, valueCents } from '@/market/pricing';
import { testSim, line, steadyPower, wire, IRON } from './testkit';
import { WORLD_EPOCH0 } from './constants';
import { replay } from './commands';
import { buildDemo, connect } from './dev';
import { worldPorts } from './entities';
import { catchUp } from './offline/catchup';
import { serialize, deserialize, type SaveData } from './serialize';
import { contentTable, remapSave, type ContentTable } from './save-remap';
import { deliveryTicks, orderTrades, throughputMu, type ImportOrder } from './trade';
import { containerFull, containerMu, handsOut, orderCentsPerMin, orderHold, sellingOf, waitingMu } from './systems/trade';
import { computeMods } from './research/modifiers';
import { Sim } from './state';
import { MapGen } from './world/mapgen';

const PLATE = (): number => itemIdx('iron_plate');
const COPPER = (): number => itemIdx('copper_ore');
const SLAG = (): number => itemIdx('slag');

/** A colony with a trade post (5×5: its pad and flame apron, D62) against the Hearth's east side; its entrance (517, 514) is fed from (517, 515). */
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

/**
 * The same, its slag sorted off (D139: the starter contract's ore comes with a slag for every five,
 * and the Core takes none in): a sorter set to the ore on (514, 509), an incinerator on its north side.
 */
function exitSortedToHearth(sim: Sim): void {
  exitToHearth(sim);
  const s = sim.place('sorter', 514, 509, 3);
  if (!s.ok) throw new Error(`sorter: ${s.reason}`);
  sim.setForkFilter(s.id!, 0, 'copper_ore');
  if (!sim.place('incinerator', 514, 508, 0).ok) throw new Error('incinerator');
}

describe('trade posts', () => {
  it('a sale straight from the Core\'s stock pays CrierBelt 40 %, a post\'s sale 20 % (D126)', () => {
    const { sim } = postSim();
    sim.stock[PLATE()] = 200_000;
    const q = sim.quoteSpot(PLATE(), 'sell', 10);
    const gross = sim.market.quote(PLATE(), 'sell', 10_000, sim.mods.slippage).totalCents;
    expect(BAL.coreSellFee).toBe(400);
    expect(q.cents).toBe(afterFee(gross, 'sell', BAL.coreSellFee));
    expect(q.cents).toBeLessThan(afterFee(gross, 'sell', BAL.tradeFee));
    // A purchase keeps the post's fee.
    const b = sim.quoteSpot(PLATE(), 'buy', 10);
    expect(b.cents).toBe(afterFee(sim.market.quote(PLATE(), 'buy', 10_000, sim.mods.slippage).totalCents, 'buy', BAL.tradeFee));
  });

  it('a post sells whatever its entrance brought at the epoch’s bid, CrierBelt taking a fifth; never the Hearth’s stock (D64)', () => {
    const { sim, post } = postSim();
    sim.ensureCompiled();
    // Its entrance takes any tradable item (its cargo's too, D131): plates brought in wait in its entrance's store.
    expect(sim.cargoOf(post)).toEqual([]);
    sellingOf(sim, post)[PLATE()] = 50_000;
    const stock0 = sim.stock[PLATE()]!, credits0 = sim.credits, bid = sim.prices.bid[PLATE()]!;
    sim.run(600); // one epoch: the boundary sells
    expect(sellingOf(sim, post)[PLATE()]).toBe(0);
    expect(sim.stock[PLATE()]).toBe(stock0); // the Hearth next door keeps its own
    expect(sim.mods.tradeFee).toBe(200);
    expect(sim.credits - credits0).toBe(afterFee(valueCents(50_000, bid, 'sell'), 'sell', 200));
    expect(sim.trade.soldTotal[PLATE()]).toBe(50_000);
    expect(sim.events.some((e) => e.k === 'trade' && e.post === post && e.soldMu === 50_000)).toBe(true);
  });

  it('CrierBelt’s fifth: no research lowers it (D64)', () => {
    // Every Commerce node (its theme's, D128; the old cm1…cmK are gone, RESEARCH_RENAMED).
    const commerce = RESEARCH_IDS.filter((id) => researchNode(id)!.theme === 'cm');
    expect(commerce.length).toBeGreaterThanOrEqual(7);
    expect(computeMods(new Set(commerce)).tradeFee).toBe(200);
  });

  it('an order makes its item cargo: the exit hands it out, the entrance still takes it (D131); cancelled, it stays cargo until the container has none left', () => {
    const { sim, post } = postSim();
    exitToHearth(sim);
    sim.grantCredits(1_000_000);
    const id = sim.addImport(post, 'copper_ore', 10, 1_000_000);
    expect(typeof id).toBe('number');
    expect(sim.cargoOf(post)).toEqual([COPPER()]);
    sim.ensureCompiled();
    // Two stores (D131): its entrance takes every tradable item, the cargo's too; its container hands the cargo out.
    const node = sim.graph.nodeByEnt.get(post)! as unknown as { cycle: readonly number[] | null };
    const entry = sim.graph.postIn.get(post)!;
    expect(entry.accepts!.has(COPPER())).toBe(true);
    expect(entry.accepts!.has(PLATE())).toBe(true);
    expect(node.cycle).toEqual([COPPER()]);
    // Bought for a while, then cancelled: what is on its way still lands and leaves by the exit,
    // then the item leaves the cargo at a boundary (the entrance took it all along).
    let k = 0;
    while (!sim.trade.inflight.length && k++ < 10) sim.run(600);
    expect(sim.cancelImport(id as number)).toBe(true);
    expect(sim.cargoOf(post)).toEqual([COPPER()]);
    for (k = 0; k < 40 && sim.cargoOf(post).length; k++) sim.run(600);
    expect(sim.cargoOf(post)).toEqual([]);
    expect(sim.trade.boughtTotal[COPPER()]).toBeGreaterThan(0);
    expect(sim.trade.soldTotal[COPPER()]).toBe(0); // none of it was sold back
    sim.ensureCompiled();
    expect(sim.graph.postIn.get(post)!.accepts!.has(COPPER())).toBe(true);
    expect((sim.graph.nodeByEnt.get(post)! as unknown as { cycle: readonly number[] | null }).cycle).toBeNull();
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

  it('an order pauses above its max price and resumes only 3 % below it', () => {
    const o: ImportOrder = { id: 1, post: 1, item: 0, perMin: 1, maxCents: 1000, active: true };
    expect(orderTrades(o, 1000)).toBe(true);
    expect(orderTrades(o, 1001)).toBe(false);
    o.active = false;
    expect(orderTrades(o, 1000)).toBe(false);
    expect(orderTrades(o, 980)).toBe(false);
    expect(orderTrades(o, 970)).toBe(true);
  });

  it('a post lifts at most its throughput per minute, orders first, then what its entrance brought', () => {
    const { sim, post } = postSim();
    sim.grantCredits(1_000_000);
    exitToHearth(sim);
    sim.addImport(post, 'copper_ore', 50, 1_000_000);
    sim.ensureCompiled();
    sellingOf(sim, post)[PLATE()] = 200_000;
    sim.run(600);
    const a = sim.trade.activity.get(post)!;
    expect(a.boughtMu).toBe(50_000);
    expect(a.soldMu).toBe(throughputMu(1) - 50_000);
  });

  it('one trade post until Second Wharf; a removed post takes its cargo and orders with it', () => {
    const { sim, post } = postSim();
    expect(sim.canPlace('trade_post', 505, 517, 0).reason).toBe('limit');
    sim.addImport(post, 'copper_ore', 5, 100_000);
    const e = sim.ents.get(post)!;
    expect(sim.remove(e.x, e.y)).toBe(true);
    expect(sim.trade.orders).toHaveLength(0);
    expect(sim.trade.cargo.has(post)).toBe(false);
    for (const id of ['cm2', 'cm_floor', 'cm3']) sim.done.add(id); // cm3, Second Wharf: a second post
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
    sim.grantCredits(1_000_000);
    expect(sim.spotTrade('copper_ore', 'buy', containerMu(sim) / 1000 + 1)).toEqual({ refused: 'container' });
    const buy = sim.spotTrade('copper_ore', 'buy', 5);
    expect('cents' in buy && buy.cents < 0).toBe(true);
    expect(sim.trade.inflight).toHaveLength(1);
    expect(sim.trade.inflight[0]!.cents).toBe(-(buy as { cents: number }).cents); // what it cost, for the post's panel
    expect(sim.cargoOf(sim.tradePosts()[0]!.id)).toEqual([COPPER()]); // its exit hands it out
  });

  it('trading during an absence matches ticking (the same ocelles and goods, within a few items on a jammed exit line)', () => {
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
      // Its entrance sells the ore (D64). Its sand comes out of its exit (518,499) onto a dead end: six squares, then the container
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
    // The jammed exit line (a dead end): under a throttled supply its group still takes a few of
    // the post's deliveries offline (docs/offline.md), so the container and with it the purchases
    // and the lift's budget for sales drift by a few items over four hours — never more.
    const near = (x: number, y: number, tol: number): void => { expect(Math.abs(x - y)).toBeLessThanOrEqual(tol); };
    expect(a.trade.soldTotal[IRON()]).toBeGreaterThan(100_000);
    near(b.trade.soldTotal[IRON()]!, a.trade.soldTotal[IRON()]!, 5_000);
    expect(a.trade.boughtTotal[itemIdx('sand')]).toBeGreaterThan(100_000);
    near(b.trade.boughtTotal[itemIdx('sand')]!, a.trade.boughtTotal[itemIdx('sand')]!, 5_000);
    near(b.credits, a.credits, 5_000); // centi-◉: within 50 ◉
    expect(b.trade.ledger.length).toBeGreaterThan(100);
    near(b.trade.ledger.length, a.trade.ledger.length, 5);
    const ps = (s: Sim): Float64Array => s.stores.get(s.tradePosts()[0]!.id)!;
    const ss = (s: Sim): Float64Array => sellingOf(s, s.tradePosts()[0]!.id); // its entrance's (D131)
    for (let i = 0; i < a.stock.length; i++) {
      near(b.stock[i]!, a.stock[i]!, 5_000);
      near(ps(b)[i]!, ps(a)[i]!, 10_000);
      near(ss(b)[i]!, ss(a)[i]!, 10_000);
    }
  });

  it('save → load with goods in flight continues bit for bit', () => {
    const { sim, post } = postSim();
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
    // Offline the same purchases, the same ocelles; what has left the container keeps pace (the
    // deliveries come in over their epoch offline, docs/offline.md: it used to lag by up to 40).
    for (const it of [COPPER(), PLATE()]) {
      expect(b.trade.boughtTotal[it]).toBe(a.trade.boughtTotal[it]);
      expect(Math.abs(b.stock[it]! - a.stock[it]!)).toBeLessThanOrEqual(2_000);
    }
    expect(b.credits).toBe(a.credits);
  });
});

describe('the starter contract (D101)', () => {
  const S = BAL.starter;
  const EP = 600;
  const starterOf = (sim: Sim): ImportOrder | undefined => sim.trade.orders.find((o) => o.starter !== undefined);

  it('is CrierBelt’s copper ore at 2 ◉, 40 in all, 10 a minute, landing a minute after each purchase; continued, capped a tenth over the ask', () => {
    // The API the tutorial is written against: these numbers are the contract.
    // Its slag (D139): one free with every five ore, out by the exit with them — « Les scories » sorts it.
    expect(S).toEqual({ item: 'copper_ore', n: 40, perMin: 10, cents: 200, delayMin: 1, continueOver: 1100, waste: ['slag', 5] });
  });

  it('signed, it is an always-active order that buys at its fixed price — only once the post’s exit leads somewhere', () => {
    const { sim, post } = postSim();
    expect(sim.trade.starterTaken).toBe(false);
    const id = sim.takeStarter(post);
    expect(typeof id).toBe('number');
    expect(sim.trade.starterTaken).toBe(true);
    const o = starterOf(sim)!;
    expect(o).toMatchObject({ id, post, item: COPPER(), perMin: 10, maxCents: 200, active: true, starter: 40_000 });
    expect(sim.cargoOf(post)).toEqual([COPPER()]); // its exit hands it out, as an order's goods
    expect(sim.log.at(-1)!.cmd).toEqual({ k: 'starter', post });
    sim.ensureCompiled();
    expect(orderHold(sim, o)).toBe('outlet');
    // The exit leads nowhere: nothing bought, nothing paid.
    const c0 = sim.credits;
    sim.run(3 * EP);
    expect(sim.credits).toBe(c0);
    expect(sim.trade.inflight).toHaveLength(0);
    expect(o.starter).toBe(40_000);
    // Laid into the Hearth: 10 at the next lift, at 2 ◉ each, no fee — from CrierBelt itself.
    exitToHearth(sim);
    sim.run(EP);
    expect(c0 - sim.credits).toBe(10 * 200);
    expect(sim.trade.spent).toBe(2000);
    // With its two slag, free (D139), in the same lot.
    expect(sim.trade.inflight).toEqual([
      { post, item: COPPER(), mu: 10_000, arrive: sim.tick + S.delayMin * EP, colony: -1, cents: 2000 },
      { post, item: SLAG(), mu: 2000, arrive: sim.tick + S.delayMin * EP, colony: -1, cents: 0 },
    ]);
    expect(sim.trade.ledger.at(-2)).toMatchObject({ post, item: COPPER(), kind: 'import', mu: 10_000, cents: -2000 });
    expect(sim.trade.ledger.at(-1)).toMatchObject({ post, item: SLAG(), kind: 'import', mu: 2000, cents: 0 });
    expect(sim.cargoOf(post)).toEqual([COPPER(), SLAG()].sort((x, y) => x - y)); // the slag out by the exit too
    expect(o.starter).toBe(30_000);
    expect(o.active).toBe(true);
  });

  it('buys 10 a minute, 40 in all, then stops (fulfilled): nothing more is bought nor paid unasked; each lot lands a minute later and leaves by the exit', () => {
    const { sim, post } = postSim();
    exitSortedToHearth(sim);
    expect(typeof sim.takeStarter(post)).toBe('number');
    const c0 = sim.credits, cu0 = sim.stock[COPPER()]!;
    sim.ensureCompiled(); // its exit linked: it buys
    expect(orderCentsPerMin(sim, starterOf(sim)!)).toBe(10 * 200); // « −20 ◉/min » on its row
    sim.run(EP); // tick 600: the first lot bought
    expect(starterOf(sim)!.starter).toBe(30_000);
    const first = sim.trade.inflight[0]!;
    expect(first.arrive).toBe(EP + S.delayMin * EP);
    expect(first.arrive % EP).toBe(0);
    sim.run(first.arrive - sim.tick - 1);
    expect(sim.stores.get(post)![COPPER()]).toBe(0); // not yet
    sim.run(1);
    expect(sim.stores.get(post)![COPPER()]).toBeGreaterThan(0); // in its container
    expect(sim.events.some((e) => e.k === 'delivered' && e.item === COPPER() && e.mu === 10_000)).toBe(true);
    sim.run(4 * EP - sim.tick); // tick 2400: the fourth and last lot
    const o = starterOf(sim)!;
    expect(o.starter).toBe(0);
    expect(orderHold(sim, o)).toBe('fulfilled');
    expect(orderCentsPerMin(sim, o)).toBe(0);
    expect(c0 - sim.credits).toBe(40 * 200);
    expect(sim.trade.boughtTotal[COPPER()]).toBe(40_000);
    expect(sim.trade.ledger.filter((l) => l.kind === 'import' && l.item === COPPER())).toHaveLength(4);
    expect(sim.trade.boughtTotal[SLAG()]).toBe(8000); // a slag with every five ore, free
    // All of it out by the exit, along the ribbon, into the Hearth; the order stands, stopped.
    sim.run(6 * EP);
    expect(sim.stock[COPPER()]! - cu0).toBe(40_000);
    expect(sim.stock[SLAG()]).toBe(0); // sorted off before the Core, burnt
    expect(sim.consumed[SLAG()]).toBe(8000);
    expect(sim.trade.inflight).toHaveLength(0);
    expect(sim.credits).toBe(c0 - 8000); // nothing more bought, at any price
    expect(sim.trade.boughtTotal[COPPER()]).toBe(40_000);
    expect(sim.trade.orders).toEqual([o]);
    expect(sim.cargoOf(post)).toEqual([COPPER()]); // its goods while it stands
    // « Arrêter » (the notice's default): cancelled, its cargo leaves the post.
    expect(sim.cancelImport(o.id)).toBe(true);
    expect(sim.trade.orders).toHaveLength(0);
    expect(sim.cargoOf(post)).toEqual([]);
    expect(sim.continueStarter(o.id)).toBe(false);
  });

  it('« Continuer au prix du marché »: one logged command, only once fulfilled; an ordinary order from then on, capped a tenth over the ask, buying at the market’s price', () => {
    const { sim, post } = postSim();
    exitToHearth(sim);
    const id = sim.takeStarter(post) as number;
    expect(sim.continueStarter(id)).toBe(false); // still buying at its fixed price
    expect(sim.continueStarter(id + 99)).toBe(false);
    sim.run(4 * EP);
    const o = starterOf(sim)!;
    expect(orderHold(sim, o)).toBe('fulfilled');
    sim.run(3 * EP + 41);
    const ask = sim.prices.ask[COPPER()]!;
    expect(ask).toBeGreaterThan(0);
    const logged = sim.log.length;
    expect(sim.continueStarter(id)).toBe(true);
    expect(sim.log.length).toBe(logged + 1);
    expect(sim.log.at(-1)!.cmd).toEqual({ k: 'starterGo', id });
    expect(o.starter).toBeUndefined();
    expect(starterOf(sim)).toBeUndefined();
    expect(o).toMatchObject({ id, post, item: COPPER(), perMin: S.perMin, maxCents: Math.ceil((ask * S.continueOver) / 1000), active: true });
    expect(sim.continueStarter(id)).toBe(false); // once
    expect(orderHold(sim, o)).toBeNull();
    // Its cost a minute is the market's: the next lift spends exactly that.
    const cost = orderCentsPerMin(sim, o);
    expect(cost).toBe(afterFee(valueCents(S.perMin * 1000, ask, 'buy'), 'buy', sim.mods.tradeFee));
    expect(cost).toBeGreaterThan(S.perMin * S.cents); // dearer than the contract (copper ore’s ask is over 2 ◉)
    const c0 = sim.credits, spent0 = sim.trade.spent;
    sim.run(EP - (sim.tick % EP));
    expect(c0 - sim.credits).toBe(cost);
    expect(sim.trade.spent - spent0).toBe(cost);
    expect(sim.trade.boughtTotal[COPPER()]).toBe(50_000);
    expect(sim.trade.inflight.at(-1)!.colony).toBeGreaterThanOrEqual(0); // from a colony, not CrierBelt
    expect(sim.trade.ledger.at(-1)).toMatchObject({ item: COPPER(), kind: 'import', mu: 10_000, cents: -cost });
  });

  it('continued, then replayed from the log: the same order and the same hash', () => {
    const { sim, post } = postSim();
    exitToHearth(sim);
    const id = sim.takeStarter(post) as number;
    sim.run(5 * EP + 213);
    expect(sim.continueStarter(id)).toBe(true);
    sim.run(3 * EP);
    const copy = testSim();
    replay(copy, sim.log, sim.tick);
    expect(copy.trade.orders).toEqual(sim.trade.orders);
    expect(copy.trade.orders[0]!.starter).toBeUndefined();
    expect(copy.hash()).toBe(sim.hash());
    sim.run(4 * EP);
    copy.run(4 * EP);
    expect(copy.hash()).toBe(sim.hash());
    expect(copy.credits).toBe(sim.credits);
    expect(copy.trade.boughtTotal[COPPER()]).toBe(sim.trade.boughtTotal[COPPER()]);
  });

  it('buys only what the purse pays at its fixed price', () => {
    const { sim, post } = postSim();
    exitToHearth(sim);
    sim.takeStarter(post);
    sim.credits = 500; // test-only: a nearly empty purse (2.5 lots of 2 ◉)
    sim.run(EP);
    expect(sim.credits).toBe(100);
    expect(starterOf(sim)!.starter).toBe(38_000);
  });

  it('once per base: refused « taken » once signed, after a cancel too; « slots » when the orders are full; « no_post »', () => {
    const { sim, post } = postSim();
    expect(sim.takeStarter(post + 999)).toBe('no_post');
    expect(sim.trade.starterTaken).toBe(false);
    const id = sim.takeStarter(post) as number;
    expect(sim.takeStarter(post)).toBe('taken');
    expect(sim.cancelImport(id)).toBe(true);
    expect(sim.trade.orders).toHaveLength(0);
    expect(sim.cargoOf(post)).toEqual([]); // nothing bought, nothing on its way: no cargo left
    expect(sim.trade.starterTaken).toBe(true);
    expect(sim.takeStarter(post)).toBe('taken');
    expect(sim.log.filter((l) => l.cmd.k === 'starter')).toHaveLength(1); // refusals are not logged
    const b = postSim();
    expect(typeof b.sim.addImport(b.post, 'iron_plate', 1, 1_000_000)).toBe('number');
    expect(typeof b.sim.addImport(b.post, 'sand', 1, 1_000_000)).toBe('number');
    expect(b.sim.takeStarter(b.post)).toBe('slots');
    expect(b.sim.trade.starterTaken).toBe(false);
  });

  it('cancelled midway, the rest is forfeit; what is on its way still lands and leaves by the exit', () => {
    const { sim, post } = postSim();
    exitSortedToHearth(sim);
    const id = sim.takeStarter(post) as number;
    const cu0 = sim.stock[COPPER()]!;
    sim.run(EP);
    expect(sim.cancelImport(id)).toBe(true);
    sim.run(8 * EP);
    expect(sim.stock[COPPER()]! - cu0).toBe(10_000);
    expect(sim.trade.boughtTotal[COPPER()]).toBe(10_000);
    expect(sim.cargoOf(post)).toEqual([]);
  });

  it('the market never sees it: its prices and state are those of the same base without the contract', () => {
    const a = postSim(), b = postSim();
    exitToHearth(a.sim);
    exitToHearth(b.sim);
    expect(typeof a.sim.takeStarter(a.post)).toBe('number');
    a.sim.run(6 * EP);
    b.sim.run(6 * EP);
    expect(a.sim.trade.boughtTotal[COPPER()]).toBe(40_000);
    expect(Array.from(a.sim.prices.ask)).toEqual(Array.from(b.sim.prices.ask));
    expect(Array.from(a.sim.prices.bid)).toEqual(Array.from(b.sim.prices.bid));
    expect(JSON.stringify(a.sim.market.save())).toBe(JSON.stringify(b.sim.market.save()));
  });

  it('replaying the log reproduces the hash', () => {
    const { sim, post } = postSim();
    exitToHearth(sim);
    sim.run(EP + 77);
    expect(typeof sim.takeStarter(post)).toBe('number');
    sim.run(3 * EP);
    expect(starterOf(sim)!.starter).toBe(10_000);
    const copy = testSim();
    replay(copy, sim.log, sim.tick);
    expect(copy.trade.starterTaken).toBe(true);
    expect(starterOf(copy)!.starter).toBe(10_000);
    expect(copy.hash()).toBe(sim.hash());
    sim.run(4 * EP);
    copy.run(4 * EP);
    expect(copy.hash()).toBe(sim.hash());
    expect(copy.credits).toBe(sim.credits);
  });

  it('save → load keeps what is left of it and that it was signed (same hash, under another content order too)', () => {
    const { sim, post } = postSim();
    exitToHearth(sim);
    sim.takeStarter(post);
    sim.run(2 * EP + 123);
    const h = sim.hash();
    // Both are hashed.
    sim.trade.starterTaken = false;
    expect(sim.hash()).not.toBe(h);
    sim.trade.starterTaken = true;
    starterOf(sim)!.starter! += 1000;
    expect(sim.hash()).not.toBe(h);
    starterOf(sim)!.starter! -= 1000;
    const data = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
    expect(data.trade!.starterTaken).toBe(true);
    expect(data.trade!.orders.find((o) => o.starter !== undefined)?.starter).toBe(20_000);
    const copy = deserialize(data, sim.grid.source);
    expect(copy.hash()).toBe(h);
    expect(copy.takeStarter(post)).toBe('taken');
    // Written under another registry order (D47): the order's `starter` rides along its re-pointed item.
    const t = contentTable();
    const other: ContentTable = { ...t, items: ['zz_probe', ...[...t.items].reverse()] };
    const none = { renamed: { items: {}, buildings: {}, recipes: {} }, costs: {} };
    const old = remapSave(JSON.parse(JSON.stringify(serialize(sim))) as SaveData, other, none).data;
    expect(old.trade!.orders.find((o) => o.starter !== undefined)).toMatchObject({ starter: 20_000, item: other.items.indexOf('copper_ore') });
    expect(deserialize(old, sim.grid.source).hash()).toBe(h);
    sim.run(6 * EP);
    copy.run(6 * EP);
    expect(copy.hash()).toBe(sim.hash());
    // A save from before the contract: not signed.
    const before = JSON.parse(JSON.stringify(serialize(postSim().sim))) as SaveData;
    delete before.trade!.starterTaken;
    expect(deserialize(before, sim.grid.source).trade.starterTaken).toBe(false);
  });

  it('an absence buys, delivers and pays the same as ticking (the same tradeEpoch); its slag within an item', () => {
    const make = (): { sim: Sim; post: number } => {
      const r = postSim();
      exitSortedToHearth(r.sim);
      expect(typeof r.sim.takeStarter(r.post)).toBe('number');
      r.sim.run(30);
      return r;
    };
    const a = make(), b = make();
    const cu0 = a.sim.stock[COPPER()]!;
    const span = 36_000;
    a.sim.run(span);
    catchUp(b.sim, span, { noDirect: true });
    expect(a.sim.stock[COPPER()]! - cu0).toBe(40_000);
    expect(b.sim.stock[COPPER()]).toBe(a.sim.stock[COPPER()]);
    expect(b.sim.trade.boughtTotal[COPPER()]).toBe(40_000);
    expect(b.sim.credits).toBe(a.sim.credits);
    expect(b.sim.trade.spent).toBe(a.sim.trade.spent);
    expect(b.sim.trade.ledger.filter((l) => l.kind === 'import').map((l) => [l.epoch, l.mu, l.cents]))
      .toEqual(a.sim.trade.ledger.filter((l) => l.kind === 'import').map((l) => [l.epoch, l.mu, l.cents]));
    // Fulfilled in both, it stands stopped in both.
    expect(b.sim.trade.orders).toEqual(a.sim.trade.orders);
    expect(orderHold(b.sim, b.sim.trade.orders[0]!)).toBe('fulfilled');
    // Its slag (D139) is a second item out of the one exit: within an item of ticking, as two
    // purchases are (D62, above: an offline delivery is spread over its epoch, so the last slag may
    // stand split between the container and the ribbon); none lost, none in the Core.
    for (const s of [a.sim, b.sim]) {
      expect(s.trade.boughtTotal[SLAG()]).toBe(8000);
      expect(s.totalHeld(SLAG()) + s.consumed[SLAG()]!).toBe(8000);
      expect(s.stock[SLAG()]).toBe(0);
    }
    expect(Math.abs(b.sim.consumed[SLAG()]! - a.sim.consumed[SLAG()]!)).toBeLessThanOrEqual(1000);
  });
});
