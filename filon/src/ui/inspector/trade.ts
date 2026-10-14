// trade.ts (inspector) — the trade post's panel: its level, fee, throughput and lift delay,
// whether it stands against the Hearth (then it also sells from the Hearth's stock), its two
// gates (D62) shown rather than told — the entrance with the icons of what it sells, the exit
// with the icons of what it hands out in turn and how many of each wait, a cut ribbon when the
// exit is linked to nothing —, its export streams (an item picker per slot, with icons), its
// standing import orders (live state, cancel), last minute's activity, its container (D43:
// purchases wait there for the exit), the goods on their way to it and its store. A post has no
// outlet to set: its one exit hands out everything it bought, in turn. Items show their icons
// (mention.ts). Orders are placed in the Crier (M), which has room for the form and the live
// prices. Shared helpers: ../trade-view.ts.
import { BAL } from '@/content/balance';
import { ITEM_IDS, N_ITEMS } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { duration, num, rate } from '@/i18n/format';
import { t } from '@/i18n/i18n';
import { containerFull, containerMu, handsOut, importItems, nextToHearth, waitingMu } from '@/sim/systems/trade';
import type { Ent } from '@/sim/types';
import type { Sim } from '@/sim/state';
import { glyph } from '../glyphs';
import { itemMention, itemRef } from '../mention';
import { heading, heldList, row, type InspectorHost, type Panel, type PanelCtx } from './kit';
import { feeText, lastExports, minutes, nextArrival, oc, orderStateText, postFacts, refusalText, secondsTo, tradeSelect } from '../trade-view';

// ── the panel ─────────────────────────────────────────────────────────────────

/** An InspectorHost that can open the Crier on a tab (optional: the shell may provide it). */
type CrierLink = InspectorHost & { openCrier?: (tab?: 'trade') => void };

export const tradePanel: Panel = ({ sim, e, host, live }) => {
  const f = postFacts(sim);
  const hearth = nextToHearth(sim, e);
  const out: Array<HTMLElement | null> = [
    row(t('insp.trade.level', { n: f.level }), t('insp.trade.throughput', { rate: rate(f.perMin) })),
    row(t('insp.trade.fee'), feeText(f.fee)),
    row(t('insp.trade.lift'), minutes(f.liftMin)),
    el('p.tr-where', { 'data-hearth': hearth ? '' : null }, hearth ? t('insp.trade.hearth', { n: BAL.tradeHearthReserve }) : t('insp.trade.ribbons')),
    ...gateRows(sim, e, live),
  ];

  // Last minute: what went up and down, and what it brought.
  const last = el('div.tr-act');
  out.push(last);
  live(() => {
    const a = sim.trade.activity.get(e.id);
    setText(last, t('insp.trade.last', {
      what: a && a.epoch === sim.absEpoch() - 1
        ? t('insp.trade.lastValue', { sold: Math.round(a.soldMu / 1000), bought: Math.round(a.boughtMu / 1000), cents: oc(a.cents, true) })
        : t('insp.trade.idle'),
    }));
  });

  // Export streams: one picker per slot; a refused pick goes back to what the post sells.
  const streams = sim.streamsOf(e.id);
  out.push(heading(t('insp.trade.streams', { used: streams.filter((i) => i >= 0).length, max: streams.length })));
  streams.forEach((cur, slot) => {
    const label = t('insp.trade.stream', { n: slot + 1 });
    const sel = tradeSelect(cur, t('crier.stream.none'), (item) => {
      const r = sim.setExport(e.id, slot, item);
      if (r) {
        host.notify('bad', refusalText(r));
        sel.set(sim.streamsOf(e.id)[slot] ?? -1);
      }
    }, { 'data-insp-slot': `${e.id}:${slot}`, 'data-pick': `stream:${slot}` }, sim, label);
    const info = el('small.tr-sub');
    if (cur >= 0) {
      live(() => {
        const sold = lastExports(sim).get(`${e.id}:${cur}`);
        setText(info, t('crier.stream.info', { bid: oc(sim.prices.bid[cur] ?? 0), n: Math.round((sold?.mu ?? 0) / 1000) }));
      });
    }
    out.push(el('div.insp-row', {}, [el('span.insp-label', {}, label), sel.root]), cur >= 0 ? info : null);
  });

  // Standing orders of this post (placed in the Crier): state and next delivery, cancel.
  const mine = sim.trade.orders.filter((o) => o.post === e.id);
  out.push(heading(t('insp.trade.orders', { used: sim.trade.orders.length, max: f.orders })));
  if (!mine.length) out.push(el('small.tr-sub', {}, t('insp.trade.noOrder')));
  for (const o of mine) {
    const state = el('span.tr-state'), eta = el('small.tr-sub');
    live(() => {
      const s = orderStateText(sim, o);
      setText(state, s.text);
      setAttr(state, 'data-state', s.state);
      setAttr(state, 'title', s.why);
      const at = nextArrival(sim, e.id, o.item);
      setText(eta, at !== null ? t('crier.order.eta', { d: duration(secondsTo(sim, at)) }) : '');
    });
    out.push(
      el('div.insp-row.tr-order', {}, [
        el('span', {}, t('insp.trade.order', { item: itemRef(o.item), rate: rate(o.perMin), max: oc(o.maxCents) })),
        state,
        el('button.insp-x', { title: t('crier.order.cancel'), 'aria-label': t('crier.order.cancel'), 'data-insp-order-cancel': String(o.id), onclick: () => sim.cancelImport(o.id) }, '✕'),
      ]),
      eta,
    );
  }
  const open = (host as CrierLink).openCrier;
  out.push(el('small.tr-sub', {}, t('insp.trade.hintCrier')));
  if (open) out.push(el('button.btn.insp-recipe', { 'data-insp-crier': '', onclick: () => open.call(host, 'trade') }, t('insp.trade.openCrier')));

  // Its container (D43): what it bought, waiting for its exit; full, the orders stop.
  const box = el('div.tr-container'), boxFull = el('small.tr-sub.tr-full');
  out.push(box, boxFull, el('small.tr-sub', {}, t('insp.trade.containerHint')));
  live(() => {
    const cap = Math.round(containerMu(sim) / 1000);
    setText(box, t('insp.trade.container', { n: num(Math.floor(waitingMu(sim, e) / 1000)), cap: num(cap) }));
    const full = containerFull(sim, e);
    setAttr(box, 'data-full', full ? '' : null);
    setText(boxFull, full ? t('insp.trade.containerFull') : '');
  });

  // Goods on their way here, soonest first.
  const flight = el('div.insp-list.tr-lines');
  out.push(heading(t('insp.trade.flight')), flight);
  live(() => {
    const ships = sim.trade.inflight.filter((s) => s.post === e.id).sort((a, b) => a.arrive - b.arrive || a.item - b.item);
    const lines = ships.slice(0, 6).map((s) => `${num(s.mu / 1000)} × ${itemRef(s.item)} · ${t('crier.flight.eta', { d: duration(secondsTo(sim, s.arrive)) })}`);
    if (ships.length > 6) lines.push(t('crier.flight.more', { n: ships.length - 6 }));
    setText(flight, lines.join('\n') || t('crier.flight.none'));
  });

  // Its store: what came in by its entrance to be sold, or deliveries waiting for its exit.
  const store = heldList(live, () => {
    const st = sim.stores.get(e.id);
    const held: Array<readonly [number, number]> = [];
    if (st) for (let i = 0; i < N_ITEMS; i++) if (st[i]! >= 1000) held.push([i, Math.floor(st[i]! / 1000)]);
    return held;
  }, t('insp.empty'), { named: true });
  out.push(heading(t('insp.trade.store')), store);
  return out;
};

// ── its gates (D62) ───────────────────────────────────────────────────────────

/**
 * The post's entrance and exit, as icons (owner: "show, don't tell"; the words on hover). The
 * entrance: what it sells, its export streams' items (the streams shape the panel: a change
 * rebuilds it). The exit: what it hands out in turn — what its orders buy, what is on its way,
 * what still waits in its container (`importItems`, the engine's own list) — each with how many
 * wait, the « in turn » arrow once there are two or more, and a cut ribbon while the exit is
 * linked to nothing (its orders then buy nothing: `handsOut`). Hooks: `[data-gate="in|out"]`,
 * `[data-gate-linked]` on the exit, its chips `[data-item]`.
 */
function gateRows(sim: Sim, e: Ent, live: PanelCtx['live']): HTMLElement[] {
  const sells = sim.streamsOf(e.id).filter((i) => i >= 0);
  const inItems = el('span.insp-value.insp-held.tr-gate-items', {}, sells.length
    ? sells.map((i) => el('span.insp-chip', { 'data-item': ITEM_IDS[i] }, itemMention(i, { name: sells.length < 3 })))
    : [glyph('empty', t('insp.trade.gate.noSale'))]);
  const inRow = el('div.insp-row.tr-gate', { 'data-gate': 'in', title: t('insp.trade.gate.in.tip') }, [
    glyph('gateIn'), el('span.insp-label', {}, t('insp.trade.gate.in')), inItems,
  ]);

  const turn = glyph('turn', t('insp.trade.gate.turn'));
  const cut = glyph('noLink', t('insp.trade.gate.unlinked'));
  const outItems = heldList(live, () => {
    const st = sim.stores.get(e.id);
    return (importItems(sim).get(e.id) ?? []).map((i) => [i, Math.floor((st?.[i] ?? 0) / 1000)] as const);
  }, glyph('empty', t('insp.trade.gate.noBuy')));
  outItems.classList.add('tr-gate-items');
  const outRow = el('div.insp-row.tr-gate', { 'data-gate': 'out', title: t('insp.trade.gate.out.tip') }, [
    glyph('gateOut'), el('span.insp-label', {}, t('insp.trade.gate.out')), turn, outItems, cut,
  ]);
  live(() => {
    const linked = handsOut(sim, e, -1);
    setAttr(outRow, 'data-gate-linked', linked ? '' : null);
    setAttr(cut, 'hidden', linked ? '' : null);
    setAttr(turn, 'hidden', outItems.childElementCount > 1 ? null : '');
  });
  return [inRow, outRow];
}
