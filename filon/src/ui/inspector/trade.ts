// trade.ts (inspector) — the trade post's panel: its level, fee, throughput and lift delay,
// whether it stands against the Hearth (then it also sells from the Hearth's stock), its export
// streams (an item picker per slot, with icons), its standing import orders (live state, cancel),
// last minute's activity, its container (D43: purchases wait there for an outlet set to them),
// the goods on their way to it and its store. Items show their icons (mention.ts). Orders are
// placed in the Crier (M), which has room for the form and the live prices. Shared helpers:
// ../trade-view.ts.
import { BAL } from '@/content/balance';
import { N_ITEMS } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { duration, num, rate } from '@/i18n/format';
import { t } from '@/i18n/i18n';
import { containerFull, containerMu, nextToHearth, waitingMu } from '@/sim/systems/trade';
import { itemRef } from '../mention';
import { heading, heldList, row, type InspectorHost, type Panel } from './kit';
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

  // Its container (D43): what it bought, waiting for its outlets; full, the orders stop.
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

  // Its store: what came in by ribbon to be sold, or deliveries waiting for its outlets.
  const store = heldList(live, () => {
    const st = sim.stores.get(e.id);
    const held: Array<readonly [number, number]> = [];
    if (st) for (let i = 0; i < N_ITEMS; i++) if (st[i]! >= 1000) held.push([i, Math.floor(st[i]! / 1000)]);
    return held;
  }, t('insp.empty'), { named: true });
  out.push(heading(t('insp.trade.store')), store);
  return out;
};
