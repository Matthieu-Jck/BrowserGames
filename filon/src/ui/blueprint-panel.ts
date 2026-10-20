// blueprint-panel.ts — the blueprints' library (D154, K or the build bar's « Gabarits »): a side
// panel where the inspector sits. At the top, the copy in hand (or the last copy): its little plan,
// its size, a name (its main building's, « Fonderie ×4 », by default) and « Enregistrer ». Below, the
// blueprints saved in the base (`Sim.blueprints`, kept in the save so an export carries them), one
// row each: the main building's icon over a little plan of its pieces, its name, its size and pieces,
// what it costs (chips, coral where the Core holds less), « Prendre » (in hand as a paste), rename in
// place (Enter keeps it, Esc lets it go) and delete (a second click confirms). Shows rather than
// tells (owner): the plans and chips carry it, one line of keys at the foot. Under the title, the two
// gestures for a finger (and a mouse that prefers buttons): « Copier une zone » (the copy tool, as
// Ctrl/⌘+C) and « Coller » (the last copy in hand, as Ctrl/⌘+V). Saving, renaming and
// deleting are the Sim's commands (`bpSave`, `bpRename`, `bpDelete`). Built with `el()`, refreshed
// at 4 Hz: the list is rebuilt only when its signature changes; the chips follow the stock.
import { BUILDING_IDS, buildingDef, buildingIdx, hasBuilding, isBeltDef, itemDef } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { num } from '@/i18n/format';
import { locale, t, tr } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { C } from '@/render/art/tokens';
import { footprint } from '@/sim/entities';
import { blueprintCost, cleanName, NAME_MAX, type Blueprint } from '@/sim/systems/blueprint';
import type { Sim } from '@/sim/state';
import { buildingIcon, itemIcon } from './build-bar';
import { modCap } from './mod-key';
import './styles/blueprints.css';

export interface BlueprintHost {
  sim(): Sim;
  /** The blueprint in hand, else the last copy (null: none) — what « Enregistrer » saves. */
  held(): Blueprint | null;
  /** Take a blueprint in hand (a paste on the cursor). */
  take(bp: Blueprint): void;
  /** The copy tool (Ctrl/⌘+C), and the last copy in hand (Ctrl/⌘+V; null: none yet). */
  copy(): void;
  clipboard(): Blueprint | null;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
}

/** The little plan's longest side (CSS px). */
const PLAN_PX = 56;

/** A blueprint's little plan: its buildings as ink-edged blocks, its line pieces as strokes along their way, its poles as dots. */
export function blueprintPlan(bp: Blueprint, px = PLAN_PX): HTMLCanvasElement {
  const k = Math.max(1, Math.min(10, Math.floor((px * 2) / Math.max(bp.w, bp.h))));
  const cv = el('canvas.bpl-plan', { width: bp.w * k + 4, height: bp.h * k + 4, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  cv.style.width = `${(bp.w * k + 4) / 2}px`;
  cv.style.height = `${(bp.h * k + 4) / 2}px`;
  const g = cv.getContext('2d');
  if (!g) return cv;
  g.fillStyle = C.paperD;
  g.fillRect(0, 0, cv.width, cv.height);
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  for (const p of bp.pieces) {
    if (!hasBuilding(p.def)) continue;
    const d = buildingIdx(p.def), b = buildingDef(d);
    const [w, h] = footprint(d, p.rot);
    const x = 2 + p.x * k, y = 2 + p.y * k;
    if (isBeltDef(p.def) || b.kind === 'bridge' || b.kind === 'crossing' || b.kind === 'fence') {
      const cx = x + k / 2, cy = y + k / 2;
      g.strokeStyle = b.kind === 'conduit' ? C.riverD : b.kind === 'fence' ? C.inkSoft : C.turqD;
      g.lineWidth = Math.max(1, k * 0.35);
      g.beginPath();
      g.moveTo(cx - (DX[p.rot]! * k) / 2, cy - (DY[p.rot]! * k) / 2);
      g.lineTo(cx + (DX[p.rot]! * k) / 2, cy + (DY[p.rot]! * k) / 2);
      g.stroke();
    } else if (b.kind === 'pole') {
      g.fillStyle = C.ink;
      g.beginPath(); g.arc(x + k / 2, y + k / 2, Math.max(1, k * 0.3), 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = b.kind === 'fork' ? C.peach : b.kind === 'storage' ? C.lilacL : C.steelL;
      g.fillRect(x + 0.5, y + 0.5, w * k - 1, h * k - 1);
      g.strokeStyle = C.ink;
      g.lineWidth = 1.2;
      g.strokeRect(x + 0.5, y + 0.5, w * k - 1, h * k - 1);
    }
  }
  return cv;
}

export class BlueprintPanel {
  readonly root: HTMLElement;
  /** Shown (K, the bar's button). */
  open = false;
  private readonly title = el('h3.lettering');
  private readonly sub = el('small');
  private readonly hand = el('div.bpl-hand');
  private readonly list = el('div.bpl-list');
  private readonly hint = el('p.insp-note.bpl-hint');
  private readonly copyBtn: HTMLButtonElement;
  private readonly pasteBtn: HTMLButtonElement;
  private readonly copyKey = el('span.bb-key');
  private readonly pasteKey = el('span.bb-key');
  private readonly copyLabel = el('span');
  private readonly pasteLabel = el('span');
  private sig = '';
  private handSig = '';
  /** The blueprint being renamed (id; 0: none), and the one a first click on « Supprimer » armed. */
  private renaming = 0;
  private armed = 0;
  /** The cost chips to keep in step with the stock (4 Hz). */
  private chips: Array<{ node: HTMLElement; item: number; mu: number }> = [];

  constructor(private readonly atlas: Atlas, private readonly host: BlueprintHost) {
    const close = el('button.insp-x', { type: 'button', 'data-bpl-close': '', onclick: () => this.toggle(false) }, '✕');
    this.copyBtn = el<'button'>('button.btn.bpl-gesture', { type: 'button', 'data-bpl-copy': '', onclick: () => host.copy() }, [this.copyKey, this.copyLabel]);
    this.pasteBtn = el<'button'>('button.btn.bpl-gesture', { type: 'button', 'data-bpl-paste': '', onclick: () => { const c = host.clipboard(); if (c) host.take(c); } }, [this.pasteKey, this.pasteLabel]);
    this.root = el('aside.bpl.cartouche', { 'data-screen': 'blueprints', hidden: true }, [
      el('header.insp-head.bpl-head', {}, [el('div', {}, [this.title, this.sub]), close]),
      el('div.bpl-gestures', {}, [this.copyBtn, this.pasteBtn]),
      this.hand,
      this.list,
      this.hint,
    ]);
  }

  toggle(on = !this.open): void {
    this.open = on;
    this.armed = 0;
    this.renaming = 0;
    this.refresh();
  }

  /** 4 Hz: shown or not; the copy in hand and the list rebuilt when they change; the chips follow the stock. */
  refresh(): void {
    setAttr(this.root, 'hidden', this.open ? null : '');
    if (!this.open) { this.sig = ''; this.handSig = ''; return; }
    const sim = this.host.sim();
    setText(this.title, t('bp.lib.title'));
    setText(this.sub, tr('bp.lib.sub', { n: sim.blueprints.length }));
    setText(this.hint, t('bp.lib.hint', { mod: modCap() }));
    setText(this.copyKey, `${modCap()}C`);
    setText(this.pasteKey, `${modCap()}V`);
    setText(this.copyLabel, t('bp.lib.copy'));
    setText(this.pasteLabel, t('bp.lib.paste'));
    setAttr(this.pasteBtn, 'disabled', this.host.clipboard() ? null : '');
    const held = this.host.held();
    const hs = held ? `${held.id}:${held.pieces.length}:${held.w}x${held.h}:${locale()}:${sim.blueprints.length}` : '';
    if (hs !== this.handSig || (held && held !== this.heldBp)) {
      this.handSig = hs;
      this.heldBp = held;
      this.hand.replaceChildren(...(held ? this.handRow(sim, held) : []));
    }
    const sig = `${locale()}|${this.renaming}|${this.armed}|${sim.blueprints.map((b) => `${b.id}:${b.name}`).join('|')}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.chips = [];
      this.list.replaceChildren(...(sim.blueprints.length ? sim.blueprints.map((b) => this.row(sim, b)) : [el('p.insp-note.bpl-empty', {}, t('bp.lib.empty', { mod: modCap() }))]));
    }
    for (const c of this.chips) setAttr(c.node, 'data-poor', sim.stock[c.item]! < c.mu ? '' : null);
  }
  private heldBp: Blueprint | null = null;

  /** The default name: its main building and how many of it (« Fonderie ×4 »). */
  private defaultName(bp: Blueprint): string {
    if (!hasBuilding(bp.icon)) return t('bp.lib.title');
    const n = bp.pieces.filter((p) => p.def === bp.icon).length;
    return cleanName(t('bp.lib.defaultName', { name: buildingDef(buildingIdx(bp.icon)).name[locale()], n }));
  }

  /** The copy in hand: its plan, size, a name and « Enregistrer » (it then stays in hand, now from the library). */
  private handRow(sim: Sim, bp: Blueprint): HTMLElement[] {
    if (bp.id > 0) return []; // already in the library: its row below
    const input = el<'input'>('input.bpl-name', { type: 'text', maxlength: String(NAME_MAX), value: this.defaultName(bp), 'aria-label': t('bp.lib.name'), 'data-bpl-name': '' });
    const save = (): void => {
      const id = sim.saveBlueprint(bp, input.value || this.defaultName(bp));
      if (!id) return;
      const saved = sim.blueprints.find((b) => b.id === id);
      this.host.notify('good', t('bp.toast.saved', { name: saved?.name ?? '' }));
      if (saved) this.host.take(saved);
      this.sig = '';
      this.refresh();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    return [
      el('div.bpl-label', {}, t('bp.lib.inHand')),
      el('div.bpl-row.bpl-row-hand', {}, [
        this.figure(bp),
        el('div.bpl-body', {}, [
          input,
          el('small.bpl-size', {}, tr('bp.lib.size', { w: bp.w, h: bp.h, n: bp.pieces.length })),
          this.cost(sim, bp),
        ]),
        el<'button'>('button.btn.primary.bpl-act', { type: 'button', 'data-bpl-save': '', onclick: save }, t('bp.lib.save')),
      ]),
    ];
  }

  /** The main building's icon over the little plan. */
  private figure(bp: Blueprint): HTMLElement {
    return el('div.bpl-fig', {}, [buildingIcon(this.atlas, hasBuilding(bp.icon) ? bp.icon : BUILDING_IDS[0]!, 30), blueprintPlan(bp)]);
  }

  /** Its cost, as chips (coral where the Core holds less). */
  private cost(sim: Sim, bp: Blueprint): HTMLElement {
    const cost = [...blueprintCost(bp)].sort((a, b) => a[0] - b[0]);
    if (!cost.length) return el('div.bpl-cost', {}, el('span', {}, t('build.free')));
    return el('div.bpl-cost', {}, cost.map(([item, mu]) => {
      const node = el('span.tip-chip', { title: itemDef(item).name[locale()], 'data-poor': sim.stock[item]! < mu ? '' : null }, [itemIcon(this.atlas, item, 14), el('b', {}, num(Math.ceil(mu / 1000)))]);
      this.chips.push({ node, item, mu });
      return node;
    }));
  }

  /** A saved blueprint: figure, name (or its rename field), size, cost, and its three actions. */
  private row(sim: Sim, bp: Blueprint): HTMLElement {
    const take = el<'button'>('button.btn.primary.bpl-act', { type: 'button', 'data-bpl-take': String(bp.id), onclick: () => this.host.take(bp) }, t('bp.lib.take'));
    let name: HTMLElement;
    if (this.renaming === bp.id) {
      const input = el<'input'>('input.bpl-name', { type: 'text', maxlength: String(NAME_MAX), value: bp.name, 'aria-label': t('bp.lib.name'), 'data-bpl-rename-input': String(bp.id) });
      const done = (keep: boolean): void => {
        if (keep) sim.renameBlueprint(bp.id, input.value);
        this.renaming = 0;
        this.refresh();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      });
      input.addEventListener('blur', () => { if (this.renaming === bp.id) done(true); });
      queueMicrotask(() => { input.focus(); input.select(); });
      name = input;
    } else name = el('b.bpl-title', { title: bp.name }, bp.name);
    const rename = el<'button'>('button.bpl-icon-btn', { type: 'button', 'data-bpl-rename': String(bp.id), title: t('bp.lib.rename'), 'aria-label': t('bp.lib.rename'), onclick: () => { this.renaming = bp.id; this.armed = 0; this.refresh(); } }, '✎');
    const armed = this.armed === bp.id;
    const del = el<'button'>(`button.bpl-icon-btn.bpl-del${armed ? '.btn.danger' : ''}`, {
      type: 'button', 'data-bpl-delete': String(bp.id), title: t('bp.lib.delete'), 'aria-label': t('bp.lib.delete'),
      onclick: () => {
        if (!armed) { this.armed = bp.id; this.refresh(); return; }
        sim.deleteBlueprint(bp.id);
        this.armed = 0;
        this.refresh();
      },
    }, armed ? t('bp.lib.confirm') : '✕');
    return el('div.bpl-row', { 'data-bpl': String(bp.id) }, [
      this.figure(bp),
      el('div.bpl-body', {}, [name, el('small.bpl-size', {}, tr('bp.lib.size', { w: bp.w, h: bp.h, n: bp.pieces.length })), this.cost(sim, bp)]),
      el('div.bpl-acts', {}, [take, el('div.bpl-tools', {}, [rename, del])]),
    ]);
  }
}
