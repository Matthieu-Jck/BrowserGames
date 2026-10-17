// purse-facts.ts — what the purse's « ◉/h » is made of (D102; owner, 2026-10-16: « Il faut que les
// ventes, achats etc. soient beaucoup plus clairs, et que le chiffre soit réel, parce
// qu'actuellement il y a écrit −700 mais je gagne de l'argent »), pure (no DOM).
//
// Why the old figure lied: it was the trade ledger alone over the last ten minutes. Each line of
// it was right, but standing orders switch on and off with the price against their cap and the
// sales follow the market: on the late debug base, inside one hour in which the purse rose by
// 18 059 ◉, the ten-minute figure ran from +31 800 down to +167 ◉/h — and the tokens, the Compute
// Plan, the rent and the rental were not in it at all.
//
// The figure now is the purse's real change: the engine books every change of the ocelles by what
// made it (sim/purse.ts, the journal); `PurseHistory` samples the journal once a game minute
// (the HUD's refresh), and `purseSummary` reads the last hour from it (less, until an hour has
// been seen): every recurring flow's actual cents over those minutes, an hour. The lines break it
// down — each trade post's sales by item and its standing orders (from the trade ledger, over the
// same minutes; any cents the ledger no longer holds go to a last « other trade » line), the AI
// tokens with their rate and the share the claim's servers covered, the Compute Plan's fee, the
// servers' rental, the leases' rent — and they add up to the headline exactly. One-offs (a spot
// trade, a parcel bought or sold, a reorientation, a reward, a grant) are the window's actual
// cents, told apart: never in the headline.
import { PURSE_KINDS, RECURRING, type PurseKind, type PurseLog } from '@/sim/purse';
import type { Sim } from '@/sim/state';
import { orderHold, orderUnitCents } from '@/sim/systems/trade';

/** One sample a game minute: the minute, the purse and its journal, the tokens used and bought so far. */
export interface PurseSample {
  readonly epoch: number;
  readonly credits: number;
  readonly log: PurseLog;
  readonly used: number;
  readonly bought: number;
}

/** Minutes the headline reads (an hour), and minutes kept for the sparkline (six hours). */
export const WINDOW_MIN = 60;
export const HISTORY_MIN = 360;

/** The journal sampled once a game minute (a new colony starts afresh). */
export class PurseHistory {
  readonly samples: PurseSample[] = [];
  private sim: unknown = null;

  /** Take this minute's sample if not taken yet. */
  sample(sim: Sim): void {
    if (sim !== this.sim) { this.sim = sim; this.samples.length = 0; }
    const epoch = sim.absEpoch();
    const last = this.samples[this.samples.length - 1];
    if (last && last.epoch === epoch) return;
    if (last && epoch < last.epoch) this.samples.length = 0; // the clock went back (a swapped colony on another clock)
    this.samples.push({ epoch, credits: sim.credits, log: { ...sim.purseLog }, used: sim.tokenStats.totalUsed, bought: sim.tokenStats.totalBought });
    if (this.samples.length > HISTORY_MIN + 1) this.samples.splice(0, this.samples.length - HISTORY_MIN - 1);
  }
}

export type FlowKind = 'sale' | 'order' | 'trade' | 'tokens' | 'fee' | 'rental' | 'rent';

/** One line of the breakdown: centi-◉ an hour (+ in, − out) and what it is about. */
export interface FlowLine {
  readonly kind: FlowKind;
  readonly perHour: number;
  /** The trade post (a sale, an order). */
  readonly post?: number;
  /** The item sold or ordered. */
  readonly item?: number;
  /** The standing order (0: gone since). */
  readonly order?: number;
  /** Items a minute (a sale, an order), tokens a minute (tokens). */
  readonly perMin?: number;
  /** A standing order's cost a minute at today's price, if it buys its full rate (centi-◉). */
  readonly liveCost?: number;
  /** Tokens: the share the claim's servers covered, ‰. */
  readonly servers?: number;
  /** Rent: the leases now. */
  readonly parcels?: readonly number[];
}

export interface PurseSummary {
  /** Game minutes read (up to `WINDOW_MIN`); 0: none yet. */
  readonly minutes: number;
  /** The purse's real recurring change, centi-◉ an hour: the lines' exact sum. */
  readonly total: number;
  /** Ins first, then outs; each trade post's lines together. */
  readonly lines: readonly FlowLine[];
  /** The biggest line out, if any. */
  readonly drain: FlowLine | null;
  /** The window's one-offs, actual centi-◉ (not an hour), by kind; none when nothing. */
  readonly oneOffs: ReadonlyArray<{ readonly kind: PurseKind; readonly cents: number }>;
  /** The purse at each sampled minute (up to six hours back), centi-◉: the sparkline. */
  readonly spark: readonly number[];
}

const EMPTY: PurseSummary = { minutes: 0, total: 0, lines: [], drain: null, oneOffs: [], spark: [] };

/** The last hour (or what has been seen of it) of the purse, from the samples and the trade ledger. */
export function purseSummary(sim: Sim, h: PurseHistory): PurseSummary {
  const s = h.samples, now = s[s.length - 1];
  if (!now || s.length < 2) return { ...EMPTY, spark: s.map((x) => x.credits) };
  // The window's first sample: the newest at least an hour back, else the oldest seen.
  let k = s.length - 2;
  while (k > 0 && now.epoch - s[k]!.epoch < WINDOW_MIN) k--;
  const from = s[k]!;
  const minutes = now.epoch - from.epoch;
  const d = (kind: PurseKind): number => now.log[kind] - from.log[kind];
  const hourly = (cents: number): number => Math.round((cents * 60) / minutes);

  // Trade, from the ledger over the same minutes: each post's sales by item, each standing order.
  const sales = new Map<string, { post: number; item: number; cents: number; mu: number }>();
  const buys = new Map<string, { post: number; item: number; cents: number; mu: number }>();
  for (let i = sim.trade.ledger.length - 1; i >= 0; i--) {
    const l = sim.trade.ledger[i]!;
    if (l.epoch <= from.epoch) break;
    if (l.epoch > now.epoch || (l.kind !== 'export' && l.kind !== 'import')) continue;
    const m = l.kind === 'export' ? sales : buys, key = `${l.post}:${l.item}`;
    const v = m.get(key) ?? { post: l.post, item: l.item, cents: 0, mu: 0 };
    v.cents += l.cents; v.mu += l.mu;
    m.set(key, v);
  }
  const lines: FlowLine[] = [];
  let traded = 0;
  for (const v of [...sales.values()].sort((a, b) => a.post - b.post || b.cents - a.cents)) {
    lines.push({ kind: 'sale', perHour: hourly(v.cents), post: v.post, item: v.item, perMin: v.mu / 1000 / minutes });
    traded += v.cents;
  }
  for (const v of [...buys.values()].sort((a, b) => a.post - b.post || a.cents - b.cents)) {
    const o = sim.trade.orders.find((x) => x.post === v.post && x.item === v.item);
    // At its own price (the starter contract's is fixed, D101); a fulfilled contract buys nothing until continued.
    const live = o ? (orderHold(sim, o) === 'fulfilled' ? 0 : o.perMin * orderUnitCents(sim, o)) : undefined;
    lines.push({ kind: 'order', perHour: hourly(v.cents), post: v.post, item: v.item, order: o?.id ?? 0, perMin: v.mu / 1000 / minutes, liveCost: live });
    traded += v.cents;
  }
  // What the journal booked for trade but the ledger no longer holds (it keeps its last lines only).
  const rest = d('sales') + d('orders') - traded;
  if (rest) lines.push({ kind: 'trade', perHour: hourly(rest) });
  // The token flow bought for research (D118): its tokens a minute, and the share of all research's
  // tokens the claim's servers gave meanwhile (their chip).
  if (d('tokens')) {
    const used = now.used - from.used, bought = now.bought - from.bought;
    lines.push({ kind: 'tokens', perHour: hourly(d('tokens')), perMin: bought / minutes, servers: used > 0 ? Math.round(((used - bought) * 1000) / used) : 0 });
  }
  if (d('fee')) lines.push({ kind: 'fee', perHour: hourly(d('fee')) });
  if (d('rental')) lines.push({ kind: 'rental', perHour: hourly(d('rental')) });
  if (d('rent')) lines.push({ kind: 'rent', perHour: hourly(d('rent')), parcels: [...sim.land.leases.keys()].sort((a, b) => a - b) });
  // The headline is the lines' sum, each line rounded the same way: exact by construction.
  const total = lines.reduce((a, l) => a + l.perHour, 0);
  const outs = lines.filter((l) => l.perHour < 0);
  const drain = outs.length ? outs.reduce((a, b) => (b.perHour < a.perHour ? b : a)) : null;
  const oneOffs = PURSE_KINDS.filter((kind) => !RECURRING.has(kind) && d(kind)).map((kind) => ({ kind, cents: d(kind) }));
  return { minutes, total, lines, drain, oneOffs, spark: s.map((x) => x.credits) };
}

/** The window's recurring change, in actual centi-◉ (not an hour): what `total` scales up. */
export function recurringCents(h: PurseHistory): number {
  const s = h.samples, now = s[s.length - 1];
  if (!now || s.length < 2) return 0;
  let k = s.length - 2;
  while (k > 0 && now.epoch - s[k]!.epoch < WINDOW_MIN) k--;
  return PURSE_KINDS.filter((kind) => RECURRING.has(kind)).reduce((a, kind) => a + now.log[kind] - s[k]!.log[kind], 0);
}
