// trade.ts (system) — the trade posts and the Crier market. Commands configure export streams
// and standing import orders, or trade at once (spot); `tradeEpoch` runs at every epoch
// boundary — online in Sim.step, offline in the catch-up loop: the same function, so the
// ledgers match. At a boundary, for the epoch that just ended (its prices):
//   1. imports that have arrived land in their post's container while it has room; one that does
//      not fit waits in the air, and so do the post's next ones (D43);
//   2. each post buys its orders — only those an outlet takes out, and not while its container is
//      full: nothing is spent on goods that could not come out — then sells its streams, within
//      its throughput;
//   3. the market settles that epoch with the mu sold / bought → the next epoch's prices;
//   4. the Gazette's news and each post's activity go out as events.
// Spot trades are booked on the market at once (`book`), and do not count in the streams.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, ITEM_IDS, N_ITEMS, itemDef } from '@/content/registry';
import { afterFee, valueCents } from '@/market/pricing';
import { EPOCH } from '../constants';
import { footprint } from '../entities';
import { ReservoirNode } from '../flow/nodes';
import {
  deliveryTicks, LEDGER_MAX, orderSlots, orderTrades, postCap, streamSlots, throughputMu, tradeLevel,
  type ImportOrder, type SpotSide, type TradeLine, type TradeRefusal,
} from '../trade';
import type { Ent } from '../types';
import type { Sim } from '../state';

/** Can this item go through the Crier at all (a market depth, not a fluid)? */
export const tradable = (item: number): boolean => item >= 0 && item < N_ITEMS && itemDef(item).depth > 0 && itemDef(item).kind !== 'fluid';

/** Trade posts per entity table version (`sorted()` returns the same array until an add / remove). */
const postsOf = new WeakMap<readonly Ent[], Ent[]>();

/** Built, active trade posts, in id order (called every epoch: no scan of the whole colony). */
export function tradePosts(sim: Sim): Ent[] {
  const order = sim.ents.sorted();
  let all = postsOf.get(order);
  if (!all) postsOf.set(order, (all = order.filter((e) => BUILDING_KIND[e.def] === 'trade')));
  return all.filter((e) => e.builtAt === 0 && !sim.isDormant(e));
}

const isPost = (sim: Sim, id: number): Ent | null => {
  const e = sim.ents.get(id);
  return e && BUILDING_KIND[e.def] === 'trade' ? e : null;
};

/** Does a post touch the Hearth (edge to edge)? Then it delivers into, and sells from, its stock. */
export function nextToHearth(sim: Sim, e: Ent): boolean {
  const h = sim.ents.get(sim.hearthId);
  if (!h) return false;
  const [w, ht] = footprint(e.def, e.rot), [hw, hh] = footprint(h.def, h.rot);
  // Overlap lengths along each axis: 0 on one axis and > 0 on the other = a shared edge.
  const ox = Math.min(e.x + w, h.x + hw) - Math.max(e.x, h.x);
  const oy = Math.min(e.y + ht, h.y + hh) - Math.max(e.y, h.y);
  return (ox === 0 && oy > 0) || (oy === 0 && ox > 0);
}

/**
 * A post's container (D43, owner 2026-10-13): what it bought waits there until an outlet takes it
 * out, at most one lift's load — its throughput, 120 / 240 / 480 items. A post against the Hearth
 * no longer delivers into it: the Hearth never gives (D34), and ore bought into it was stuck there,
 * out of sight. A full container holds the next deliveries in the air and stops the purchases.
 */
export const containerMu = (sim: Sim): number => throughputMu(tradeLevel(sim.mods));

/** What a post's container holds of its purchases (mu): its store, less the items the post sells. */
export function waitingMu(sim: Sim, post: Ent): number {
  const st = sim.stores.get(post.id);
  if (!st) return 0;
  const sells = streamsOf(sim, post.id);
  let n = 0;
  for (let i = 0; i < N_ITEMS; i++) if (!sells.includes(i)) n += st[i]!;
  return n;
}

/**
 * Does a post hand `item` out: is its exit linked to a ribbon or a building? Its one exit hands out
 * whatever it bought, in turn (D62), so any purchase leaves by it.
 */
export function handsOut(sim: Sim, post: Ent, _item: number): boolean {
  const n = sim.graph?.nodeByEnt.get(post.id);
  return n instanceof ReservoirNode && n.outE.length > 0;
}

/** Is a post's container full: purchases waiting up to its load, or a delivery held in the air for want of room? */
export function containerFull(sim: Sim, post: Ent): boolean {
  if (waitingMu(sim, post) >= containerMu(sim)) return true;
  return sim.trade.inflight.some((s) => s.post === post.id && s.arrive <= sim.tick);
}

/** Why an order buys nothing at the next lift (null: it buys, if the ocelles allow): its price, no outlet for it, a full container. */
export type OrderHold = 'price' | 'outlet' | 'full';
export function orderHold(sim: Sim, o: ImportOrder): OrderHold | null {
  if (!o.active) return 'price';
  const p = sim.ents.get(o.post);
  if (!p) return null;
  if (!handsOut(sim, p, o.item)) return 'outlet';
  return containerFull(sim, p) ? 'full' : null;
}

/** A post's export streams (item per slot, -1 = empty), padded to the slots research gives. */
export function streamsOf(sim: Sim, post: number): number[] {
  const n = streamSlots(sim.mods);
  const cur = sim.trade.exports.get(post) ?? [];
  return Array.from({ length: n }, (_, i) => cur[i] ?? -1);
}

/** What each post's inlets take (its stream items) — the graph compiler builds the node with it. */
export function exportAccepts(sim: Sim): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const [post, items] of sim.trade.exports) m.set(post, new Set(items.filter((i) => i >= 0)));
  return m;
}

/**
 * What each post's exit hands out in turn (D62), sorted, once each: what it buys by its orders,
 * what is on its way to it, and the purchases still waiting in its container (not what it sells).
 */
export function importItems(sim: Sim): Map<number, number[]> {
  const m = new Map<number, Set<number>>();
  const add = (post: number, it: number): void => { let s = m.get(post); if (!s) m.set(post, (s = new Set())); s.add(it); };
  for (const o of sim.trade.orders) add(o.post, o.item);
  for (const s of sim.trade.inflight) add(s.post, s.item);
  for (const [post, st] of sim.stores) {
    if (BUILDING_KIND[sim.ents.get(post)?.def ?? -1] !== 'trade') continue;
    const sells = streamsOf(sim, post);
    for (let i = 0; i < N_ITEMS; i++) if (st[i]! > 0 && !sells.includes(i)) add(post, i);
  }
  return new Map([...m].map(([post, s]) => [post, [...s].sort((a, b) => a - b)]));
}

/** The fee (‰) on every trade now: the post's, or none while a quest reward waives it (systems/quests.ts). */
const fee = (sim: Sim): number => (sim.tick < sim.quests.feeFreeUntil ? 0 : sim.mods.tradeFee);
const line = (sim: Sim, l: Omit<TradeLine, 'epoch'>): void => {
  sim.trade.ledger.push({ epoch: sim.absEpoch(), ...l });
  if (sim.trade.ledger.length > LEDGER_MAX) sim.trade.ledger.splice(0, sim.trade.ledger.length - LEDGER_MAX);
};

// ── commands ──────────────────────────────────────────────────────────────
/** Sell an item through one of a post's export streams (null clears the slot). */
export function setExport(sim: Sim, post: number, slot: number, item: string | null): TradeRefusal | null {
  if (!isPost(sim, post)) return 'no_post';
  if (slot < 0 || slot >= streamSlots(sim.mods)) return 'slots';
  const it = item === null ? -1 : ITEM_IDS.indexOf(item as never);
  if (it >= 0 && !tradable(it)) return 'not_tradable';
  if (it >= 0 && sim.trade.orders.some((o) => o.post === post && o.item === it)) return 'importing';
  const cur = streamsOf(sim, post);
  if (it >= 0 && cur.some((x, i) => x === it && i !== slot)) return null; // already sold here
  cur[slot] = it;
  sim.trade.exports.set(post, cur);
  sim.log.push({ tick: sim.tick, cmd: { k: 'exportItem', post, slot, item } });
  sim.dirty = true; // the post's inlets take other items now
  return null;
}

/** Open a standing import order (whole items per minute, at most `maxCents` per item). Returns its id or a refusal. */
export function addImport(sim: Sim, post: number, item: string, perMin: number, maxCents: number): number | TradeRefusal {
  if (!isPost(sim, post)) return 'no_post';
  const it = ITEM_IDS.indexOf(item as never);
  if (!tradable(it)) return 'not_tradable';
  if (!Number.isInteger(perMin) || perMin < 1 || !Number.isInteger(maxCents) || maxCents < 1) return 'bad_amount';
  if (sim.trade.orders.length >= orderSlots(sim.mods)) return 'slots';
  if (streamsOf(sim, post).includes(it)) return 'exporting';
  const o: ImportOrder = { id: sim.trade.nextOrderId++, post, item: it, perMin, maxCents, active: false };
  o.active = (sim.prices.ask[it] ?? 0) > 0 && sim.prices.ask[it]! <= maxCents;
  sim.trade.orders.push(o);
  sim.log.push({ tick: sim.tick, cmd: { k: 'importOrder', post, item, perMin, maxCents } });
  sim.dirty = true; // its exit hands the item out (D62)
  return o.id;
}

export function cancelImport(sim: Sim, id: number): boolean {
  const i = sim.trade.orders.findIndex((o) => o.id === id);
  if (i < 0) return false;
  sim.trade.orders.splice(i, 1);
  sim.log.push({ tick: sim.tick, cmd: { k: 'cancelOrder', id } });
  sim.dirty = true; // the post's exit hands out what it still buys
  return true;
}

/** What a spot trade would bring / cost now, fee included (pure). */
export function quoteSpot(sim: Sim, item: number, side: SpotSide, n: number): { ok: boolean; cents: number; unitCents: number; factor: number; shock: number } {
  if (!tradable(item) || n <= 0) return { ok: false, cents: 0, unitCents: 0, factor: 0, shock: 1 };
  const q = sim.market.quote(item, side, n * 1000, sim.mods.slippage);
  const cents = afterFee(q.totalCents, side, fee(sim));
  return { ok: q.ok, cents, unitCents: Math.round(cents / n), factor: q.factor, shock: q.shock };
}

/**
 * Sell n items from the Hearth at once, or buy n: delivered after the delays into the container
 * of the first post an outlet of which takes the item out, at most one container's load, never
 * into a full one. Needs a trade post. Returns the ocelles received (+) or paid (−), or a refusal.
 */
export function spotTrade(sim: Sim, item: string, side: SpotSide, n: number): { cents: number } | { refused: TradeRefusal } {
  const posts = tradePosts(sim);
  if (!posts.length) return { refused: 'no_post' };
  const it = ITEM_IDS.indexOf(item as never);
  if (!tradable(it)) return { refused: 'not_tradable' };
  if (!Number.isInteger(n) || n < 1) return { refused: 'bad_amount' };
  const mu = n * 1000;
  const pre = quoteSpot(sim, it, side, n);
  if (!pre.ok) return { refused: 'not_tradable' };
  if (side === 'sell' && sim.stock[it]! < mu) return { refused: 'stock' };
  // Never below the restart reserve (D36): what the base needs to rebuild its production.
  if (side === 'sell' && sim.reserveShort([{ item: it, mu }]).length) return { refused: 'reserve' };
  if (side === 'buy' && sim.credits < pre.cents) return { refused: 'unaffordable' };
  const post = side === 'buy' ? posts.find((p) => handsOut(sim, p, it)) : posts[0];
  if (side === 'buy') sim.dirty = true; // its exit hands the item out (D62)
  if (!post) return { refused: 'no_outlet' };
  if (side === 'buy' && mu > containerMu(sim)) return { refused: 'container' };
  if (side === 'buy' && containerFull(sim, post)) return { refused: 'full' };
  const q = sim.market.book(it, side, mu, sim.mods.slippage);
  const cents = afterFee(q.totalCents, side, fee(sim));
  if (side === 'sell') {
    sim.stock[it] = sim.stock[it]! - mu;
    sim.credits += cents;
    sim.trade.earned += cents;
    sim.trade.soldTotal[it] = sim.trade.soldTotal[it]! + mu;
    line(sim, { post: post.id, item: it, kind: 'spotSell', mu, cents });
  } else {
    sim.credits -= cents;
    sim.trade.spent += cents;
    sim.trade.boughtTotal[it] = sim.trade.boughtTotal[it]! + mu;
    const src = sim.market.sources(it)[0];
    const boundary = Math.ceil((sim.tick + 1) / EPOCH) * EPOCH;
    sim.trade.inflight.push({ post: post.id, item: it, mu, arrive: boundary + deliveryTicks(tradeLevel(sim.mods), src?.delayMin ?? 0, sim.mods), colony: src?.colony ?? -1 });
    line(sim, { post: post.id, item: it, kind: 'spotBuy', mu, cents: -cents });
  }
  sim.log.push({ tick: sim.tick, cmd: { k: 'spot', item, side, n } });
  return { cents: side === 'sell' ? cents : -cents };
}

// ── the epoch boundary ────────────────────────────────────────────────────
/** A post's store: its container (purchases waiting for its outlets) and what its inlets brought to sell. */
function storeOf(sim: Sim, e: Ent): Float64Array {
  let st = sim.stores.get(e.id);
  if (!st) sim.stores.set(e.id, (st = new Float64Array(N_ITEMS)));
  return st;
}

export function tradeEpoch(sim: Sim): void {
  const t = sim.trade;
  const ended = sim.absEpoch() - 1;
  const { bid, ask } = sim.prices;
  const level = tradeLevel(sim.mods);
  const posts = tradePosts(sim);
  const byId = new Map(posts.map((p) => [p.id, p] as const));

  // 1. Deliveries due, each post's in order: into its container while it has room; one that does
  //    not fit waits in the air, and so do the post's next ones. A post gone or dormant: into the
  //    Hearth — nothing vanishes.
  if (t.inflight.length) {
    const keep = [];
    const room = new Map<number, number>(); // post → room left in its container (mu); -1 once one is held
    for (const s of t.inflight) {
      if (s.arrive > sim.tick) { keep.push(s); continue; }
      const p = byId.get(s.post);
      if (!p) {
        sim.stock[s.item] = sim.stock[s.item]! + s.mu;
        sim.events.push({ k: 'delivered', post: s.post, item: s.item, mu: s.mu });
        continue;
      }
      const r = room.get(p.id) ?? containerMu(sim) - waitingMu(sim, p);
      if (r < s.mu) { room.set(p.id, -1); keep.push(s); continue; }
      room.set(p.id, r - s.mu);
      const st = storeOf(sim, p);
      st[s.item] = st[s.item]! + s.mu;
      sim.events.push({ k: 'delivered', post: s.post, item: s.item, mu: s.mu });
    }
    t.inflight = keep;
  }

  // 2. Each post: active orders first (they are commitments), then its streams.
  for (const p of posts) {
    let budget = throughputMu(level);
    let soldMu = 0, boughtMu = 0, net = 0;
    const from: number[] = [];
    for (const o of t.orders) {
      if (o.post !== p.id) continue;
      o.active = orderTrades(o, ask[o.item] ?? 0);
      if (budget < 1000 || orderHold(sim, o)) continue;
      const src = sim.market.sources(o.item)[0];
      if (!src) continue;
      // Whole items: as many as the order wants, the throughput allows and the ocelles pay for.
      const unit = afterFee(valueCents(1000, ask[o.item]!, 'buy'), 'buy', fee(sim));
      let n = Math.min(o.perMin, Math.floor(budget / 1000), unit > 0 ? Math.floor(sim.credits / unit) : 0);
      let cost = n > 0 ? afterFee(valueCents(n * 1000, ask[o.item]!, 'buy'), 'buy', fee(sim)) : 0;
      while (n > 0 && cost > sim.credits) { n--; cost = n > 0 ? afterFee(valueCents(n * 1000, ask[o.item]!, 'buy'), 'buy', fee(sim)) : 0; }
      if (n <= 0) continue;
      const mu = n * 1000;
      sim.credits -= cost;
      t.spent += cost;
      t.bought[o.item] = t.bought[o.item]! + mu;
      t.boughtTotal[o.item] = t.boughtTotal[o.item]! + mu;
      budget -= mu; boughtMu += mu; net -= cost;
      t.inflight.push({ post: p.id, item: o.item, mu, arrive: sim.tick + deliveryTicks(level, src.delayMin, sim.mods), colony: src.colony });
      if (!from.includes(src.colony)) from.push(src.colony);
      line(sim, { post: p.id, item: o.item, kind: 'import', mu, cents: -cost });
    }
    const own = storeOf(sim, p);
    const hearth = nextToHearth(sim, p);
    for (const it of streamsOf(sim, p.id)) {
      if (it < 0 || budget <= 0 || (bid[it] ?? 0) <= 0) continue;
      // What came in by ribbon, then (next to the Hearth) its stock above the reserve.
      const fromOwn = Math.min(Math.floor(own[it]!), budget);
      const fromHearth = hearth ? Math.max(0, Math.min(Math.floor(sim.stock[it]! - BAL.tradeHearthReserve * 1000), budget - fromOwn)) : 0;
      const mu = fromOwn + fromHearth;
      if (mu <= 0) continue;
      own[it] = own[it]! - fromOwn;
      sim.stock[it] = sim.stock[it]! - fromHearth;
      const cents = afterFee(valueCents(mu, bid[it]!, 'sell'), 'sell', fee(sim));
      sim.credits += cents;
      t.earned += cents;
      t.sold[it] = t.sold[it]! + mu;
      t.soldTotal[it] = t.soldTotal[it]! + mu;
      budget -= mu; soldMu += mu; net += cents;
      line(sim, { post: p.id, item: it, kind: 'export', mu, cents });
    }
    if (soldMu || boughtMu) {
      t.activity.set(p.id, { epoch: ended, soldMu, boughtMu, cents: net });
      sim.events.push({ k: 'trade', post: p.id, soldMu, boughtMu, cents: net, from });
    }
  }

  // 3. The market settles the epoch that ended; its prices hold until the next boundary.
  const out = sim.market.settle({ epoch: ended, sold: t.sold, bought: t.bought });
  sim.prices = { epoch: out.epoch, bid: out.bid, ask: out.ask };
  t.sold.fill(0);
  t.bought.fill(0);
  // 4. The Gazette.
  if (out.started.length || out.announced.length || out.ended.length) sim.events.push({ k: 'gazette', started: out.started, ended: out.ended, announced: out.announced });
}

/** A store's content a post may not hold beyond (its node's cap). */
export const tradeCap = (sim: Sim): number => postCap(tradeLevel(sim.mods));
