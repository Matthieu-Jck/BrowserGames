// inspector.ts — the panel for the selected building (click it in either view), laid out by the
// kit (D89; owner, 2026-10-15: « Plus clair, plus séparé »):
// · the header: its icon, name, category and size, close;
// · the top block answers three questions at a glance: what it does (the kind's `HERO`: a recipe
//   as an icon equation, what a drill cuts a minute, the power it makes, the project it runs…),
//   whether it works (the status line: a mark and one word — at work, a passing stop, stopped, as
//   the world draws it, `workOf` D83; at work but slowed by a weak grid, in amber, D91; being built;
//   asleep, D80), and why not (the reason as icons: the inputs it waits for, its full output, no
//   power, the weak grid and its %, no wire, no recipe; under it, the few words of what to do);
// · the kind's sections (panels.ts: its recipe and buffers, its stores, its filters, its project's
//   data…), each its own card, then the grid card (power.ts, D25/D76);
// · the foot: every action of the panels (choose a research, open the Crier, take the Link tool,
//   grow the Core) and Demolish.
// A specialised view (D88) names its facet (`InspectorHost.facet`): that part is lifted under the
// top block and the others fade. Refreshed at 4 Hz: the DOM is rebuilt only when the inspection's
// signature changes; in between, the live updaters rewrite the values. A rebuild gives the focus
// back to the control that had it (`data-pick`), so a keyboard player can set three filters in a row.
import { BUILDING_IDS, BUILDING_KIND, buildingDef } from '@/content/registry';
import type { BuildingDef, BuildingKind } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import type { FNode } from '@/sim/flow/node';
import type { DrillNode, GeneratorNode, MachineNode } from '@/sim/flow/nodes';
import type { Sim } from '@/sim/state';
import { St, type Ent } from '@/sim/types';
import { linkable } from '@/sim/power/links';
import { LOOKS_AT_WORK, weakGrid, workOf } from '@/sim/systems/work';
import { buildingIcon } from '../build-bar';
import { firstSentence } from '../building-facts';
import { glyph } from '../glyphs';
import { itemList, itemRef } from '../mention';
import { pct } from '@/i18n/format';
import { itemReason, mark, statusLine, weakReason, type Facet, type InspectorHost, type PanelCtx, type StateWord } from './kit';
import { HERO, PANELS } from './panels';
import { gridCard } from './power';
import { tradeSig } from '../trade-view';
import '../styles/inspector.css';

export type { InspectorHost } from './kit';

/** The status in words (the line's tooltip and the why line's lead). */
const STATUS: Record<number, MsgKey> = {
  [St.Ok]: 'insp.status.ok', [St.Starved]: 'insp.status.starved', [St.Blocked]: 'insp.status.blocked',
  [St.Unpowered]: 'insp.status.unpowered', [St.NoJob]: 'insp.status.nojob', [St.Idle]: 'insp.status.idle',
  [St.LowPower]: 'insp.status.lowpower', [St.NoFuel]: 'insp.status.nofuel', [St.Building]: 'insp.status.building',
  [St.Dormant]: 'insp.status.dormant',
};

/** The one word for a kind without a look of work (logistics, the Heart, stores): its engine status. */
const WORD: Record<number, StateWord> = {
  [St.Ok]: 'on', [St.Starved]: 'pause', [St.Blocked]: 'pause', [St.Idle]: 'pause', [St.LowPower]: 'pause',
  [St.Unpowered]: 'off', [St.NoJob]: 'off', [St.NoFuel]: 'off', [St.Building]: 'build', [St.Dormant]: 'sleep',
};

/** Why it is not working, as things: the reason's icons and the few words of what to do. */
interface Why { icons: () => Node[]; sig: string; text: string | null }

/**
 * Under the status, what it needs — shown rather than told (owner, 2026-10-13): the items it
 * waits for, the one its full output holds, the fuel it lacks, as icons (their names in the line
 * below); a struck bolt, a cut plug, an empty slot, the land or the tree for a sleeper; else a few
 * words of what to do. Nothing when the status says it all.
 */
function why(node: FNode | undefined, kind: BuildingKind, st: number, unwired: boolean, asleep: 'research' | 'land' | null, sat: number): Why {
  // At work, slowed by a weak grid (D91; `sat` only then): the half-bolt and its %.
  if (sat > 0) return { icons: () => [weakReason(sat)], sig: `k${pct(sat / 1000)}`, text: t('insp.why.weak', { p: pct(sat / 1000) }) };
  const m = node?.kind === 'machine' ? (node as MachineNode) : null;
  const none: Why = { icons: () => [], sig: '', text: null };
  switch (st) {
    case St.Starved: {
      const r = m?.recipe;
      const short = r ? r.ins.filter((s, j) => m!.inBuf[j]! < s.mu).map((s) => s.item) : [];
      return short.length ? { icons: () => short.map((i) => itemReason(i, 'missing')), sig: `s${short.join('.')}`, text: itemList(short) } : none;
    }
    case St.Blocked: {
      const item = m?.recipe ? m.recipe.outs.find((s, j) => m.outBuf[j]! + s.mu > m.outCap[j]!)?.item ?? m.recipe.outs[0]?.item
        : node?.kind === 'drill' ? (node as DrillNode).item : undefined;
      return item !== undefined && item >= 0 ? { icons: () => [itemReason(item, 'full')], sig: `b${item}`, text: itemRef(item) } : none;
    }
    case St.Unpowered: return unwired
      ? { icons: () => [glyph('unwired', t('insp.status.unlinked'))], sig: 'w', text: t('insp.why.unlinked') }
      : { icons: () => [glyph('noPower', t('insp.status.unpowered'))], sig: 'p', text: t('insp.why.unpowered') };
    case St.NoJob: return { icons: () => [glyph('empty', t('insp.status.nojob'))], sig: 'j', text: t(kind === 'drill' ? 'insp.why.nojob.drill' : 'insp.why.nojob') };
    case St.LowPower: return { icons: () => [glyph('power', t('insp.status.lowpower'))], sig: 'l', text: t('insp.why.lowpower') };
    case St.NoFuel: {
      const g = node?.kind === 'generator' ? (node as GeneratorNode) : null;
      return g ? { icons: () => [itemReason(g.fuelItem, 'missing')], sig: `f${g.fuelItem}`, text: itemRef(g.fuelItem) } : none;
    }
    // Asleep, it is cut from its grid: the way to wake it, not a wire (owner, 2026-10-14: "I cannot
    // wire the solar panels here… it just puts a dot line and tells me the solar panels aren't wired").
    case St.Dormant: return asleep === 'land' ? { icons: () => [glyph('parcel', t('insp.status.dormantLand'))], sig: 'dl', text: t('insp.why.dormantLand') }
      : asleep === 'research' ? { icons: () => [mark('tree', t('insp.status.dormant'))], sig: 'dr', text: t('insp.why.dormant') } : none;
    default: return none;
  }
}

/** The facet a section belongs to when it does not say (the kind's production panels: D88). */
const PRODUCTION: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['machine', 'drill', 'generator', 'lab', 'server', 'pump']);

export class Inspector {
  readonly root: HTMLElement;
  private sig = '';
  private readonly body: HTMLElement;
  private live: Array<() => void> = [];
  /** Per-frame updaters of the panels (progress bars), from `frame`. */
  private anims: Array<(simTicks: number) => void> = [];
  private graph: unknown = null;

  constructor(private readonly atlas: Atlas, private readonly host: InspectorHost) {
    this.body = el('div.insp-body');
    this.root = el('aside.inspector.cartouche', { 'data-screen': 'inspector', hidden: true }, [this.body]);
  }

  /** Everything a rebuild depends on: change it and the panels are built again (a trade post: also its streams and orders; the view's facet). */
  private signature(sim: Sim, e: Ent): string {
    const base = `${e.id}:${e.cfg}:${e.builtAt !== 0}:${sim.graph?.nodeByEnt.get(e.id) ? 1 : 0}:${locale()}:${(e.portItems ?? []).join('.')}:${sim.hearthLevel}:${sim.fleet.get(e.id) ?? 0}:${sim.done.size}:${this.host.facet?.() ?? ''}:${e.id === sim.hearthId ? sim.expertise.slots.map((x) => (x ? `${x.id}${x.on ? '+' : '-'}${sim.expertise.ranks.get(x.id) ?? 0}` : '')).join('/') : ''}`;
    return BUILDING_KIND[e.def] === 'trade' ? `${base}:${tradeSig(sim, e.id)}` : base;
  }

  private build(sim: Sim, e: Ent): void {
    const b = buildingDef(e.def) as BuildingDef;
    const kind = BUILDING_KIND[e.def] as BuildingKind;
    const node = sim.graph?.nodeByEnt.get(e.id);
    const facet: Facet | null = this.host.facet?.() ?? null;
    // The control that has the focus (a picker), to give it back once rebuilt.
    const had = document.activeElement instanceof HTMLElement && this.body.contains(document.activeElement)
      ? document.activeElement.closest<HTMLElement>('[data-pick]')?.dataset.pick ?? null : null;
    this.live = [];
    this.anims = [];
    const actions: HTMLElement[] = [];
    const ctx: PanelCtx = {
      sim, e, kind, node, atlas: this.atlas, host: this.host,
      live: (fn) => this.live.push(fn), anim: (fn) => this.anims.push(fn), action: (n) => { actions.push(n); },
    };
    // The status line and, while it is not working, what to do.
    const status = statusLine();
    const whyEl = el('p.insp-why');
    // A kind with no look of work (a ribbon, a store, the Heart) says its state only when it is not working.
    const quiet = !LOOKS_AT_WORK.has(kind);
    this.live.push(() => {
      const asleep = e.builtAt !== 0 ? null : sim.dormancy(e);
      const st = e.builtAt !== 0 ? St.Building : asleep ? St.Dormant : node ? node.status : St.Ok;
      // Unpowered because no wire reaches it (D25) says so: the fix is a wire, not more power.
      const unwired = st === St.Unpowered && sim.graph?.netOfEnt.get(e.id) === undefined;
      const work: StateWord = st === St.Building ? 'build' : st === St.Dormant ? 'sleep' : quiet ? WORD[st] ?? 'on' : workOf(sim, e);
      // At work on a grid under 100 %: it runs, slowed — a warning in amber, not « En marche » (D91).
      const sat = quiet || work === 'build' || work === 'sleep' ? 0 : weakGrid(sim, e);
      const word: StateWord = work === 'on' && sat ? 'slow' : work;
      const label = t(word === 'slow' ? 'insp.status.weak' : unwired ? 'insp.status.unlinked' : asleep === 'land' ? 'insp.status.dormantLand' : STATUS[st] ?? 'insp.status.ok');
      const w = why(node, kind, st, unwired, asleep, word === 'slow' ? sat : 0);
      status.set(word, w.icons, w.sig, label);
      setAttr(status.root, 'hidden', quiet && word === 'on' ? '' : null);
      // The why line: the status in words, then what to do (or the items, by name).
      const text = word === 'on' ? null : w.text ? `${label} · ${w.text}` : st !== St.Ok ? label : null;
      setText(whyEl, text ?? '');
      setAttr(whyEl, 'hidden', text ? null : '');
      setAttr(whyEl, 'data-state', word);
    });
    const hero = HERO[kind]?.(ctx) ?? null;
    const L = locale();
    const head = el('header.insp-head', {}, [
      buildingIcon(this.atlas, BUILDING_IDS[e.def]!, 46),
      el('div.insp-titles', {}, [
        el('h3.lettering', {}, b.name[L]),
        el('small', {}, `${t(`build.cat.${b.category}` as MsgKey)} · ${t('card.size', { n: b.w * b.h, w: b.w, h: b.h })}`),
      ]),
      el('button.insp-x', { title: t('insp.close'), 'aria-label': t('insp.close'), onclick: () => this.host.select(0) }, '✕'),
    ]);
    const panels = PANELS[kind] ?? [];
    // What it is for, in words, only when nothing below shows it — no panel, no grid card, no hero (its card in the tray says the rest).
    const desc = panels.length || linkable(e.def) || hero ? null : el('p.insp-desc', {}, firstSentence(b.desc[L]));
    const top = el('div.insp-top', {}, [status.root, whyEl, hero, desc]);
    // The kind's sections, then the grid card; each tagged with its facet.
    const sections = [...panels.flatMap((panel) => panel(ctx)), ...gridCard(ctx)].filter((p): p is HTMLElement => !!p);
    for (const s of sections) if (!s.dataset.group && PRODUCTION.has(kind) && s.matches('.ksec')) s.dataset.group = 'production';
    // The view's facet first (D88), the others faded; production's own facet also lights the top block.
    let ordered = sections;
    if (facet) {
      const mine = sections.filter((s) => s.dataset.group === facet);
      ordered = [...mine, ...sections.filter((s) => s.dataset.group !== facet)];
      for (const s of sections) if (s.matches('.ksec') && s.dataset.group !== facet) s.dataset.dim = '';
    }
    const foot = el('footer.insp-foot.kfoot', {}, [
      ...actions,
      kind !== 'hearth' ? el('button.btn.danger', { onclick: () => this.host.remove(e.id) }, t('insp.remove')) : null,
    ]);
    setAttr(this.root, 'data-facet', facet);
    setAttr(this.root, 'data-kind', kind);
    this.body.replaceChildren(head, top, ...ordered, ...(foot.children.length ? [foot] : []));
    if (had) this.body.querySelector<HTMLElement>(`[data-pick="${CSS.escape(had)}"]`)?.focus();
  }

  refresh(): void {
    const sim = this.host.sim();
    const id = this.host.selected();
    const e = id ? sim.ents.get(id) : undefined;
    if (!e) {
      if (id) this.host.select(0);
      setAttr(this.root, 'hidden', '');
      this.sig = '';
      return;
    }
    setAttr(this.root, 'hidden', null);
    const sig = this.signature(sim, e);
    if (sig !== this.sig || sim.graph !== this.graph) { this.sig = sig; this.graph = sim.graph; this.build(sim, e); }
    for (const f of this.live) f();
  }

  /** Every frame (`simTicks`: the game time between ticks): the panels' smooth parts, while one is open. */
  frame(simTicks: number): void {
    if (!this.anims.length || this.root.hasAttribute('hidden')) return;
    for (const f of this.anims) f(simTicks);
  }
}
