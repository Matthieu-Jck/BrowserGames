// trade.ts — the trade post's rules, as data and pure functions (the system that applies them
// is systems/trade.ts). A trade post (Comptoir) is the colony's dock at the Crier Ring:
// · export streams: items that ribbons bring in are sold at each epoch boundary (once per game
//   minute) at that epoch's bid, minus the post's fee, up to its throughput; a post next to the
//   Hearth also sells from the Hearth's stock (keeping a small reserve);
// · standing import orders (item, items/min, max price): filled at each boundary while the ask
//   stays under the max (with hysteresis) and the ocelles suffice; the goods arrive after the
//   post's lift delay plus the supplying colony's delay, into the post's container (its store),
//   which its outlets set to that item empty (D43). An order buys only what an outlet takes out,
//   and nothing while the container is full (a container's load: the post's throughput);
// · spot trades: a stock sold or bought at once along the market's depth (slippage).
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
}

export interface Shipment {
  post: number;
  item: number;
  mu: number;
  /** Tick of arrival (always an epoch boundary). */
  arrive: number;
  /** Supplying colony (index in the market's colonies), for the views. */
  colony: number;
}

/** One line of the ledger: what was traded, when, for how much (a server can re-check it). */
export interface TradeLine {
  /** Absolute world epoch of the trade. */
  epoch: number;
  post: number;
  item: number;
  kind: 'export' | 'import' | 'spotSell' | 'spotBuy';
  mu: number;
  /** Ocelles received (+) or paid (−), after fees. */
  cents: number;
}

/** A post's last epoch, for the inspector and the cargo launches. */
export interface PostActivity { epoch: number; soldMu: number; boughtMu: number; cents: number }

/** Why a trade command was refused (null = accepted). */
export type TradeRefusal = 'no_post' | 'not_tradable' | 'slots' | 'unaffordable' | 'stock' | 'exporting' | 'importing' | 'bad_amount' | 'reserve'
  /** A purchase no outlet of any post takes out; more than one container's load; a full container (D43). */
  | 'no_outlet' | 'container' | 'full';

/** The trade post level from research: 1, 2 (Second Wharf), 3 (Grand Post). */
export const tradeLevel = (mods: Mods): number => (mods.flags.has('tradeL3') ? 3 : mods.flags.has('tradeL2') ? 2 : 1);

/** Export streams per post, and standing import orders in all (Standing Orders: 6 and 6). */
export const streamSlots = (mods: Mods): number => BAL.tradeStreams + mods.streams;
export const orderSlots = (mods: Mods): number => BAL.tradeStreams + mods.streams;

/** Trade posts the colony may build (Second Wharf allows a second one). */
export const maxPosts = (mods: Mods): number => (mods.flags.has('tradeL2') ? 2 : 1);

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
  /** Per post: the item of each export stream slot (-1 = empty). */
  exports: Map<number, number[]>;
  orders: ImportOrder[];
  nextOrderId: number;
  /** Imports bought and on their way. */
  inflight: Shipment[];
  /** mu sold by streams / bought by orders at the coming boundary's settlement (zeroed after it). */
  sold: Float64Array;
  bought: Float64Array;
  ledger: TradeLine[];
  /** Per post: its last epoch with trade. */
  activity: Map<number, PostActivity>;
  /** Lifetime ocelles earned and spent through the Crier (centi-◉), and mu sold / bought per item. */
  earned: number;
  spent: number;
  soldTotal: Float64Array;
  boughtTotal: Float64Array;
}

export function newTradeState(nItems: number): TradeState {
  return {
    exports: new Map(), orders: [], nextOrderId: 1, inflight: [],
    sold: new Float64Array(nItems), bought: new Float64Array(nItems),
    ledger: [], activity: new Map(), earned: 0, spent: 0,
    soldTotal: new Float64Array(nItems), boughtTotal: new Float64Array(nItems),
  };
}
