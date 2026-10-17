// wind-panel.ts — the Vent view's side panel (D95), shown rather than told (sim/readouts/wind.ts
// `windReport`):
// - the compass: an ink arrow the way the wind blows today, a faint one for its usual bearing, and
//   the wind of the moment as a gauge against the reference wind (×1);
// - the next 24 hours: a bar an epoch, the wind over flat open ground (the world clock's weather,
//   exact), coloured on the view's ramp, the reference wind a dotted line, the night greyed;
// - the turbines, least windy first (the spots to move): a row each — icon, a bar of what it gives
//   over the day against its rating with now as a tick, its kW — a click goes to it.
// Built with `el()`, refreshed at 4 Hz with change-only writes; the chart redrawn when its figures do.
import { buildingDef, BUILDING_IDS } from '@/content/registry';
import { COS64, SIN64 } from '@/content/world';
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { num } from '@/i18n/format';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { C } from '@/render/art/tokens';
import { viewIconCanvas, windColor } from '@/render/art/view-icons';
import { DAY_EPOCHS } from '@/sim/constants';
import { dayEpoch, sunPermille } from '@/sim/power/network';
import type { WindReport } from '@/sim/readouts/wind';
import type { Sim } from '@/sim/state';
import { buildingIcon } from '../build-bar';

/** Rows listed at most (the least windy). */
const ROWS = 8;
const CHART_W = 272, CHART_H = 64, ROSE = 64;

/** The hour (0–23) on the HUD's clock at the start of a day epoch (midnight mid-night). */
const hourOf = (de: number): number => Math.floor((((de - 6 + DAY_EPOCHS) % DAY_EPOCHS) / DAY_EPOCHS) * 24);
/** A bearing's eighth of the compass (0 east, 2 south…), for its name. */
const octant = (b: number): number => Math.round(b / 8) & 7;
/** A factor ‰ as the player reads it: « ×1,6 ». */
const times = (permille: number): string => `×${num(Math.round(permille / 10) / 100)}`;

export interface WindPanelHost {
  /** Select a building and bring the camera to it. */
  focus(id: number): void;
}

export class WindPanel {
  readonly root: HTMLElement;
  private readonly rose = el('canvas.vp-rose', { width: ROSE * 2, height: ROSE * 2 }) as HTMLCanvasElement;
  private readonly from = el('b.vp-wind-from');
  private readonly usual = el('small.vp-wind-usual');
  private readonly nowLabel = el('small');
  private readonly nowFill = el('span.vp-acc-fill.vp-wind-fill');
  private readonly nowF = el('b.vp-wind-f');
  private readonly chart = el('canvas.vp-chart', { width: CHART_W * 2, height: CHART_H * 2 }) as HTMLCanvasElement;
  private readonly axis = el('div.vp-axis');
  private readonly dayH = el('h4.vp-h');
  private readonly rowsH = el('h4.vp-h');
  private readonly rows = el('div.vp-top');
  private readonly none = el('p.insp-note.vp-none');
  private roseSig = '';
  private chartSig = '';
  private rowSig = '';

  constructor(private readonly atlas: Atlas, private readonly host: WindPanelHost) {
    this.rose.style.width = this.rose.style.height = `${ROSE}px`;
    this.chart.style.width = `${CHART_W}px`;
    this.chart.style.height = `${CHART_H}px`;
    this.root = el('div.vp-wind', {}, [
      el('div.vp-wind-head', {}, [this.rose, el('div.vp-wind-now', {}, [
        this.from, this.usual,
        el('div.vp-acc', {}, [viewIconCanvas('wind', 18), el('span.vp-acc-bar', {}, [this.nowFill]), this.nowF]),
        this.nowLabel,
      ])]),
      this.dayH, this.chart, this.axis,
      this.rowsH, this.rows, this.none,
    ]);
  }

  refresh(sim: Sim, w: WindReport): void {
    setText(this.from, t('mapview.wind.fromDir', { dir: t(`mapview.dir.${octant(w.bearing)}` as MsgKey) }));
    setText(this.usual, t('mapview.wind.usual', { dir: t(`mapview.dir.${octant(w.prevailing)}` as MsgKey) }));
    setText(this.nowLabel, t('mapview.wind.now'));
    setText(this.nowF, times(w.wind));
    setStyle(this.nowFill, 'transform', `scaleX(${Math.min(1, w.wind / 2000).toFixed(3)})`);
    setText(this.dayH, t('mapview.wind.day'));
    setAttr(this.chart, 'title', t('mapview.wind.day.tip'));
    setText(this.rowsH, t('mapview.wind.turbines'));
    setAttr(this.rowsH, 'hidden', w.turbines.length ? null : '');
    setText(this.none, t('mapview.wind.none'));
    setAttr(this.none, 'hidden', w.turbines.length ? '' : null);
    this.drawRose(w);
    this.drawChart(w);
    this.fillRows(sim, w);
  }

  /** The compass: N up; today's wind an ink arrow the way it blows, its usual bearing a faint one. */
  private drawRose(w: WindReport): void {
    const sig = `${w.bearing}:${w.prevailing}`;
    if (sig === this.roseSig) return;
    this.roseSig = sig;
    const g = this.rose.getContext('2d');
    if (!g) return;
    const S = ROSE * 2, c = S / 2, r = S / 2 - 8;
    g.clearRect(0, 0, S, S);
    g.fillStyle = C.paper; g.strokeStyle = C.ink; g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = C.inkSoft; g.font = '600 18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const L = locale();
    for (const [lab, dx, dy] of [[L === 'fr' ? 'N' : 'N', 0, -1], [L === 'fr' ? 'E' : 'E', 1, 0], [L === 'fr' ? 'S' : 'S', 0, 1], [L === 'fr' ? 'O' : 'W', -1, 0]] as const) g.fillText(lab, c + dx * (r - 12), c + dy * (r - 12));
    const arrow = (b: number, col: string, wdt: number, alpha: number): void => {
      // The wind comes from bearing b and blows towards the opposite side.
      const ux = -COS64[b]! / 1024, uy = -SIN64[b]! / 1024, L2 = r - 22;
      g.globalAlpha = alpha; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = wdt; g.lineCap = 'round';
      g.beginPath(); g.moveTo(c - ux * L2, c - uy * L2); g.lineTo(c + ux * L2, c + uy * L2); g.stroke();
      const hx = c + ux * L2, hy = c + uy * L2, h = 12;
      g.beginPath(); g.moveTo(hx + ux * 4, hy + uy * 4); g.lineTo(hx - ux * h - uy * h * 0.7, hy - uy * h + ux * h * 0.7); g.lineTo(hx - ux * h + uy * h * 0.7, hy - uy * h - ux * h * 0.7); g.closePath(); g.fill();
      g.globalAlpha = 1;
    };
    if (w.prevailing !== w.bearing) arrow(w.prevailing, C.turqD, 4, 0.35);
    arrow(w.bearing, C.ink, 6, 1);
  }

  /** The next 24 hours: a bar an epoch on the ramp, ×1 dotted, the night greyed, now ticked. */
  private drawChart(w: WindReport): void {
    const sig = w.day.map((d) => `${d.ep}:${d.wind}`).join('|');
    if (sig === this.chartSig) return;
    this.chartSig = sig;
    const g = this.chart.getContext('2d');
    if (!g || !w.day.length) return;
    const W = this.chart.width, H = this.chart.height, pad = 4, base = H - 6;
    const top = Math.max(2000, ...w.day.map((d) => d.wind)) * 1.05;
    const bw = (W - 2 * pad) / w.day.length;
    const y = (v: number): number => base - ((base - pad) * v) / top;
    g.clearRect(0, 0, W, H);
    w.day.forEach((d, i) => {
      const x = pad + i * bw;
      if (sunPermille(d.ep) <= 0) { g.fillStyle = 'rgba(30,27,46,0.1)'; g.fillRect(x, 0, bw, base); }
      g.fillStyle = windColor(d.wind);
      g.fillRect(x + 1, y(d.wind), bw - 2, base - y(d.wind));
      g.strokeStyle = C.ink; g.lineWidth = 1.2; g.strokeRect(x + 1, y(d.wind), bw - 2, base - y(d.wind));
    });
    g.strokeStyle = C.ink; g.lineWidth = 2; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(pad, y(1000)); g.lineTo(W - pad, y(1000)); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(0, base + 1); g.lineTo(W, base + 1); g.stroke();
    g.fillStyle = C.ink; g.fillRect(pad - 2, pad, 3, base - pad);
    const ticks: HTMLElement[] = [];
    w.day.forEach((d, i) => {
      const h = hourOf(dayEpoch(d.ep)), prev = i ? hourOf(dayEpoch(w.day[i - 1]!.ep)) : -1;
      if (i > 0 && h % 6 === 0 && h !== prev) ticks.push(el('small', { style: `left:${((i * bw + pad) / W) * 100}%` }, t('hud.time', { h })));
    });
    this.axis.replaceChildren(...ticks);
  }

  /** The least windy turbines: a row each, a bar of its day's mean against its rating with now ticked, a click goes to it. */
  private fillRows(sim: Sim, w: WindReport): void {
    const rows = [...w.turbines].sort((a, b) => a.overall - b.overall || a.ent - b.ent).slice(0, ROWS);
    const sig = rows.map((r) => r.ent).join(',') + locale();
    if (sig !== this.rowSig) {
      this.rowSig = sig;
      const L = locale();
      this.rows.replaceChildren(...rows.map((r) => {
        const e = sim.ents.get(r.ent);
        const id = e ? BUILDING_IDS[e.def]! : '';
        return el('button.vp-row.vp-wind-row', { type: 'button', 'data-ent': String(r.ent), onclick: () => this.host.focus(r.ent) }, [
          e ? buildingIcon(this.atlas, id, 22) : null,
          el('span.vp-row-name', {}, e ? buildingDef(e.def).name[L] : ''),
          el('span.vp-row-bar', {}, [el('span.vp-row-fill'), el('i.vp-row-now')]),
          el('small.vp-row-kw'),
        ]);
      }));
    }
    rows.forEach((r, i) => {
      const row = this.rows.children[i] as HTMLElement | undefined;
      if (!row) return;
      const fill = row.querySelector<HTMLElement>('.vp-row-fill')!;
      setStyle(fill, 'transform', `scaleX(${(r.full > 0 ? r.mean / r.full : 0).toFixed(3)})`);
      setStyle(fill, 'background', windColor(r.overall));
      setStyle(row.querySelector<HTMLElement>('.vp-row-now')!, 'left', `${(r.full > 0 ? (100 * r.kw) / r.full : 0).toFixed(1)}%`);
      setText(row.querySelector('.vp-row-kw')!, t('insp.kw', { v: num(r.mean) }));
      setAttr(row, 'title', t('mapview.wind.row.tip', { f: times(r.exposure), kw: num(r.kw), full: num(r.full), mean: num(r.mean) }));
    });
  }
}
