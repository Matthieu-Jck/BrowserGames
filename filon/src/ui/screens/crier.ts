// crier.ts — the Crier screen (M): « La Criée », the colony's window on the Crier Ring. The
// orbital view stands on the left (the planet, the sister colonies, the arcs of the player's
// trade) above the Gazette (events announced, with a countdown, and running, until when);
// on the right, three tabs:
//   · Prices: every tradable item with this minute's sell / buy price, a 24 h sparkline, the
//     trend, what the Hearth holds and the player's own flow; items under an event are flagged;
//   · Trade: per trade post its export streams and standing import orders (state, next
//     delivery, a form to add one), spot trades with a live quote (total, unit price, the
//     price factor and the lasting shock), and the goods in flight;
//   · What pays: the unlocked recipes by ◉ per raw tile-minute, their margin per machine, and
//     what the player's own flow does to the output's price.
// Every item named shows its icon (mention.ts), and every item choice is an item picker with icons
// (item-picker.ts, through trade-view's `tradeSelect`); the header's chips say what they are on hover.
// Built once (again only on a locale or world change); refresh() (4 Hz while open) writes
// values through change-only setters, and each part rebuilds only when its signature changes
// (posts, streams slots, orders, unlocked recipes, events). Selects and inputs the player is
// using are never rebuilt or overwritten. The sim decides: this shows, and asks through the
// Sim's trade commands (refusals become toasts).
import { BAL } from '@/content/balance';
import { BUILDINGS } from '@/content/buildings';
import { RECIPES } from '@/content/recipes';
import { CRECIPES, ITEM_IDS } from '@/content/registry';
import type { BuildingDef, RecipeDef } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { compact, duration, num, rate } from '@/i18n/format';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import type { BoardRow, ColonyView, ItemMarket, MarketEvent, MarketSnapshot } from '@/market/types';
import type { Atlas } from '@/render/art/atlas';
import { EPOCH, TPS } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { nextToHearth } from '@/sim/systems/trade';
import { maxPosts, type ImportOrder } from '@/sim/trade';
import type { Ent } from '@/sim/types';
import { itemIcon } from '../build-bar';
import { eventLine } from '../gazette';
import { itemName } from '../inspector/kit';
import type { ItemPicker } from '../item-picker';
import { itemMention, itemRef, plain } from '../mention';
import {
  arrivalTick, feeText, lastExports, minutes, nextArrival, nextBoundary, oc, ocNum, orderStateText, postFacts,
  refusalText, secondsTo, spct, TRADABLE, tradePerHour, tradeSelect, unitBuyCents, unitSellCents, type PostFacts,
} from '../trade-view';
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
/** Shipments listed in the Trade tab before « and n more ». */
const FLIGHT_MAX = 10;
/** Sparkline box (SVG user units = CSS px). */
const SPARK_W = 96;
const SPARK_H = 24;

interface Ctx { readonly atlas: Atlas; readonly host: CrierHost }

/** What the player typed or picked: kept across a rebuild (a locale switch). */
interface OrderForm { item: string; n: string; max: string; touched: boolean }
interface Forms { spotItem: string; spotN: string; readonly orders: Map<number, OrderForm> }

// ── small helpers ─────────────────────────────────────────────────────────────

const colonyName = (c: ColonyView | undefined): string => (c ? c.name[locale()] : '?');
const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const round2 = (v: number): number => Math.round(v * 100) / 100;
const itemOf = (id: string | null): number => (id ? ITEM_IDS.indexOf(id as never) : -1);

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

// ── Prices ────────────────────────────────────────────────────────────────────

interface PriceRow {
  readonly idx: number;
  readonly node: HTMLElement;
  readonly stock: HTMLElement;
  readonly bid: HTMLElement;
  readonly ask: HTMLElement;
  readonly spark: Spark;
  readonly trend: HTMLElement;
  readonly flow: HTMLElement;
  readonly badge: HTMLElement;
}

class PricesPane {
  readonly root: HTMLElement;
  private readonly note = el('p.cr-note');
  private readonly rows: PriceRow[] = [];

  constructor(private readonly ctx: Ctx, snap: MarketSnapshot, go: (item: number) => void) {
    const kids: HTMLElement[] = [el('div.cr-row.cr-prow.cr-headrow', {}, [
      el('span', {}, t('crier.col.item')),
      el('span.cr-num', {}, t('crier.col.stock')),
      el('span.cr-num', { title: t('crier.col.sell.tip') }, t('crier.col.sell')),
      el('span.cr-num', { title: t('crier.col.buy.tip') }, t('crier.col.buy')),
      el('span.cr-mid', {}, t('crier.col.spark')),
      el('span.cr-num', {}, t('crier.col.trend')),
      el('span.cr-num', { title: t('crier.col.flow.tip') }, t('crier.col.flow')),
      el('span'),
    ])];
    let tier = 0;
    for (const im of [...snap.items].sort((a, b) => a.tier - b.tier || a.idx - b.idx)) {
      if (im.tier !== tier) { tier = im.tier; kids.push(el('div.cr-tier.lettering', {}, t('crier.tier', { n: tier }))); }
      kids.push(this.row(snap, im, go));
    }
    this.root = el('div.cr-pane.cartouche', { 'data-crier-pane': 'prices' }, [this.note, el('div.cr-table', {}, kids)]);
  }

  private row(snap: MarketSnapshot, im: ItemMarket, go: (item: number) => void): HTMLElement {
    // Where it comes from (nearest first, with their delay) and who wants it: fixed for the world.
    const from = im.sources.slice(0, 3).map((s) => `${colonyName(snap.colonies[s.colony])} (${minutes(s.delayMin)})`).join(', ');
    const wanted = snap.colonies.filter((c) => c.needs.includes(im.item)).slice(0, 4).map(colonyName).join(', ');
    const title = [from && t('crier.sources', { list: from }), wanted && t('crier.buyers', { list: wanted })].filter(Boolean).join('\n');
    const stock = el('span.cr-num.cr-stock'), bid = el('span.cr-num.cr-bid'), ask = el('span.cr-num.cr-ask');
    const spark = new Spark(), trend = el('span.cr-num.cr-trend'), flow = el('span.cr-num.cr-flow'), badge = el('span.cr-badge');
    const node = el('div.cr-row.cr-prow', { 'data-price-item': im.item }, [
      el('span.cr-item', { title }, [
        itemIcon(this.ctx.atlas, im.idx, 20),
        el('span.cr-stack', {}, [
          el('span.cr-name', {}, [itemName(im.idx), im.unique ? el('span.cr-uniq', { title: t('crier.unique') }, ' ✦') : null]),
          badge,
        ]),
      ]),
      stock, bid, ask, el('span.cr-mid', {}, [spark.root]), trend, flow,
      el('button.cr-go', { title: t('crier.go'), 'data-trade-item': im.item, onclick: () => go(im.idx) }, '⇄'),
    ]);
    this.rows.push({ idx: im.idx, node, stock, bid, ask, spark, trend, flow, badge });
    return node;
  }

  refresh(sim: Sim, snap: MarketSnapshot, items: ReadonlyMap<number, ItemMarket>, f: PostFacts): void {
    setText(this.note, t('crier.prices.note', { fee: feeText(f.fee) }));
    const { active, announced } = snap.events;
    for (const r of this.rows) {
      const im = items.get(r.idx);
      if (!im) continue;
      const held = Math.floor((sim.stock[r.idx] ?? 0) / 1000);
      setText(r.stock, held > 0 ? compact(held) : '—');
      setText(r.bid, ocNum(im.bid));
      setText(r.ask, ocNum(im.ask));
      setAttr(r.bid, 'title', t('crier.afterFee', { v: oc(unitSellCents(sim, r.idx)) }));
      setAttr(r.ask, 'title', t('crier.afterFee', { v: oc(unitBuyCents(sim, r.idx)) }));
      r.spark.set([...im.history, im.mid], im.value * 100);
      const sign = im.trend > 0.005 ? '+' : im.trend < -0.005 ? '-' : null;
      setText(r.trend, spct(im.trend));
      setAttr(r.trend, 'data-sign', sign);
      setAttr(r.node, 'data-trend', sign);
      const flows = [im.flow.sold >= 0.05 ? `↑\u00A0${rate(im.flow.sold)}` : '', im.flow.bought >= 0.05 ? `↓\u00A0${rate(im.flow.bought)}` : ''].filter(Boolean);
      setText(r.flow, flows.join(' ') || '—');
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

/** One trade post: its export streams, its standing orders and the form to add one. */
class PostCard {
  readonly root: HTMLElement;
  private readonly tag = el('span.cr-tag');
  private readonly act = el('span.cr-post-act');
  private readonly help = el('p.cr-help');
  private readonly streamsCount = el('span.cr-count');
  private readonly slotsEl = el('div.cr-slots');
  private slots: Array<{ sel: ItemPicker; info: HTMLElement }> = [];
  private readonly ordersCount = el('span.cr-count');
  private readonly ordersEl = el('div.cr-orders');
  private orders: Array<{ o: ImportOrder; state: HTMLElement; eta: HTMLElement }> = [];
  private ordersSig: string | null = null;
  private readonly item: ItemPicker;
  private readonly n: HTMLInputElement;
  private readonly max: HTMLInputElement;
  private readonly hint = el('small.cr-sub.cr-order-hint');
  private readonly form: OrderForm;

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
    this.max = el<'input'>('input.cr-input.cr-input-oc', {
      type: 'text', inputmode: 'decimal', value: form.max, 'data-order-max': String(id), title: t('crier.order.max'),
      oninput: () => { this.form.max = this.max.value; this.form.touched = true; }, onkeydown: keys(add),
    });
    this.root = el('article.cr-post', { 'data-post': String(id) }, [
      el('header.cr-post-head', {}, [el('h3.lettering', {}, t('crier.post.name', { n: id })), this.tag, this.act]),
      el('section.cr-post-sec', {}, [
        el('h4.lettering', {}, [t('crier.streams'), ' ', this.streamsCount]),
        this.slotsEl, this.help,
      ]),
      el('section.cr-post-sec', {}, [
        el('h4.lettering', {}, [t('crier.orders'), ' ', this.ordersCount]),
        this.ordersEl,
        el('div.cr-order-form', {}, [
          this.item.root,
          el('label.cr-field', {}, [this.n, el('span', {}, t('crier.order.perMin'))]),
          el('label.cr-field', {}, [el('span', {}, t('crier.order.atMost')), this.max, el('span', {}, '◉')]),
          el('button.btn.primary.cr-add', { 'data-order-add': String(id), onclick: add }, t('crier.order.add')),
        ]),
        this.hint,
      ]),
    ]);
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
    const r = sim.addImport(this.id, this.form.item, n, max);
    if (typeof r === 'string') { this.ctx.host.notify('bad', refusalText(r)); return; }
    this.ctx.host.notify('good', t('crier.order.placed', { rate: rate(n), item: itemRef(it), max: oc(max) }));
  }

  private setStream(slot: number, item: string | null, sel: ItemPicker): void {
    const sim = this.ctx.host.sim();
    const r = sim.setExport(this.id, slot, item);
    const now = sim.streamsOf(this.id)[slot] ?? -1;
    if (r) this.ctx.host.notify('bad', refusalText(r));
    else if (item && ITEM_IDS[now] !== item) this.ctx.host.notify('warn', refusalText('exporting')); // sold by another slot already
    sel.set(now);
  }

  private buildSlots(n: number): void {
    const sim = this.ctx.host.sim();
    this.slots = Array.from({ length: n }, (_, k) => {
      const sel: ItemPicker = tradeSelect(-1, t('crier.stream.none'), (v) => this.setStream(k, v, sel), { 'data-export-slot': `${this.id}:${k}` }, sim, t('insp.trade.stream', { n: k + 1 }));
      return { sel, info: el('small.cr-sub') };
    });
    this.slotsEl.replaceChildren(...this.slots.map((s, k) => el('div.cr-slot', {}, [el('span.cr-slot-n', {}, String(k + 1)), s.sel.root, s.info])));
  }

  private buildOrders(mine: readonly ImportOrder[]): void {
    this.orders = [];
    const rows = mine.map((o) => {
      const state = el('span.cr-state'), eta = el('small.cr-sub');
      this.orders.push({ o, state, eta });
      return el('div.cr-order', { 'data-order': String(o.id) }, [
        el('div.cr-order-main', {}, [
          el('span.cr-name', {}, itemMention(o.item)),
          el('span.cr-order-line', {}, t('crier.order.line', { rate: rate(o.perMin), max: oc(o.maxCents) })),
          el('button.cr-x', { title: t('crier.order.cancel'), 'aria-label': t('crier.order.cancel'), 'data-order-cancel': String(o.id), onclick: () => this.cancel(o) }, '✕'),
        ]),
        el('div.cr-order-sub', {}, [state, eta]),
      ]);
    });
    this.ordersEl.replaceChildren(...(rows.length ? rows : [el('p.cr-empty', {}, t('crier.orders.none'))]));
  }

  private cancel(o: ImportOrder): void {
    if (this.ctx.host.sim().cancelImport(o.id)) this.ctx.host.notify('info', t('crier.order.cancelled', { item: itemRef(o.item) }));
  }

  refresh(sim: Sim, e: Ent, f: PostFacts, sold: ReadonlyMap<string, { mu: number; cents: number }>, colonies: readonly ColonyView[]): void {
    const hearth = nextToHearth(sim, e);
    setText(this.tag, hearth ? t('crier.post.hearth') : '');
    setAttr(this.tag, 'hidden', hearth ? null : '');
    setText(this.help, hearth ? t('crier.post.hearth.tip', { n: BAL.tradeHearthReserve }) : t('crier.post.ribbons.tip'));
    const a = sim.trade.activity.get(this.id);
    setText(this.act, a && a.epoch === sim.absEpoch() - 1
      ? t('crier.post.last', { used: Math.round((a.soldMu + a.boughtMu) / 1000), max: f.perMin, cents: oc(a.cents, true) })
      : t('crier.post.idle'));

    // Export streams: slots follow research; values follow the sim unless a picker is open.
    const streams = sim.streamsOf(this.id);
    if (streams.length !== this.slots.length) this.buildSlots(streams.length);
    setText(this.streamsCount, `${streams.filter((i) => i >= 0).length}/${streams.length}`);
    streams.forEach((cur, k) => {
      const s = this.slots[k]!;
      s.sel.set(cur);
      const out = sold.get(`${this.id}:${cur}`);
      setText(s.info, cur >= 0 ? t('crier.stream.info', { bid: oc(sim.prices.bid[cur] ?? 0), n: Math.round((out?.mu ?? 0) / 1000) }) : '');
    });

    // Standing orders: rows when the set changes; state and next delivery live.
    const mine = sim.trade.orders.filter((o) => o.post === this.id);
    const sig = mine.map((o) => o.id).join('.');
    if (sig !== this.ordersSig) { this.ordersSig = sig; this.buildOrders(mine); }
    setText(this.ordersCount, `${sim.trade.orders.length}/${f.orders}`);
    for (const r of this.orders) {
      const st = orderStateText(sim, r.o);
      setText(r.state, st.text);
      setAttr(r.state, 'data-state', st.state);
      setAttr(r.state, 'data-order-state', st.state);
      setAttr(r.state, 'title', st.why);
      const at = nextArrival(sim, this.id, r.o.item);
      setText(r.eta, at !== null ? t('crier.order.eta', { d: duration(secondsTo(sim, at)) })
        : st.state === 'active' ? t('crier.order.next', { d: duration(secondsTo(sim, nextBoundary(sim))) }) : '');
    }

    // The form: its picker and max follow the sim unless the player is at them.
    this.item.set(itemOf(this.form.item));
    this.defaultMax(sim);
    const it = itemOf(this.form.item);
    const src = it >= 0 ? sim.market.sources(it)[0] : undefined;
    setText(this.hint, it < 0 ? '' : t('crier.order.hint', {
      ask: oc(sim.prices.ask[it] ?? 0),
      d: duration(secondsTo(sim, arrivalTick(sim, it, nextBoundary(sim)))),
      colony: colonyName(src ? colonies[src.colony] : undefined),
    }));
  }
}

/** Spot trades: an item, a quantity, the live quote both ways, Sell / Buy. */
class SpotBox {
  readonly root: HTMLElement;
  private readonly sel: ItemPicker;
  readonly n: HTMLInputElement;
  private readonly have = el('small.cr-sub.cr-spot-have');
  private readonly q: Record<'sell' | 'buy', { box: HTMLElement; total: HTMLElement; sub: HTMLElement; why: HTMLElement }>;

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
    const side = (s: 'sell' | 'buy'): { box: HTMLElement; total: HTMLElement; sub: HTMLElement; why: HTMLElement } => {
      const total = el('strong.cr-q-total'), sub = el('small.cr-sub'), why = el('small.cr-why');
      const btn = el('button.btn.cr-q-btn', { cls: s === 'buy' ? 'primary' : null, [`data-spot-${s}`]: '', onclick: () => this.trade(s) }, t(s === 'sell' ? 'crier.spot.sell' : 'crier.spot.buy'));
      const head = el('span.cr-q-head', {}, [total, el('span.cr-coin', {}, '◉')]);
      return { box: el('div.cr-quote', { 'data-spot-quote': s }, [el('div.cr-q-text', {}, [head, sub, why]), btn]), total, sub, why };
    };
    this.q = { sell: side('sell'), buy: side('buy') };
    this.root = el('section.cr-box.cr-spot', { 'data-crier-section': 'spot' }, [
      el('h3.lettering', {}, t('crier.spot')),
      el('div.cr-spot-pick', {}, [this.sel.root, this.n]),
      el('div.cr-presets', {}, [
        preset('10', num(10), () => 10), preset('100', num(100), () => 100), preset('1000', num(1000), () => 1000),
        preset('all', t('crier.spot.all'), () => Math.floor((this.ctx.host.sim().stock[itemOf(forms.spotItem)] ?? 0) / 1000)),
      ]),
      this.have,
      this.q.sell.box, this.q.buy.box,
      el('p.cr-help', {}, t('crier.spot.help')),
    ]);
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
    setText(this.have, t('crier.spot.have', { n: held, bid: oc(sim.prices.bid[it] ?? 0), ask: oc(sim.prices.ask[it] ?? 0) }));
    for (const s of ['sell', 'buy'] as const) {
      const q = this.q[s];
      const r = n > 0 ? sim.quoteSpot(it, s, n) : null;
      if (!r || !r.ok) {
        setText(q.total, '—'); setText(q.sub, ''); setText(q.why, n > 0 ? refusalText('not_tradable') : refusalText('bad_amount'));
        setAttr(q.box, 'data-warn', '');
        continue;
      }
      setText(q.total, ocNum(s === 'sell' ? r.cents : -r.cents, true));
      // The lasting mark on the price, when the trade is big enough to leave one.
      const shock = Math.abs(r.shock - 1) >= 0.005 ? ` · ${t('crier.spot.shock', { pct: spct(r.shock - 1) })}` : '';
      setText(q.sub, `${t('crier.spot.unit', { unit: oc(r.unitCents), factor: round2(r.factor) })}${shock}`);
      const why = !post ? refusalText('no_post')
        : s === 'sell' && held < n ? refusalText('stock')
          : s === 'buy' && sim.credits < r.cents ? refusalText('unaffordable') : '';
      setText(q.why, why || (s === 'sell' ? t('crier.spot.fromHearth')
        : t('crier.spot.deliver', { n: post!.id, d: duration(secondsTo(sim, arrivalTick(sim, it, nextBoundary(sim)))) })));
      setAttr(q.box, 'data-warn', why ? '' : null);
    }
  }
}

/** Goods bought and on their way, soonest first. */
class FlightBox {
  readonly root: HTMLElement;
  private readonly count = el('span.cr-count');
  private readonly list = el('div.cr-flight-list');
  private sig: string | null = null;
  private etas: Array<{ at: number; node: HTMLElement }> = [];

  constructor() {
    this.root = el('section.cr-box.cr-flight', { 'data-crier-section': 'flight' }, [el('h3.lettering', {}, [t('crier.flight'), ' ', this.count]), this.list]);
  }

  refresh(sim: Sim, colonies: readonly ColonyView[]): void {
    const ships = [...sim.trade.inflight].sort((a, b) => a.arrive - b.arrive || a.post - b.post || a.item - b.item);
    const sig = ships.map((s) => `${s.post}:${s.item}:${s.mu}:${s.arrive}`).join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      this.etas = [];
      const rows: HTMLElement[] = ships.slice(0, FLIGHT_MAX).map((s) => {
        const eta = el('span.cr-num.cr-eta');
        this.etas.push({ at: s.arrive, node: eta });
        return el('div.cr-flight-row', { 'data-flight': `${s.post}:${ITEM_IDS[s.item]}` }, [
          el('span.cr-flight-what', {}, [
            el('span.cr-name', {}, [`${num(s.mu / 1000)} × `, itemMention(s.item)]),
            el('small.cr-sub', {}, t('crier.flight.from', { colony: colonyName(colonies[s.colony]), post: s.post })),
          ]),
          eta,
        ]);
      });
      if (ships.length > FLIGHT_MAX) rows.push(el('small.cr-sub', {}, t('crier.flight.more', { n: ships.length - FLIGHT_MAX })));
      this.list.replaceChildren(...(rows.length ? rows : [el('p.cr-empty', {}, t('crier.flight.none'))]));
    }
    setText(this.count, ships.length ? String(ships.length) : '');
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
    this.flight = new FlightBox();
    this.nopost = el('div.cr-nopost', { 'data-crier-nopost': '' }, [el('h3.lettering', {}, t('crier.trade.none.title')), el('p', {}, t('crier.trade.none.text'))]);
    this.root = el('div.cr-pane.cartouche', { 'data-crier-pane': 'trade' }, [
      el('div.cr-trade', {}, [
        el('div.cr-trade-posts', {}, [el('h3.lettering.cr-sec-title', {}, [t('crier.posts.title'), ' ', this.postsCount]), this.nopost, this.posts]),
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
    const sold = lastExports(sim);
    for (const p of posts) this.cards.get(p.id)!.refresh(sim, p, f, sold, snap.colonies);
    this.spot.refresh(sim, posts);
    this.flight.refresh(sim, snap.colonies);
  }
}

// ── What pays ─────────────────────────────────────────────────────────────────

interface BoardView { readonly node: HTMLElement; readonly out: number; readonly margin: HTMLElement; readonly perTile: HTMLElement; readonly spark: Spark; readonly impact: HTMLElement }

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
  private readonly note = el('p.cr-note');
  private readonly head: HTMLElement;
  private readonly table = el('div.cr-table');
  private readonly rows = new Map<string, BoardView>();
  private ids: string | null = null;
  private key = '';
  private data: BoardRow[] = [];
  private hypo = new Map<string, BoardRow>();

  constructor(private readonly ctx: Ctx) {
    this.head = el('div.cr-row.cr-brow.cr-headrow', {}, [
      el('span', {}, t('crier.col.recipe')),
      el('span.cr-num', { title: t('crier.col.margin.tip') }, t('crier.col.margin')),
      el('span.cr-num', { title: t('crier.col.perTile.tip') }, t('crier.col.perTile')),
      el('span.cr-mid', {}, t('crier.col.spark')),
      el('span', {}, t('crier.col.impact')),
    ]);
    this.root = el('div.cr-pane.cartouche', { 'data-crier-pane': 'board' }, [this.note, this.table]);
  }

  private row(id: string): BoardView {
    const r = (RECIPES as Record<string, RecipeDef>)[id]!;
    const out = itemOf(r.outs[0]![0]);
    const machine = (BUILDINGS as Record<string, BuildingDef>)[r.machines[0]!]?.name[locale()] ?? '';
    const margin = el('span.cr-num.cr-margin'), perTile = el('span.cr-num.cr-pertile'), spark = new Spark(), impact = el('span.cr-impact');
    const node = el('div.cr-row.cr-brow', { 'data-board-recipe': id }, [
      el('span.cr-item', {}, [
        itemIcon(this.ctx.atlas, out, 20),
        el('span.cr-stack', {}, [el('span.cr-name', {}, r.name[locale()]), el('small.cr-sub', {}, machine)]),
        el('span.cr-best', {}, t('crier.board.best')),
      ]),
      margin, perTile, el('span.cr-mid', {}, [spark.root]), impact,
    ]);
    return { node, out, margin, perTile, spark, impact };
  }

  refresh(sim: Sim, items: ReadonlyMap<number, ItemMarket>): void {
    setText(this.note, t('crier.board.note', { energy: num(ENERGY_COST) }));
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
    const order = this.data.map((r) => this.rows.get(r.recipe)?.node).filter((n): n is HTMLElement => !!n);
    const kids = this.table.children;
    if (kids.length !== order.length + 1 || kids[0] !== this.head || order.some((n, k) => kids[k + 1] !== n)) this.table.replaceChildren(this.head, ...order);
    let best = true;
    for (const r of this.data) {
      const v = this.rows.get(r.recipe);
      if (!v) continue;
      setText(v.margin, ocNum(r.margin * 100, true));
      setAttr(v.margin, 'data-sign', r.margin >= 0.005 ? '+' : r.margin <= -0.005 ? '-' : null);
      setText(v.perTile, r.perTile === null ? '—' : ocNum(r.perTile * 100));
      setAttr(v.perTile, 'title', r.perTile === null ? t('crier.board.bought') : null);
      setAttr(v.node, 'data-best', best && r.perTile !== null && r.perTile > 0 ? '' : null);
      if (r.perTile !== null) best = false;
      const im = items.get(v.out);
      if (im) v.spark.set([...im.history, im.mid], im.value * 100);
      const own = r.flow >= 0.05;
      const h = this.hypo.get(r.recipe);
      setText(v.impact, own ? t('crier.board.impact', { rate: rate(round2(r.flow)), pct: spct(r.impact) })
        : h ? t('crier.board.oneMachine', { rate: rate(round2(h.flow)), pct: spct(h.impact) }) : '—');
      setAttr(v.impact, 'data-own', own ? '' : null);
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

  constructor() {
    this.root = el('section.cr-gazette.cartouche', { 'data-crier-section': 'gazette' }, [
      el('header.cr-gz-head', {}, [el('h2.lettering', {}, t('crier.gazette')), el('small', {}, t('crier.gazette.sub'))]),
      this.list,
    ]);
  }

  private entry(ev: MarketEvent, when: 'now' | 'soon', colonies: readonly ColonyView[]): HTMLElement {
    const it = itemOf(ev.item);
    const at = el('small.cr-gz-when'), held = el('small.cr-gz-held');
    this.live.push((sim) => {
      setText(at, when === 'soon' ? t('crier.gazette.starts', { d: duration(secsToEpoch(sim, ev.start)) }) : t('crier.gazette.ends', { d: duration(secsToEpoch(sim, ev.end)) }));
      // A demand event on something the Hearth holds: say so (the first trade is a sale).
      const n = it >= 0 && ev.side === 'demand' ? Math.floor((sim.stock[it] ?? 0) / 1000) : 0;
      setText(held, n > 0 ? t('crier.gazette.held', { n }) : '');
    });
    return el('article.cr-gz', { 'data-gazette': ev.id, 'data-when': when, 'data-side': ev.side }, [
      el('span.cr-gz-glyph', { title: t(`crier.kind.${ev.kind}` as MsgKey) }, ev.side === 'demand' ? '▲' : '▼'),
      el('div.cr-gz-body', {}, [el('p.cr-gz-line', {}, capFirst(eventLine(ev, colonies))), el('div.cr-gz-meta', {}, [at, held])]),
      it >= 0 ? null : el('span.cr-gz-tier.lettering', {}, t('crier.tier', { n: ev.tier })),
    ]);
  }

  refresh(sim: Sim, snap: MarketSnapshot): void {
    const { active, announced } = snap.events;
    const sig = `${announced.map((e) => e.id).join(',')}|${active.map((e) => e.id).join(',')}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.live = [];
      const kids: HTMLElement[] = [];
      if (announced.length) kids.push(el('h3.cr-gz-sec.lettering', {}, t('crier.gazette.soon')), ...announced.map((e) => this.entry(e, 'soon', snap.colonies)));
      if (active.length) kids.push(el('h3.cr-gz-sec.lettering', {}, t('crier.gazette.now')), ...active.map((e) => this.entry(e, 'now', snap.colonies)));
      this.list.replaceChildren(...(kids.length ? kids : [el('p.cr-empty', {}, t('crier.gazette.empty'))]));
    }
    for (const f of this.live) f(sim);
  }
}

// ── the screen ────────────────────────────────────────────────────────────────

interface Parts {
  readonly balance: HTMLElement;
  readonly rate: HTMLElement;
  readonly level: HTMLElement;
  readonly fee: HTMLElement;
  readonly through: HTMLElement;
  readonly lift: HTMLElement;
  readonly posts: HTMLElement;
  readonly legend: HTMLElement;
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
      const b = el<'button'>('button.btn.cr-tab', { 'data-crier-tab': k, onclick: () => this.show(k) }, t(`crier.tab.${k}` as MsgKey));
      tabs.set(k, b);
      return b;
    }));
    const p: Parts = {
      balance: el('span.cr-balance', { 'data-crier-balance': '' }),
      rate: el('span.cr-rate', { 'data-crier-rate': '', title: t('crier.rate.tip') }),
      level: el('span.cr-fact'), fee: el('span.cr-fact'), through: el('span.cr-fact'), lift: el('span.cr-fact'), posts: el('span.cr-fact'),
      legend: el('p.cr-legend'),
      tabs,
      prices: new PricesPane(ctx, snap, (item) => this.tradeItem(item)),
      trade: new TradePane(ctx, this.forms),
      board: new BoardPane(ctx),
      gazette: new GazetteBox(),
    };
    this.root.replaceChildren(
      el('header.cr-head', {}, [
        el('h1.lettering', {}, t('screen.market')),
        el('div.cr-purse', { title: t('crier.balance.tip') }, [el('span.cr-coin', {}, '◉'), p.balance, p.rate]),
        el('div.cr-facts', {}, [p.level, p.fee, p.through, p.lift, p.posts]),
        el('button.btn.rs-close', { onclick: () => this.host.close(), title: t('screen.close') }, '✕'),
      ]),
      el('div.cr-body', {}, [
        el('aside.cr-side', {}, [el('div.cr-orbit', {}, [this.orbit.root]), p.legend, p.gazette.root]),
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

    // The purse and what every post does at this research.
    const f = postFacts(sim);
    setText(ui.balance, ocNum(sim.credits));
    const perHour = tradePerHour(sim);
    setText(ui.rate, Math.abs(perHour) >= 50 ? t('crier.rate', { v: oc(perHour, true, 0) }) : '');
    setAttr(ui.rate, 'data-sign', perHour >= 50 ? '+' : perHour <= -50 ? '-' : null);
    setText(ui.level, t('crier.level', { n: f.level }));
    setText(ui.fee, t('crier.fee', { v: feeText(f.fee) }));
    setText(ui.through, t('crier.throughput', { rate: rate(f.perMin) }));
    setText(ui.lift, t('crier.lift', { d: minutes(f.liftMin) }));
    // What each chip means, on hover.
    setAttr(ui.level, 'title', t('crier.level.tip'));
    setAttr(ui.fee, 'title', t('crier.fee.tip', { v: feeText(f.fee) }));
    setAttr(ui.through, 'title', t('crier.throughput.tip'));
    setAttr(ui.lift, 'title', t('crier.lift.tip'));
    setAttr(ui.posts, 'title', t('crier.posts.tip'));
    const posts = sim.tradePosts();
    const np = posts.length;
    setText(ui.posts, np ? t('crier.posts', { n: np, max: maxPosts(sim.mods) }) : t('crier.noPost'));
    setAttr(ui.posts, 'data-none', np ? null : '');
    setText(ui.legend, `${t('crier.orbit.legend', { n: snap.colonies.length })} · ${snap.trade.length ? t('crier.orbit.trading', { n: snap.trade.length }) : t('crier.orbit.none')}`);

    ui.gazette.refresh(sim, snap);
    this.paintTabs(ui);
    const items = new Map(snap.items.map((im) => [im.idx, im] as const));
    if (this.tab === 'prices') ui.prices.refresh(sim, snap, items, f);
    else if (this.tab === 'trade') ui.trade.refresh(sim, snap, f, posts);
    else ui.board.refresh(sim, items);
  }

  frame(dt: number): void { this.orbit.frame(dt); }
}
