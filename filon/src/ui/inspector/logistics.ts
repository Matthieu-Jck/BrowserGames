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
// what they took on its line since the last nightfall. A conduit's tee (D152: a line drawing water
// off its side) shows how its water divides: a bar per way out, its water a minute (`teePanel`). A
// pressure gauge (D155) shows its dial at the top as the world draws it (`gaugeHero`) and its water
// network's figures under it (`gaugePanel`): the pumps' water against the drinkers', as bars with their
// icons, and — short or tight — what to add, as icons: so many pumps more, or high-pressure pumps, or
// power for the pumps that lack it.
import { BUILDING_IDS, ITEM_IDS, buildingDef, itemIdx } from '@/content/registry';
import type { BuildingDef } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import { filterOf } from '@/sim/cfg';
import type { Chain } from '@/sim/flow/chain';
import type { FNode } from '@/sim/flow/node';
import type { ReservoirNode } from '@/sim/flow/nodes';
import type { Rot } from '@/sim/types';
import { glyph } from '../glyphs';
import { refusalCanvas, viewIconCanvas } from '@/render/art/view-icons';
import { refusedAt } from '@/sim/readouts/core-door';
import { tileIndex } from '@/sim/world/grid';
import { itemMention } from '../mention';
import { buildingIcon } from '../build-bar';
import { PRESSURE_COL, drawDial, drawGaugeNeedle, gaugeAngle } from '@/render/art/recipes/pipes';
import { pressureAt, pressureFix, type WaterNet } from '@/sim/readouts/pressure';
import { fmt, heldList, itemSelect, mark, meter, note, perMin, row, section, type Panel, type PanelCtx } from './kit';

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

/** Ticks a tee's shares average over (at least; at most twice that): a few seconds, so the bars never blink. */
const TEE_SPAN = 100;

/**
 * A tee (D152): how its water divides, shown rather than told — a row per way out, in the order the
 * tee hands on (its way on first, then its branches N E S W): an arrow and where the way is from the
 * tee's front (ahead, left, right; the compass beside), what it ends in (the building it feeds, else
 * the conduit's own icon), a bar of its share of the tee's water and its water a minute. The shares
 * are read off the tee's counters (`Chain.shared`, what each way took), sampled here over a few
 * seconds; the section's header gives the tee's whole flow and, on hover, the rule in words.
 */
export const teePanel: Panel = ({ sim, e, live, atlas }) => {
  sim.ensureCompiled();
  const g = sim.graph, tile = tileIndex(e.x, e.y);
  const c: Chain | undefined = sim.chainAt(e.x, e.y);
  if (!g.tees.has(tile) || !c || c.lastTile !== tile || c.outE.length < 2) return [];
  const conduit = (): HTMLElement => el('span.kbuf-icon', {}, buildingIcon(atlas, BUILDING_IDS[e.def]!, 18));
  // What a way ends in: down its lines (one way each) to the building they feed; a tee or an open end: the conduit.
  const endOf = (n: FNode): HTMLElement => {
    let at = n;
    for (let k = 0; k < 64 && at.kind === 'chain' && at.outE.length === 1; k++) at = g.nodes[g.eDst[at.outE[0]!]!]!;
    const b = at.kind === 'chain' ? undefined : sim.ents.get(at.ent);
    const icon = b ? buildingIcon(atlas, BUILDING_IDS[b.def]!, 18) : null;
    return icon ? el('span.kbuf-icon', { title: buildingDef(b!.def).name[locale()] }, icon) : conduit();
  };
  const ways = c.outE.map((edge) => {
    const dst = g.nodes[g.eDst[edge]!]!;
    // Its side: towards the first tile of the line it feeds; a building is fed from the tee's way on.
    const t0 = dst.kind === 'chain' ? (dst as Chain).tiles[0]! : -1;
    const d = t0 < 0 ? e.rot & 3 : t0 === tile - 1024 ? 0 : t0 === tile + 1 ? 1 : t0 === tile + 1024 ? 2 : 3;
    const label = sideLabel(d, e.rot & 3);
    const m = meter();
    const root = el('div.kbuf.ktee', { 'data-tee-way': String(d) }, [el('span.ktee-way', {}, [el('span.ktee-arrow', { 'aria-hidden': 'true' }, '↑→↓←'[d]!), label.node]), endOf(dst), m.root]);
    return { root, m, name: label.name };
  });
  const total = el('b');
  // Two samples, the older one TEE_SPAN to 2 × TEE_SPAN ticks back (readouts/ribbons.ts's way).
  type Sample = { tick: number; v: number[] };
  let old: Sample | null = null, mid: Sample | null = null;
  live(() => {
    const now = sim.tick, v = ways.map((_, k) => c.shared[k] ?? 0);
    if (!old || !mid || now < mid.tick || v.some((x, k) => x < mid!.v[k]!)) { old = mid = { tick: now, v }; }
    else if (now - mid.tick >= TEE_SPAN) { old = mid; mid = { tick: now, v }; }
    const dt = now - old.tick;
    const rates = v.map((x, k) => (dt > 0 ? ((x - old!.v[k]!) * 600) / dt / 1000 : 0));
    const sum = rates.reduce((a, b) => a + b, 0);
    ways.forEach((w, k) => {
      w.m.set(rates[k]!, sum, 'good', perMin(rates[k]!));
      setAttr(w.root, 'title', t('insp.tee.way', { way: w.name, rate: perMin(rates[k]!) }));
    });
    setText(total, perMin(sum));
  });
  return [section({ sec: 'tee', title: () => t('insp.tee.title'), icon: itemMention(itemIdx('water'), { name: false }), aside: total, group: 'logistics', tip: () => t('insp.tee.tip') }, ways.map((w) => w.root))];
};

/** The pumps a gauge's inspector suggests (D155): the pump, and the high-pressure pump (« a better pump »). */
const FIX_PUMPS = ['pump', 'hp_pump'] as const;

/**
 * A pressure gauge at the top (D155): its dial as the world draws it — the scale's arcs, the needle at
 * its network's pressure in its state's colour — and the state in a word beside it, in that colour.
 */
export const gaugeHero = ({ sim, e, live }: PanelCtx): HTMLElement | null => {
  if (!buildingDef(e.def).gauge) return null;
  const S = 168, cv = el('canvas.kgauge-dial', { width: S, height: S, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const word = el('b.kgauge-word');
  let shown = '';
  live(() => {
    const net = pressureAt(sim, e.x, e.y);
    const state = net?.state ?? 'idle', p = net?.pressure ?? 0, sig = `${state}:${p}:${locale()}`;
    if (sig === shown) return;
    shown = sig;
    const c = cv.getContext('2d');
    if (c) {
      c.clearRect(0, 0, S, S);
      const R = S * 0.44;
      drawDial(c, S / 2, S / 2, R, 3, false);
      c.save();
      c.translate(S / 2, S / 2);
      c.rotate(gaugeAngle(p) + Math.PI / 2);
      drawGaugeNeedle(c, 0, 0, R, PRESSURE_COL[state]);
      c.restore();
    }
    setText(word, t(`insp.gauge.state.${state}` as MsgKey));
    setAttr(word, 'data-state', state);
    word.style.color = PRESSURE_COL[state];
  });
  return el('div.insp-hero.kgauge', { 'data-hero': 'gauge' }, [cv, word]);
};

/**
 * A pressure gauge's network (D155): a row for the pumps (their icons, a bar of their water against the
 * larger of the two figures, their water a minute) and one for the drinkers (their icons, theirs); then,
 * short or tight, what brings it to enough: each pump kind with its count to add (« +2 »), the high-
 * pressure pump faded with the tree's mark while it is still to learn; a struck bolt where pumps lack
 * power. Words on hover only.
 */
export const gaugePanel: Panel = ({ sim, e, live, atlas }) => {
  if (!buildingDef(e.def).gauge) return [];
  const icon = (id: string): HTMLElement => el('span.kbuf-icon', { title: buildingDef(BUILDING_IDS.indexOf(id as never)).name[locale()] }, buildingIcon(atlas, id, 18));
  const icons = (ents: readonly number[]): HTMLElement => {
    const ids = [...new Set(ents.map((id) => sim.ents.get(id)).filter((x) => !!x).map((x) => BUILDING_IDS[x!.def]!))].sort();
    return el('span.kgauge-who', {}, ids.length ? ids.slice(0, 3).map(icon) : [glyph('empty')]);
  };
  const supply = meter(), demand = meter();
  const supplyWho = el('span.kgauge-who-slot'), demandWho = el('span.kgauge-who-slot');
  const fix = el('div.kbuf.kgauge-fix', { hidden: '' });
  let sigs = '';
  live(() => {
    const net: WaterNet | null = pressureAt(sim, e.x, e.y);
    const sup = net?.supply ?? 0, dem = net?.demand ?? 0, max = Math.max(sup, dem, 1);
    const st = net?.state ?? 'idle';
    supply.set(sup, max, st === 'ok' || st === 'idle' ? 'good' : st === 'tight' ? 'warn' : 'bad', perMin(sup / 1000));
    demand.set(dem, max, 'idle', perMin(dem / 1000));
    const f = net ? pressureFix(net, FIX_PUMPS) : null;
    const sig = `${net?.pumps.map((p) => p.ent).join('.')}|${net?.drinkers.map((d) => d.ent).join('.')}|${f?.more.map((m) => `${m.id}${m.n}`).join('.')}|${f?.unpowered}|${locale()}|${sim.unlocked(buildingDef(BUILDING_IDS.indexOf('hp_pump' as never)).unlock)}`;
    if (sig === sigs) return;
    sigs = sig;
    supplyWho.replaceChildren(icons(net?.pumps.map((p) => p.ent) ?? []));
    demandWho.replaceChildren(icons(net?.drinkers.map((d) => d.ent) ?? []));
    const kids: HTMLElement[] = [];
    if (f?.unpowered) kids.push(el('span.kgauge-add', { title: t('insp.gauge.unpowered') }, [glyph('noPower', t('insp.gauge.unpowered'))]));
    for (const m of f?.more ?? []) {
      const def = buildingDef(BUILDING_IDS.indexOf(m.id as never));
      const locked = !sim.unlocked(def.unlock);
      const name = def.name[locale()];
      kids.push(el('span.kgauge-add', { 'data-pump': m.id, 'data-locked': locked ? '' : null, title: t('insp.gauge.more', { n: m.n, name }) }, [
        buildingIcon(atlas, m.id, 22), el('b', {}, `+${m.n}`), locked ? mark('tree', t('tree.hud')) : null,
      ]));
    }
    fix.replaceChildren(el('span.kgauge-fix-lead', { title: t('insp.gauge.fix') }, '→'), ...kids);
    setAttr(fix, 'hidden', kids.length ? null : '');
  });
  return [section({ sec: 'gauge', title: () => t('insp.gauge.title'), icon: itemMention(itemIdx('water'), { name: false }), group: 'logistics', tip: () => t('insp.gauge.tip') }, [
    el('div.kbuf.kgauge-row', { 'data-k': 'supply', title: t('insp.gauge.supply') }, [supplyWho, supply.root]),
    el('div.kbuf.kgauge-row', { 'data-k': 'demand', title: t('insp.gauge.demand') }, [demandWho, demand.root]),
    fix,
  ])];
};

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
