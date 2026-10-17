// view-panel.ts — the specialised views' side card (D88), where the inspector sits: shown while
// Électricité, Logistique, Production or Vent is on and no building is inspected (a click on one opens
// the inspector on that view's facet over it; Esc gives the card back). Its head: the view's mark,
// its name and what it counts, ✕ back to Normal; a legend of the marks the world shows, one word
// each; then the view's own part (power-panel.ts, logistics-panel.ts, production-panel.ts,
// wind-panel.ts: D95). The
// Terrain view keeps its land panel (land-panel.ts). Built with `el()`, refreshed at 4 Hz with
// change-only writes; it reads the shell's `Readouts` and changes nothing.
import { el, setAttr, setText } from '@/core/dom';
import type { MapView } from '@/core/kinds';
import { t, tr, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { POWER_GROUP_COLOR, heatColor, viewIconCanvas, windColor, type ViewIcon } from '@/render/art/view-icons';
import type { Readouts } from '@/sim/readouts/readouts';
import type { Sim } from '@/sim/state';
import { LogisticsPanel } from './logistics-panel';
import { PowerPanel } from './power-panel';
import { ProductionPanel } from './production-panel';
import { WindPanel } from './wind-panel';

export interface ViewPanelHost {
  sim(): Sim;
  view(): MapView;
  data(): Readouts;
  /** Is a building inspected (the inspector over the card)? */
  covered(): boolean;
  /** ✕: back to Normal. */
  close(): void;
  /** Select a building and bring the camera to it. */
  focus(id: number): void;
  /** Bring the camera to a tile. */
  goTo(x: number, y: number): void;
}

type Veiled = 'power' | 'logistics' | 'production' | 'wind';

/** Each view's legend: a mark (an icon, a swatch or a little gauge) and its word. */
const LEGEND: Record<Veiled, ReadonlyArray<{ mark: ViewIcon | `swatch:${string}` | 'gauge' | 'bar' | 'arrow'; label: MsgKey }>> = {
  // The wash by what a building is to power (owner, 2026-10-16), then the badges.
  power: [
    { mark: `swatch:${POWER_GROUP_COLOR.producer[0]}`, label: 'mapview.group.producer' }, { mark: `swatch:${POWER_GROUP_COLOR.consumer[0]}`, label: 'mapview.group.consumer' },
    { mark: `swatch:${POWER_GROUP_COLOR.storage[0]}`, label: 'mapview.group.storage' }, { mark: `swatch:${POWER_GROUP_COLOR.unlinked[0]}`, label: 'mapview.group.unlinked' },
    { mark: `swatch:${POWER_GROUP_COLOR.none[0]}`, label: 'mapview.group.none' }, { mark: 'bar', label: 'mapview.output' },
    { mark: 'gauge', label: 'mapview.draw' }, { mark: 'dark', label: 'mapview.flag.dark' },
    { mark: 'unwired', label: 'mapview.flag.unwired' }, { mark: 'site', label: 'mapview.flag.site' },
  ],
  logistics: [
    { mark: `swatch:${heatColor(150)}`, label: 'mapview.heat.empty' }, { mark: `swatch:${heatColor(1000)}`, label: 'mapview.heat.full' }, { mark: 'jam', label: 'mapview.jam' },
    { mark: 'dead', label: 'mapview.dead' }, { mark: 'dock', label: 'mapview.routes' },
  ],
  production: [
    { mark: 'swatch:var(--c-turq)', label: 'mapview.work.on' }, { mark: 'swatch:var(--c-warn)', label: 'mapview.work.pause' }, { mark: 'swatch:var(--c-coral)', label: 'mapview.work.off' },
    { mark: 'dark', label: 'mapview.why.power' }, { mark: 'unwired', label: 'mapview.why.unwired' }, { mark: 'inputs', label: 'mapview.why.inputs' },
    { mark: 'output', label: 'mapview.why.output' }, { mark: 'low', label: 'mapview.why.weak' }, { mark: 'recipe', label: 'mapview.why.recipe' },
    { mark: 'idle', label: 'mapview.why.idle' },
  ],
  wind: [
    { mark: `swatch:${windColor(400)}`, label: 'mapview.wind.calm' }, { mark: `swatch:${windColor(2000)}`, label: 'mapview.wind.strong' },
    { mark: 'arrow', label: 'mapview.wind.from' }, { mark: 'bar', label: 'mapview.wind.turbine' },
  ],
};
/** The head's mark per view. */
const HEAD_ICON: Record<Veiled, ViewIcon> = { power: 'bolt', logistics: 'flow', production: 'gear', wind: 'wind' };

export class ViewPanel {
  readonly root: HTMLElement;
  private readonly mark = el('span.vp-mark');
  private readonly title = el('h3.lettering');
  private readonly sub = el('small');
  private readonly legend = el('div.vp-legend');
  private readonly body = el('div.vp-body');
  private readonly power: PowerPanel;
  private readonly logistics: LogisticsPanel;
  private readonly production: ProductionPanel;
  private readonly wind: WindPanel;
  private shown: Veiled | null = null;
  private readonly close: HTMLElement;

  constructor(atlas: Atlas, private readonly host: ViewPanelHost) {
    this.close = el('button.insp-x', { type: 'button', 'data-view-close': '', onclick: () => host.close() }, '✕');
    this.power = new PowerPanel(atlas, { focus: (id) => host.focus(id) });
    this.logistics = new LogisticsPanel({ goTo: (x, y) => host.goTo(x, y) });
    this.production = new ProductionPanel(atlas, { focus: (id) => host.focus(id) });
    this.wind = new WindPanel(atlas, { focus: (id) => host.focus(id) });
    this.root = el('aside.vpanel.cartouche', { 'data-screen': 'view', hidden: true }, [
      el('header.insp-head.vp-head', {}, [this.mark, el('div', {}, [this.title, this.sub]), this.close]),
      this.legend,
      this.body,
    ]);
  }

  /** 4 Hz: shown with a veiled view and nothing inspected; the view's part refreshed. */
  refresh(): void {
    const v = this.host.view();
    const veiled: Veiled | null = v === 'power' || v === 'logistics' || v === 'production' || v === 'wind' ? v : null;
    const on = !!veiled && !this.host.covered();
    setAttr(this.root, 'hidden', on ? null : '');
    setAttr(this.root, 'data-view', veiled);
    if (!veiled || !on) return;
    if (veiled !== this.shown) {
      this.shown = veiled;
      this.mark.replaceChildren(viewIconCanvas(HEAD_ICON[veiled], 34, false));
      this.legend.replaceChildren(...LEGEND[veiled].map((l) => el('span.vp-key', {}, [this.legendMark(l.mark), el('span', { 'data-label': l.label })])));
      this.body.replaceChildren(veiled === 'power' ? this.power.root : veiled === 'logistics' ? this.logistics.root : veiled === 'wind' ? this.wind.root : this.production.root);
    }
    for (const n of this.legend.querySelectorAll<HTMLElement>('[data-label]')) setText(n, t(n.dataset.label as MsgKey));
    setText(this.title, t(`mapview.${veiled}` as MsgKey));
    setAttr(this.close, 'title', t('mapview.close'));
    const sim = this.host.sim(), d = this.host.data();
    if (veiled === 'power' && d.power) {
      setText(this.sub, tr('mapview.power.sub', { n: d.power.grids.length }));
      this.power.refresh(sim, d.power.grids, d.power.marks, d.power.idle);
    } else if (veiled === 'logistics' && d.ribbons && d.ribbonSummary) {
      setText(this.sub, tr('mapview.logistics.sub', { n: d.ribbonSummary.lines }));
      this.logistics.refresh(sim, d.ribbons, d.ribbonSummary);
    } else if (veiled === 'wind' && d.wind) {
      setText(this.sub, tr('mapview.wind.sub', { n: d.wind.turbines.length }));
      this.wind.refresh(sim, d.wind);
    } else if (veiled === 'production' && d.production) {
      setText(this.sub, tr('mapview.production.sub', { n: d.production.length }));
      this.production.refresh(sim, d.production);
    }
  }

  private legendMark(m: string): HTMLElement {
    if (m.startsWith('swatch:')) return el('i.vp-swatch', { style: `background:${m.slice(7)}` });
    if (m === 'gauge') return el('i.vp-gauge', {}, [el('i')]);
    if (m === 'bar') return el('i.vp-mini-bar', {}, [el('i')]);
    if (m === 'arrow') return el('i.vp-arrow', {}, '→');
    return viewIconCanvas(m as ViewIcon, 18);
  }
}
