// logistics-panel.ts — the Logistique view's side panel (D88): the ribbon lines in a few marks —
// how many, how many full, jammed (a click goes to the next), dead ends (likewise), idle — then
// the heat's key (empty pale turquoise to full coral; a ribbon carries 60 a minute, a swift one 120)
// over a histogram of the lines by how loaded they are, each bar in its heat (the skydocks'
// drifter routes went in D108). Read from `Readouts.ribbons` (sim/readouts/ribbons.ts); refreshed at 4 Hz with
// change-only writes. Then the night (D103): how many ribbon tiles the Gleaners reach (the crescent,
// as the map marks them) and how many are kept from them (the glass hood), and what they took last
// night, each item by its icon — the block gone where no ribbon runs by the open desert.
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { t, tr, type MsgKey } from '@/i18n/i18n';
import { HEAT, heatColor, viewIconCanvas } from '@/render/art/view-icons';
import type { RibbonLook, RibbonSummary } from '@/sim/readouts/ribbons';
import type { Sim } from '@/sim/state';
import { locale } from '@/i18n/i18n';
import { num } from '@/i18n/format';
import { itemRef } from '../mention';

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
  /** The night (D103): exposed and guarded tiles, last night's takings. */
  private readonly night: HTMLElement;
  private readonly exposed = el('b');
  private readonly guarded = el('b');
  private readonly taken = el('p.vp-glean-taken');
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
    this.night = el('div.vp-glean', { 'data-glean': '' }, [
      el('div.vp-flags', {}, [
        el('span.vp-flag', { 'data-k': 'exposed' }, [viewIconCanvas('moon', 20), this.exposed]),
        el('span.vp-flag', { 'data-k': 'guarded' }, [viewIconCanvas('guard', 20), this.guarded]),
      ]),
      this.taken,
    ]);
    this.root = el('div.vp-logistics', {}, [
      row,
      el('h4.vp-h', { 'data-label': 'mapview.heat' }),
      el('div.vp-hist', {}, this.bars),
      el('div.vp-heat', { style: `background:${grad}` }),
      el('div.vp-heat-ends', {}, [el('small', { 'data-label': 'mapview.heat.empty' }), el('small', { 'data-label': 'mapview.heat.full' })]),
      this.night,
    ]);
  }

  /** Go to the next line that jams, or ends on nothing. */
  private next(k: string): void {
    const ls = this.looks.filter((l) => (k === 'jams' ? l.jam : l.dead));
    if (!ls.length) return;
    const i = (this.cursor.get(k) ?? 0) % ls.length;
    this.cursor.set(k, i + 1);
    const v = ls[i]!.chain.lastTile;
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
    // The night (D103).
    const g = sim.graph?.glean;
    const ne = g?.exposed.length ?? 0, ng = g?.guarded.length ?? 0;
    const took = sim.gleanedTonight().sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    setAttr(this.night, 'hidden', ne || ng || took.length ? null : '');
    setText(this.exposed, String(ne));
    setText(this.guarded, String(ng));
    setAttr(this.exposed.parentElement!, 'title', tr('mapview.glean.exposed', { n: ne }));
    setAttr(this.guarded.parentElement!, 'title', tr('mapview.glean.guarded', { n: ng }));
    setAttr(this.exposed.parentElement!, 'hidden', ne ? null : '');
    setAttr(this.guarded.parentElement!, 'hidden', ng ? null : '');
    const list = took.slice(0, 6).map(([i, mu]) => t('glean.item', { n: num(Math.round(mu / 1000)), item: itemRef(i) }));
    setText(this.taken, took.length ? `${t(sim.gleanNight() ? 'mapview.glean.tonight' : 'mapview.glean.taken')} ${new Intl.ListFormat(locale(), { type: 'conjunction' }).format(list)}` : t('mapview.glean.none'));
  }
}
