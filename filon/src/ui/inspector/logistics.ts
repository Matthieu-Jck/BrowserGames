// logistics.ts — inspector panels of the moving parts: what rides a ribbon, a fork's per-side
// filters, a silo's one item (the skydock's store, outlet pickers, drifters and freight routes
// went with it in D108; a trade post has no outlet to set, D62). Items show their icons
// (mention.ts); item choices are pickers with icons (item-picker.ts). A router's ways are named
// from where it faces (ahead, left, right; the compass beside them), as the player sees the
// block, not as the map's north. Rows show rather than tell (D53, owner 2026-10-13): « Devant :
// [item] », an empty slot for nothing, the explanations on hover. Each part is a section of the kit (D89) tagged with the
// logistics facet (D88: the Logistique view lifts it); a silo's one item and its gauge sit at the
// top (`storeHero`), what it does. A ribbon the Gleaners reach at night (D103) says so under what it
// carries — « Exposé la nuit », the crescent — or that it is safe (under glass, behind a fence), and
// what they took on its line since the last nightfall.
import { ITEM_IDS, buildingDef } from '@/content/registry';
import type { BuildingDef } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { t, type MsgKey } from '@/i18n/i18n';
import { filterOf } from '@/sim/cfg';
import type { Chain } from '@/sim/flow/chain';
import type { ReservoirNode } from '@/sim/flow/nodes';
import type { Rot } from '@/sim/types';
import { glyph } from '../glyphs';
import { refusalCanvas, viewIconCanvas } from '@/render/art/view-icons';
import { refusedAt } from '@/sim/readouts/core-door';
import { tileIndex } from '@/sim/world/grid';
import { itemMention } from '../mention';
import { fmt, heldList, itemSelect, mark, meter, note, row, section, type Panel, type PanelCtx } from './kit';

export const ribbonPanel: Panel = ({ sim, e, live }) => {
  const list = heldList(live, () => {
    const c: Chain | undefined = sim.chainAt(e.x, e.y);
    const sums = new Map<number, number>();
    for (const r of c?.contents() ?? []) sums.set(r.item, (sums.get(r.item) ?? 0) + r.mu);
    return [...sums].map(([i, mu]) => [i, mu / 1000] as const);
  }, glyph('empty', t('insp.ribbon.empty')), { named: true });
  return [section({ sec: 'ribbon', title: t('insp.onRibbon'), icon: mark('cargo'), group: 'logistics' }, [list, doorRow(sim, e, live)]), nightSection(sim, e, live)];
};

/**
 * Its line stopped at a door (D139): the head an item the Core refuses — any waste — or the machine
 * it feeds does not take. The refusal's badge (the world hangs the same over the door) and a short
 * line; how to sort it on hover. Hidden while the line runs.
 */
function doorRow(sim: PanelCtx['sim'], e: PanelCtx['e'], live: PanelCtx['live']): HTMLElement {
  const icon = el('span.insp-refused-icon'), say = el('span.insp-label');
  const r = el('div.insp-row.insp-refused', { 'data-refused': '', hidden: '', title: t('insp.refused.tip') }, [icon, say]);
  let sig = '';
  live(() => {
    const at = refusedAt(sim, sim.chainAt(e.x, e.y));
    const now = at ? `${at.item}:${at.by}` : '';
    if (now === sig) return;
    sig = now;
    setAttr(r, 'hidden', at ? null : '');
    setAttr(r, 'data-item', at ? ITEM_IDS[at.item] ?? null : null);
    if (!at) return;
    icon.replaceChildren(refusalCanvas(at.item, 22));
    setText(say, at.by === 'core' ? t('insp.refused.core') : t('insp.refused.machine'));
  });
  return r;
}

/** Is tile t in a sorted list of tiles? */
const listed = (arr: Int32Array, t: number): boolean => {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, v = arr[m]!; if (v === t) return true; if (v < t) lo = m + 1; else hi = m - 1; }
  return false;
};

/**
 * The Gleaners at night (D103): whether they reach this ribbon from the desert (sim/world/reach.ts),
 * or it is kept from them — under glass, buried (D109), behind a fence — and what they took on its line since the
 * last nightfall (the line's marks). Nothing for a ribbon nowhere near the open desert.
 */
function nightSection(sim: PanelCtx['sim'], e: PanelCtx['e'], live: PanelCtx['live']): HTMLElement | null {
  sim.ensureCompiled();
  const tile = tileIndex(e.x, e.y), g = sim.graph.glean;
  const exposed = listed(g.exposed, tile);
  if (!exposed && !listed(g.guarded, tile)) return null;
  const b = buildingDef(e.def);
  const say = exposed ? t('insp.glean.exposed') : b.glazed ? t('insp.glean.glass') : b.camo ? t('insp.glean.buried') : t('insp.glean.fence');
  const state = el('div.insp-row.insp-glean', { 'data-glean': exposed ? 'exposed' : 'guarded' }, [viewIconCanvas(exposed ? 'moon' : 'guard', 18), el('span.insp-label', {}, say)]);
  const taken = el('b');
  const takenRow = row(t('insp.glean.taken'), taken);
  live(() => {
    const c: Chain | undefined = sim.chainAt(e.x, e.y);
    let mu = 0;
    for (const v of c?.tiles ?? []) mu += sim.gleaners.marks.get(v) ?? 0;
    setText(taken, String(Math.round(mu / 1000)));
    setAttr(takenRow, 'hidden', mu > 0 ? null : '');
  });
  return section({ sec: 'night', title: t('insp.glean.title'), icon: viewIconCanvas('moon', 16, false), group: 'logistics' }, [state, exposed ? note(t('insp.glean.exposed.tip')) : null, takenRow]);
}

/** A side of a block: where it is from the block's front (ahead, left, right, behind) with the compass beside, and that as one name. */
function sideLabel(d: number, front: number | null): { node: HTMLElement; name: string } {
  const compass = t(`insp.side.${'NESW'[d]}` as MsgKey);
  if (front === null) return { node: el('span.insp-label', {}, compass), name: compass };
  const rel = t((['insp.fork.front', 'insp.fork.right', 'insp.fork.back', 'insp.fork.left'] as const)[(d - front + 4) & 3]!);
  return { node: el('span.insp-label', {}, [rel, el('small.insp-compass', {}, compass)]), name: `${rel} (${compass})` };
}

/**
 * Routing blocks: a sorter's / inverted sorter's chosen item, a gate's rule; a
 * router's way in (its back) and what each of its three ways out takes (owner, 2026-10-12:
 * "where to send which entry"); a distributor's filter per side.
 */
export const forkPanel: Panel = ({ sim, e }) => {
  const logic = buildingDef(e.def).logic ?? 'router';
  // The rule in a line — but a router's and a distributor's description says it already, just above.
  const rule = logic === 'router' || logic === 'distributor' ? null : note(t(`insp.route.${logic}` as MsgKey));
  const set = (d: number) => (v: number): void => { sim.setForkFilter(e.id, (d & 3) as Rot, v < 0 ? null : ITEM_IDS[v]!); };
  if (logic === 'sorter' || logic === 'inverted') {
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
