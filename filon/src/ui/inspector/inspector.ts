// inspector.ts — the panel for the selected building (click it in either view): what it is,
// what it is doing and, when it is not working, why and what to do about it (the status from its
// engine node, then a sentence: the inputs it waits for, the output that is full, the wire it
// lacks…), then the panels of its kind (panels.ts: recipe and buffers, deposit, ribbon contents,
// research project, stock and level, a store's contents, outlets, landscaping job, drifters and
// routes, fork filters, modules…), the grid it is wired into and its wires (power.ts, D25), and
// Demolish. Refreshed at 4 Hz: the DOM is rebuilt only when the inspection's signature changes;
// in between, the panels' live updaters rewrite their values. A rebuild gives the focus back to
// the control that had it (`data-pick`), so a keyboard player can set three filters in a row.
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
import { buildingIcon } from '../build-bar';
import { firstSentence } from '../building-facts';
import { itemList, itemRef } from '../mention';
import { STATUS_TONE, type InspectorHost, type PanelCtx } from './kit';
import { PANELS } from './panels';
import { gridCard } from './power';
import { tradeSig } from '../trade-view';

export type { InspectorHost } from './kit';

const STATUS: Record<number, MsgKey> = {
  [St.Ok]: 'insp.status.ok', [St.Starved]: 'insp.status.starved', [St.Blocked]: 'insp.status.blocked',
  [St.Unpowered]: 'insp.status.unpowered', [St.NoJob]: 'insp.status.nojob', [St.Idle]: 'insp.status.idle',
  [St.LowPower]: 'insp.status.lowpower', [St.NoFuel]: 'insp.status.nofuel', [St.Building]: 'insp.status.building',
  [St.Dormant]: 'insp.status.dormant',
};
const TONE = STATUS_TONE;

/**
 * Under the status, what it needs — shown rather than told (owner, 2026-10-13): the items it
 * waits for, the one its full output holds, the fuel it lacks, as icons with their names; else a
 * few words of what to do. Null when the status says it all.
 */
function why(node: FNode | undefined, kind: BuildingKind, st: number, unwired: boolean): string | null {
  const m = node?.kind === 'machine' ? (node as MachineNode) : null;
  switch (st) {
    case St.Starved: {
      const r = m?.recipe;
      const short = r ? r.ins.filter((s, j) => m!.inBuf[j]! < s.mu).map((s) => s.item) : [];
      return short.length ? itemList(short) : null;
    }
    case St.Blocked: {
      const item = m?.recipe ? m.recipe.outs.find((s, j) => m.outBuf[j]! + s.mu > m.outCap[j]!)?.item ?? m.recipe.outs[0]?.item
        : node?.kind === 'drill' ? (node as DrillNode).item : undefined;
      return item !== undefined && item >= 0 ? itemRef(item) : null;
    }
    case St.Unpowered: return t(unwired ? 'insp.why.unlinked' : 'insp.why.unpowered');
    case St.NoJob: return t(kind === 'drill' ? 'insp.why.nojob.drill' : 'insp.why.nojob');
    case St.LowPower: return t('insp.why.lowpower');
    case St.NoFuel: {
      const g = node?.kind === 'generator' ? (node as GeneratorNode) : null;
      return g ? itemRef(g.fuelItem) : null;
    }
    default: return null;
  }
}

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

  /** Everything a rebuild depends on: change it and the panels are built again (a trade post: also its streams and orders). */
  private signature(sim: Sim, e: Ent): string {
    const base = `${e.id}:${e.cfg}:${e.builtAt !== 0}:${sim.graph?.nodeByEnt.get(e.id) ? 1 : 0}:${locale()}:${(e.portItems ?? []).join('.')}:${sim.hearthLevel}:${sim.fleet.get(e.id) ?? 0}:${sim.done.size}`;
    return BUILDING_KIND[e.def] === 'trade' ? `${base}:${tradeSig(sim, e.id)}` : base;
  }

  private build(sim: Sim, e: Ent): void {
    const b = buildingDef(e.def) as BuildingDef;
    const kind = BUILDING_KIND[e.def] as BuildingKind;
    const node = sim.graph?.nodeByEnt.get(e.id);
    // The control that has the focus (a picker), to give it back once rebuilt.
    const had = document.activeElement instanceof HTMLElement && this.body.contains(document.activeElement)
      ? document.activeElement.closest<HTMLElement>('[data-pick]')?.dataset.pick ?? null : null;
    this.live = [];
    this.anims = [];
    const status = el('div.insp-status');
    const whyEl = el('p.insp-why');
    this.live.push(() => {
      const st = e.builtAt !== 0 ? St.Building : sim.isDormant(e) ? St.Dormant : node ? node.status : St.Ok;
      // Unpowered because no wire reaches it (D25) says so: the fix is a wire, not more power.
      const unwired = st === St.Unpowered && sim.graph?.netOfEnt.get(e.id) === undefined;
      setText(status, t(unwired ? 'insp.status.unlinked' : STATUS[st] ?? 'insp.status.ok'));
      setAttr(status, 'data-tone', TONE[st] ?? 'good');
      const w = why(node, kind, st, unwired);
      setText(whyEl, w ?? '');
      setAttr(whyEl, 'hidden', w ? null : '');
      setAttr(whyEl, 'data-tone', TONE[st] ?? 'good');
    });
    const ctx: PanelCtx = { sim, e, kind, node, atlas: this.atlas, host: this.host, live: (fn) => this.live.push(fn), anim: (fn) => this.anims.push(fn) };
    const L = locale();
    const parts: Array<HTMLElement | null> = [
      el('header.insp-head', {}, [
        buildingIcon(this.atlas, BUILDING_IDS[e.def]!, 46),
        el('div', {}, [
          el('h3.lettering', {}, b.name[L]),
          el('small', {}, `${t(`build.cat.${b.category}` as MsgKey)} · ${t('card.size', { n: b.w * b.h, w: b.w, h: b.h })}`),
        ]),
        el('button.insp-x', { title: t('insp.close'), 'aria-label': t('insp.close'), onclick: () => this.host.select(0) }, '✕'),
      ]),
      // What it is for, in words, only when nothing below shows it — no panel, no grid module (its card in the tray says the rest).
      (PANELS[kind] ?? []).length || linkable(e.def) ? null : el('p.insp-desc', {}, firstSentence(b.desc[L])),
      el('div.insp-state', {}, [status, whyEl]),
      ...(PANELS[kind] ?? []).flatMap((panel) => panel(ctx)),
    ];
    // The grid module: its grid, its own part in it, its wires (nothing for a building outside power).
    parts.push(...gridCard(ctx));
    if (kind !== 'hearth') parts.push(el('footer.insp-foot', {}, [el('button.btn.danger', { onclick: () => this.host.remove(e.id) }, t('insp.remove'))]));
    this.body.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
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
