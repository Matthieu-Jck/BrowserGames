// logistics-panel.ts — the Logistique view's side panel (D88): the ribbon lines in a few marks —
// how many, how many full, jammed (a click goes to the next), dead ends (likewise), idle — then
// the heat's key (empty pale turquoise to full coral; a ribbon carries 60 a minute, a swift one 120)
// over a histogram of the lines by how loaded they are, each bar in its heat, and the skydocks'
// drifter routes. Read from `Readouts.ribbons` (sim/readouts/ribbons.ts); refreshed at 4 Hz with
// change-only writes.
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { t, tr, type MsgKey } from '@/i18n/i18n';
import { HEAT, heatColor, viewIconCanvas } from '@/render/art/view-icons';
import type { RibbonLook, RibbonSummary } from '@/sim/readouts/ribbons';
import type { Sim } from '@/sim/state';

/** The histogram's buckets (tenths of what a line carries). */
const BUCKETS = 10;

export interface LogisticsPanelHost {
  /** Bring the camera to a tile (the head of a line). */
  goTo(x: number, y: number): void;
}

export class LogisticsPanel {
  readonly root: HTMLElement;
  private readonly chips = new Map<string, { node: HTMLElement; n: HTMLElement }>();
  private readonly bars: HTMLElement[] = [];
  private readonly routes = el('b');
  private readonly routesRow: HTMLElement;
  private readonly cursor = new Map<string, number>();
  private looks: readonly RibbonLook[] = [];

  constructor(private readonly host: LogisticsPanelHost) {
    const chip = (k: string, mark: HTMLElement, label: MsgKey, go = false): HTMLElement => {
      const n = el('b');
      const node = el(go ? 'button.vp-flag' : 'span.vp-flag', { type: go ? 'button' : null, 'data-k': k, 'data-label': label, onclick: go ? () => this.next(k) : null }, [mark, n]);
      this.chips.set(k, { node, n });
      return node;
    };
    const swatch = (col: string): HTMLElement => el('i.vp-swatch', { style: `background:${col}` });
    const row = el('div.vp-flags', {}, [
      chip('lines', viewIconCanvas('flow', 20, false), 'mapview.logistics'),
      chip('full', swatch(heatColor(1000)), 'mapview.full'),
      chip('jams', viewIconCanvas('jam', 20), 'mapview.jam', true),
      chip('dead', viewIconCanvas('dead', 20), 'mapview.dead', true),
      chip('idle', swatch('#f1e2cc'), 'mapview.idle'),
    ]);
    const grad = `linear-gradient(90deg, ${HEAT.map(([u, c]) => `${c} ${u / 10}%`).join(', ')})`;
    for (let i = 0; i < BUCKETS; i++) this.bars.push(el('i.vp-hist-bar', { style: `background:${heatColor((i + 0.5) * (1000 / BUCKETS))}` }));
    this.routesRow = el('div.vp-routes', {}, [viewIconCanvas('dock', 20), el('span', { 'data-label': 'mapview.routes' }), this.routes]);
    this.root = el('div.vp-logistics', {}, [
      row,
      el('h4.vp-h', { 'data-label': 'mapview.heat' }),
      el('div.vp-hist', {}, this.bars),
      el('div.vp-heat', { style: `background:${grad}` }),
      el('div.vp-heat-ends', {}, [el('small', { 'data-label': 'mapview.heat.empty' }), el('small', { 'data-label': 'mapview.heat.full' })]),
      this.routesRow,
    ]);
  }

  /** Go to the next line that jams, or ends on nothing. */
  private next(k: string): void {
    const ls = this.looks.filter((l) => (k === 'jams' ? l.jam : l.dead));
    if (!ls.length) return;
    const i = (this.cursor.get(k) ?? 0) % ls.length;
    this.cursor.set(k, i + 1);
    const v = ls[i]!.chain.tiles[ls[i]!.chain.tiles.length - 1]!;
    this.host.goTo((v & 1023) + 0.5, (v >> 10) + 0.5);
  }

  refresh(sim: Sim, looks: readonly RibbonLook[], s: RibbonSummary): void {
    this.looks = looks;
    for (const n of this.root.querySelectorAll<HTMLElement>('[data-label]')) {
      const k = n.dataset.label as MsgKey;
      if (n.classList.contains('vp-flag')) setAttr(n, 'title', k === 'mapview.jam' || k === 'mapview.dead' ? t('mapview.next', { label: t(k) }) : t(k));
      else setText(n, t(k));
    }
    setAttr(this.root.querySelector('.vp-heat')!, 'title', t('mapview.heat.tip'));
    const counts: Record<string, number> = { lines: s.lines, full: s.full, jams: s.jams, dead: s.dead, idle: s.idle };
    for (const [k, c] of this.chips) {
      setText(c.n, String(counts[k] ?? 0));
      setAttr(c.node, 'hidden', k === 'lines' || counts[k] ? null : '');
    }
    setAttr(this.chips.get('lines')!.node, 'title', tr('mapview.logistics.sub', { n: s.lines }));
    // The lines by how loaded they are (sampled ones only).
    const hist = new Array<number>(BUCKETS).fill(0);
    for (const l of looks) if (l.util >= 0) hist[Math.min(BUCKETS - 1, Math.floor((l.util * BUCKETS) / 1000))]!++;
    const max = Math.max(1, ...hist);
    hist.forEach((n, i) => {
      setStyle(this.bars[i]!, 'height', `${Math.max(n ? 8 : 2, Math.round((n * 100) / max))}%`);
      setAttr(this.bars[i]!, 'title', `${i * 10}–${t('hud.powerPct', { v: (i + 1) * 10 })} · ${n}`);
    });
    setText(this.routes, String(sim.routes.length));
    setAttr(this.routesRow, 'hidden', sim.routes.length ? null : '');
  }
}
