// logistics.ts — inspector panels of the moving parts: what rides a ribbon, a fork's per-side
// filters, what a store holds, what each outlet of a store hands out, and a skydock's drifters
// and freight routes. Items show their icons (mention.ts); item choices are pickers with icons
// (item-picker.ts). A router's ways are named from where it faces (ahead, left, right; the
// compass beside them), as the player sees the block, not as the map's north. Rows show rather
// than tell (D53, owner 2026-10-13): « Contenu : [items] », « Sortie 1 : [item] », an empty slot
// for nothing, the explanations on hover. Each part is a section of the kit (D89) tagged with the
// logistics facet (D88: the Logistique view lifts it); a silo's one item and its gauge sit at the
// top (`storeHero`), what it does.
import { BAL } from '@/content/balance';
import { BUILDING_KIND, ITEM_IDS, buildingDef } from '@/content/registry';
import type { BuildingDef } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { rate } from '@/i18n/format';
import { t, type MsgKey } from '@/i18n/i18n';
import { filterOf } from '@/sim/cfg';
import type { Chain } from '@/sim/flow/chain';
import type { ReservoirNode } from '@/sim/flow/nodes';
import { dockShips } from '@/sim/space';
import type { Rot } from '@/sim/types';
import { glyph } from '../glyphs';
import { itemPicker } from '../item-picker';
import { itemMention, itemRef } from '../mention';
import { CARGO, costChips, fmt, heldList, itemSelect, mark, meter, note, row, section, seenBy, type Panel, type PanelCtx } from './kit';

export const ribbonPanel: Panel = ({ sim, e, live }) => {
  const list = heldList(live, () => {
    const c: Chain | undefined = sim.chainAt(e.x, e.y);
    const sums = new Map<number, number>();
    for (const r of c?.contents() ?? []) sums.set(r.item, (sums.get(r.item) ?? 0) + r.mu);
    return [...sums].map(([i, mu]) => [i, mu / 1000] as const);
  }, glyph('empty', t('insp.ribbon.empty')), { named: true });
  return [section({ sec: 'ribbon', title: t('insp.onRibbon'), icon: mark('cargo'), group: 'logistics' }, [list])];
};

/** A side of a block: where it is from the block's front (ahead, left, right, behind) with the compass beside, and that as one name. */
function sideLabel(d: number, front: number | null): { node: HTMLElement; name: string } {
  const compass = t(`insp.side.${'NESW'[d]}` as MsgKey);
  if (front === null) return { node: el('span.insp-label', {}, compass), name: compass };
  const rel = t((['insp.fork.front', 'insp.fork.right', 'insp.fork.back', 'insp.fork.left'] as const)[(d - front + 4) & 3]!);
  return { node: el('span.insp-label', {}, [rel, el('small.insp-compass', {}, compass)]), name: `${rel} (${compass})` };
}

/**
 * Routing blocks: a sorter's / inverted sorter's / unloader's chosen item, a gate's rule; a
 * router's way in (its back) and what each of its three ways out takes (owner, 2026-10-12:
 * "where to send which entry"); a distributor's filter per side.
 */
export const forkPanel: Panel = ({ sim, e }) => {
  const logic = buildingDef(e.def).logic ?? 'router';
  // The rule in a line — but a router's and a distributor's description says it already, just above.
  const rule = logic === 'router' || logic === 'distributor' ? null : note(t(`insp.route.${logic}` as MsgKey));
  const set = (d: number) => (v: number): void => { sim.setForkFilter(e.id, (d & 3) as Rot, v < 0 ? null : ITEM_IDS[v]!); };
  if (logic === 'sorter' || logic === 'inverted' || logic === 'unloader') {
    const sel = itemSelect(sim, filterOf(e.cfg, 0), t('insp.route.none'), set(0), 'fork:0', t('insp.route.item'));
    return [section({ sec: 'filters', title: t('insp.route.item'), icon: mark('filter'), group: 'logistics' }, [rule, row(t('insp.route.item'), sel)])];
  }
  if (logic !== 'router' && logic !== 'distributor') return rule ? [section({ sec: 'rule', title: t('insp.fork.rule'), icon: mark('filter'), group: 'logistics' }, [rule])] : [];
  const router = logic === 'router';
  const front = router ? e.rot & 3 : null;
  const back = router ? (e.rot + 2) & 3 : -1;
  // Ahead first, then left and right: the order the player reads the block in.
  const outs = router ? [front!, (front! + 3) & 3, (front! + 1) & 3] : [0, 1, 2, 3];
  // What a filter does, on hover of the section's header (D53).
  return [section({ sec: 'filters', title: t('insp.fork.filters'), icon: mark('filter'), group: 'logistics', tip: t('insp.fork.filters.hint') }, [
    rule,
    router ? el('div.insp-row', {}, [el('span.insp-label', {}, t('insp.fork.in')), el('span.insp-value', {}, [t('insp.fork.back'), el('small.insp-compass', {}, t(`insp.side.${'NESW'[back]}` as MsgKey))])]) : null,
    ...outs.map((d) => {
      const label = sideLabel(d, front);
      const sel = itemSelect(sim, filterOf(e.cfg, d), t('insp.fork.any'), set(d), `fork:${d}`, label.name, { 'data-fork-side': String(d) });
      return el('div.insp-row', {}, [label.node, sel]);
    }),
  ])];
};

/** A store's stock, its room per item, and whether it keeps one kind of item only (a silo). */
function storeOf({ sim, e, node }: PanelCtx): { stock: () => Float64Array | undefined; capMu: number; single: boolean } {
  const b = buildingDef(e.def) as BuildingDef;
  const res = node?.kind === 'reservoir' ? (node as ReservoirNode) : null;
  return { stock: () => res?.stock ?? sim.stores.get(e.id), capMu: res?.cap ?? (b.storageCap ?? 0) * 1000, single: res?.single ?? b.kind === 'storage' };
}

/** A silo at the top: its one item and how many against its size, as a meter; empty, what fills it. */
export const storeHero = (ctx: PanelCtx): HTMLElement | null => {
  const { stock, capMu, single } = storeOf(ctx);
  if (!single) return null;
  const icon = el('span.kbuf-icon'), g = meter();
  const empty = el('p.insp-note', {}, [glyph('empty'), ' ', t('insp.store.empty')]);
  const line = el('div.kbuf', { 'data-k': 'silo' }, [icon, g.root]);
  let shown = -2;
  ctx.live(() => {
    const st = stock();
    let item = -1;
    if (st) for (let i = 0; i < st.length; i++) if (st[i]! >= 1000) { item = i; break; }
    if (item !== shown) {
      shown = item;
      icon.replaceChildren(...(item >= 0 ? [itemMention(item, { name: false })] : []));
      setAttr(line, 'data-item', item >= 0 ? ITEM_IDS[item]! : null);
      setAttr(line, 'hidden', item >= 0 ? null : '');
      setAttr(empty, 'hidden', item >= 0 ? '' : null);
    }
    const n = item >= 0 ? Math.floor(st![item]! / 1000) : 0;
    g.set(n * 1000, capMu, capMu > 0 && n * 1000 >= capMu ? 'bad' : 'good', t('insp.store.of', { n: fmt(n, 0), cap: fmt(capMu / 1000, 0) }));
  });
  return el('div.insp-hero', { 'data-hero': 'store' }, [line, empty]);
};

/** What a skydock or a trade post holds, as chips (a silo's is its hero); empty, an empty slot. */
export const storePanel: Panel = (ctx) => {
  const { stock, capMu, single } = storeOf(ctx);
  if (single) return [];
  const list = heldList(ctx.live, () => {
    const st = stock();
    const out: Array<readonly [number, number]> = [];
    if (st) for (let i = 0; i < st.length; i++) if (st[i]! >= 1000) out.push([i, Math.floor(st[i]! / 1000)]);
    return out;
  }, glyph('empty', t('insp.store.emptyMany')), { named: false });
  return [section({ sec: 'store', title: t('insp.store'), icon: mark('store'), group: 'logistics', tip: capMu ? t('insp.store.each', { n: fmt(capMu / 1000, 0) }) : null }, [list])];
};

/** One item picker per outlet of a store (a skydock; a trade post has none to set: its one exit hands out what it bought, in turn, D62). */
export const outletsPanel: Panel = ({ sim, e }) => {
  const b = buildingDef(e.def) as BuildingDef;
  const outs = b.ports.map((p, i) => ({ p, i })).filter((q) => q.p.io === 'out');
  if (!outs.length) return [];
  return [section({ sec: 'outlets', title: t('insp.outlets'), icon: mark('gate'), group: 'logistics', tip: t('insp.outlets.hint') }, outs.map(({ i }, k) => {
    const label = t('insp.outlet', { n: k + 1 });
    // `data-outlet`: the tutorial's guide points at these. Closed: an empty slot (the word in its list and on hover).
    const sel = itemSelect(sim, e.portItems?.[i] ?? -1, t('insp.outlet.closed'), (v) => sim.setPortItem(e.id, i, v < 0 ? null : ITEM_IDS[v]!), `outlet:${k}`, label, { 'data-outlet': String(k) }, '');
    return el('div.insp-row', {}, [el('span.insp-label', {}, label), sel]);
  }))];
};

/** Drifters (buy), the routes flown from this dock (close), and a new route form. */
export const dockPanel: Panel = ({ sim, e, host, live }) => {
  // « Dirigeables  0/4  [+ cost] »: the buy button carries its price.
  const count = el('b');
  const buy = el('button.btn.insp-recipe.insp-buy', {
    title: t('insp.dock.buy'), 'aria-label': t('insp.dock.buy'),
    onclick: () => { if (!sim.buyDrifter(e.id)) host.notify('bad', t('reason.unaffordable')); },
  }, ['+', costChips(sim, Object.entries(BAL.drifterCost))]);
  const body: Array<HTMLElement | null> = [
    el('div.insp-row', {}, [el('span.insp-label', {}, t('insp.dock.ships.label')), el('span.insp-value.insp-gv', {}, [count, buy])]),
  ];
  live(() => setText(count, `${sim.fleet.get(e.id) ?? 0}/${dockShips(sim.mods, buildingDef(e.def).dock)}`));
  const list = el('div.insp-routes');
  body.push(list);
  live(() => {
    const mine = sim.routes.filter((r) => r.from === e.id);
    const sig = mine.map((r) => `${r.id}:${r.ships}`).join(',');
    if (list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    list.replaceChildren(...mine.map((r) => {
      const perMin = sim.routeRateNow(r, () => 1000) * 600 / 1000;
      return el('div.insp-row', {}, [
        el('span', {}, t('insp.dock.route', { to: t('insp.dock.name', { n: r.to }), item: itemRef(r.item), ships: r.ships, rate: rate(perMin) })),
        el('button.insp-x', { title: t('insp.dock.remove'), 'aria-label': t('insp.dock.remove'), onclick: () => sim.removeRoute(r.id) }, '✕'),
      ]);
    }));
  });
  const sec = (kids: Array<HTMLElement | null>): HTMLElement[] => [section({ sec: 'routes', title: t('insp.dock.routes'), icon: mark('route'), group: 'logistics' }, kids)];
  const others = sim.ents.sorted().filter((o) => o.id !== e.id && BUILDING_KIND[o.def] === 'dock');
  if (!others.length) {
    // No route yet, and none possible: an empty slot (what it takes, on hover).
    const r = row(t('insp.dock.routes.none'), glyph('empty', t('insp.dock.noOther')));
    r.title = t('insp.dock.noOther');
    return sec([...body, r]);
  }
  const to = el('select.insp-select', { 'aria-label': t('insp.dock.to') }, others.map((o) => el('option', { value: String(o.id) }, t('insp.dock.name', { n: o.id })))) as HTMLSelectElement;
  const cargo = CARGO();
  let item = cargo[0]!;
  const pick = itemPicker({ items: cargo, value: item, none: null, onPick: (i) => { item = i; }, known: seenBy(sim), label: t('insp.dock.item'), attrs: { 'data-pick': 'dock:item' } });
  return sec([...body, el('div.insp-row.insp-route-form', {}, [to, pick.root]),
    el('button.btn.insp-recipe', {
      onclick: () => {
        const free = sim.freeShips(e.id);
        if (free <= 0) { host.notify('warn', t('insp.dock.noShip')); return; }
        sim.addRoute(e.id, Number(to.value), ITEM_IDS[item]!, free);
      },
    }, t('insp.dock.new'))]);
};
