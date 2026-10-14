// trade-view.ts — the small trade view helpers the Crier screen, the trade post's inspector
// panel and the HUD share: ocelles with two decimals, signed percentages, the tradable items
// and their picker (with icons), a post's facts at the colony's research, an order's state, delivery times,
// the colony's recurring trade per hour. Everything here reads the sim; changes go through its
// trade commands.
import { BAL } from '@/content/balance';
import { ITEM_IDS, N_ITEMS } from '@/content/registry';
import { duration } from '@/i18n/format';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { afterFee, valueCents } from '@/market/pricing';
import { EPOCH, TPS } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { containerMu, orderHold, tradable } from '@/sim/systems/trade';
import { deliveryTicks, orderSlots, streamSlots, throughputMu, tradeLevel, type ImportOrder, type TradeRefusal } from '@/sim/trade';
import { seenBy } from './inspector/kit';
import { itemPicker, type ItemPicker } from './item-picker';

/** Items the Crier trades (a market depth, not a fluid), in registry order. */
export const TRADABLE: readonly number[] = Array.from({ length: N_ITEMS }, (_, i) => i).filter((i) => tradable(i));

const formats = new Map<string, Intl.NumberFormat>();
/** One Intl formatter per (locale, use), built on first need. */
function nf(use: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale()}|${use}`;
  let f = formats.get(key);
  if (!f) { f = new Intl.NumberFormat(locale(), opts); formats.set(key, f); }
  return f;
}

/** Centi-ocelles as ocelles with two decimals (or `digits`), no glyph: « 1 234,50 »; `sign` adds a + (a − always shows). */
export function ocNum(cents: number, sign = false, digits = 2): string {
  const c = Math.round(cents);
  const s = c < 0 ? '−' : sign && c > 0 ? '+' : '';
  return s + nf(`oc${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(c) / 100);
}

/** The same with the ◉ glyph (held to the number by a no-break space). */
export const oc = (cents: number, sign = false, digits = 2): string => `${ocNum(cents, sign, digits)}\u00A0◉`;

/** A relative change as a signed percentage: −0.14 → « −14 % » (0 shows no sign; a true minus sign, like ocNum). */
export const spct = (ratio: number): string =>
  nf('spct', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(ratio).replace('-', '−');

/** A delay in whole minutes from the tables: « 10 min », « 2 h », else « 1 h 30 min » (duration() would add « 00 s »). */
export function minutes(m: number): string {
  if (m < 60) return t('crier.min', { v: m });
  return m % 60 === 0 ? t('crier.hours', { v: m / 60 }) : duration(m * 60);
}

/** A fee in ‰ as a percentage: 80 → « 8 % ». */
export const feeText = (permille: number): string => t('crier.pct', { v: permille / 10 });

/** What a refused trade command says. */
export const refusalText = (r: TradeRefusal): string => tr(`trade.refused.${r}`);

/** What every trade post does at the colony's research (they share the level). */
export interface PostFacts {
  level: number;
  /** Fee ‰ on every sale and purchase. */
  fee: number;
  /** Items lifted per minute and post, imports and exports together. */
  perMin: number;
  /** Minutes from a purchase to the lift-off. */
  liftMin: number;
  /** Export streams per post, standing orders in all. */
  streams: number;
  orders: number;
}

export function postFacts(sim: Sim): PostFacts {
  const level = tradeLevel(sim.mods);
  return {
    level, fee: sim.mods.tradeFee, perMin: throughputMu(level) / 1000,
    liftMin: BAL.liftDelayMin[Math.min(3, level) - 1]!, streams: streamSlots(sim.mods), orders: orderSlots(sim.mods),
  };
}

/** Seconds of game time until a tick (never negative). */
export const secondsTo = (sim: Sim, tick: number): number => Math.max(0, (tick - sim.tick) / TPS);

/** The next epoch boundary, when posts sell their streams and fill their orders. */
export const nextBoundary = (sim: Sim): number => Math.ceil((sim.tick + 1) / EPOCH) * EPOCH;

/** When goods of an item bought at tick `at` (a boundary) would land: the lift, then the nearest supplier's freighter. */
export function arrivalTick(sim: Sim, item: number, at: number): number {
  const src = sim.market.sources(item)[0];
  return at + deliveryTicks(tradeLevel(sim.mods), src?.delayMin ?? 0, sim.mods);
}

/** What one item costs now through a post, fee included (centi-◉). */
export const unitBuyCents = (sim: Sim, item: number): number =>
  afterFee(valueCents(1000, sim.prices.ask[item] ?? 0, 'buy'), 'buy', sim.mods.tradeFee);

/** What one item brings now through a post, fee deducted (centi-◉). */
export const unitSellCents = (sim: Sim, item: number): number =>
  afterFee(valueCents(1000, sim.prices.bid[item] ?? 0, 'sell'), 'sell', sim.mods.tradeFee);

/**
 * A standing order as the player sees it: buying (active), paused (the ask went above its max;
 * it resumes 3 % under it), waiting for an outlet (none of its post's is set to the item), held
 * by a full container (D43: nothing bought, nothing paid), or short of ocelles.
 */
export type OrderState = 'active' | 'paused' | 'outlet' | 'full' | 'poor';
export function orderState(sim: Sim, o: ImportOrder): OrderState {
  const hold = orderHold(sim, o);
  if (hold === 'price') return 'paused';
  if (hold) return hold;
  return sim.credits < unitBuyCents(sim, o.item) ? 'poor' : 'active';
}

/** The ask under which a paused order resumes (the hysteresis of trade.ts). */
export const resumeCents = (o: ImportOrder): number => Math.floor((o.maxCents * (1000 - BAL.importHysteresis)) / 1000);

/** The order's state, in words, and why (the title of its chip). */
export function orderStateText(sim: Sim, o: ImportOrder): { state: OrderState; text: string; why: string } {
  const state = orderState(sim, o);
  const ask = sim.prices.ask[o.item] ?? 0;
  const why = state === 'paused' ? t('crier.order.paused.tip', { ask: oc(ask), resume: oc(resumeCents(o)) })
    : state === 'poor' ? t('crier.order.poor.tip', { cost: oc(unitBuyCents(sim, o.item)) })
      : state === 'outlet' ? t('crier.order.outlet.tip')
        : state === 'full' ? t('crier.order.full.tip', { n: Math.round(containerMu(sim) / 1000) })
          : t('crier.order.active.tip', { ask: oc(ask) });
  return { state, text: t(`crier.order.${state}` as MsgKey), why };
}

/** Earliest arrival (tick) of the goods in flight to a post (of one item, if given), or null. */
export function nextArrival(sim: Sim, post: number, item = -1): number | null {
  let best: number | null = null;
  for (const s of sim.trade.inflight) {
    if (s.post !== post || (item >= 0 && s.item !== item)) continue;
    if (best === null || s.arrive < best) best = s.arrive;
  }
  return best;
}

/**
 * The colony's recurring trade (export streams and standing orders, not spot trades) in
 * centi-◉ per hour, averaged over the last `win` boundaries — or since its oldest line in that
 * window, so that a stream set up a minute ago already shows its pace.
 */
export function tradePerHour(sim: Sim, win = 10): number {
  const now = sim.absEpoch(), lines = sim.trade.ledger;
  let sum = 0, oldest = Infinity;
  for (let k = lines.length - 1; k >= 0; k--) {
    const l = lines[k]!;
    if (l.epoch <= now - win) break;
    if (l.kind !== 'export' && l.kind !== 'import') continue;
    sum += l.cents;
    if (l.epoch < oldest) oldest = l.epoch;
  }
  if (oldest === Infinity) return 0;
  return (sum / Math.max(1, Math.min(win, now - oldest + 1))) * 60;
}

/** Items sold by each post's streams at the last boundary: `${post}:${item}` → mu and centi-◉. */
export function lastExports(sim: Sim): Map<string, { mu: number; cents: number }> {
  const out = new Map<string, { mu: number; cents: number }>();
  const now = sim.absEpoch(), lines = sim.trade.ledger;
  for (let k = lines.length - 1; k >= 0; k--) {
    const l = lines[k]!;
    if (l.epoch < now) break;
    if (l.kind !== 'export') continue;
    const key = `${l.post}:${l.item}`, cur = out.get(key);
    if (cur) { cur.mu += l.mu; cur.cents += l.cents; } else out.set(key, { mu: l.mu, cents: l.cents });
  }
  return out;
}

/**
 * A picker over the tradable items (item-picker.ts: each item's icon and name, on the button and in
 * the list), with an optional first « none » choice; `onPick` gets the item id, or null for none.
 * Given the colony, the items the base has seen come first. `set(index)` shows another item.
 */
export function tradeSelect(current: number, none: string | null, onPick: (item: string | null) => void, attrs: Record<string, unknown> = {}, sim?: Sim, label?: string): ItemPicker {
  return itemPicker({ items: TRADABLE, value: current, none, onPick: (i) => onPick(i >= 0 ? ITEM_IDS[i]! : null), attrs, label, known: sim ? seenBy(sim) : undefined });
}

/** Rebuild key of a post's panel: its streams and its orders shape the DOM. */
export function tradeSig(sim: Sim, post: number): string {
  return `${sim.streamsOf(post).join('.')}|${sim.trade.orders.filter((o) => o.post === post).map((o) => o.id).join('.')}`;
}
