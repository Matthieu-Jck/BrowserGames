// trade.ts — the trade post's rules, as data and pure functions (the system that applies them
// is systems/trade.ts). A trade post (Comptoir) is the colony's dock at the Crier Ring:
// · sales: whatever its one entrance brings (any tradable item but its cargo, below) is sold at
//   each epoch boundary (once per game minute) at that epoch's bid, minus CrierBelt's fee, up to
//   its throughput (D64: no export streams to choose — one way in, one way out);
// · standing import orders (item, items/min, max price): filled at each boundary while the ask
//   stays under the max (with hysteresis) and the ocelles suffice; the goods arrive after the
//   post's lift delay plus the supplying colony's delay, into the post's container (its store),
//   which its one exit hands out, each item in turn (D43, D62). An order buys only while the exit
//   leads somewhere, and nothing while the container is full (a container's load: the post's
//   throughput). The post's **cargo** is what it bought and holds or awaits;
// · spot trades: a stock sold or bought at once along the market's depth (slippage);
// · the starter contract (D101): once per base, CrierBelt sells copper ore at a fixed price, off
//   the market — a standing order that buys `BAL.starter.n` in all, then stops (fulfilled) until
//   the player continues it at the market's price or stops it; it lands `BAL.starter.delayMin`
//   minutes after each purchase and, like every purchase, leaves only by the exit.
// Everything here is integer: milli-items, centi-ocelles, ticks.
import { BAL } from '@/content/balance';
import { EPOCH } from './constants';
import type { Mods } from './research/modifiers';

export type SpotSide = 'sell' | 'buy';

export interface ImportOrder {
  id: number;
  /** The trade post that receives the goods. */
  post: number;
  item: number;
  /** Whole items per minute. */
  perMin: number;
  /** Highest ask (centi-ocelles per item) the order pays. */
  maxCents: number;
  /** Hysteresis state: an order pauses above its max and resumes 3 % below it. */
  active: boolean;
  /** Express Freight (cm_express): half the delay, a quarter dearer. */
  express?: boolean;
  /**
   * The starter contract (D101; present only on that order): the mu still to buy at CrierBelt's
   * fixed price, off the market. Always active (no hysteresis); at 0 it stands stopped (`orderHold`
   * 'fulfilled') until continued at the market's price (`continueStarter`, which drops the field)
   * or cancelled.
   */
  starter?: number;
}

export interface Shipment {
  post: number;
  item: number;
  mu: number;
  /** Tick of arrival (always an epoch boundary). */
  arrive: number;
  /** Supplying colony (index in the market's colonies), for the views; −1: CrierBelt itself (the starter contract, D101). */
  colony: number;
  /** What it cost, CrierBelt's cut included (centi-◉; for the views: the post's panel). Absent in saves before D64. */
  cents?: number;
}

/** One line of the ledger: what was traded, when, for how much (a server can re-check it). */
export interface TradeLine {
  /** Absolute world epoch of the trade. */
  epoch: number;
  post: number;
  item: number;
  /** `autoSell`: the Core's surplus sold at the boundary (D127; `post` is the Core's id). */
  kind: 'export' | 'import' | 'spotSell' | 'spotBuy' | 'autoSell';
  mu: number;
  /** Ocelles received (+) or paid (−), after fees. */
  cents: number;
}

/** A post's last epoch, for the inspector and the cargo launches. */
export interface PostActivity { epoch: number; soldMu: number; boughtMu: number; cents: number }

/** Why a trade command was refused (null = accepted). */
export type TradeRefusal = 'no_express' | 'no_post' | 'not_tradable' | 'slots' | 'unaffordable' | 'stock' | 'bad_amount' | 'reserve'
  /** A purchase no outlet of any post takes out; more than one container's load; a full container (D43). */
  | 'no_outlet' | 'container' | 'full'
  /** The starter contract was already signed on this base (D101: once, even if cancelled since). */
  | 'taken';

/** The trade post level from research: 1, 2 (Wider Wharf), 3 (Grand Post). */
export const tradeLevel = (mods: Mods): number => (mods.flags.has('tradeL3') ? 3 : mods.flags.has('tradeL2') ? 2 : 1);

/** Standing import orders in all (Standing Orders: 6). */
export const orderSlots = (mods: Mods): number => BAL.tradeOrders + mods.orders;

/**
 * Trade posts the colony may build: a second with « Second comptoir » (`post2`, Commerce's Tier 1
 * since D107), a third with the Crier House. Before D107 the second came with the post's level 2
 * (`tradeL2`): a claim holding that keeps its second post.
 */
export const maxPosts = (mods: Mods): number => (mods.flags.has('post3') ? 3 : mods.flags.has('post2') || mods.flags.has('tradeL2') ? 2 : 1);

/** What one post lifts per epoch, imports and exports together (mu). */
export const throughputMu = (level: number): number => BAL.tradeThroughput[Math.min(3, level) - 1]! * 1000;

/** A post's store: two minutes of its throughput (mu). */
export const postCap = (level: number): number => 2 * throughputMu(level);

/** Ticks from an import's purchase to its arrival: the lift, then the colony's freighter (research shortens it). */
export function deliveryTicks(level: number, colonyDelayMin: number, mods: Mods): number {
  const lift = BAL.liftDelayMin[Math.min(3, level) - 1]!;
  return (lift + Math.ceil((colonyDelayMin * mods.deliveryDelay) / 1000)) * EPOCH;
}

/** Hysteresis: does an order trade at this ask? (pauses above max, resumes at ≤ max − 3 %). */
export function orderTrades(o: ImportOrder, ask: number): boolean {
  if (ask <= 0) return false;
  if (o.active) return ask <= o.maxCents;
  return ask * 1000 <= o.maxCents * (1000 - BAL.importHysteresis);
}

/** Ledger lines kept (rolling): a day of busy trading. */
export const LEDGER_MAX = 2000;

/** Everything the colony's trade holds between boundaries (saved, hashed). */
export interface TradeState {
  /**
   * Per post, its cargo (D64): the items it bought and holds or awaits — on order, on their way,
   * or still in its container — sorted, once each. Its exit hands these out in turn; its entrance
   * takes every other tradable item, to sell. An item leaves the cargo at the boundary when no
   * order wants it, none is on its way and not one is left in the container (systems/trade.ts).
   */
  cargo: Map<number, number[]>;
  orders: ImportOrder[];
  nextOrderId: number;
  /** Imports bought and on their way. */
  inflight: Shipment[];
  /** mu sold / bought by the posts at the coming boundary's settlement (zeroed after it). */
  sold: Float64Array;
  bought: Float64Array;
  ledger: TradeLine[];
  /** Per post: its last epoch with trade. */
  activity: Map<number, PostActivity>;
  /** Floor Prices (cm_floor): per item, the bid (centi-◉ an item) under which the posts hold it back. */
  floors: Map<number, number>;
  /**
   * Auto-sell (cm_autosell, D127): per item switched on, its threshold in whole items — what the Core
   * holds beyond it is sold at each boundary (systems/trade.ts `autoSales`), and the Core takes the
   * item under its threshold, which stays below the Core's cap (D163).
   */
  autoSell: Map<number, number>;
  /** Lifetime ocelles earned and spent through the Crier (centi-◉), and mu sold / bought per item. */
  earned: number;
  spent: number;
  soldTotal: Float64Array;
  boughtTotal: Float64Array;
  /** The starter contract (D101) was signed on this base: CrierBelt offers it once, ever. */
  starterTaken: boolean;
}

export function newTradeState(nItems: number): TradeState {
  return {
    cargo: new Map(), orders: [], nextOrderId: 1, inflight: [],
    sold: new Float64Array(nItems), bought: new Float64Array(nItems),
    ledger: [], activity: new Map(), floors: new Map(), autoSell: new Map(), earned: 0, spent: 0,
    soldTotal: new Float64Array(nItems), boughtTotal: new Float64Array(nItems),
    starterTaken: false,
  };
}
