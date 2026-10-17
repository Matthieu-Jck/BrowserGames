// crier.ts — the Crier screen (M): « La Criée », the colony's window on the Crier Ring. Laid out by
// the panels' kit (D89; owner, 2026-10-15: « Plus clair, plus séparé », and show, don't tell):
// · the header: the purse as a big figure with its pace an hour, then the posts' facts as one bar of
//   icon chips (level, CrierBelt's fee, what a post lifts a minute, the lift's delay, posts built) —
//   the words on hover;
// · on the left, the orbital view (the planet, the other claims, the arcs of the player's trade;
//   its legend as two chips in its corner) over the Gazette: each event an item's icon (a rank's
//   badge for a boom), its kind as a coloured chip, ▲ / ▼ and its factor, the host colony, and its
//   countdown (announced) or what is left of it (running); the sentence on hover;
// · on the right, three tabs, each a scroll of the kit's section cards:
//   · Cours: a sticky column head, then one card per rank; one line per item — this minute's sell /
//     buy price, a 24 h sparkline, the trend and (Market Planning) the hour's forecast as coloured
//     arrow chips, the player's own flow as ↑ / ↓ chips, (Market Economy) the floor price in its own
//     light column, ⇄ to trade it; an item under an event gets a badge and a coloured rule;
//   · Échanges: one card per trade post (its icon, the minute's lift as a meter and what it earned in
//     its head; what it does in words on hover, not on the card) with its standing orders as one-line
//     rows (rate, cap, state chip, next delivery) and the form to add one — and on top, until it is
//     signed, CrierBelt's starter contract (D101): the ore's icon and count, its fixed price, its
//     delay, « Signer »; its order's row then carries a « Contrat » tag and what is left to buy; « Au comptant » (spot
//     trades with a live quote both ways); « En route » by item and post (how many, the soonest
//     arrival), not one line per shipment;
//   · Ce qui rapporte: the unlocked recipes by ◉ per raw tile-minute, best first, each with a bar on
//     that figure and a diverging bar on its margin per machine, its sparkline and what the player's
//     flow (or one machine's) does to the price.
// Every item named shows its icon (mention.ts), and every item choice is an item picker with icons
// (item-picker.ts, through trade-view's `tradeSelect`).
// Built once (again only on a locale or world change); refresh() (4 Hz while open) writes values
// through change-only setters, and each part rebuilds only when its signature changes (posts,
// orders, flights, unlocked recipes, events). Selects and inputs the player is using are never
// rebuilt or overwritten. The sim decides: this shows, and asks through the Sim's trade commands
// (refusals become toasts).
import { BAL } from '@/content/balance';
import { BUILDINGS } from '@/content/buildings';
import { RECIPES } from '@/content/recipes';
import { CRECIPES, ITEM_IDS } from '@/content/registry';
import type { BuildingDef, RecipeDef } from '@/content/types';
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { compact, duration, num, rate } from '@/i18n/format';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import type { BoardRow, ColonyView, ItemMarket, MarketEvent, MarketSnapshot } from '@/market/types';
import type { Atlas } from '@/render/art/atlas';
import { EPOCH, TPS } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { maxPosts, type ImportOrder } from '@/sim/trade';
import type { Ent } from '@/sim/types';
import { buildingIcon } from '../build-bar';
import { eventLine } from '../gazette';
import { glyph } from '../glyphs';
import { mark, meter, progressBar, section } from '../inspector/kit';
import type { ItemPicker } from '../item-picker';
import { itemMention, itemRef, nameOf, plain } from '../mention';
import {
  arrivalTick, feeText, minutes, nextArrival, nextBoundary, oc, ocNum, orderStateText, postFacts,
  refusalText, secondsTo, spct, TRADABLE, tradePerHour, tradeSelect, unitBuyCents, unitSellCents, type PostFacts,
} from '../trade-view';
import { orderCentsPerMin } from '@/sim/systems/trade';
import { OrbitView, type OrbitLift } from '../orbit/orbit-view';

export interface CrierHost {
  sim(): Sim;
  close(): void;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
  /** Cargo lifts since the last call (the shell collects them from the sim's trade events). */
  takeLifts(): OrbitLift[];
}

/** The screen's tabs (the Gazette is always in view, under the orbit). */
export type CrierTab = 'prices' | 'trade' | 'board';
const TABS: readonly CrierTab[] = ['prices', 'trade', 'board'];

/** Energy priced into « Ce qui rapporte »: coal as fuel, ≈ 0.04 ◉ per kW·min (design §6). */
const ENERGY_COST = BAL.market.energyCost;
/** The order form's defaults: items per minute, the max price over the ask (‰), the item (the cirque's copper vein is tired: what most colonies import first). */
const ORDER_N = 10;
const ORDER_OVER = 1100;
const ORDER_ITEM = 'copper_ore';
/** « En route »: lines (an item to a post) listed before « and n more ». */
const FLIGHT_MAX = 8;
/** Sparkline box (SVG user units = CSS px). */
const SPARK_W = 96;
const SPARK_H = 24;
/** A change smaller than this (a ratio) is flat: no sign, a → arrow. */
const FLAT = 0.005;

interface Ctx { readonly atlas: Atlas; readonly host: CrierHost }

/** What the player typed or picked: kept across a rebuild (a locale switch). */
interface OrderForm { item: string; n: string; max: string; touched: boolean; express?: boolean }
interface Forms { spotItem: string; spotN: string; readonly orders: Map<number, OrderForm> }

// ── small helpers ─────────────────────────────────────────────────────────────

const colonyName = (c: ColonyView | undefined): string => (c ? c.name[locale()] : '?');
/** Where goods in flight come from: another claim (a colony), or CrierBelt itself (−1: the starter contract, D101). */
const fromName = (colonies: readonly ColonyView[], c: number): string => (c < 0 ? t('crier.starter.from') : colonyName(colonies[c]));
/** The starter contract's fixed price (D101): « 2 ◉ », its cents shown only when it has some. */
const starterPrice = (): string => oc(BAL.starter.cents, false, BAL.starter.cents % 100 ? 2 : 0);
const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const round2 = (v: number): number => Math.round(v * 100) / 100;
const itemOf = (id: string | null): number => (id ? ITEM_IDS.indexOf(id as never) : -1);
/** The sign of a relative change, for `data-sign` (null: flat). */
const signOf = (d: number): string | null => (d > FLAT ? '+' : d < -FLAT ? '-' : null);
/** A relative change as an arrow and a signed percentage: « ↗ +18 % ». */
const moveText = (d: number): string => `${d > FLAT ? '↗' : d < -FLAT ? '↘' : '→'} ${spct(d)}`;

/** Write a control's value unless the player is using it. */
function sync(n: HTMLSelectElement | HTMLInputElement, v: string): void {
  if (document.activeElement !== n && n.value !== v) n.value = v;
}

/** A whole positive quantity typed by the player, or 0. */
function qty(s: string): number {
  const n = Math.floor(Number(s));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Ocelles typed by the player (« 4,40 », « 4.4 », « 1 200 ») → centi-ocelles; NaN when it is not a number. */
function parseOc(s: string): number {
  const v = Number(s.replace(/\s/g, '').replace(',', '.')); // \s covers the no-break spaces of Intl's groups
  return s.trim() && Number.isFinite(v) ? Math.round(v * 100) : NaN;
}

/** Esc leaves a field (a second Esc closes the screen); Enter runs `go` when given. */
const keys = (go?: () => void) => (e: KeyboardEvent): void => {
  if (e.key === 'Escape') (e.target as HTMLElement).blur();
  else if (e.key === 'Enter' && go) go();
};

/** Seconds of game time until an absolute epoch begins (tick precision inside the minute). */
const secsToEpoch = (sim: Sim, epoch: number): number => Math.max(0, (epoch - sim.absEpoch()) * (EPOCH / TPS) - (sim.tick % EPOCH) / TPS);

/** Does a world event move this item's price? (a tier boom moves its whole tier) */
const hits = (ev: MarketEvent, im: ItemMarket): boolean => (ev.item !== null ? ev.item === im.item : ev.tier === im.tier);

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/** The tabs' inked icons on a 16 × 16 board (drawn in the text's colour, crier.css `.cr-ticon`): a price line, ⇄, a podium of bars. */
const TAB_ICON: Readonly<Record<CrierTab, ReadonlyArray<readonly ['path' | 'rect', Record<string, string>]>>> = {
  prices: [['path', { d: 'M1.6 14.4h12.8' }], ['path', { d: 'M1.8 11.4l3.2-3.8 3 2.6 3.6-5.6 2.8 2.4' }]],
  trade: [['path', { d: 'M2.4 5.2h10.4M10.2 2.6l2.6 2.6-2.6 2.6' }], ['path', { d: 'M13.6 10.8H3.2M5.8 8.2l-2.6 2.6 2.6 2.6' }]],
  board: [['rect', { x: '1.8', y: '9', width: '3.4', height: '5.4', rx: '0.6' }], ['rect', { x: '6.3', y: '5.4', width: '3.4', height: '9', rx: '0.6' }], ['rect', { x: '10.8', y: '1.8', width: '3.4', height: '12.6', rx: '0.6' }]],
};
function tabIcon(k: CrierTab): SVGSVGElement {
  const s = svg('svg', { class: 'cr-ticon', viewBox: '0 0 16 16', 'aria-hidden': 'true' });
  for (const [tag, a] of TAB_ICON[k]) s.append(svg(tag, a));
  return s;
}

/** A building's plan icon (the trade post, the Heart) as a small canvas, or a kit mark when the atlas has none. */
const bIcon = (atlas: Atlas, def: string, px: number): HTMLElement => buildingIcon(atlas, def, px) ?? mark('cargo');

/** A 24 h price line: the hourly mids then the price now, over a dotted rule at the item's reference value. */
class Spark {
  readonly root: SVGSVGElement;
  private readonly ref = svg('line', { class: 'cr-spark-ref', x1: '0', x2: String(SPARK_W) });
  private readonly line = svg('polyline', { class: 'cr-spark-line' });
  private readonly dot = svg('circle', { class: 'cr-spark-dot', r: '2' });

  constructor() {
    this.root = svg('svg', { class: 'cr-spark', viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, width: String(SPARK_W), height: String(SPARK_H), 'aria-hidden': 'true' });
    this.root.append(this.ref, this.line, this.dot);
  }

  /** Prices in cents, oldest first; `ref` = the reference value V in cents. */
  set(points: readonly number[], ref: number): void {
    const n = points.length;
    if (!n) return;
    let lo = ref, hi = ref;
    for (const p of points) { if (p < lo) lo = p; if (p > hi) hi = p; }
    // A calm market is a calm line, not its last cent of noise blown up to full height.
    const span = Math.max(1, hi * 0.04);
    if (hi - lo < span) { const mid = (hi + lo) / 2; lo = mid - span / 2; hi = mid + span / 2; }
    const pad = 2.5, w = SPARK_W - 2 * pad, h = SPARK_H - 2 * pad;
    const x = (k: number): number => pad + (n > 1 ? (k / (n - 1)) * w : w);
    const y = (v: number): number => pad + (1 - (v - lo) / (hi - lo)) * h;
    setAttr(this.line, 'points', points.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
    const ry = y(ref).toFixed(1);
    setAttr(this.ref, 'y1', ry);
    setAttr(this.ref, 'y2', ry);
    setAttr(this.dot, 'cx', x(n - 1).toFixed(1));
    setAttr(this.dot, 'cy', y(points[n - 1]!).toFixed(1));
  }
}

/**
 * A diverging bar for a figure that may be negative (a margin): a rail with a mid rule, the
 * fill running right in turquoise for a gain, left in coral for a loss, scaled to `max`. The
 * fills are transforms, written only when they change.
 */
class DBar {
  readonly root: HTMLElement;
  private readonly neg = el('span.cr-dbar-neg');
  private readonly pos = el('span.cr-dbar-pos');
  private last = '';

  constructor() { this.root = el('span.cr-dbar', { 'aria-hidden': 'true' }, [this.neg, this.pos]); }

  set(v: number, max: number): void {
    const f = max > 0 ? Math.round(Math.min(1, Math.abs(v) / max) * 1000) / 1000 : 0;
    const key = `${v < 0 ? -f : f}`;
    if (key === this.last) return;
    this.last = key;
    this.neg.style.transform = `scaleX(${v < 0 ? f : 0})`;
    this.pos.style.transform = `scaleX(${v > 0 ? f : 0})`;
  }
}

// ── Prices ────────────────────────────────────────────────────────────────────

interface PriceRow {
  readonly idx: number;
  readonly node: HTMLElement;
  readonly stock: HTMLElement;
  readonly bid: HTMLElement;
  readonly ask: HTMLElement;
  readonly spark: Spark;
  readonly trend: HTMLElement;
  /** The player's flow: its cell, then what it sells (↑) and buys (↓) a minute. */
  readonly flow: HTMLElement;
  readonly sold: HTMLElement;
  readonly bought: HTMLElement;
  readonly badge: HTMLElement;
  /** Price Forecast (an_forecast): the mid price's move within the hour. */
  readonly fc: HTMLElement;
  /** Floor Prices (cm_floor): the bid under which the posts keep it. */
  readonly floor: HTMLInputElement;
}

class PricesPane {
  readonly root: HTMLElement;
  /** The column heads, sticky over the cards; the note on the prices on hover. */
  private readonly head: HTMLElement;
  private readonly rows: PriceRow[] = [];

  constructor(private readonly ctx: Ctx, snap: MarketSnapshot, go: (item: number) => void) {
    this.head = el('div.cr-row.cr-prow.cr-headrow', {}, [
      el('span', {}, t('crier.col.item')),
      el('span.cr-num', {}, t('crier.col.stock')),
      el('span.cr-num', { title: t('crier.col.sell.tip') }, t('crier.col.sell')),
      el('span.cr-num', { title: t('crier.col.buy.tip') }, t('crier.col.buy')),
      el('span.cr-mid', {}, t('crier.col.spark')),
      el('span.cr-mid', {}, t('crier.col.trend')),
      el('span.cr-mid.cr-fc-cell', { title: t('crier.forecast.tip') }, t('crier.col.forecast')),
      el('span', { title: t('crier.col.flow.tip') }, t('crier.col.flow')),
      el('span.cr-mid.cr-floor-cell', { title: t('crier.floor.tip') }, t('crier.col.floor')),
      el('span'),
    ]);
    // One card per rank, its items in registry order.
    const tiers = new Map<number, HTMLElement[]>();
    for (const im of [...snap.items].sort((a, b) => a.tier - b.tier || a.idx - b.idx)) {
      let list = tiers.get(im.tier);
      if (!list) { list = []; tiers.set(im.tier, list); }
      list.push(this.row(snap, im, go));
    }
    const cards = [...tiers].map(([n, rows]) => {
      const s = section({ sec: `tier-${n}`, title: () => t('crier.tier', { n }) }, [el('div.cr-rows', {}, rows)]);
      s.classList.add('cr-tiercard');
      return s;
    });
    this.root = el('div.cr-pane.cr-prices', { 'data-crier-pane': 'prices' }, [this.head, ...cards]);
  }

  private row(snap: MarketSnapshot, im: ItemMarket, go: (item: number) => void): HTMLElement {
    // Where it comes from (nearest first, with their delay) and who wants it: fixed for the world.
    const from = im.sources.slice(0, 3).map((s) => `${colonyName(snap.colonies[s.colony])} (${minutes(s.delayMin)})`).join(', ');
    const wanted = snap.colonies.filter((c) => c.needs.includes(im.item)).slice(0, 4).map(colonyName).join(', ');
    const title = [from && t('crier.sources', { list: from }), wanted && t('crier.buyers', { list: wanted })].filter(Boolean).join('\n');
    const stock = el('span.cr-num.cr-stock'), bid = el('span.cr-num.cr-bid'), ask = el('span.cr-num.cr-ask');
    const spark = new Spark(), trend = el('span.cr-move'), badge = el('span.cr-badge');
    const fc = el('span.cr-move.cr-fc', { title: t('crier.forecast.tip') });
    const sold = el('span.cr-flowchip', { 'data-dir': 'out' }), bought = el('span.cr-flowchip', { 'data-dir': 'in' });
    const flow = el('span.cr-flow', { title: t('crier.col.flow.tip') }, [sold, bought]);
    const floor = el<'input'>('input.cr-input.cr-input-floor', {
      type: 'text', inputmode: 'decimal', placeholder: '—', title: t('crier.floor.tip'), 'aria-label': t('crier.col.floor'), 'data-floor': im.item,
      onchange: () => {
        const v = floor.value.trim() === '' ? null : parseOc(floor.value);
        if (!this.ctx.host.sim().setFloorPrice(im.item, v !== null && v > 0 ? v : null) && v !== null) floor.value = '';
      },
    });
    const node = el('div.cr-row.cr-prow', { 'data-price-item': im.item }, [
      el('span.cr-item', { title }, [
        el('span.cr-name', {}, [itemMention(im.idx), im.unique ? el('span.cr-uniq', { title: t('crier.unique') }, ' ✦') : null]),
        badge,
      ]),
      stock, bid, ask, el('span.cr-mid', {}, [spark.root]), el('span.cr-mid', {}, [trend]),
      el('span.cr-mid.cr-fc-cell', {}, [fc]), flow, el('span.cr-floor-cell', {}, [floor]),
      el('button.cr-go', { title: t('crier.go'), 'aria-label': t('crier.go'), 'data-trade-item': im.item, onclick: () => go(im.idx) }, '⇄'),
    ]);
    this.rows.push({ idx: im.idx, node, stock, bid, ask, spark, trend, flow, sold, bought, badge, fc, floor });
    return node;
  }

  /** The forecast, once a minute (a copy of the market run an hour on: a few ms). */
  private fcEpoch = -1;
  private fcMid: number[] | null = null;

  refresh(sim: Sim, snap: MarketSnapshot, items: ReadonlyMap<number, ItemMarket>, f: PostFacts): void {
    setAttr(this.head, 'title', t('crier.prices.note', { fee: feeText(f.fee) }));
    const forecast = sim.mods.flags.has('forecast'), floors = sim.mods.flags.has('floorPrices');
    if (forecast && this.fcEpoch !== sim.absEpoch()) {
      this.fcEpoch = sim.absEpoch();
      const p = sim.priceForecast(60);
      this.fcMid = p ? p.bid.map((b, i) => (b + p.ask[i]!) / 2) : null;
    }
    // The optional columns: there only once researched (crier.css lays the grid by them).
    const fcOn = forecast && !!this.fcMid;
    setAttr(this.root, 'data-fc', fcOn ? '' : null);
    setAttr(this.root, 'data-floors', floors ? '' : null);
    const { active, announced } = snap.events;
    for (const r of this.rows) {
      r.floor.hidden = !floors;
      if (floors && document.activeElement !== r.floor) {
        const fl = sim.trade.floors.get(r.idx);
        const v = fl ? ocNum(fl) : '';
        if (r.floor.value !== v) r.floor.value = v;
        setAttr(r.floor, 'data-set', fl ? '' : null);
      }
      const im = items.get(r.idx);
      if (!im) continue;
      if (fcOn) {
        const now = (im.bid + im.ask) / 2, then = this.fcMid![r.idx] ?? now;
        const d = now > 0 ? then / now - 1 : 0;
        setText(r.fc, moveText(d));
        setAttr(r.fc, 'data-sign', signOf(d));
      }
      const held = Math.floor((sim.stock[r.idx] ?? 0) / 1000);
      setText(r.stock, held > 0 ? compact(held) : '—');
      setAttr(r.stock, 'data-zero', held > 0 ? null : '');
      setText(r.bid, ocNum(im.bid));
      setText(r.ask, ocNum(im.ask));
      setAttr(r.bid, 'title', t('crier.afterFee', { v: oc(unitSellCents(sim, r.idx)) }));
      setAttr(r.ask, 'title', t('crier.afterFee', { v: oc(unitBuyCents(sim, r.idx)) }));
      r.spark.set([...im.history, im.mid], im.value * 100);
      const sign = signOf(im.trend);
      setText(r.trend, moveText(im.trend));
      setAttr(r.trend, 'data-sign', sign);
      setAttr(r.node, 'data-trend', sign);
      const out = im.flow.sold >= 0.05, inn = im.flow.bought >= 0.05;
      setText(r.sold, out ? `↑ ${rate(im.flow.sold)}` : '');
      setText(r.bought, inn ? `↓ ${rate(im.flow.bought)}` : '');
      setAttr(r.flow, 'data-none', out || inn ? null : '');
      // The first event on it: running first, else announced (with its countdown).
      const now = active.find((ev) => hits(ev, im));
      const soon = now ? undefined : announced.find((ev) => hits(ev, im));
      const ev = now ?? soon;
      setAttr(r.node, 'data-event', now ? 'on' : soon ? 'soon' : null);
      setText(r.badge, !ev ? '' : now
        ? t('crier.badge', { kind: t(`crier.kind.${ev.kind}` as MsgKey), mult: round2(ev.mult) })
        : t('crier.badge.soon', { kind: t(`crier.kind.${ev.kind}` as MsgKey), d: duration(secsToEpoch(sim, ev.start)) }));
      setAttr(r.badge, 'title', ev ? plain(capFirst(eventLine(ev, snap.colonies))) : null);
    }
  }
}

// ── Trade: posts, spot, goods in flight ───────────────────────────────────────

/** One trade post: the minute's lift in its head, its standing orders and the form to add one. */
/**
 * The starter contract's state (D101): an order's holds (its exit linked to nothing, a full
 * container), but « short of ocelles » and its tip at its own fixed price, not the market's.
 */
function starterStateText(sim: Sim, o: ImportOrder): ReturnType<typeof orderStateText> {
  const st = orderStateText(sim, o);
  if (st.state === 'outlet' || st.state === 'full' || st.state === 'fulfilled') return st;
  const price = starterPrice();
  const state = sim.credits < BAL.starter.cents ? 'poor' : 'active';
  return { state, text: t(`crier.order.${state}` as MsgKey), why: state === 'poor' ? t('crier.order.poor.tip', { cost: price }) : t('crier.starter.active.tip', { price }) };
}

class PostCard {
  readonly root: HTMLElement;
  /** The head's figures (the minute's lift, what it earned), the minute in words on hover. */
  private readonly act: HTMLElement;
  private readonly lift = meter();
  private readonly earn = el('span.cr-earn');
  private readonly ordersCount = el('span.cr-count');
  private readonly ordersEl = el('div.cr-orders');
  /** `left`: the starter contract's « reste n » and its bar (D101), in place of the cap; `cost`: what the order costs a minute now (D101). */
  private orders: Array<{ o: ImportOrder; state: HTMLElement; eta: HTMLElement; etaT: HTMLElement; left: HTMLElement | null; bar: HTMLElement | null; cost: HTMLElement }> = [];
  private ordersSig: string | null = null;
  /** CrierBelt's starter contract (D101), on top of the card until it is signed (on this post or another); then gone. */
  private readonly starter: HTMLElement;
  private readonly subhead: HTMLElement;
  private readonly item: ItemPicker;
  private readonly n: HTMLInputElement;
  private readonly max: HTMLInputElement;
  /** Under the form: the item's ask, when a purchase now would land, from where (chips; the sentence on hover). */
  private readonly hint: HTMLElement;
  private readonly hAsk = el('b');
  private readonly hEta = el('b');
  private readonly hFrom = el('b');
  private readonly form: OrderForm;
  /** Express Freight (cm_express): half the delay, a quarter dearer. */
  private readonly expressBox: HTMLInputElement;
  private readonly express: HTMLElement;

  constructor(private readonly ctx: Ctx, readonly id: number, forms: Forms) {
    let form = forms.orders.get(id);
    if (!form) {
      form = { item: TRADABLE.includes(itemOf(ORDER_ITEM)) ? ORDER_ITEM : ITEM_IDS[TRADABLE[0]!]!, n: String(ORDER_N), max: '', touched: false };
      forms.orders.set(id, form);
    }
    this.form = form;
    const add = (): void => this.addOrder();
    this.item = tradeSelect(itemOf(form.item), null, (v) => { if (v) this.pick(v); }, { 'data-order-item': String(id) }, ctx.host.sim(), t('crier.order.item'));
    this.n = el<'input'>('input.cr-input.cr-input-n', {
      type: 'number', min: '1', step: '1', value: form.n, 'data-order-n': String(id), title: t('crier.order.n'),
      oninput: () => { this.form.n = this.n.value; }, onkeydown: keys(add),
    });
    this.expressBox = el<'input'>('input', { type: 'checkbox', 'data-order-express': String(id), onchange: () => { this.form.express = this.expressBox.checked; } });
    this.expressBox.checked = !!form.express;
    this.express = el('label.cr-field.cr-express', { hidden: '', title: t('crier.order.express.tip') }, [this.expressBox, el('span', {}, t('crier.order.express'))]);
    this.max = el<'input'>('input.cr-input.cr-input-oc', {
      type: 'text', inputmode: 'decimal', value: form.max, 'data-order-max': String(id), title: t('crier.order.max'),
      oninput: () => { this.form.max = this.max.value; this.form.touched = true; }, onkeydown: keys(add),
    });
    this.hint = el('div.cr-hint.cr-order-hint', {}, [
      el('span.cr-hchip', {}, [tabIcon('prices'), this.hAsk]),
      el('span.cr-hchip', {}, [mark('flight'), this.hEta]),
      el('span.cr-hchip', {}, [glyph('flagNeighbour'), this.hFrom]),
    ]);
    this.act = el('span.cr-post-act', {}, [this.lift.root, this.earn]);
    this.starter = this.starterOffer();
    this.subhead = el('div.cr-subhead', {}, [mark('order'), el('span.lettering', {}, t('crier.orders')), this.ordersCount]);
    this.root = section({
      sec: 'post', title: () => t('crier.post.name', { n: id }), icon: bIcon(ctx.atlas, 'trade_post', 24), aside: this.act,
      tip: () => t('crier.post.ribbons.tip', { fee: feeText(ctx.host.sim().mods.tradeFee) }),
    }, [
      this.starter,
      this.subhead,
      this.ordersEl,
      el('div.cr-order-new', {}, [
        el('div.cr-order-form', {}, [
          this.item.root,
          el('label.cr-field', {}, [this.n, el('span', {}, t('crier.order.perMin'))]),
          el('label.cr-field', { title: t('crier.order.max') }, [el('span.cr-le', {}, '≤'), this.max, el('span', {}, '◉')]),
          this.express,
          el('button.btn.primary.cr-add', { 'data-order-add': String(id), onclick: add }, t('crier.order.add')),
        ]),
        this.hint,
      ]),
    ]);
    this.root.classList.add('cr-post');
    this.root.setAttribute('data-post', String(id));
  }

  /**
   * The starter contract's offer (D101), shown, not told: the ore's icon and how many, its fixed
   * price and its delay as chips, the title in lettering, one short line, « Signer »; the deal in
   * words on hover.
   */
  private starterOffer(): HTMLElement {
    const S = BAL.starter, it = itemOf(S.item), id = this.id;
    const price = starterPrice(), d = minutes(S.delayMin);
    return el('div.cr-starter', { 'data-starter': String(id), title: t('crier.starter.tip', { n: S.n, item: nameOf(it), price, rate: rate(S.perMin), d }) }, [
      el('span.cr-starter-n', { title: t('crier.starter.n.tip', { n: S.n, rate: rate(S.perMin) }) }, [itemMention(it, { name: false, big: true }), el('b', {}, num(S.n))]),
      el('div.cr-starter-text', {}, [
        el('div.cr-starter-head', {}, [
          el('span.lettering', {}, t('crier.starter.title')),
          el('span.cr-hchip', { title: t('crier.starter.price.tip') }, [el('b', {}, ocNum(S.cents, false, S.cents % 100 ? 2 : 0)), el('span.cr-coin', {}, '◉')]),
          el('span.cr-hchip', { title: t('crier.starter.delay.tip', { d }) }, [mark('flight'), el('b', {}, d)]),
          // Its allowance, whole until signed (D101: a small bar, the order's row empties it), and what it costs a minute.
          el('span.cr-hchip', { title: t('crier.starter.n.tip', { n: S.n, rate: rate(S.perMin) }) }, [el('span.cr-o-bar', {}, el('i', { style: 'width:100%' }))]),
          el('span.cr-o-cost', { title: t('crier.order.cost.tip') }, t('crier.order.cost', { v: oc(S.perMin * S.cents) })),
        ]),
        el('small.cr-starter-line', {}, t('crier.starter.line')),
      ]),
      el('button.btn.primary.cr-starter-take', { 'data-starter-take': String(id), onclick: () => this.takeStarter() }, t('crier.starter.take')),
    ]);
  }

  private takeStarter(): void {
    const S = BAL.starter;
    const r = this.ctx.host.sim().takeStarter(this.id);
    if (typeof r === 'string') { this.ctx.host.notify('bad', refusalText(r)); return; }
    this.ctx.host.notify('good', t('crier.starter.signed', { n: S.n, item: itemRef(S.item), price: starterPrice() }));
  }

  /** A new item in the order form: its max price goes back to the default (the ask + 10 %). */
  private pick(id: string): void {
    this.form.item = id;
    this.form.touched = false;
    this.defaultMax(this.ctx.host.sim(), true);
  }

  private defaultMax(sim: Sim, force = false): void {
    if (this.form.touched && !force) return;
    const ask = sim.prices.ask[itemOf(this.form.item)] ?? 0;
    const v = ask > 0 ? ocNum(Math.ceil((ask * ORDER_OVER) / 1000)) : '';
    this.form.max = v;
    if (force) this.max.value = v;
    else sync(this.max, v);
  }

  private addOrder(): void {
    const sim = this.ctx.host.sim();
    const it = itemOf(this.form.item);
    const n = Number(this.n.value), max = parseOc(this.max.value);
    const r = sim.addImport(this.id, this.form.item, n, max, !!this.form.express && sim.mods.flags.has('expressFreight'));
    if (typeof r === 'string') { this.ctx.host.notify('bad', refusalText(r)); return; }
    this.ctx.host.notify('good', t('crier.order.placed', { rate: rate(n), item: itemRef(it), max: oc(max) }));
  }

  /** One line per order: the item, its rate, its cap, its state, the next delivery (or purchase), ✕. */
  private buildOrders(mine: readonly ImportOrder[]): void {
    this.orders = [];
    const rows = mine.map((o) => {
      const state = el('span.cr-state'), etaT = el('span');
      const eta = el('span.cr-o-eta', {}, [mark('flight'), mark('order'), etaT]);
      // The starter contract (D101): its tag, its fixed price, what it has left as a figure and a
      // bar in place of a cap (live); fulfilled, it stops — « Continuer au prix du marché » or
      // « Arrêter » (the default) in place of its state and arrival.
      const starter = o.starter !== undefined, done = starter && (o.starter ?? 0) <= 0;
      const bar = starter ? el('i') : null;
      const left = starter ? el('span.cr-o-max.cr-o-left') : null;
      const cost = el('span.cr-o-cost', { 'data-order-cost': String(o.id) });
      this.orders.push({ o, state, eta, etaT, left, bar, cost });
      return el('div.cr-order', { 'data-order': String(o.id), 'data-order-starter': starter ? (done ? 'done' : '') : null }, [
        el('span.cr-o-item', {}, [
          itemMention(o.item),
          o.express ? el('span.cr-tag', { title: t('crier.order.express.tip') }, t('crier.order.express')) : null,
          // On a line of its own under the ore (the row is narrow): « Contrat de départ · prix fixe 2 ◉ ».
          starter ? el('span.cr-tag.cr-tag-starter', { title: t('crier.starter.tag.tip', { price: starterPrice() }) }, `${t('crier.starter.title')} ${starterPrice()}`) : null,
        ]),
        el('span.cr-o-rate', { title: t('crier.order.n') }, rate(o.perMin)),
        left ? el('span.cr-o-allow', {}, [left, el('span.cr-o-bar', {}, bar)]) : el('span.cr-o-max', { title: t('crier.order.max') }, `≤ ${oc(o.maxCents)}`),
        cost,
        ...(done ? [el('span.cr-o-acts', {}, [
          el('button.btn.cr-continue', { 'data-starter-go': String(o.id), onclick: () => this.continueStarter(o) }, t('crier.starter.continue')),
          el('button.btn.primary.cr-stop', { 'data-starter-stop': String(o.id), onclick: () => this.cancel(o) }, t('crier.starter.stop')),
        ])] : [el('span.cr-o-state', {}, [state]), eta]),
        el('button.cr-x', { title: t('crier.order.cancel'), 'aria-label': t('crier.order.cancel'), 'data-order-cancel': String(o.id), onclick: () => this.cancel(o) }, '✕'),
      ]);
    });
    this.ordersEl.replaceChildren(...(rows.length ? rows : [el('p.cr-empty', {}, t('crier.orders.none'))]));
  }

  private cancel(o: ImportOrder): void {
    if (this.ctx.host.sim().cancelImport(o.id)) this.ctx.host.notify('info', t('crier.order.cancelled', { item: itemRef(o.item) }));
  }

  /** The fulfilled starter contract continued at the market's price (D101): one logged click. */
  private continueStarter(o: ImportOrder): void {
    const sim = this.ctx.host.sim();
    if (sim.continueStarter(o.id)) this.ctx.host.notify('info', t('crier.starter.continued', { item: itemRef(o.item), cost: oc(orderCentsPerMin(sim, o)) }));
  }

  refresh(sim: Sim, _e: Ent, f: PostFacts, colonies: readonly ColonyView[]): void {
    // The minute that ended: what it lifted against what it may, and what that brought.
    const a = sim.trade.activity.get(this.id);
    const last = a && a.epoch === sim.absEpoch() - 1 ? a : null;
    const used = last ? Math.round((last.soldMu + last.boughtMu) / 1000) : 0;
    this.lift.set(used, f.perMin, used > 0 ? 'good' : 'idle', `${num(used)}/${num(f.perMin)}`);
    setText(this.earn, last && last.cents !== 0 ? oc(last.cents, true) : '');
    setAttr(this.earn, 'data-sign', last ? signOf(last.cents) : null);
    setAttr(this.act, 'title', last
      ? t('crier.post.last', { used, max: f.perMin, cents: oc(last.cents, true) })
      : t('crier.post.idle'));

    // The starter contract's offer (D101): until it is signed, on this post or another — then gone.
    const offer = !sim.trade.starterTaken;
    if (offer !== (this.starter.parentNode !== null)) { if (offer) this.subhead.before(this.starter); else this.starter.remove(); }

    // Standing orders: rows when the set changes; state and next delivery live.
    const mine = sim.trade.orders.filter((o) => o.post === this.id);
    // The starter contract's phase too (D101): running, fulfilled, continued as an ordinary order.
    const sig = mine.map((o) => `${o.id}${o.starter === undefined ? '' : o.starter > 0 ? 's' : 'f'}`).join('.');
    if (sig !== this.ordersSig) { this.ordersSig = sig; this.buildOrders(mine); }
    setText(this.ordersCount, `${sim.trade.orders.length}/${f.orders}`);
    for (const r of this.orders) {
      const st = r.o.starter !== undefined ? starterStateText(sim, r.o) : orderStateText(sim, r.o);
      if (r.left) {
        const n = Math.ceil((r.o.starter ?? 0) / 1000);
        setText(r.left, t('crier.starter.left', { n }));
        setAttr(r.left, 'title', t('crier.starter.left.tip', { n, price: starterPrice() }));
        if (r.bar) setStyle(r.bar, 'width', `${Math.round((100 * n) / BAL.starter.n)}%`);
      }
      // What it costs a minute now (D101; the purse's breakdown reads the same: `orderCentsPerMin`):
      // nothing while it holds, the reason in its state chip.
      const cents = orderCentsPerMin(sim, r.o);
      setText(r.cost, cents > 0 ? t('crier.order.cost', { v: oc(cents) }) : t('crier.order.cost.none'));
      setAttr(r.cost, 'data-zero', cents > 0 ? null : '');
      setAttr(r.cost, 'title', t('crier.order.cost.tip'));
      if (r.o.starter !== undefined && r.o.starter <= 0) {
        const go = r.cost.parentElement?.querySelector('[data-starter-go]');
        if (go) setAttr(go as HTMLElement, 'title', t('crier.starter.continue.tip', { price: oc(unitBuyCents(sim, r.o.item)), cost: oc(r.o.perMin * unitBuyCents(sim, r.o.item)) }));
      }
      setText(r.state, st.text);
      setAttr(r.state, 'data-state', st.state);
      setAttr(r.state, 'data-order-state', st.state);
      setAttr(r.state, 'title', st.why);
      const at = nextArrival(sim, this.id, r.o.item);
      const d = at !== null ? duration(secondsTo(sim, at)) : st.state === 'active' ? duration(secondsTo(sim, nextBoundary(sim))) : '';
      setText(r.etaT, d);
      setAttr(r.eta, 'data-k', at !== null ? 'flight' : d ? 'next' : null);
      setAttr(r.eta, 'title', at !== null ? t('crier.order.eta', { d }) : d ? t('crier.order.next', { d }) : null);
    }

    this.express.hidden = !sim.mods.flags.has('expressFreight');
    // The form: its picker and max follow the sim unless the player is at them.
    this.item.set(itemOf(this.form.item));
    this.defaultMax(sim);
    const it = itemOf(this.form.item);
    setAttr(this.hint, 'hidden', it < 0 ? '' : null);
    if (it < 0) return;
    const src = sim.market.sources(it)[0];
    const ask = oc(sim.prices.ask[it] ?? 0), d = duration(secondsTo(sim, arrivalTick(sim, it, nextBoundary(sim)))), colony = colonyName(src ? colonies[src.colony] : undefined);
    setText(this.hAsk, ask);
    setText(this.hEta, `≈ ${d}`);
    setText(this.hFrom, colony);
    setAttr(this.hint, 'title', t('crier.order.hint', { ask, d, colony }));
  }
}

/** One side of the spot quote: its box, the total, the unit price, the lasting mark on the price, why it cannot be done. */
interface Quote { box: HTMLElement; total: HTMLElement; sub: HTMLElement; shock: HTMLElement; why: HTMLElement }

/** Spot trades: an item, a quantity, the live quote both ways, Sell / Buy. */
class SpotBox {
  readonly root: HTMLElement;
  private readonly sel: ItemPicker;
  readonly n: HTMLInputElement;
  /** What the Hearth holds of it and its two prices, as three small figures (the sentence on hover). */
  private readonly have: HTMLElement;
  private readonly haveN = el('b');
  private readonly haveBid = el('b');
  private readonly haveAsk = el('b');
  private readonly q: Record<'sell' | 'buy', Quote>;

  constructor(private readonly ctx: Ctx, private readonly forms: Forms) {
    this.sel = tradeSelect(itemOf(forms.spotItem), null, (v) => { if (v) { forms.spotItem = v; this.refresh(ctx.host.sim()); } }, { 'data-spot-item': '' }, ctx.host.sim(), t('crier.spot.item'));
    this.n = el<'input'>('input.cr-input.cr-input-n', {
      type: 'number', min: '1', step: '1', value: forms.spotN, 'data-spot-n': '', title: t('crier.spot.n'),
      oninput: () => { forms.spotN = this.n.value; this.refresh(ctx.host.sim()); }, onkeydown: keys(),
    });
    const preset = (key: string, label: string, v: () => number): HTMLElement => el('button.btn.cr-preset', {
      'data-spot-preset': key,
      onclick: () => { const x = v(); if (x > 0) { this.n.value = String(x); forms.spotN = this.n.value; this.refresh(ctx.host.sim()); } },
    }, label);
    const side = (s: 'sell' | 'buy'): Quote => {
      const total = el('strong.cr-q-total'), sub = el('small.cr-sub'), shock = el('span.cr-move.cr-shock'), why = el('small.cr-why');
      const btn = el('button.btn.cr-q-btn', { cls: s === 'buy' ? 'primary' : null, [`data-spot-${s}`]: '', onclick: () => this.trade(s) }, t(s === 'sell' ? 'crier.spot.sell' : 'crier.spot.buy'));
      const head = el('span.cr-q-head', {}, [total, el('span.cr-coin', {}, '◉'), shock]);
      return { box: el('div.cr-quote', { 'data-spot-quote': s }, [el('div.cr-q-text', {}, [head, sub, why]), btn]), total, sub, shock, why };
    };
    this.q = { sell: side('sell'), buy: side('buy') };
    const cell = (v: HTMLElement, cap: string, icon?: HTMLElement): HTMLElement =>
      el('div.cr-have-cell', {}, [el('b.cr-have-v', {}, [icon ?? null, v]), el('small', {}, cap)]);
    this.have = el('div.cr-have', {}, [
      cell(this.haveN, t('crier.col.stock'), bIcon(ctx.atlas, 'hearth', 18)),
      cell(this.haveBid, t('crier.col.sell')),
      cell(this.haveAsk, t('crier.col.buy')),
    ]);
    this.root = section({ sec: 'spot', title: () => t('crier.spot'), icon: el('span.cr-coin', {}, '◉'), tip: () => t('crier.spot.help') }, [
      el('div.cr-spot-pick', {}, [this.sel.root, this.n]),
      el('div.cr-presets', {}, [
        preset('10', num(10), () => 10), preset('100', num(100), () => 100), preset('1000', num(1000), () => 1000),
        preset('all', t('crier.spot.all'), () => Math.floor((this.ctx.host.sim().stock[itemOf(forms.spotItem)] ?? 0) / 1000)),
      ]),
      this.have,
      this.q.sell.box, this.q.buy.box,
    ]);
    this.root.classList.add('cr-spot');
    this.root.setAttribute('data-crier-section', 'spot');
  }

  /** Put an item in the form (the Prices tab's ⇄). */
  select(id: string): void {
    this.forms.spotItem = id;
    this.sel.set(itemOf(id));
  }

  private trade(side: 'sell' | 'buy'): void {
    const sim = this.ctx.host.sim();
    const n = qty(this.n.value), id = this.forms.spotItem;
    const r = sim.spotTrade(id, side, n);
    if ('refused' in r) { this.ctx.host.notify('bad', refusalText(r.refused)); return; }
    const name = itemRef(id);
    if (side === 'sell') this.ctx.host.notify('good', t('crier.spot.sold', { n, item: name, cents: oc(r.cents) }));
    else {
      const ship = sim.trade.inflight[sim.trade.inflight.length - 1];
      this.ctx.host.notify('good', t('crier.spot.bought', { n, item: name, cents: oc(-r.cents), d: duration(ship ? secondsTo(sim, ship.arrive) : 0) }));
    }
    this.refresh(sim);
  }

  /** `posts`: the built trade posts, when the caller has them at hand. */
  refresh(sim: Sim, posts: readonly Ent[] = sim.tradePosts()): void {
    this.sel.set(itemOf(this.forms.spotItem));
    sync(this.n, this.forms.spotN);
    const it = itemOf(this.forms.spotItem);
    if (it < 0) return;
    const n = qty(this.n.value);
    const held = Math.floor((sim.stock[it] ?? 0) / 1000);
    const post = posts[0];
    const bid = oc(sim.prices.bid[it] ?? 0), ask = oc(sim.prices.ask[it] ?? 0);
    setText(this.haveN, compact(held));
    setText(this.haveBid, bid);
    setText(this.haveAsk, ask);
    setAttr(this.have, 'title', t('crier.spot.have', { n: held, bid, ask }));
    for (const s of ['sell', 'buy'] as const) {
      const q = this.q[s];
      const r = n > 0 ? sim.quoteSpot(it, s, n) : null;
      if (!r || !r.ok) {
        setText(q.total, '—'); setText(q.sub, ''); setText(q.shock, ''); setText(q.why, n > 0 ? refusalText('not_tradable') : refusalText('bad_amount'));
        setAttr(q.box, 'data-warn', '');
        continue;
      }
      setText(q.total, ocNum(s === 'sell' ? r.cents : -r.cents, true));
      setText(q.sub, t('crier.spot.unit', { unit: oc(r.unitCents), factor: round2(r.factor) }));
      // The lasting mark on the price, when the trade is big enough to leave one.
      const dent = r.shock - 1, marked = Math.abs(dent) >= FLAT;
      setText(q.shock, marked ? moveText(dent) : '');
      setAttr(q.shock, 'data-sign', marked ? signOf(dent) : null);
      setAttr(q.shock, 'title', marked ? t('crier.spot.shock', { pct: spct(dent) }) : null);
      const why = !post ? refusalText('no_post')
        : s === 'sell' && held < n ? refusalText('stock')
          : s === 'buy' && sim.credits < r.cents ? refusalText('unaffordable') : '';
      setText(q.why, why || (s === 'sell' ? t('crier.spot.fromHearth')
        : t('crier.spot.deliver', { n: post!.id, d: duration(secondsTo(sim, arrivalTick(sim, it, nextBoundary(sim)))) })));
      setAttr(q.box, 'data-warn', why ? '' : null);
    }
  }
}

/** One line of « En route »: an item on its way to a post, all its shuttles together. */
interface FlightLine { post: number; item: number; mu: number; first: number; ships: number; colonies: number[] }

/** Goods bought and on their way, by item and post (how many in all, the soonest arrival), soonest first. */
class FlightBox {
  readonly root: HTMLElement;
  private readonly count = el('span.cr-count');
  private readonly list = el('div.cr-flight-list');
  private sig: string | null = null;
  private etas: Array<{ at: number; node: HTMLElement }> = [];

  constructor(private readonly ctx: Ctx) {
    this.root = section({ sec: 'flight', title: () => t('crier.flight'), icon: mark('flight'), aside: this.count }, [this.list]);
    this.root.classList.add('cr-flight');
    this.root.setAttribute('data-crier-section', 'flight');
  }

  refresh(sim: Sim, colonies: readonly ColonyView[]): void {
    const by = new Map<string, FlightLine>();
    for (const s of sim.trade.inflight) {
      const k = `${s.post}:${s.item}`;
      let g = by.get(k);
      if (!g) { g = { post: s.post, item: s.item, mu: 0, first: s.arrive, ships: 0, colonies: [] }; by.set(k, g); }
      g.mu += s.mu;
      g.ships++;
      if (s.arrive < g.first) g.first = s.arrive;
      if (!g.colonies.includes(s.colony)) g.colonies.push(s.colony);
    }
    const lines = [...by.values()].sort((a, b) => a.first - b.first || a.post - b.post || a.item - b.item);
    const sig = lines.map((g) => `${g.post}:${g.item}:${g.mu}:${g.first}:${g.ships}`).join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      this.etas = [];
      const rows: HTMLElement[] = lines.slice(0, FLIGHT_MAX).map((g) => {
        const eta = el('span.cr-num.cr-eta');
        this.etas.push({ at: g.first, node: eta });
        const from = t('crier.flight.from', { colony: g.colonies.map((c) => fromName(colonies, c)).join(', '), post: g.post });
        return el('div.cr-flight-row', { 'data-flight': `${g.post}:${ITEM_IDS[g.item]}`, title: `${t('crier.flight.ships', { n: g.ships })} · ${from}` }, [
          el('span.cr-fl-what', {}, [el('b.cr-fl-n', {}, `${num(g.mu / 1000)} ×`), itemMention(g.item)]),
          el('span.cr-fl-post', { title: t('crier.post.name', { n: g.post }) }, [bIcon(this.ctx.atlas, 'trade_post', 16), t('crier.post.short', { n: g.post })]),
          eta,
        ]);
      });
      if (lines.length > FLIGHT_MAX) rows.push(el('small.cr-sub.cr-more', {}, t('crier.flight.more', { n: lines.length - FLIGHT_MAX })));
      this.list.replaceChildren(...(rows.length ? rows : [el('p.cr-empty', {}, t('crier.flight.none'))]));
    }
    const n = sim.trade.inflight.length;
    setText(this.count, n ? num(n) : '');
    setAttr(this.count, 'title', n ? t('crier.flight.ships', { n }) : null);
    for (const r of this.etas) setText(r.node, t('crier.flight.eta', { d: duration(secondsTo(sim, r.at)) }));
  }
}

class TradePane {
  readonly root: HTMLElement;
  readonly spot: SpotBox;
  private readonly flight: FlightBox;
  private readonly postsCount = el('span.cr-count');
  private readonly posts = el('div.cr-post-list');
  private readonly nopost: HTMLElement;
  private readonly cards = new Map<number, PostCard>();

  constructor(private readonly ctx: Ctx, private readonly forms: Forms) {
    this.spot = new SpotBox(ctx, forms);
    this.flight = new FlightBox(ctx);
    this.nopost = el('div.cr-nopost', { 'data-crier-nopost': '' }, [
      el('span.cr-nopost-i', {}, bIcon(ctx.atlas, 'trade_post', 40)),
      el('div', {}, [el('h3.lettering', {}, t('crier.trade.none.title')), el('p', {}, t('crier.trade.none.text'))]),
    ]);
    this.root = el('div.cr-pane', { 'data-crier-pane': 'trade' }, [
      el('div.cr-trade', {}, [
        el('div.cr-trade-posts', {}, [
          el('h3.lettering.cr-sec-title', {}, [bIcon(ctx.atlas, 'trade_post', 26), t('crier.posts.title'), this.postsCount]),
          this.nopost, this.posts,
        ]),
        el('div.cr-trade-side', {}, [this.spot.root, this.flight.root]),
      ]),
    ]);
  }

  refresh(sim: Sim, snap: MarketSnapshot, f: PostFacts, posts: readonly Ent[]): void {
    for (const p of posts) if (!this.cards.has(p.id)) this.cards.set(p.id, new PostCard(this.ctx, p.id, this.forms));
    for (const [id, c] of this.cards) if (!posts.some((p) => p.id === id)) { c.root.remove(); this.cards.delete(id); }
    const want = posts.map((p) => this.cards.get(p.id)!.root);
    if (want.length !== this.posts.children.length || want.some((n, k) => this.posts.children[k] !== n)) this.posts.replaceChildren(...want);
    setAttr(this.nopost, 'hidden', posts.length ? '' : null);
    setText(this.postsCount, `${posts.length}/${maxPosts(sim.mods)}`);
    for (const p of posts) this.cards.get(p.id)!.refresh(sim, p, f, snap.colonies);
    this.spot.refresh(sim, posts);
    this.flight.refresh(sim, snap.colonies);
  }
}

// ── What pays ─────────────────────────────────────────────────────────────────

interface BoardView {
  readonly node: HTMLElement;
  readonly out: number;
  readonly margin: HTMLElement;
  readonly mbar: DBar;
  readonly perTile: HTMLElement;
  readonly pbar: ReturnType<typeof progressBar>;
  readonly spark: Spark;
  readonly impact: HTMLElement;
  readonly impactT: HTMLElement;
}

/** One machine's output per minute for each recipe's output: the impact line when the player exports none yet. */
function oneMachineFlows(ids: readonly string[], craftSpeed: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const r = (RECIPES as Record<string, RecipeDef>)[id];
    const o = r?.outs[0];
    if (!r || !o) continue;
    const perMin = (60 / r.seconds) * (craftSpeed / 1000) * o[1];
    out[o[0]] = Math.max(out[o[0]] ?? 0, perMin);
  }
  return out;
}

class BoardPane {
  readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly count = el('span.cr-count');
  private readonly table = el('div.cr-rows');
  private readonly rows = new Map<string, BoardView>();
  private ids: string | null = null;
  private key = '';
  private data: BoardRow[] = [];
  private hypo = new Map<string, BoardRow>();

  constructor() {
    this.head = el('div.cr-row.cr-brow.cr-headrow', {}, [
      el('span', {}, t('crier.col.recipe')),
      el('span.cr-num', { title: t('crier.col.margin.tip') }, t('crier.col.margin')),
      el('span.cr-num', { title: t('crier.col.perTile.tip') }, t('crier.col.perTile')),
      el('span.cr-mid', {}, t('crier.col.spark')),
      el('span', {}, t('crier.col.impact')),
    ]);
    const card = section({ sec: 'board', title: () => t('crier.board.title'), icon: tabIcon('board'), aside: this.count, tip: () => t('crier.board.note', { energy: num(ENERGY_COST) }) }, [this.head, this.table]);
    card.classList.add('cr-board');
    this.root = el('div.cr-pane', { 'data-crier-pane': 'board' }, [card]);
  }

  private row(id: string): BoardView {
    const r = (RECIPES as Record<string, RecipeDef>)[id]!;
    const out = itemOf(r.outs[0]![0]);
    const machine = (BUILDINGS as Record<string, BuildingDef>)[r.machines[0]!]?.name[locale()] ?? '';
    const margin = el('span.cr-num.cr-margin'), perTile = el('span.cr-num.cr-pertile'), spark = new Spark();
    const mbar = new DBar(), pbar = progressBar();
    const impactT = el('span');
    const impact = el('span.cr-impact', {}, [glyph('building'), impactT]);
    const node = el('div.cr-row.cr-brow', { 'data-board-recipe': id }, [
      el('span.cr-item', {}, [
        itemMention(out, { name: false, big: true }),
        el('span.cr-stack', {}, [el('span.cr-name', {}, r.name[locale()]), el('small.cr-sub', {}, machine)]),
        el('span.cr-best', {}, t('crier.board.best')),
      ]),
      el('span.cr-barcell', {}, [mbar.root, margin]),
      el('span.cr-barcell', {}, [pbar.root, perTile]),
      el('span.cr-mid', {}, [spark.root]),
      impact,
    ]);
    return { node, out, margin, mbar, perTile, pbar, spark, impact, impactT };
  }

  refresh(sim: Sim, items: ReadonlyMap<number, ItemMarket>): void {
    const ids = CRECIPES.filter((r) => sim.unlocked(r.unlock)).map((r) => r.id);
    // The board only moves at a boundary (prices, flows), with research (recipes, craft speed).
    const key = `${sim.prices.epoch}|${ids.join(',')}|${sim.mods.craftSpeed}`;
    if (key !== this.key) {
      this.key = key;
      const opts = { craftSpeed: sim.mods.craftSpeed };
      this.data = sim.market.board(ids, ENERGY_COST, opts);
      this.hypo = new Map(sim.market.board(ids, ENERGY_COST, { ...opts, flows: oneMachineFlows(ids, sim.mods.craftSpeed) }).map((r) => [r.recipe, r]));
    }
    const sig = ids.join(',');
    if (sig !== this.ids) {
      this.ids = sig;
      for (const id of [...this.rows.keys()]) if (!ids.includes(id)) this.rows.delete(id);
      for (const id of ids) if (!this.rows.has(id)) this.rows.set(id, this.row(id));
    }
    setText(this.count, num(ids.length));
    const order = this.data.map((r) => this.rows.get(r.recipe)?.node).filter((n): n is HTMLElement => !!n);
    const kids = this.table.children;
    if (kids.length !== order.length || order.some((n, k) => kids[k] !== n)) this.table.replaceChildren(...order);
    // The bars' scales: the best ◉ per tile-minute, the widest margin either way.
    let maxPer = 0, maxM = 0;
    for (const r of this.data) {
      if (r.perTile !== null && r.perTile > maxPer) maxPer = r.perTile;
      if (Math.abs(r.margin) > maxM) maxM = Math.abs(r.margin);
    }
    let best = true;
    for (const r of this.data) {
      const v = this.rows.get(r.recipe);
      if (!v) continue;
      const isBest = best && r.perTile !== null && r.perTile > 0;
      setText(v.margin, ocNum(r.margin * 100, true));
      setAttr(v.margin, 'data-sign', r.margin >= 0.005 ? '+' : r.margin <= -0.005 ? '-' : null);
      v.mbar.set(r.margin, maxM);
      setText(v.perTile, r.perTile === null ? '—' : ocNum(r.perTile * 100));
      setAttr(v.perTile, 'title', r.perTile === null ? t('crier.board.bought') : null);
      v.pbar.set(r.perTile !== null && maxPer > 0 ? Math.max(0, r.perTile) / maxPer : 0, isBest ? 'warn' : 'good');
      setAttr(v.node, 'data-best', isBest ? '' : null);
      if (r.perTile !== null) best = false;
      const im = items.get(v.out);
      if (im) v.spark.set([...im.history, im.mid], im.value * 100);
      // What a flow does to the output's price: the player's own (↑, as in Cours), else one machine's.
      const own = r.flow >= 0.05;
      const h = this.hypo.get(r.recipe);
      const x = own ? r : h;
      setText(v.impactT, x ? `${own ? '↑ ' : ''}${rate(round2(x.flow))} → ${spct(x.impact)}` : '—');
      setAttr(v.impact, 'title', own ? t('crier.board.impact', { rate: rate(round2(r.flow)), pct: spct(r.impact) })
        : h ? t('crier.board.oneMachine', { rate: rate(round2(h.flow)), pct: spct(h.impact) }) : null);
      setAttr(v.impact, 'data-own', own ? '' : null);
      setAttr(v.impact, 'data-none', x ? null : '');
      setAttr(v.impact, 'data-sign', x && x.impact <= -0.1 ? '-' : null);
      setAttr(v.node, 'title', t('crier.board.tip', {
        rev: oc(r.revenue * 100), ins: oc(r.inputs * 100), en: oc(r.energy * 100), cycles: round2(r.cycles), tiles: round2(r.tiles),
      }));
    }
  }
}

// ── the Gazette ───────────────────────────────────────────────────────────────

class GazetteBox {
  readonly root: HTMLElement;
  private readonly list = el('div.cr-gz-list');
  private sig: string | null = null;
  private live: Array<(sim: Sim) => void> = [];

  constructor(private readonly atlas: Atlas) {
    this.root = el('section.cr-gazette.cartouche', { 'data-crier-section': 'gazette' }, [
      el('header.cr-gz-head', {}, [el('h2.lettering', {}, t('crier.gazette')), el('small', {}, t('crier.gazette.sub'))]),
      this.list,
    ]);
  }

  /**
   * One event: the item's icon (a rank's badge for a boom), what it is in short — its kind, ▲ / ▼
   * and its factor, the colony it is at — and when (its countdown, or what is left of it); what
   * the Hearth holds of a wanted item; the sentence on hover.
   */
  private entry(ev: MarketEvent, when: 'now' | 'soon', colonies: readonly ColonyView[]): HTMLElement {
    const it = itemOf(ev.item);
    const at = el('span.cr-gz-when'), heldN = el('b');
    const held = el('span.cr-gz-held', { hidden: '' }, [bIcon(this.atlas, 'hearth', 16), heldN]);
    this.live.push((sim) => {
      setText(at, when === 'soon' ? t('crier.gazette.starts', { d: duration(secsToEpoch(sim, ev.start)) }) : t('crier.gazette.ends', { d: duration(secsToEpoch(sim, ev.end)) }));
      // A demand event on something the Hearth holds: say so (the first trade is a sale).
      const n = it >= 0 && ev.side === 'demand' ? Math.floor((sim.stock[it] ?? 0) / 1000) : 0;
      setText(heldN, n > 0 ? compact(n) : '');
      setAttr(held, 'hidden', n > 0 ? null : '');
      setAttr(held, 'title', n > 0 ? t('crier.gazette.held', { n }) : null);
    });
    const col = ev.colony >= 0 ? colonies[ev.colony] : undefined;
    const tier = t('crier.tier', { n: ev.tier });
    return el('article.cr-gz', { 'data-gazette': ev.id, 'data-when': when, 'data-side': ev.side, 'data-kind': ev.kind, title: plain(capFirst(eventLine(ev, colonies))) }, [
      el('span.cr-gz-icon', {}, it >= 0 ? itemMention(it, { name: false }) : el('b.cr-gz-tier.lettering', { title: tier }, num(ev.tier))),
      el('div.cr-gz-body', {}, [
        el('div.cr-gz-what', {}, it >= 0 ? nameOf(it) : tier),
        el('div.cr-gz-meta', {}, [
          el('span.cr-gz-kind', {}, t(`crier.kind.${ev.kind}` as MsgKey)),
          el('span.cr-gz-mult', {}, `${ev.side === 'demand' ? '▲' : '▼'} ×${num(Math.round(ev.mult * 10) / 10)}`),
          col ? el('span.cr-gz-where', {}, [glyph('flagNeighbour'), colonyName(col)]) : null,
        ]),
      ]),
      el('div.cr-gz-side', {}, [at, held]),
    ]);
  }

  refresh(sim: Sim, snap: MarketSnapshot): void {
    const { active, announced } = snap.events;
    const sig = `${announced.map((e) => e.id).join(',')}|${active.map((e) => e.id).join(',')}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.live = [];
      const kids: HTMLElement[] = [];
      const group = (title: string, evs: readonly MarketEvent[], when: 'now' | 'soon'): void => {
        if (!evs.length) return;
        kids.push(el('h3.cr-gz-sec.lettering', {}, [title, el('span.cr-count', {}, num(evs.length))]), ...evs.map((e) => this.entry(e, when, snap.colonies)));
      };
      group(t('crier.gazette.soon'), announced, 'soon');
      group(t('crier.gazette.now'), active, 'now');
      this.list.replaceChildren(...(kids.length ? kids : [el('p.cr-empty', {}, t('crier.gazette.empty'))]));
    }
    for (const f of this.live) f(sim);
  }
}

// ── the screen ────────────────────────────────────────────────────────────────

/** A fact of the header's bar: the chip (its words on hover) and its figure. */
interface Fact { readonly chip: HTMLElement; readonly v: HTMLElement }

interface Parts {
  readonly balance: HTMLElement;
  readonly rate: HTMLElement;
  readonly level: Fact;
  readonly fee: Fact;
  readonly through: Fact;
  readonly lift: Fact;
  readonly posts: Fact;
  /** The orbit's legend: the other claims, those the player trades with. */
  readonly colonies: Fact;
  readonly partners: Fact;
  readonly tabs: ReadonlyMap<CrierTab, HTMLButtonElement>;
  readonly prices: PricesPane;
  readonly trade: TradePane;
  readonly board: BoardPane;
  readonly gazette: GazetteBox;
}

export class CrierScreen {
  readonly root: HTMLElement;
  readonly orbit: OrbitView;
  private tab: CrierTab = 'prices';
  /** Locale and world the DOM was built for. */
  private key = '';
  private ui: Parts | null = null;
  private readonly forms: Forms = { spotItem: '', spotN: '100', orders: new Map() };

  constructor(readonly atlas: Atlas, readonly host: CrierHost) {
    this.orbit = new OrbitView(atlas);
    this.root = el('section.screen.crier', { 'data-screen': 'market' });
  }

  /** A line to bring into view at the next refresh, flashed once (the purse's card, D102: an order, a post); given up after a few refreshes. */
  private pending: { sel: string; tries: number } | null = null;

  /** Bring a line of the Trade tab into view (a CSS selector: `[data-order="7"]`, `[data-post="99"]`) and flash it. */
  focusLine(sel: string): void {
    this.pending = { sel, tries: 8 };
  }

  /** Bring a tab to the front (the trade post's inspector asks for Trade). */
  show(tab: CrierTab): void {
    this.tab = tab;
    if (this.ui) this.paintTabs(this.ui);
    if (this.root.isConnected) this.refresh();
  }

  /** The Prices tab's ⇄: the item goes into the spot form (and untouched order forms), on the Trade tab. */
  private tradeItem(item: number): void {
    const id = ITEM_IDS[item]!;
    this.ui?.trade.spot.select(id);
    this.forms.spotItem = id;
    for (const f of this.forms.orders.values()) if (!f.touched) f.item = id;
    this.show('trade');
    this.ui?.trade.spot.n.focus();
  }

  private build(sim: Sim, snap: MarketSnapshot): Parts {
    if (!this.forms.spotItem) {
      // The item of the first demand event (the scripted bulb shortage at founding), else what the Hearth holds most of.
      const ev = [...snap.events.active, ...snap.events.announced].find((e) => e.item && e.side === 'demand' && TRADABLE.includes(itemOf(e.item)));
      const most = TRADABLE.reduce((a, b) => ((sim.stock[b] ?? 0) > (sim.stock[a] ?? 0) ? b : a), TRADABLE[0]!);
      this.forms.spotItem = ev?.item ?? ITEM_IDS[most]!;
    }
    const ctx: Ctx = { atlas: this.atlas, host: this.host };
    const tabs = new Map<CrierTab, HTMLButtonElement>();
    const nav = el('nav.cr-tabs', {}, TABS.map((k) => {
      const b = el<'button'>('button.btn.cr-tab', { 'data-crier-tab': k, onclick: () => this.show(k) }, [tabIcon(k), el('span', {}, t(`crier.tab.${k}` as MsgKey))]);
      tabs.set(k, b);
      return b;
    }));
    const fact = (k: string, icon: Node, cls = 'cr-fact'): Fact => {
      const v = el('b');
      return { chip: el(`span.${cls}`, { 'data-fact': k }, [el(`span.${cls}-i`, {}, icon), v]), v };
    };
    const p: Parts = {
      balance: el('b.cr-balance', { 'data-crier-balance': '' }),
      rate: el('small.cr-rate', { 'data-crier-rate': '', title: t('crier.rate.tip') }),
      level: fact('level', mark('level')),
      fee: fact('fee', glyph('crier')),
      through: fact('throughput', el('span.cr-sym', {}, '⇅')),
      lift: fact('lift', el('span.cr-sym', {}, '⇡')),
      posts: fact('posts', bIcon(this.atlas, 'trade_post', 22)),
      colonies: fact('colonies', glyph('flagNeighbour'), 'cr-lchip'),
      partners: fact('partners', mark('route'), 'cr-lchip'),
      tabs,
      prices: new PricesPane(ctx, snap, (item) => this.tradeItem(item)),
      trade: new TradePane(ctx, this.forms),
      board: new BoardPane(),
      gazette: new GazetteBox(this.atlas),
    };
    this.root.replaceChildren(
      el('header.cr-head', {}, [
        el('h1.lettering', {}, t('screen.market')),
        el('div.kstat.cr-purse', { title: t('crier.balance.tip') }, [el('span.kstat-icon.cr-coin', {}, '◉'), el('div.kstat-body', {}, [p.balance, p.rate])]),
        el('div.cr-facts', {}, [p.level.chip, p.fee.chip, p.through.chip, p.lift.chip, p.posts.chip]),
        el('button.btn.rs-close', { onclick: () => this.host.close(), title: t('screen.close') }, '✕'),
      ]),
      el('div.cr-body', {}, [
        el('aside.cr-side', {}, [
          el('div.cr-orbit', {}, [this.orbit.root, el('div.cr-legend', {}, [p.colonies.chip, p.partners.chip])]),
          p.gazette.root,
        ]),
        el('div.cr-main', {}, [nav, p.prices.root, p.trade.root, p.board.root]),
      ]),
    );
    this.paintTabs(p);
    return p;
  }

  private paintTabs(p: Parts): void {
    for (const [k, b] of p.tabs) setAttr(b, 'data-on', k === this.tab ? '' : null);
    setAttr(p.prices.root, 'hidden', this.tab === 'prices' ? null : '');
    setAttr(p.trade.root, 'hidden', this.tab === 'trade' ? null : '');
    setAttr(p.board.root, 'hidden', this.tab === 'board' ? null : '');
  }

  refresh(): void {
    const sim = this.host.sim();
    const snap = sim.market.snapshot();
    const key = `${locale()}|${sim.worldSeed}`;
    if (!this.ui || key !== this.key) { this.key = key; this.ui = this.build(sim, snap); }
    const ui = this.ui;
    this.orbit.setData({ snapshot: snap, epoch: sim.absEpoch(), lifts: this.host.takeLifts() });

    // The purse, and what every post does at this research: a figure per chip, the words on hover.
    const f = postFacts(sim);
    setText(ui.balance, ocNum(sim.credits));
    const perHour = tradePerHour(sim);
    setText(ui.rate, Math.abs(perHour) >= 50 ? t('crier.rate', { v: oc(perHour, true, 0) }) : '');
    setAttr(ui.rate, 'data-sign', perHour >= 50 ? '+' : perHour <= -50 ? '-' : null);
    const tip = (x: Fact, head: string, body: string): void => setAttr(x.chip, 'title', `${head}\n${body}`);
    setText(ui.level.v, num(f.level));
    tip(ui.level, t('crier.level', { n: f.level }), t('crier.level.tip'));
    setText(ui.fee.v, feeText(f.fee));
    tip(ui.fee, t('crier.fee', { v: feeText(f.fee) }), t('crier.fee.tip', { v: feeText(f.fee) }));
    setText(ui.through.v, rate(f.perMin));
    tip(ui.through, t('crier.throughput', { rate: rate(f.perMin) }), t('crier.throughput.tip'));
    setText(ui.lift.v, minutes(f.liftMin));
    tip(ui.lift, t('crier.lift', { d: minutes(f.liftMin) }), t('crier.lift.tip'));
    const posts = sim.tradePosts();
    const np = posts.length, mp = maxPosts(sim.mods);
    setText(ui.posts.v, np ? `${np}/${mp}` : t('crier.noPost'));
    setAttr(ui.posts.chip, 'data-none', np ? null : '');
    tip(ui.posts, np ? t('crier.posts', { n: np, max: mp }) : t('crier.noPost'), t('crier.posts.tip'));
    // The orbit's legend.
    setText(ui.colonies.v, num(snap.colonies.length));
    setAttr(ui.colonies.chip, 'title', t('crier.orbit.legend', { n: snap.colonies.length }));
    setText(ui.partners.v, num(snap.trade.length));
    setAttr(ui.partners.chip, 'title', snap.trade.length ? capFirst(t('crier.orbit.trading', { n: snap.trade.length })) : capFirst(t('crier.orbit.none')));

    ui.gazette.refresh(sim, snap);
    this.paintTabs(ui);
    const items = new Map(snap.items.map((im) => [im.idx, im] as const));
    if (this.tab === 'prices') ui.prices.refresh(sim, snap, items, f);
    else if (this.tab === 'trade') ui.trade.refresh(sim, snap, f, posts);
    else ui.board.refresh(sim, items);
    // The purse's card asked for a line (D102): into view, flashed once.
    if (this.pending) {
      const n = this.root.querySelector<HTMLElement>(this.pending.sel);
      if (n) {
        this.pending = null;
        n.scrollIntoView({ block: 'center' });
        n.setAttribute('data-flash', '');
        setTimeout(() => n.removeAttribute('data-flash'), 1800);
      } else if (--this.pending.tries <= 0) this.pending = null;
    }
  }

  frame(dt: number): void { this.orbit.frame(dt); }
}
