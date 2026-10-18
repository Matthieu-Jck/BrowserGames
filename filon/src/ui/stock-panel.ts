// stock-panel.ts — the Heart's stock behind the HUD's « Stock » button (D96; owner, 2026-10-16:
// « n'affiche plus cette barre de ressource en haut à gauche par défaut, il faut que le joueur
// clique sur un bouton Stock pour le voir »). The HUD's bar of five stocks and its « +n » drawer
// gave way to a crate and the word; a click opens this panel with every item the Heart holds, in
// the kit's sections by kind (stock-facts.ts: raw, materials, parts, rare finds): each item's
// icon, name, amount and — with the telemetry (D41) — what came into the Heart over the last
// minute (D79). An item the base lacks is marked (stock-facts.ts `shortages`): ran out in coral,
// short in peach, the shortfall as « −12 » and what it is for in its tooltip.
// The HUD owns it (the rates are its samples); the shell puts the root in #ui, where it stands
// under the HUD on the left (over the quest log) or, on a narrow window, as a bottom sheet
// (responsive.css, ui/sheet.ts). Rebuilt when the items, the telemetry or the language change;
// the figures are written change-only, the amounts every frame while it is open.
// The Heart holds at most `hearthCap` of each item (BAL, by its level): the panel says so in its
// head, with what the next level holds, and each row's thin gauge fills toward it — amber near the
// top, coral and « plein » at it, where the Heart takes no more and what comes to it waits on the
// ribbons (owner, 2026-10-17: « il faut expliquer au joueur que le core ne peut contenir que X de
// chaque item au maximum »). One cap for every item (D122: the data's own cap went with the data).
// Auto-sell (D127, once researched): a small ◉ at each tradable item's row end switches it on — the
// Core then takes the item in uncapped and sells what it holds beyond a threshold at each minute's
// end. The threshold stands on the gauge as an ink mark, and as a chip beside it, which a click edits
// in place (each change a logged command, `Sim.setAutoSell`); under them « Vendu automatiquement :
// +X ◉/h » (the purse's own figure for the item, ui/purse-facts.ts). An auto-sold item is never « plein ».
import { BAL } from '@/content/balance';
import { autoSellMax, autoSellOn, tradable } from '@/sim/systems/trade';
import { ITEM_IDS, itemIdx } from '@/content/registry';
import { nodeName } from '@/content/research';
import { buildingDef, buildingIdx } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t, tr } from '@/i18n/i18n';
import { num } from '@/i18n/format';
import type { Atlas } from '@/render/art/atlas';
import type { Sim } from '@/sim/state';
import { itemIcon } from './build-bar';
import { itemName, lang, section } from './inspector/kit';
import { groupOf, STOCK_GROUPS, type Shortage } from './stock-facts';
import type { MsgKey } from '@/i18n/i18n';
import './styles/stock.css';

const SVG = 'http://www.w3.org/2000/svg';

/** The Stock's mark: an inked crate, its planks and corner posts (the HUD's button and the panel's head). */
export function crateGlyph(cls = 'hud-crate'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const box = document.createElementNS(SVG, 'rect');
  for (const [k, v] of [['x', '2.5'], ['y', '4.5'], ['width', '15'], ['height', '12.5'], ['rx', '1.6'], ['class', 'crate-box']] as const) box.setAttribute(k, v);
  const lines = document.createElementNS(SVG, 'path');
  lines.setAttribute('d', 'M2.5 8.6 H17.5 M2.5 12.8 H17.5 M6 4.5 V17 M14 4.5 V17');
  lines.setAttribute('class', 'crate-line');
  svg.append(box, lines);
  return svg;
}

/** Whole items, compact past ten thousand (« 12,4 k »), as the bar said them. */
export function compact(n: number): string {
  const L = locale();
  if (Math.abs(n) >= 10000) return `${new Intl.NumberFormat(L, { maximumFractionDigits: 1 }).format(n / 1000)} k`;
  return new Intl.NumberFormat(L, { maximumFractionDigits: 0 }).format(n);
}

/** « +1 450 ◉/h »: whole ocelles an hour, as the purse's card says them (D127: an auto-sold item's line). */
function perHour(cents: number): string {
  const v = Math.round(cents / 100);
  return t('purse.perHour', { v: `${v > 0 ? '+' : v < 0 ? '−' : ''}${compact(Math.abs(v))}` });
}

/** What a shortage is for, in words: the plan's name or the building's. */
function needName(s: Shortage): string {
  return s.for.k === 'plan' ? nodeName(s.for.id)[locale()] : buildingDef(buildingIdx(s.for.id)).name[locale()];
}

interface Row {
  node: HTMLElement; val: HTMLElement; rate: HTMLElement; need: HTMLElement; fill: HTMLElement;
  /** Auto-sell (D127): its toggle, the threshold's mark on the gauge, the line under it (what it sold, the threshold, its edit). */
  auto: HTMLButtonElement; mark: HTMLElement; line: HTMLElement; sold: HTMLElement; at: HTMLButtonElement; edit: HTMLInputElement;
}

export class StockPanel {
  readonly root: HTMLElement;
  private readonly body = el('div.stk-body', { 'data-stock-body': '' });
  private readonly kinds = el('small.stk-kinds');
  private readonly empty = el('p.insp-note.stk-empty');
  /** What the Heart holds of each item at most, and at the next level. */
  private readonly cap = el('p.stk-cap', { 'data-stock-cap': '' });
  private readonly rows = new Map<number, Row>();
  private sig = '';
  private shown: number[] = [];
  /** The colony last shown (auto-sell's clicks are its commands). */
  private sim: Sim | null = null;

  constructor(private readonly atlas: Atlas, close: () => void) {
    const x = el('button.insp-x', { type: 'button', 'data-stock-close': '', onclick: close }, '✕');
    lang(x, () => t('insp.close'), 'title');
    lang(x, () => t('insp.close'), 'aria-label');
    this.root = el('aside.stockp.cartouche', { 'data-screen': 'stock', hidden: true }, [
      el('header.insp-head.stk-head', {}, [crateGlyph('stk-crate'), el('div.insp-titles', {}, [lang(el('h3.lettering'), () => t('stock.title')), this.kinds]), x]),
      this.cap,
      this.empty,
      this.body,
    ]);
  }

  get open(): boolean { return !this.root.hasAttribute('hidden'); }

  show(on: boolean): void { setAttr(this.root, 'hidden', on ? null : ''); }

  private row(item: number): Row {
    let r = this.rows.get(item);
    if (!r) {
      const val = el('b.stk-val'), rate = el('span.stk-rate'), need = el('span.stk-need'), fill = el('i');
      const id = ITEM_IDS[item]!;
      const auto = el<'button'>('button.stk-auto', { type: 'button', 'data-stock-auto': id, 'aria-pressed': 'false', hidden: true, onclick: () => this.toggleAuto(item) }, '◉');
      const mark = el('i.stk-mark', { 'aria-hidden': 'true' });
      const sold = el('span.stk-sold');
      const at = el<'button'>('button.stk-at', { type: 'button', 'data-stock-at': id, onclick: () => this.editAt(item) });
      const edit = el<'input'>('input.stk-at-in', {
        type: 'number', step: '100', inputmode: 'numeric', hidden: true, 'data-stock-at-in': id,
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') this.commitAt(item); else if (e.key === 'Escape') { e.stopPropagation(); this.closeAt(item); } },
        onblur: () => this.commitAt(item),
      });
      const line = el('div.stk-autoline', { hidden: true }, [sold]);
      const gauge = el('span.stk-gauge', {}, [el('span.stk-fill', {}, [fill, mark]), at, edit]);
      const node = el('div.stk-row', { 'data-item': id }, [itemIcon(this.atlas, item, 22), el('span.stk-name'), need, val, rate, auto, gauge, line]);
      r = { node, val, rate, need, fill, auto, mark, line, sold, at, edit };
      this.rows.set(item, r);
    }
    return r;
  }

  /** Auto-sell switched on (at its default threshold, the Core's cap at most) or off: a logged command. */
  private toggleAuto(item: number): void {
    const sim = this.sim;
    if (!sim) return;
    const id = ITEM_IDS[item]!;
    sim.setAutoSell(id, sim.trade.autoSell.has(item) ? null : Math.min(BAL.autoSell.at, autoSellMax(sim)));
  }

  /** The threshold edited in place: its chip gives way to a number field. */
  private editAt(item: number): void {
    const sim = this.sim, r = this.rows.get(item);
    if (!sim || !r) return;
    r.edit.min = String(BAL.autoSell.min);
    r.edit.max = String(autoSellMax(sim));
    r.edit.value = String(sim.trade.autoSell.get(item) ?? BAL.autoSell.at);
    setAttr(r.at, 'hidden', '');
    setAttr(r.edit, 'hidden', null);
    r.edit.focus();
    r.edit.select();
  }

  /** The field read (clamped to what the Core may hold) and set; the chip back. */
  private commitAt(item: number): void {
    const sim = this.sim, r = this.rows.get(item);
    if (!sim || !r || r.edit.hidden) return;
    const v = Math.round(Number(r.edit.value));
    if (Number.isFinite(v) && sim.trade.autoSell.has(item)) sim.setAutoSell(ITEM_IDS[item]!, Math.max(BAL.autoSell.min, Math.min(autoSellMax(sim), v)));
    this.closeAt(item);
  }

  private closeAt(item: number): void {
    const r = this.rows.get(item);
    if (!r) return;
    setAttr(r.edit, 'hidden', '');
    setAttr(r.at, 'hidden', this.sim?.trade.autoSell.has(item) ? null : '');
  }

  /**
   * 4 Hz while open: the items the Heart shows (in the bar's chain order), each one's intake a
   * minute (`rate`: null without the telemetry), what the base lacks (`lacks`, by item), and what
   * each auto-sold item brought in an hour (`sold`: centi-◉, the purse's figure; null: none yet).
   */
  refresh(sim: Sim, items: readonly number[], rate: (item: number) => number | null, lacks: ReadonlyMap<number, Shortage>, sold: (item: number) => number | null = () => null): void {
    this.sim = sim;
    const autoOn = autoSellOn(sim);
    setAttr(this.root, 'data-autosell', autoOn ? '' : null);
    const tele = items.length > 0 && rate(items[0]!) !== null;
    const L = locale();
    const sig = `${items.join(',')}|${tele}|${L}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.shown = [...items];
      const sections = STOCK_GROUPS.map((g) => {
        const mine = items.filter((i) => groupOf(i) === g.id);
        if (!mine.length) return null;
        for (const i of mine) setText(this.row(i).node.querySelector('.stk-name')!, itemName(i));
        return section({ sec: `stock-${g.id}`, title: () => t(`stock.group.${g.id}` as MsgKey), icon: itemIcon(this.atlas, itemIdx(g.icon), 20), aside: String(mine.length) }, [
          el('div.stk-list', {}, mine.map((i) => this.row(i).node)),
          // The waste (D125) is of no use here: where it goes instead, in a line.
          g.id === 'waste' ? el('p.stk-note', {}, t('stock.wasteNote')) : null,
        ]);
      });
      this.body.replaceChildren(...sections.filter((n): n is HTMLElement => !!n));
      setAttr(this.root, 'data-tele', tele ? '' : null);
    }
    setText(this.kinds, tr('stock.kinds', { n: items.length }));
    const capN = Math.floor(sim.hearthCap() / 1000), next = BAL.hearthCap[sim.hearthLevel];
    setText(this.cap, next ? t('stock.capNext', { n: num(capN), next: num(next), level: sim.hearthLevel + 1 }) : t('stock.cap', { n: num(capN) }));
    setAttr(this.cap, 'title', t('stock.capTip'));
    setText(this.empty, items.length ? '' : t('stock.empty'));
    setAttr(this.empty, 'hidden', items.length ? '' : null);
    const capI = sim.hearthCap();
    for (const i of items) {
      const r = this.row(i);
      setText(r.val, compact(Math.floor(sim.stock[i]! / 1000)));
      const d = rate(i);
      const dv = d !== null && Math.abs(d) >= 0.5 ? `+${compact(Math.abs(d))}` : '';
      setText(r.rate, dv ? t('hud.perMin', { v: dv }) : '');
      const n = compact(Math.floor(sim.stock[i]! / 1000));
      setAttr(r.node, 'title', d !== null ? t('hud.stock.tipRate', { item: itemName(i), n, rate: t('hud.perMin', { v: dv || '0' }) }) : t('hud.stock.tip', { item: itemName(i), n }));
      const lack = lacks.get(i);
      setAttr(r.node, 'data-lack', lack ? (lack.out ? 'out' : 'short') : null);
      // Auto-sell (D127): the toggle once researched (a tradable item); on, the threshold's mark and its line.
      const at = autoOn ? sim.trade.autoSell.get(i) : undefined;
      setAttr(r.auto, 'hidden', autoOn && tradable(i) ? null : '');
      setAttr(r.auto, 'aria-pressed', at !== undefined ? 'true' : 'false');
      setAttr(r.auto, 'title', t(at !== undefined ? 'stock.auto.off' : 'stock.auto.on'));
      setAttr(r.node, 'data-auto', at !== undefined ? '' : null);
      setAttr(r.line, 'hidden', at !== undefined ? null : '');
      if (at === undefined) setAttr(r.at, 'hidden', '');
      else if (r.edit.hidden) setAttr(r.at, 'hidden', null);
      if (at !== undefined) {
        r.mark.style.left = `${Math.min(100, (at * 100000) / Math.max(1, capI))}%`;
        const v = sold(i);
        setText(r.sold, v ? t('stock.auto.sold', { v: perHour(v) }) : t('stock.auto.wait'));
        setText(r.at, t('stock.auto.at', { n: compact(at) }));
        const keep = Math.floor(sim.autoSellKeep(i) / 1000);
        setAttr(r.at, 'title', `${t('stock.auto.atTip', { n: num(at), min: num(BAL.autoSell.min), max: num(autoSellMax(sim)) })}${keep > at ? ` ${t('stock.auto.keep', { n: num(keep) })}` : ''}`);
        setAttr(r.edit, 'aria-label', t('stock.auto.edit'));
      } else if (!r.edit.hidden) this.closeAt(i);
      // Its share of what the Heart can hold of it: near the top, full (the Heart takes no more of it —
      // unless it auto-sells it: then it takes it all, and sells the surplus).
      const share = Math.min(1000, Math.floor((sim.stock[i]! * 1000) / Math.max(1, capI)));
      const full = share >= 1000 && at === undefined;
      r.fill.style.width = `${share / 10}%`;
      setAttr(r.node, 'data-fill', full ? 'full' : share >= 900 && at === undefined ? 'near' : null);
      setText(r.need, lack ? `−${num(Math.ceil(lack.missing / 1000))}` : full ? t('stock.full') : '');
      setAttr(r.need, 'title', lack ? t(lack.out ? 'stock.out' : 'stock.short', { n: num(Math.ceil(lack.missing / 1000)), need: needName(lack) }) : full ? t('stock.fullTip', { n: num(Math.floor(capI / 1000)) }) : null);
    }
  }

  /** Every frame while open: the amounts (an item lands in the Heart whole, its +1 shows at once). */
  counts(sim: Sim): void {
    if (!this.open) return;
    for (const i of this.shown) setText(this.row(i).val, compact(Math.floor(sim.stock[i]! / 1000)));
  }
}
