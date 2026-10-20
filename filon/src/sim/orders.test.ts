// orders.test.ts — CrierBelt's delivery orders (D153, systems/orders.ts): drawn deterministically from
// the seeds and the world minute among what the base can make at its Core's level; accepted by a
// logged command (replayed); filled through a trade post's entrance before its sales, within its lift;
// paid in full at the boundary that fills them, with their reward; a missed one closed with what it
// got paid at the market; an offer nobody takes withdrawn; saved by item id; and the same online and
// offline, bit for bit.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { ORDER_GOODS, ORDER_KITS } from '@/content/orders';
import { BUILDINGS } from '@/content/buildings';
import { RECIPES } from '@/content/recipes';
import { isTreeNode } from '@/content/research';
import type { RecipeDef } from '@/content/types';
import { ITEM_IDS, costOf, buildingIdx, itemDef, itemIdx } from '@/content/registry';
import { afterFee, valueCents } from '@/market/pricing';
import { replay } from './commands';
import { EPOCH, WORLD_EPOCH0 } from './constants';
import { catchUp } from './offline/catchup';
import { deserialize, serialize } from './serialize';
import { Sim } from './state';
import { canMake, drawOrder, orderGoods, orderPay, roundItems, tutorialOver, type DeliveryOrder } from './systems/orders';
import { line, steadyPower, testSim, testSource, wire, IRON } from './testkit';

/** Run to the next minute's boundary (the orders' clock). */
const toBoundary = (sim: Sim): void => sim.run(EPOCH - (sim.tick % EPOCH));

/**
 * A drill on the iron deposit feeding a trade post's entrance by ribbon (the absence rig of
 * trade.test.ts, without its imports), the tutorial skipped: the first order is posted at the next
 * boundary. `steady`: the steady geothermal grid (a twin's single regime; not replayable).
 */
function rig(steady = true): { sim: Sim; post: number } {
  const sim = testSim();
  if (steady) steadyPower(sim);
  const d = sim.place('drill', 511, 502, 1); // east output
  if (!d.ok) throw new Error(`drill ${d.reason}`);
  wire(sim, d.id!);
  const p = sim.place('trade_post', 516, 499, 0);
  if (!p.ok) throw new Error(`post ${p.reason}`);
  // Drill output (513,502) east → round the apron → the post's entrance (518,503) from the south.
  sim.placeBelts('ribbon', [...line(513, 502, 1, 2), [515, 502, 2], [515, 503, 2], ...line(515, 504, 1, 3), [518, 504, 0]]);
  expect(sim.skipTutorial()).toBe(true);
  toBoundary(sim);
  return { sim, post: p.id! };
}

/** The first order, turned into an order for the rig's iron ore (outside commands, as a test's setup): `n` items. */
function ironOrder(sim: Sim, n: number): DeliveryOrder {
  const o = sim.deliveries.open[0]!;
  expect(o.first).toBe(true);
  o.item = IRON();
  o.n = n;
  return o;
}

const exportsOf = (sim: Sim, item: number): number => sim.trade.ledger.filter((l) => l.kind === 'export' && l.item === item).reduce((a, l) => a + l.mu, 0);

describe('CrierBelt’s delivery orders (D153)', () => {
  it('its content holds: tradable goods a recipe makes or an extractor named, real kits, windows past a night, sizes and prices sane', () => {
    for (const [id, g] of Object.entries(ORDER_GOODS)) {
      const d = itemDef(itemIdx(id));
      expect(d.depth, id).toBeGreaterThan(0); // the Crier trades it
      expect(['fluid', 'waste', 'unique'].includes(d.kind), id).toBe(false);
      expect(g.level, id).toBeGreaterThanOrEqual(1);
      expect(g.level, id).toBeLessThanOrEqual(BAL.orders.worth.length);
      expect(Number.isInteger(g.w) && g.w > 0, id).toBe(true);
      if (g.needs) for (const u of g.needs) expect(u === 'start' || isTreeNode(u), `${id} needs ${u}`).toBe(true);
      else expect((Object.values(RECIPES) as RecipeDef[]).some((r) => r.outs.some(([o]) => o === id)), `${id}: a recipe makes it`).toBe(true);
    }
    for (const k of ORDER_KITS) expect(k.def in BUILDINGS, k.def).toBe(true);
    for (const [lo, hi] of Object.values(BAL.orders.window)) { expect(lo).toBeGreaterThan(18); expect(hi).toBeGreaterThanOrEqual(lo); }
    // Never at a profit from a purchase: the premium at most the fee a purchase pays, the ask above the bid on top (the draws' test checks the prices).
    expect(BAL.orders.premium[1]).toBeLessThanOrEqual(BAL.tradeFee);
    expect(BAL.orders.first.windowMin).toBeGreaterThan(18);
    expect(ORDER_GOODS[BAL.orders.first.item]).toBeDefined();
  });

  it('come once the tutorial is over: the first right after it, quartz (D146), then one every quarter hour while fewer than three stand', () => {
    const sim = testSim();
    sim.run(5 * EPOCH);
    expect(tutorialOver(sim)).toBe(false);
    expect(sim.deliveries.open).toEqual([]);
    sim.skipTutorial();
    toBoundary(sim);
    expect(sim.deliveries.open).toHaveLength(1);
    const first = sim.deliveries.open[0]!;
    expect(first).toMatchObject({ item: itemIdx('quartz'), n: BAL.orders.first.n, windowMin: BAL.orders.first.windowMin, due: -1, first: true });
    expect(first.cents).toBe(Math.ceil((sim.prices.bid[itemIdx('quartz')]! * (1000 + BAL.orders.first.premium)) / 1000));
    expect(first.offerEnd - first.posted).toBe(BAL.orders.offerMin);
    expect(first.reward).toEqual({ k: 'credits', cents: BAL.orders.first.bonus * 100 });
    // The next ones on the world's clock, at most three standing.
    for (let i = 0; i < 40 && sim.deliveries.open.length < BAL.orders.open; i++) sim.run(EPOCH);
    expect(sim.deliveries.open).toHaveLength(BAL.orders.open);
    for (const o of sim.deliveries.open.slice(1)) expect(o.posted % BAL.orders.everyMin).toBe(0);
    // Never two for the same item at once.
    expect(new Set(sim.deliveries.open.map((o) => o.item)).size).toBe(sim.deliveries.open.length);
  });

  it('are drawn from the seeds and the world minute alone, and only what the base can make at its Core’s level', () => {
    const a = testSim(), b = testSim();
    const e0 = a.absEpoch();
    const draws = (s: Sim): Array<Omit<DeliveryOrder, 'id'>> => Array.from({ length: 60 }, (_, k) => { const { id: _id, ...o } = drawOrder(s, e0 + k * 15)!; return o; });
    expect(draws(a)).toEqual(draws(b));
    // Another claim of the world draws other orders.
    const other = new Sim({ worldSeed: 7, playerSeed: 12, source: testSource(), foundingEpoch: WORLD_EPOCH0 + 24 });
    expect(draws(other)).not.toEqual(draws(a));
    // Feasible: a good the base can make, at its Core's level (level 1 here: no quartz, no parts).
    for (const o of draws(a)) {
      expect(canMake(a, o.item)).toBe(true);
      expect(ORDER_GOODS[ITEM_IDS[o.item]!]!.level).toBeLessThanOrEqual(a.hearthLevel);
      expect(o.n).toBe(roundItems(o.n));
      expect(o.windowMin).toBeGreaterThanOrEqual(20); // every window outlasts a night (D146)
      expect(o.cents).toBeGreaterThan(a.prices.bid[o.item]!);
      // Never above a purchase's cost (the ask and CrierBelt's fee): no profit from the Crier's own goods.
      expect(o.cents).toBeLessThan(afterFee(a.prices.ask[o.item]!, 'buy', a.mods.tradeFee));
    }
    // A new base's starting kit (no plan taken): only what its drill extracts.
    const kit = testSim(undefined, { plans: false });
    expect(orderGoods(kit).map((i) => ITEM_IDS[i]).sort()).toEqual(['coal', 'iron_ore']);
    // The Core's level opens the parts and makes the orders bigger (the worth at reference value grows).
    const big = testSim();
    big.hearthLevel = 3;
    const worth = (s: Sim): number => draws(s).reduce((t, o) => t + o.n * (itemDef(o.item).value ?? 0), 0);
    expect(worth(big)).toBeGreaterThan(2 * worth(a));
    expect(orderGoods(big).length).toBeGreaterThan(orderGoods(a).length);
    // An event order: bigger, longer, always a reward.
    const ev = Array.from({ length: 400 }, (_, k) => drawOrder(big, e0 + k * 15)!).filter((o) => o.event);
    expect(ev.length).toBeGreaterThan(10);
    for (const o of ev) expect(o.reward).toBeDefined();
    // Rewards are ocelles, kits or a research — never AI tokens.
    const kinds = new Set(Array.from({ length: 400 }, (_, k) => drawOrder(big, e0 + k * 15)?.reward?.k).filter(Boolean));
    expect([...kinds].every((k) => k === 'credits' || k === 'kit' || k === 'node')).toBe(true);
  });

  it('an accepted order takes what the post’s entrance brings of its item before the sale, within the lift; the rest sells as ever', () => {
    const { sim } = rig();
    const o = ironOrder(sim, 200);
    // On offer, not accepted: the ore sells.
    sim.run(3 * EPOCH);
    const sold0 = exportsOf(sim, IRON());
    expect(sold0).toBeGreaterThan(0);
    expect(o.got).toBe(0);
    expect(sim.acceptDelivery(o.id)).toBe(true);
    expect(sim.acceptDelivery(o.id)).toBe(false); // once
    expect(o.due).toBe(sim.absEpoch() + o.windowMin);
    sim.run(4 * EPOCH);
    // Everything the entrance brought went to the order: no sale of ore meanwhile.
    expect(o.got).toBeGreaterThan(20);
    expect(exportsOf(sim, IRON())).toBe(sold0);
    expect(sim.trade.soldTotal[IRON()]).toBe(sold0 + o.got * 1000);
    // Filled, the order closes and the ore sells again.
    for (let i = 0; i < 40 && sim.deliveries.open.some((x) => x.id === o.id); i++) sim.run(EPOCH);
    expect(sim.deliveries.open.some((x) => x.id === o.id)).toBe(false);
    sim.run(3 * EPOCH);
    expect(exportsOf(sim, IRON())).toBeGreaterThan(sold0);
  });

  it('a filled order is paid in full at the boundary that fills it, in the purse’s journal and the ledger, its reward delivered', () => {
    const { sim } = rig();
    const o = ironOrder(sim, 60);
    o.reward = { k: 'kit', def: 'silo', n: 2 };
    sim.acceptDelivery(o.id);
    const silo = costOf(buildingIdx('silo'));
    const core0 = silo.map((c) => sim.stock[c.item]!);
    let before = sim.credits, paidAt = -1;
    for (let i = 0; i < 40 && paidAt < 0; i++) {
      before = sim.credits;
      const sales0 = sim.purseLog.sales;
      sim.run(EPOCH);
      if (!sim.deliveries.open.some((x) => x.id === o.id)) {
        paidAt = sim.absEpoch();
        // The minute's change: the order's pay, and what the rest of the minute's ore sold for.
        expect(sim.credits - before).toBe(orderPay(o) + (sim.purseLog.sales - sales0));
      }
    }
    expect(paidAt).toBeGreaterThan(0);
    expect(sim.purseLog.delivery).toBe(orderPay(o));
    const l = sim.trade.ledger.find((x) => x.kind === 'delivery')!;
    expect(l).toMatchObject({ epoch: paidAt, item: IRON(), mu: 60_000, cents: orderPay(o) });
    expect(sim.deliveries.past[0]).toMatchObject({ id: o.id, what: 'filled', paid: orderPay(o), got: 60 });
    expect(sim.deliveries.filled).toBe(1);
    silo.forEach((c, k) => expect(sim.stock[c.item]! - core0[k]!).toBe(2 * c.mu));
    // A bonus is paid with the order, in ocelles — never AI tokens into a store (owner: no reserve of them); a node's is learnt at once.
    const t = rig();
    const o2 = ironOrder(t.sim, 20);
    o2.reward = { k: 'credits', cents: 15_000 };
    const bank0 = t.sim.tokenBank;
    t.sim.acceptDelivery(o2.id);
    for (let i = 0; i < 20 && t.sim.deliveries.open.some((x) => x.id === o2.id); i++) t.sim.run(EPOCH);
    expect(t.sim.purseLog.delivery).toBe(orderPay(o2) + 15_000);
    expect(t.sim.tokenBank).toBe(bank0);
    const n = rig();
    const o3 = ironOrder(n.sim, 20);
    o3.reward = { k: 'node', id: 'tr1' };
    expect(n.sim.done.has('tr1')).toBe(false);
    n.sim.acceptDelivery(o3.id);
    for (let i = 0; i < 20 && n.sim.deliveries.open.some((x) => x.id === o3.id); i++) n.sim.run(EPOCH);
    expect(n.sim.done.has('tr1')).toBe(true);
    expect(n.sim.events.some((e) => e.k === 'research' && e.id === 'tr1')).toBe(true);
  });

  it('a missed order simply closes: what it got paid at the market, less the post’s fee; an offer nobody takes is withdrawn', () => {
    const { sim } = rig();
    const o = ironOrder(sim, 5000); // far more than the drill gives in its window
    sim.acceptDelivery(o.id);
    const due = o.due;
    while (sim.absEpoch() < due - 1) sim.run(EPOCH);
    expect(sim.deliveries.open.some((x) => x.id === o.id)).toBe(true);
    const c0 = sim.credits, s0 = sim.purseLog.sales, bid = sim.prices.bid[IRON()]!;
    sim.run(EPOCH); // the boundary of its last minute: the epoch's bid
    expect(sim.absEpoch()).toBe(due);
    expect(sim.deliveries.open.some((x) => x.id === o.id)).toBe(false);
    const got = sim.deliveries.past[0]!.got;
    expect(got).toBeGreaterThan(100);
    const paid = afterFee(valueCents(got * 1000, bid, 'sell'), 'sell', sim.mods.tradeFee);
    expect(sim.deliveries.past[0]).toMatchObject({ what: 'missed', got, paid });
    expect(sim.credits - c0).toBe(paid + (sim.purseLog.sales - s0));
    expect(sim.deliveries.missed).toBe(1);
    expect(sim.events.some((e) => e.k === 'delivery' && e.what === 'missed' && e.got === got)).toBe(true);
    // The offers standing beside it, never accepted, went at their time.
    const w = rig().sim;
    const offer = w.deliveries.open[0]!;
    while (w.absEpoch() < offer.offerEnd) w.run(EPOCH);
    expect(w.deliveries.open.some((x) => x.id === offer.id)).toBe(false);
    expect(w.events.some((e) => e.k === 'delivery' && e.what === 'withdrawn' && e.id === offer.id)).toBe(true);
    expect(w.deliveries.past.some((x) => x.id === offer.id)).toBe(false);
  });

  it('accepting is a logged command: a replay reproduces the orders, their fills and the purse', () => {
    const { sim: a } = rig(false);
    const o = a.deliveries.open[0]!;
    expect(a.acceptDelivery(o.id)).toBe(true);
    expect(a.log.at(-1)!.cmd).toEqual({ k: 'acceptDelivery', id: o.id });
    a.run(50 * EPOCH);
    expect(a.deliveries.open.length).toBeGreaterThan(1);
    const b = testSim();
    replay(b, a.log, a.tick);
    expect(b.tick).toBe(a.tick);
    expect(b.deliveries).toEqual(a.deliveries);
    expect(b.credits).toBe(a.credits);
    expect(b.hash()).toBe(a.hash());
  });

  it('saves by item id and comes back the same; a save from before D153 has none', () => {
    const { sim } = rig();
    const o = ironOrder(sim, 300);
    sim.acceptDelivery(o.id);
    sim.run(30 * EPOCH);
    const d = serialize(sim);
    expect(d.deliveries!.open.every((x) => typeof x.item === 'string')).toBe(true);
    const back = deserialize(JSON.parse(JSON.stringify(d)), testSource());
    expect(back.deliveries).toEqual(sim.deliveries);
    expect(back.hash()).toBe(sim.hash());
    delete d.deliveries;
    const old = deserialize(JSON.parse(JSON.stringify(d)), testSource());
    expect(old.deliveries.open).toEqual([]);
    expect(old.deliveries.firstPosted).toBe(false);
  });

  for (const [what, n] of [['filled', 300], ['missed', 2000]] as const) {
    it(`online ≈ offline: an accepted order ${what} within two hours, bit for bit — the same fills, pay, offers and state`, () => {
      const build = (): Sim => {
        const { sim } = rig();
        sim.acceptDelivery(ironOrder(sim, n).id);
        sim.run(300);
        return sim;
      };
      const on = build(), off = build();
      expect(off.hash()).toBe(on.hash());
      on.run(72_000);
      catchUp(off, 72_000, { noDirect: true });
      expect(off.tick).toBe(on.tick);
      expect(on.deliveries.past.find((x) => x.what === what)).toBeDefined();
      expect(on.deliveries.open.length + on.deliveries.past.length).toBeGreaterThan(3); // offers came and went too
      expect(off.deliveries).toEqual(on.deliveries);
      expect(off.credits).toBe(on.credits);
      expect(off.purseLog.delivery).toBe(on.purseLog.delivery);
      expect(off.trade.soldTotal[IRON()]).toBe(on.trade.soldTotal[IRON()]);
      expect(off.hash()).toBe(on.hash());
    }, 60_000);
  }
});
