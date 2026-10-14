// trade.ts (system) — the trade posts and the Crier market. Commands open and cancel standing
// import orders, or trade at once (spot); `tradeEpoch` runs at every epoch boundary — online in
// Sim.step, offline in the catch-up loop: the same function, so the ledgers match. A post has one
// entrance and one exit (D62) and no export streams to set (D64): its entrance takes every
// tradable item but its cargo (what it bought and holds or awaits), and it sells all of it; its
// exit hands its cargo out, each item in turn. At a boundary, for the epoch that just ended (its
// prices):
//   1. imports that have arrived land in their post's container while it has room; one that does
//      not fit waits in the air, and so do the post's next ones (D43);
//   2. each post buys its orders — only while its exit leads somewhere, and not while its
//      container is full: nothing is spent on goods that could not come out — then sells what
//      its entrance brought, within its throughput;
//   3. the cargo no order wants, none on its way and none left in its container leaves it (the
//      graph is then recompiled: the entrance takes the item again);
//   4. the market settles that epoch with the mu sold / bought → the next epoch's prices;
//   5. the Gazette's news and each post's activity go out as events.
// Spot trades are booked on the market at once (`book`).
import { BAL } from '@/content/balance';
import { BUILDING_KIND, ITEM_IDS, N_ITEMS, itemDef } from '@/content/registry';
import { afterFee, valueCents } from '@/market/pricing';
import { LocalMarketService } from '@/market/service';
import { EPOCH } from '../constants';
import { ReservoirNode } from '../flow/nodes';
import {
  deliveryTicks, LEDGER_MAX, orderSlots, orderTrades, postCap, throughputMu, tradeLevel,
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

/**
 * A post's container (D43, owner 2026-10-13): what it bought waits there until an outlet takes it
 * out, at most one lift's load — its throughput, 120 / 240 / 480 items. A post against the Hearth
 * no longer delivers into it: the Hearth never gives (D34), and ore bought into it was stuck there,
 * out of sight. A full container holds the next deliveries in the air and stops the purchases.
 */
export const containerMu = (sim: Sim): number => throughputMu(tradeLevel(sim.mods));

const NONE: readonly number[] = [];

/** A post's cargo (D64): what it bought and holds or awaits, sorted. */
export const cargoOf = (sim: Sim, post: number): readonly number[] => sim.trade.cargo.get(post) ?? NONE;

/** What a post's container holds of its purchases (mu): its store's cargo items. */
export function waitingMu(sim: Sim, post: Ent): number {
  const st = sim.stores.get(post.id);
  if (!st) return 0;
  let n = 0;
  for (const i of cargoOf(sim, post.id)) n += st[i]!;
  return n;
}

/** A post buys an item: it joins its cargo (the graph changes: its exit hands it out, its entrance no longer takes it). */
function addCargo(sim: Sim, post: number, it: number): void {
  const cur = sim.trade.cargo.get(post) ?? [];
  if (cur.includes(it)) return;
  sim.trade.cargo.set(post, [...cur, it].sort((a, b) => a - b));
  sim.dirty = true;
}

/**
 * The cargo a post no longer holds nor awaits leaves it: no order for the item, none on its way,
 * not one whole item left in its container. Whether any left (the graph must be recompiled).
 */
function pruneCargo(sim: Sim): boolean {
  const t = sim.trade;
  let changed = false;
  for (const post of [...t.cargo.keys()].sort((a, b) => a - b)) {
    const st = sim.stores.get(post);
    const keep = t.cargo.get(post)!.filter((it) =>
      t.orders.some((o) => o.post === post && o.item === it)
      || t.inflight.some((s) => s.post === post && s.item === it)
      || (st?.[it] ?? 0) >= 1000);
    if (keep.length === t.cargo.get(post)!.length) continue;
    changed = true;
    if (keep.length) t.cargo.set(post, keep); else t.cargo.delete(post);
  }
  if (changed) sim.dirty = true;
  return changed;
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

/** Every item the Crier trades, ascending (the content is fixed for a run). */
let TRADABLE: readonly number[] | null = null;
export const tradables = (): readonly number[] => (TRADABLE ??= Array.from({ length: N_ITEMS }, (_, i) => i).filter(tradable));

/** What each post's entrance takes (D64): every tradable item but its cargo — the graph compiler builds the node with it. */
export function exportAccepts(sim: Sim): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  let all: Set<number> | null = null;
  for (const e of sim.ents.sorted()) {
    if (BUILDING_KIND[e.def] !== 'trade') continue;
    const cargo = cargoOf(sim, e.id);
    m.set(e.id, cargo.length ? new Set(tradables().filter((i) => !cargo.includes(i))) : (all ??= new Set(tradables())));
  }
  return m;
}

/** What each post's exit hands out in turn (D62): its cargo, sorted, once each. */
export function importItems(sim: Sim): Map<number, readonly number[]> {
  return new Map([...sim.trade.cargo].filter(([, items]) => items.length > 0));
}

/** The fee (‰) on every trade: CrierBelt's cut (D64: a monopoly's, and nothing lowers it). */
const fee = (sim: Sim): number => sim.mods.tradeFee;
const line = (sim: Sim, l: Omit<TradeLine, 'epoch'>): void => {
  sim.trade.ledger.push({ epoch: sim.absEpoch(), ...l });
  if (sim.trade.ledger.length > LEDGER_MAX) sim.trade.ledger.splice(0, sim.trade.ledger.length - LEDGER_MAX);
};

// ── commands ──────────────────────────────────────────────────────────────
/** Open a standing import order (whole items per minute, at most `maxCents` per item). Returns its id or a refusal. */
export function addImport(sim: Sim, post: number, item: string, perMin: number, maxCents: number, express = false): number | TradeRefusal {
  if (!isPost(sim, post)) return 'no_post';
  const it = ITEM_IDS.indexOf(item as never);
  if (!tradable(it)) return 'not_tradable';
  if (!Number.isInteger(perMin) || perMin < 1 || !Number.isInteger(maxCents) || maxCents < 1) return 'bad_amount';
  if (sim.trade.orders.length >= orderSlots(sim.mods)) return 'slots';
  if (express && !sim.mods.flags.has('expressFreight')) return 'no_express';
  const o: ImportOrder = { id: sim.trade.nextOrderId++, post, item: it, perMin, maxCents, active: false, ...(express ? { express: true } : {}) };
  o.active = (sim.prices.ask[it] ?? 0) > 0 && sim.prices.ask[it]! <= maxCents;
  sim.trade.orders.push(o);
  sim.log.push({ tick: sim.tick, cmd: { k: 'importOrder', post, item, perMin, maxCents, ...(express ? { express: true } : {}) } });
  // Its cargo now: the exit hands it out, the entrance no longer takes it (what it brought of it,
  // still in the container, leaves by the exit too: nothing is sold or lost).
  addCargo(sim, post, it);
  sim.dirty = true;
  return o.id;
}

/**
 * Price Forecast (an_forecast): the Crier's bid and ask `minutes` from now, as the sister claims
 * alone would move them (a copy of the market run on, trade-free — the « Avant de partir »
 * forecast's way: the world's own answer, not a guess, as long as the claim does not trade).
 * Pure: the colony's market is untouched.
 */
export function priceForecast(sim: Sim, minutes: number): { bid: number[]; ask: number[] } | null {
  if (!(sim.market instanceof LocalMarketService)) return null;
  const copy = LocalMarketService.load(sim.market.save(), sim.market.config);
  const zero = new Float64Array(N_ITEMS);
  const out = copy.settle({ epoch: sim.absEpoch() - 1 + Math.max(1, minutes), sold: zero, bought: zero });
  return { bid: out.bid, ask: out.ask };
}

/** Floor Prices (cm_floor): the bid (centi-◉ an item) under which the posts hold an item back (null: none). Logged. */
export function setFloorPrice(sim: Sim, item: string, cents: number | null): boolean {
  if (!sim.mods.flags.has('floorPrices')) return false;
  const it = ITEM_IDS.indexOf(item as never);
  if (!tradable(it)) return false;
  if (cents === null) { if (!sim.trade.floors.delete(it)) return false; }
  else { if (!Number.isInteger(cents) || cents < 1) return false; sim.trade.floors.set(it, cents); }
  sim.log.push({ tick: sim.tick, cmd: { k: 'floorPrice', item, cents } });
  return true;
}

export function cancelImport(sim: Sim, id: number): boolean {
  const i = sim.trade.orders.findIndex((o) => o.id === id);
  if (i < 0) return false;
  sim.trade.orders.splice(i, 1);
  sim.log.push({ tick: sim.tick, cmd: { k: 'cancelOrder', id } });
  // What it bought and still holds or awaits stays cargo until the exit has handed it out.
  pruneCargo(sim);
  sim.dirty = true;
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
    sim.trade.inflight.push({ post: post.id, item: it, mu, arrive: boundary + deliveryTicks(tradeLevel(sim.mods), src?.delayMin ?? 0, sim.mods), colony: src?.colony ?? -1, cents });
    addCargo(sim, post.id, it); // its exit hands it out (D62)
    line(sim, { post: post.id, item: it, kind: 'spotBuy', mu, cents: -cents });
  }
  sim.log.push({ tick: sim.tick, cmd: { k: 'spot', item, side, n } });
  return { cents: side === 'sell' ? cents : -cents };
}

// ── the epoch boundary ────────────────────────────────────────────────────
/** A post's store: its container (its cargo, waiting for its exit) and what its entrance brought to sell. */
function storeOf(sim: Sim, e: Ent): Float64Array {
  let st = sim.stores.get(e.id);
  if (!st) sim.stores.set(e.id, (st = new Float64Array(N_ITEMS)));
  return st;
}

/** The epoch boundary's trade (see the header). Whether the cargo changed (then the graph must be recompiled, offline too). */
export function tradeEpoch(sim: Sim): boolean {
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
        sim.hearthIn[s.item] = sim.hearthIn[s.item]! + s.mu;
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

  // 2. Each post: active orders first (they are commitments), then what its entrance brought.
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
      // Express freight (cm_express) costs a share more and comes in a share of the time.
      const priceOf = (k: number): number => {
        const c = afterFee(valueCents(k * 1000, ask[o.item]!, 'buy'), 'buy', fee(sim));
        return o.express ? Math.ceil((c * BAL.express.price) / 1000) : c;
      };
      const unit = priceOf(1);
      let n = Math.min(o.perMin, Math.floor(budget / 1000), unit > 0 ? Math.floor(Math.max(0, sim.credits) / unit) : 0);
      let cost = n > 0 ? priceOf(n) : 0;
      while (n > 0 && cost > sim.credits) { n--; cost = n > 0 ? priceOf(n) : 0; }
      if (n <= 0) continue;
      const mu = n * 1000;
      sim.credits -= cost;
      t.spent += cost;
      t.bought[o.item] = t.bought[o.item]! + mu;
      t.boughtTotal[o.item] = t.boughtTotal[o.item]! + mu;
      budget -= mu; boughtMu += mu; net -= cost;
      const delay = deliveryTicks(level, src.delayMin, sim.mods);
      t.inflight.push({ post: p.id, item: o.item, mu, arrive: sim.tick + (o.express ? Math.ceil((delay * BAL.express.delay) / 1000 / EPOCH) * EPOCH : delay), colony: src.colony, cents: cost });
      if (!from.includes(src.colony)) from.push(src.colony);
      line(sim, { post: p.id, item: o.item, kind: 'import', mu, cents: -cost });
    }
    const own = storeOf(sim, p);
    const cargo = cargoOf(sim, p.id);
    for (const it of tradables()) {
      if (budget <= 0) break;
      if (own[it]! < 1000 || cargo.includes(it) || (bid[it] ?? 0) <= 0) continue;
      // Floor Prices (cm_floor): under its floor, the item waits in the container for a better bid.
      if (sim.mods.flags.has('floorPrices') && bid[it]! < (t.floors.get(it) ?? 0)) continue;
      // Whole items, as many as the throughput lets go (the rest waits for the next lift).
      const mu = Math.min(Math.floor(own[it]! / 1000), Math.floor(budget / 1000)) * 1000;
      if (mu <= 0) break;
      own[it] = own[it]! - mu;
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

  // 3. The cargo handed out in full leaves it.
  const changed = pruneCargo(sim);

  // 4. The market settles the epoch that ended; its prices hold until the next boundary.
  const out = sim.market.settle({ epoch: ended, sold: t.sold, bought: t.bought });
  sim.prices = { epoch: out.epoch, bid: out.bid, ask: out.ask };
  t.sold.fill(0);
  t.bought.fill(0);
  // 5. The Gazette.
  if (out.started.length || out.announced.length || out.ended.length) sim.events.push({ k: 'gazette', started: out.started, ended: out.ended, announced: out.announced });
  return changed;
}

/** A store's content a post may not hold beyond (its node's cap). */
export const tradeCap = (sim: Sim): number => postCap(tradeLevel(sim.mods));
