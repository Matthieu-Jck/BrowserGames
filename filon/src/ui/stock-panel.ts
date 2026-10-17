// stock-panel.ts — the Heart's stock behind the HUD's « Stock » button (D96; owner, 2026-10-16:
// « n'affiche plus cette barre de ressource en haut à gauche par défaut, il faut que le joueur
// clique sur un bouton Stock pour le voir »). The HUD's bar of five stocks and its « +n » drawer
// gave way to a crate and the word; a click opens this panel with every item the Heart holds, in
// the kit's sections by kind (stock-facts.ts: raw, materials, parts, data, rare finds): each item's
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
// chaque item au maximum »). Data holds at most `BAL.hearthDataCap` (200) whatever the level (D118:
// « pour la data, le cœur ne devrait pouvoir stocker que 200 max »): its rows fill toward that, and
// a line under the Données section says it.
import { BAL } from '@/content/balance';
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

/** What a shortage is for, in words: the plan's name or the building's. */
function needName(s: Shortage): string {
  return s.for.k === 'plan' ? nodeName(s.for.id)[locale()] : buildingDef(buildingIdx(s.for.id)).name[locale()];
}

interface Row { node: HTMLElement; val: HTMLElement; rate: HTMLElement; need: HTMLElement; fill: HTMLElement }

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
      const node = el('div.stk-row', { 'data-item': ITEM_IDS[item] }, [itemIcon(this.atlas, item, 22), el('span.stk-name'), need, val, rate, el('span.stk-fill', {}, [fill])]);
      r = { node, val, rate, need, fill };
      this.rows.set(item, r);
    }
    return r;
  }

  /**
   * 4 Hz while open: the items the Heart shows (in the bar's chain order), each one's intake a
   * minute (`rate`: null without the telemetry), what the base lacks (`lacks`, by item).
   */
  refresh(sim: Sim, items: readonly number[], rate: (item: number) => number | null, lacks: ReadonlyMap<number, Shortage>): void {
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
          g.id === 'data' ? el('p.insp-note.stk-datacap', { 'data-stock-datacap': '' }, t('stock.dataCap', { n: num(BAL.hearthDataCap) })) : null,
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
      // Its share of what the Heart can hold of it (data: 200, D118): near the top, full (the Heart takes no more of it).
      const capI = sim.hearthCapOf(i);
      const share = Math.min(1000, Math.floor((sim.stock[i]! * 1000) / Math.max(1, capI)));
      const full = share >= 1000;
      r.fill.style.width = `${share / 10}%`;
      setAttr(r.node, 'data-fill', full ? 'full' : share >= 900 ? 'near' : null);
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
