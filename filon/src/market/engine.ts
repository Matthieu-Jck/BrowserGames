// engine.ts — the market's state machine. `settle` advances one epoch at a time, in order:
// it books the epoch's trade (stream exports and imports into the block's flow totals, spot
// volume into a lasting price shock), every 5 epochs solves each item's equilibrium on the
// block's average flows and eases the smoothed price toward it, then prices the next epoch:
//   P = V·exp(ln r_f + ln e_f + σ·u(t) + shock), clamped to [0.25 V, 4 V],
// where r_f is the flow equilibrium smoothed over τ (6 h commons, 12 h uniques), e_f the
// impact of the events in progress (eased over 20 min, so even the 2 h scripted shortage
// shows), u the stateless noise and the shock the wake of spot trades (fading over τ).
// What depends on the player's flows lives in typed arrays that `save` copies; everything else
// (colonies, depths, events, noise) is a pure function of the seeds and the epoch, recomputed
// on demand — so a loaded market continues exactly like the original.
import { BAL } from '@/content/balance';
import { ITEMS } from '@/content/items';
import { ITEM_IDS, N_ITEMS, itemIdx } from '@/content/registry';
import type { ItemDef } from '@/content/types';
import { makeColonies, tradeByItem, type Colony, type ItemTrade } from './colonies';
import { EventSchedule, firstTradeEvent, type EventWorld } from './events';
import {
  LN_RMAX, LN_RMIN, NOISE_NORM, OCT_G, OCT_L, askCents, bidCents, easeFactor, gauss, lnEquilibrium,
  lnRatioNoFlow, meanPath, noiseAt, noiseOffset, noiseSeedOf, rampAt, spotDepth, spotShock,
} from './pricing';
import type { MarketConfig, MarketEvent, Quote, TradeSide } from './types';

const M = BAL.market;
const DAY = 1440;
const NO = OCT_L.length;
/** A gap longer than this between settles restarts from the no-trade equilibrium (every τ has long passed). */
export const GAP_RESEED = 10 * DAY;

const def = (i: number): ItemDef => ITEMS[ITEM_IDS[i]!] as ItemDef;
/** Does the market price this item (registry index)? Every item with a depth Q and a value V. */
export const isTradable = (i: number): boolean => { const d = def(i); return d.depth > 0 && (d.value ?? 0) > 0; };
const clampLn = (v: number): number => (v < LN_RMIN ? LN_RMIN : v > LN_RMAX ? LN_RMAX : v);
/** Spot slippage ‰ as a depth scale (1 = normal, 0.7 with Market Sense); junk input means normal. */
const slipScale = (slip: number): number => (Number.isFinite(slip) ? Math.max(0, slip) / 1000 : 1);

/** The events that touched an epoch, gathered while settling. */
export interface Boundaries { started: MarketEvent[]; ended: MarketEvent[]; announced: MarketEvent[] }

export class MarketEngine {
  readonly seed: number;
  readonly founding: number;
  readonly colonies: readonly Colony[];
  readonly trade: readonly ItemTrade[];
  readonly schedule: EventSchedule;
  /** Tradable item indices (depth > 0), registry order; `tradable[i]` = 1 for them. */
  readonly items: readonly number[];
  readonly tradable = new Uint8Array(N_ITEMS);
  readonly V = new Float64Array(N_ITEMS);
  readonly Q = new Float64Array(N_ITEMS);
  readonly tier = new Uint8Array(N_ITEMS);
  readonly unique = new Uint8Array(N_ITEMS);
  private readonly noiseSeed: number;
  private readonly noiseOn: boolean;
  private readonly sigma = new Float64Array(N_ITEMS);
  private readonly spread = new Float64Array(N_ITEMS);
  private readonly tau = new Float64Array(N_ITEMS);
  /** easeFactor(blockMin, τ) and the per-epoch shock decay e^(−1/τ). */
  private readonly k5 = new Float64Array(N_ITEMS);
  private readonly decay = new Float64Array(N_ITEMS);
  /** Growth per day of the base supply and demand, after BAL.market.growthSkew. */
  private readonly gS = new Float64Array(N_ITEMS);
  private readonly gD = new Float64Array(N_ITEMS);
  private readonly emaKeep = Math.exp(-1 / M.tradeEmaMin);

  // ── state that depends on the player's flows (saved) ──────────────────────
  /** Last settled epoch: the current prices apply to epoch + 1. */
  epoch = 0;
  /** Epoch of the last equilibrium step, and epochs gathered in the current block. */
  heavyAt = 0;
  blockN = 0;
  readonly lnRf = new Float64Array(N_ITEMS);
  readonly lnEv = new Float64Array(N_ITEMS);
  readonly shock = new Float64Array(N_ITEMS);
  /** Items exported / imported so far in the block, and the last block's averages (items/min). */
  readonly sumX = new Float64Array(N_ITEMS);
  readonly sumM = new Float64Array(N_ITEMS);
  readonly lastX = new Float64Array(N_ITEMS);
  readonly lastM = new Float64Array(N_ITEMS);
  /** Net spot volume booked this epoch (items sold +, bought −), × slippage. */
  readonly booked = new Float64Array(N_ITEMS);
  /** Hourly mid prices (cents) per item, oldest first. */
  readonly hist: number[][] = Array.from({ length: N_ITEMS }, () => []);
  /** The player's trade per colony, centi-ocelles per minute, smoothed over tradeEmaMin. */
  readonly expCpm: Float64Array;
  readonly impCpm: Float64Array;

  // ── derived: pure functions of the above, the seeds and the epoch ─────────
  /** Base NPC supply and demand (items/min) and event multipliers at the last equilibrium step. */
  readonly S0 = new Float64Array(N_ITEMS);
  readonly D0 = new Float64Array(N_ITEMS);
  readonly eS = new Float64Array(N_ITEMS);
  readonly eD = new Float64Array(N_ITEMS);
  /** ln r* without and with the events, on the last block's flows. */
  readonly lnRs = new Float64Array(N_ITEMS);
  readonly lnRsEv = new Float64Array(N_ITEMS);
  /** Host colony of a demand event on the item (−1 none) and its multiplier: exports flow there. */
  readonly host = new Int32Array(N_ITEMS);
  readonly hostMult = new Float64Array(N_ITEMS);
  /** The current epoch's ln(P/V) and integer prices (cents). */
  readonly lnP = new Float64Array(N_ITEMS);
  readonly mid = new Int32Array(N_ITEMS);
  readonly bid = new Int32Array(N_ITEMS);
  readonly ask = new Int32Array(N_ITEMS);
  /** Noise lattice cache per item × octave: phase, cell, and the cell's two Gaussian values. */
  private readonly nOff = new Float64Array(N_ITEMS * NO);
  private readonly nK = new Float64Array(N_ITEMS * NO).fill(Number.NaN);
  private readonly nG0 = new Float64Array(N_ITEMS * NO);
  private readonly nG1 = new Float64Array(N_ITEMS * NO);
  private readonly byTier: number[][] = [[], [], [], [], []];

  constructor(cfg: MarketConfig) {
    if (!Number.isInteger(cfg.foundingEpoch) || (cfg.startEpoch !== undefined && !Number.isInteger(cfg.startEpoch))) {
      throw new RangeError('market: founding and start epochs must be integers (absolute world minutes)');
    }
    this.seed = cfg.worldSeed >>> 0;
    this.founding = cfg.foundingEpoch;
    this.noiseSeed = noiseSeedOf(this.seed);
    this.noiseOn = cfg.noise ?? true;
    this.colonies = makeColonies(this.seed);
    this.trade = tradeByItem(this.colonies);
    this.expCpm = new Float64Array(this.colonies.length);
    this.impCpm = new Float64Array(this.colonies.length);
    const items: number[] = [];
    for (let i = 0; i < N_ITEMS; i++) {
      if (!isTradable(i)) continue;
      const d = def(i);
      const uq = d.kind === 'unique';
      items.push(i);
      this.tradable[i] = 1;
      this.V[i] = d.value!;
      this.Q[i] = d.depth;
      this.tier[i] = d.tier;
      this.unique[i] = uq ? 1 : 0;
      this.sigma[i] = uq ? M.noiseSigma.unique : M.noiseSigma.common;
      this.spread[i] = uq ? M.spread.unique : M.spread.common;
      this.tau[i] = uq ? M.tauMin.unique : M.tauMin.common;
      this.k5[i] = easeFactor(M.blockMin, this.tau[i]!);
      this.decay[i] = Math.exp(-1 / this.tau[i]!);
      const tr = this.trade[i]!, mean = (tr.growthS + tr.growthD) / 2;
      this.gS[i] = mean + M.growthSkew * (tr.growthS - mean);
      this.gD[i] = mean + M.growthSkew * (tr.growthD - mean);
      this.byTier[d.tier]!.push(i);
      for (let o = 0; o < NO; o++) this.nOff[i * NO + o] = noiseOffset(this.noiseSeed, i, o);
    }
    this.items = items;
    const world: EventWorld = { tradable: items, uniques: items.filter((i) => this.unique[i]), trade: this.trade, colonies: this.colonies };
    const own = (cfg.firstTrade ?? true) ? [firstTradeEvent(this.founding, this.colonies)] : [];
    this.schedule = new EventSchedule(this.seed, world, own, cfg.events ?? true);
    this.reset(cfg.startEpoch ?? cfg.foundingEpoch);
  }

  /** Start afresh at epoch t0: no trade yet, prices at the no-trade equilibrium, history filled in. */
  reset(t0: number): void {
    this.epoch = t0 - 1;
    this.heavyAt = t0;
    this.blockN = 0;
    for (const a of [this.shock, this.sumX, this.sumM, this.lastX, this.lastM, this.booked, this.expCpm, this.impCpm]) a.fill(0);
    this.derive(t0);
    for (const i of this.items) {
      this.lnRf[i] = this.lnRs[i]!;
      this.lnEv[i] = this.lnRsEv[i]! - this.lnRs[i]!; // an event already running is priced in
    }
    this.price(t0);
    this.prefillHistory(t0);
  }

  /** Recompute the derived state after a restore: as it was right after the last settle. */
  rederive(): void {
    this.derive(this.heavyAt);
    this.price(this.epoch + 1);
  }

  // ── one epoch ─────────────────────────────────────────────────────────────

  /**
   * Settle epoch E (the one that just ended): its stream flows and spot trades (mu, by item
   * index), then the prices of E + 1. `slip` ‰ scales the `spot` volumes' depth (Market Sense).
   */
  settleOne(E: number, sold: ArrayLike<number> | undefined, bought: ArrayLike<number> | undefined, spot: ArrayLike<number> | undefined, slip: number, out: Boundaries): void {
    const t = E + 1;
    const keep = this.emaKeep;
    for (let c = 0; c < this.expCpm.length; c++) { this.expCpm[c] = this.expCpm[c]! * keep; this.impCpm[c] = this.impCpm[c]! * keep; }
    for (const i of this.items) {
      // The epoch's trade, valued at its own mid price (this.mid holds epoch E's prices).
      const x = Math.max(0, sold?.[i] ?? 0) / 1000, m = Math.max(0, bought?.[i] ?? 0) / 1000;
      if (x > 0) { this.sumX[i] = this.sumX[i]! + x; this.attribute(i, x * this.mid[i]!, 'sell'); }
      if (m > 0) { this.sumM[i] = this.sumM[i]! + m; this.attribute(i, m * this.mid[i]!, 'buy'); }
      let W = this.booked[i]!;
      const sp = spot?.[i] ?? 0;
      if (sp !== 0 && Number.isFinite(sp)) {
        W += (sp / 1000) * slipScale(slip);
        this.attribute(i, (Math.abs(sp) / 1000) * this.mid[i]!, sp > 0 ? 'sell' : 'buy');
      }
      // Shocks fade one epoch, then this epoch's spot volume lands on the price.
      let s = this.shock[i]! * this.decay[i]!;
      if (W !== 0) s = clampLn(s + spotShock(W, this.spotK(i)));
      this.shock[i] = Math.abs(s) < 1e-12 ? 0 : s;
      this.booked[i] = 0;
    }
    this.blockN++;
    if (t % M.blockMin === 0) this.heavy(t);
    this.price(t);
    if (t % M.historyEveryMin === 0) {
      for (const i of this.items) {
        const h = this.hist[i]!;
        h.push(this.mid[i]!);
        if (h.length > M.historyPoints) h.shift();
      }
    }
    this.schedule.boundaries(t, out.started, out.ended, out.announced);
    this.epoch = E;
  }

  /** The equilibrium step: block averages → r* (with and without events) → smoothing. */
  private heavy(t: number): void {
    const n = Math.max(1, this.blockN);
    for (const i of this.items) {
      this.lastX[i] = this.sumX[i]! / n;
      this.lastM[i] = this.sumM[i]! / n;
      this.sumX[i] = 0;
      this.sumM[i] = 0;
    }
    this.derive(t);
    const kEv = easeFactor(n, M.eventTauMin);
    for (const i of this.items) {
      const k = n === M.blockMin ? this.k5[i]! : easeFactor(n, this.tau[i]!);
      this.lnRf[i] = this.lnRf[i]! + k * (this.lnRs[i]! - this.lnRf[i]!);
      this.lnEv[i] = this.lnEv[i]! + kEv * (this.lnRsEv[i]! - this.lnRs[i]! - this.lnEv[i]!);
    }
    this.blockN = 0;
    this.heavyAt = t;
  }

  /** Depths, event multipliers and both equilibria at epoch t, on the last block's flows. */
  private derive(t: number): void {
    this.multipliers(t, this.eS, this.eD, true);
    const day = Math.max(0, (t - this.founding) / DAY), g = Math.min(day, M.growthCapDays);
    for (const i of this.items) {
      const [S, D] = this.base(i, day, g);
      const x = this.lastX[i]!, m = this.lastM[i]!;
      this.S0[i] = S;
      this.D0[i] = D;
      this.lnRs[i] = lnEquilibrium(S, D, x, m);
      this.lnRsEv[i] = this.eS[i] !== 1 || this.eD[i] !== 1 ? lnEquilibrium(S * this.eS[i]!, D * this.eD[i]!, x, m) : this.lnRs[i]!;
    }
  }

  /** Base NPC supply and demand (items/min) of item i on the colony's day `day` (growth days g). */
  private base(i: number, day: number, g: number): [number, number] {
    const ramp = rampAt(this.tier[i]!, day);
    return [this.Q[i]! * (1 + this.gS[i]! * g) * (M.rampSupply ? ramp : 1), this.Q[i]! * (1 + this.gD[i]! * g) * ramp];
  }

  /** Supply / demand multipliers of the events in progress at t (and, if asked, the demand hosts). */
  private multipliers(t: number, eS: Float64Array, eD: Float64Array, hosts: boolean): void {
    eS.fill(1);
    eD.fill(1);
    if (hosts) { this.host.fill(-1); this.hostMult.fill(1); }
    for (const e of this.schedule.active(t)) {
      const targets = e.item !== null ? [itemIdx(e.item)] : this.byTier[e.tier] ?? [];
      for (const i of targets) {
        if (!this.tradable[i]) continue;
        if (e.side === 'supply') eS[i] = eS[i]! * e.mult;
        else eD[i] = eD[i]! * e.mult;
        if (hosts && e.side === 'demand' && e.colony >= 0) { this.host[i] = e.colony; this.hostMult[i] = e.mult; }
      }
    }
  }

  /** The prices of epoch t from the state. */
  private price(t: number): void {
    for (const i of this.items) {
      const L = clampLn(this.lnRf[i]! + this.lnEv[i]! + this.shock[i]! + (this.noiseOn ? this.sigma[i]! * this.noise(i, t) : 0));
      const P = this.V[i]! * Math.exp(L);
      this.lnP[i] = L;
      this.mid[i] = Math.round(P * 100);
      const b = bidCents(P, this.spread[i]!);
      this.bid[i] = b;
      this.ask[i] = askCents(P, this.spread[i]!, b);
    }
  }

  /** Unit-σ noise of item i at t through the lattice cache (bit-identical to pricing.noiseAt). */
  private noise(i: number, t: number): number {
    let u = 0;
    for (let o = 0; o < NO; o++) {
      const j = i * NO + o;
      const x = (t + this.nOff[j]!) / OCT_L[o]!;
      const k = Math.floor(x), f = x - k;
      if (this.nK[j] !== k) {
        this.nG0[j] = this.nK[j] === k - 1 ? this.nG1[j]! : gauss(this.noiseSeed, i, o, k);
        this.nG1[j] = gauss(this.noiseSeed, i, o, k + 1);
        this.nK[j] = k;
      }
      const s = f * f * (3 - 2 * f), g0 = this.nG0[j]!;
      u += OCT_G[o]! * (g0 + (this.nG1[j]! - g0) * s);
    }
    return u * NOISE_NORM;
  }

  /** History for a fresh market: the last 24 hourly marks ≤ t0, priced as if no one traded. */
  private prefillHistory(t0: number): void {
    for (const i of this.items) this.hist[i]!.length = 0;
    const eS = new Float64Array(N_ITEMS), eD = new Float64Array(N_ITEMS);
    const step = M.historyEveryMin, last = Math.floor(t0 / step);
    for (let h = last - M.historyPoints + 1; h <= last; h++) {
      const th = h * step;
      this.multipliers(th, eS, eD, false);
      const day = Math.max(0, (th - this.founding) / DAY), g = Math.min(day, M.growthCapDays);
      for (const i of this.items) {
        const [S, D] = this.base(i, day, g);
        const L = clampLn(lnRatioNoFlow(S * eS[i]!, D * eD[i]!) + (this.noiseOn ? this.sigma[i]! * noiseAt(this.noiseSeed, i, th) : 0));
        this.hist[i]!.push(Math.round(this.V[i]! * Math.exp(L) * 100));
      }
    }
  }

  // ── spot trades and trade attribution ────────────────────────────────────

  /** Depth K (items) of a spot trade: κ minutes of the item's current NPC flow. */
  spotK(i: number): number {
    return spotDepth((this.S0[i]! + this.D0[i]!) / 2);
  }

  /** Price a spot trade of qtyMu along the depth curve, from the volume already booked this epoch. */
  quote(i: number, side: TradeSide, qtyMu: number, slip = 1000): Quote & { readonly w1: number } {
    if (!this.tradable[i] || !(qtyMu >= 0) || !Number.isFinite(qtyMu)) return { item: i, side, qtyMu, ok: false, totalCents: 0, unitCents: 0, factor: 1, shock: 1, w1: this.booked[i] ?? 0 };
    const K = this.spotK(i);
    // The marginal price stays within the bounds: factors relative to the epoch's mid.
    const P = this.V[i]! * Math.exp(this.lnP[i]!);
    const lo = Math.min(1, (M.rMin * this.V[i]!) / P), hi = Math.max(1, (M.rMax * this.V[i]!) / P);
    const w0 = this.booked[i]!, dw = (qtyMu / 1000) * slipScale(slip);
    const w1 = side === 'sell' ? w0 + dw : w0 - dw;
    const f = side === 'sell' ? meanPath(w0, w1, K, lo, hi) : meanPath(w1, w0, K, lo, hi);
    const base = side === 'sell' ? this.bid[i]! : this.ask[i]!;
    const total = side === 'sell' ? Math.floor((qtyMu * base * f) / 1000) : Math.ceil((qtyMu * base * f) / 1000);
    return {
      item: i, side, qtyMu, ok: true, totalCents: total, unitCents: Math.round(base * f), factor: f,
      shock: Math.exp(spotShock(w1, K) - spotShock(w0, K)), w1,
    };
  }

  /** Book a priced spot trade: it moves along the curve for later quotes, its shock lands at the next settle. */
  book(q: Quote & { readonly w1: number }): void {
    if (!q.ok) return;
    this.booked[q.item] = q.w1;
    // Attributed now (the epoch's EMA step is the settle's decay), at the money that changed hands.
    this.attribute(q.item, q.totalCents, q.side);
  }

  /** Credit one epoch's trade value (cents) to the colonies on the other side of it. */
  private attribute(i: number, cents: number, side: TradeSide): void {
    const a = (1 - this.emaKeep) * cents;
    if (!(a > 0)) return;
    const tr = this.trade[i]!;
    if (side === 'buy') {
      const src = tr.sources[0];
      if (src) this.impCpm[src.colony] = this.impCpm[src.colony]! + a;
      return;
    }
    // Exports go to the item's buyers by demand share; a hosted shortage draws its extra demand.
    const h = this.host[i]!, hm = this.hostMult[i]!;
    const base = h >= 0 && hm > 1 ? a / hm : a;
    if (h >= 0 && hm > 1) this.expCpm[h] = this.expCpm[h]! + (a - base);
    for (const b of tr.buyers) this.expCpm[b.colony] = this.expCpm[b.colony]! + base * b.share;
  }
}
