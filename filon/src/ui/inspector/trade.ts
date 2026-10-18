// trade.ts (inspector) — the trade post's panel, a recap (owner, 2026-10-14: "No streams, as
// there's just one entry and one out. Just a recap of what's currently in the cargo, its current
// value, and what's coming, how much it costs"; D64). Then: "make something clearer, separated,
// that takes this kind of thing into account" (a line that wrapped by accident). So every part is
// its own inked card, laid on a grid whose columns hold their place — an icon, a text that shrinks
// with an ellipsis, a value that never breaks — and two lines only where they are meant (an order):
// · the facts as three chips: what it lifts a minute, CrierBelt's cut, the lift's delay;
// · its two gates (D62): the entrance — it sells whatever it brings, every minute —, and the exit,
//   which hands its purchases out in turn, a cut ribbon while it leads nowhere (its orders then buy
//   nothing);
// · « À vendre » (D131): what its entrance brought, in a store of its own — its cargo's items too —,
//   each item's icon, × how many and what they bring at today's bid (CrierBelt's cut taken), the total
//   in the card's head: sold at the minute's end;
// · « Livré, attend la sortie »: its container, the purchases its exit hands out, × how many, and a
//   bar of them against its load (a full one stops the purchases, D43);
// · « En route »: by item, × how many, when the first lands, what they cost, the total in the head;
// · « Ordres »: one card line per order — its rate and what a minute of it costs at today's ask,
//   then its state and its price cap — with ✕; and the Crier's button, where orders are placed.
// Words on hover; numbers tabular. Shared helpers: ../trade-view.ts. Laid out by the kit (D89): the
// facts at the top (`tradeHero`, what it does), each card a section, « Ouvrir la Criée » in the foot.
import { ITEM_IDS } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { duration, num, rate } from '@/i18n/format';
import { t } from '@/i18n/i18n';
import { afterFee, valueCents } from '@/market/pricing';
import { containerFull, containerMu, handsOut, tradables, waitingMu } from '@/sim/systems/trade';
import { N_ITEMS } from '@/content/registry';
import type { Ent } from '@/sim/types';
import type { Sim } from '@/sim/state';
import { glyph } from '../glyphs';
import { itemMention, itemRef } from '../mention';
import { mark, progressBar, section, type InspectorHost, type MarkId, type Panel, type PanelCtx } from './kit';
import { feeText, minutes, oc, orderStateText, postFacts, secondsTo, unitBuyCents, type PostFacts } from '../trade-view';

/** An InspectorHost that can open the Crier on a tab (optional: the shell may provide it). */
type CrierLink = InspectorHost & { openCrier?: (tab?: 'trade') => void };

/** At the top, what the post does: what it lifts a minute, CrierBelt's cut, the lift's delay. */
export const tradeHero = ({ sim }: PanelCtx): HTMLElement => el('div.insp-hero', { 'data-hero': 'trade' }, [factChips(postFacts(sim))]);

export const tradePanel: Panel = ({ sim, e, host, live, action }) => {
  const f = postFacts(sim);
  const out: Array<HTMLElement | null> = [gateRows(sim, e, live), sellCard(sim, e, live), cargoCard(sim, e, live), flightCard(sim, e, live), ordersCard(sim, e, live, f)];
  const open = (host as CrierLink).openCrier;
  if (open) action(el('button.btn.primary.insp-recipe.tp-crier', { 'data-insp-crier': '', onclick: () => open.call(host, 'trade') }, [glyph('crier'), ' ', t('insp.trade.openCrier')]));
  return out;
};

// ── the parts ─────────────────────────────────────────────────────────────────

/** The facts, three chips that wrap as wholes, never inside: items a minute, CrierBelt's fifth, the lift's delay. */
function factChips(f: PostFacts): HTMLElement {
  return el('div.tp-facts', {}, [
    el('span.tp-fact', { title: t('insp.trade.throughput.tip', { n: f.level }) }, `⇅ ${t('insp.trade.throughput', { rate: rate(f.perMin) })}`),
    el('span.tp-fact', { title: t('insp.trade.fee.tip') }, [glyph('crier'), feeText(f.fee)]),
    el('span.tp-fact', { title: t('insp.trade.lift') }, `⇡ ${minutes(f.liftMin)}`),
  ]);
}

/** One card: a section of the kit, its title and, on the right of its head, a total; then its body. */
function card(hook: string, icon: MarkId, title: string, total: HTMLElement | null, body: Array<HTMLElement | null>): HTMLElement {
  const s = section({ sec: hook, title, icon: mark(icon), aside: total }, body);
  s.classList.add('tp-card');
  s.dataset.tp = hook;
  return s;
}

/** What its entrance brought (D131), sold at the minute's end: by item, what it brings at today's bid; the total in the head. */
function sellCard(sim: Sim, e: Ent, live: PanelCtx['live']): HTMLElement {
  const total = el('b.tp-total');
  live(() => {
    const rows = sellRows(sim, e);
    setText(total, rows.length ? oc(rows.reduce((s, r) => s + (r.cents ?? 0), 0)) : '');
  });
  const c = card('sell', 'gate', t('insp.trade.sell'), total, [liveRows(live, () => sellRows(sim, e), t('insp.trade.sell.empty'))]);
  c.title = t('insp.trade.sell.tip');
  return c;
}

/** Its container (D43): the purchases its exit hands out, by item, and a bar of them against its load. */
function cargoCard(sim: Sim, e: Ent, live: PanelCtx['live']): HTMLElement {
  const bar = progressBar();
  const fill = el('small.tp-fill-n');
  live(() => {
    // The bar: its purchases waiting for the exit against the container's load.
    const held = Math.floor(waitingMu(sim, e) / 1000), cap = Math.round(containerMu(sim) / 1000);
    const full = containerFull(sim, e);
    bar.set(cap > 0 ? held / cap : 0, full ? 'bad' : 'ok');
    setText(fill, full ? t('insp.trade.containerFull') : t('insp.trade.container', { n: num(held), cap: num(cap) }));
    setAttr(fill, 'data-full', full ? '' : null);
  });
  return card('cargo', 'cargo', t('insp.trade.cargo'), null, [
    liveRows(live, () => cargoRows(sim, e), t('insp.trade.cargo.empty')),
    el('div.tp-fill', { title: t('insp.trade.containerHint') }, [bar.root, fill]),
  ]);
}

function flightCard(sim: Sim, e: Ent, live: PanelCtx['live']): HTMLElement {
  const total = el('b.tp-total');
  live(() => {
    const ships = sim.trade.inflight.filter((s) => s.post === e.id);
    setText(total, ships.length ? oc(ships.reduce((s, x) => s + (x.cents ?? 0), 0)) : '');
  });
  return card('flight', 'flight', t('insp.trade.flight'), total, [liveRows(live, () => flightRows(sim, e), t('crier.flight.none'))]);
}

/** Its standing orders (placed in the Crier), each on a two-line card row: rate and cost a minute; state and cap. */
function ordersCard(sim: Sim, e: Ent, live: PanelCtx['live'], f: PostFacts): HTMLElement {
  const mine = sim.trade.orders.filter((o) => o.post === e.id);
  const rows = mine.map((o) => {
    const state = el('span.tr-state'), cost = el('span.tp-cost');
    live(() => {
      const s = orderStateText(sim, o);
      setText(state, s.text);
      setAttr(state, 'data-state', s.state);
      setAttr(state, 'title', s.why);
      setText(cost, t('insp.trade.order.cost', { cents: oc(unitBuyCents(sim, o.item) * o.perMin) }));
    });
    return el('div.tr-order.tp-order', { 'data-item': ITEM_IDS[o.item], title: t('insp.trade.order.tip', { item: itemRef(o.item), max: oc(o.maxCents) }) }, [
      el('span.tp-icon', {}, itemMention(o.item, { name: false })),
      el('span.tp-rate', {}, rate(o.perMin)),
      cost,
      el('button.insp-x.tp-x', { title: t('crier.order.cancel'), 'aria-label': t('crier.order.cancel'), 'data-insp-order-cancel': String(o.id), onclick: () => sim.cancelImport(o.id) }, '✕'),
      el('span.tp-sub', {}, [state, el('small.tp-cap', {}, t('insp.trade.order.cap', { max: oc(o.maxCents) }))]),
    ]);
  });
  return card('orders', 'order', t('insp.trade.orders', { used: sim.trade.orders.length, max: f.orders }), null,
    rows.length ? rows : [el('span.insp-empty', {}, t('insp.trade.noOrder'))]);
}

// ── the recap's rows ──────────────────────────────────────────────────────────

/** One line of a card: an item, how many, a note (when it lands) and a value (centi-◉; none for the container's purchases). */
interface RecapRow { key: string; item: number; n: number; cents?: number; note?: string }

/** What its entrance brought (D131), by item: how many and what they bring at today's bid, CrierBelt's cut taken. */
function sellRows(sim: Sim, e: Ent): RecapRow[] {
  const st = sim.selling.get(e.id);
  if (!st) return [];
  const rows: RecapRow[] = [];
  for (const i of tradables()) {
    const n = Math.floor(st[i]! / 1000);
    if (n <= 0) continue;
    rows.push({ key: `s${i}`, item: i, n, cents: afterFee(valueCents(n * 1000, sim.prices.bid[i] ?? 0, 'sell'), 'sell', sim.mods.tradeFee) });
  }
  return rows;
}

/** What its container holds, by item: the purchases waiting for its exit. */
function cargoRows(sim: Sim, e: Ent): RecapRow[] {
  const st = sim.stores.get(e.id);
  if (!st) return [];
  const rows: RecapRow[] = [];
  for (let i = 0; i < N_ITEMS; i++) {
    const n = Math.floor(st[i]! / 1000);
    if (n > 0) rows.push({ key: `c${i}`, item: i, n });
  }
  return rows;
}

/** What is on its way to the post, by item (soonest first): how many in all, when the first lands, what they cost. */
function flightRows(sim: Sim, e: Ent): RecapRow[] {
  const by = new Map<number, { n: number; cents: number; first: number }>();
  for (const s of sim.trade.inflight) {
    if (s.post !== e.id) continue;
    const r = by.get(s.item) ?? { n: 0, cents: 0, first: s.arrive };
    r.n += Math.round(s.mu / 1000); r.cents += s.cents ?? 0; r.first = Math.min(r.first, s.arrive);
    by.set(s.item, r);
  }
  return [...by].sort((a, b) => a[1].first - b[1].first || a[0] - b[0])
    .map(([item, r]) => ({ key: `f${item}`, item, n: r.n, cents: r.cents, note: t('insp.trade.flight.in', { d: duration(secondsTo(sim, r.first)) }) }));
}

/**
 * Card lines kept in step at 4 Hz, on a grid that holds its columns: the item's icon (its name on
 * hover), « × n » and the note (shrinking with an ellipsis), the value (never broken). Lines are
 * rebuilt only when the list's shape changes; the numbers are written change-only.
 */
function liveRows(live: PanelCtx['live'], read: () => RecapRow[], empty: string): HTMLElement {
  const box = el('div.tp-recap');
  const none = el('span.insp-empty', {}, empty);
  let sig: string | null = null; // nothing drawn yet: the first read always builds (an empty list shows `empty`)
  let cells: Array<{ n: HTMLElement; note: HTMLElement; v: HTMLElement }> = [];
  live(() => {
    const rows = read();
    const s = rows.map((r) => `${r.key}:${r.item}`).join(',');
    if (s !== sig) {
      sig = s;
      cells = rows.map(() => ({ n: el('b.tp-n'), note: el('small.tp-when'), v: el('span.tp-v') }));
      box.replaceChildren(...(rows.length ? rows.map((r, k) => el('div.tp-line', { 'data-item': ITEM_IDS[r.item], title: itemRef(r.item) }, [
        el('span.tp-icon', {}, itemMention(r.item, { name: false })), el('span.tp-mid', {}, [cells[k]!.n, cells[k]!.note]), cells[k]!.v,
      ])) : [none]));
    }
    rows.forEach((r, k) => {
      const c = cells[k]!;
      setText(c.n, `× ${num(r.n)}`);
      setText(c.note, r.note ?? '');
      setText(c.v, r.cents === undefined ? '' : oc(r.cents));
    });
  });
  return box;
}

// ── its gates (D62) ───────────────────────────────────────────────────────────

/**
 * The post's entrance and exit, as icons (owner: "show, don't tell"; the words on hover). The
 * entrance sells whatever it brings (D64: no streams). The exit hands out what the post bought, in
 * turn, and shows a cut ribbon while it is linked to nothing (its orders then buy nothing:
 * `handsOut`). Hooks: `[data-gate="in|out"]`, `[data-gate-linked]` on the exit.
 */
function gateRows(sim: Sim, e: Ent, live: PanelCtx['live']): HTMLElement {
  const inRow = el('div.tp-gate', { 'data-gate': 'in', title: t('insp.trade.gate.in.tip') }, [
    glyph('gateIn'), el('span.tp-gate-name', {}, t('insp.trade.gate.in')), el('span.tp-gate-what', {}, t('insp.trade.gate.sells')), el('span'),
  ]);
  const turn = glyph('turn', t('insp.trade.gate.turn'));
  const cut = glyph('noLink', t('insp.trade.gate.unlinked'));
  const outRow = el('div.tp-gate', { 'data-gate': 'out', title: t('insp.trade.gate.out.tip') }, [
    glyph('gateOut'), el('span.tp-gate-name', {}, t('insp.trade.gate.out')), el('span.tp-gate-what', {}, t('insp.trade.gate.hands')), el('span.tp-gate-marks', {}, [turn, cut]),
  ]);
  live(() => {
    const linked = handsOut(sim, e, -1);
    setAttr(outRow, 'data-gate-linked', linked ? '' : null);
    setAttr(cut, 'hidden', linked ? '' : null);
    setAttr(turn, 'hidden', sim.cargoOf(e.id).length > 1 ? null : '');
  });
  const sec = section({ sec: 'gates', title: t('insp.trade.gates'), icon: mark('gate'), group: 'logistics' }, [el('div.tp-gates', {}, [inRow, outRow])]);
  sec.classList.add('tp-card');
  return sec;
}
