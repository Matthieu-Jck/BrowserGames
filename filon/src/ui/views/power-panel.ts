// power-panel.ts — the Électricité view's side panel (D88), shown rather than told: the base by what
// each building is to power (owner, 2026-10-16), a chip per group in the world's wash with its count
// — what makes power, what draws it, the accumulators, what needs it and reaches no grid, what needs
// none (a click goes to the next of a group; the last only counts) —; the buildings in trouble as
// chips (no power, being built — a click goes to the next one), then
// one card per grid in its colour (sim/readouts/power.ts `gridReports`):
// - its head: the swatch, its name and size, how well it is served;
// - what it makes now against what it asks: one bar stacked by source (the Core, the ground's
//   heat, the wind, the sun, fuel burnt, accumulators giving back) with the demand as an ink
//   mark, and each source's mark with its kW under it;
// - its accumulators' charge;
// - the next 24 hours (`forecast`: the weather is the world clock's, so the renewables are exact;
//   the demand and the fuel held as now, the accumulators simulated): a bar an hour stacked by
//   source, the demand dotted, the night greyed, the accumulators' charge as a line, a shortfall
//   in coral — whether the base makes it through the night, at a glance;
// - its biggest consumers, a click away.
// The grid of the Core opens first; the others fold to their head and bar (a click unfolds one).
// Built with `el()`, refreshed at 4 Hz with change-only writes; the cards rebuilt when the grids
// change, the chart redrawn when its figures do.
import { buildingDef } from '@/content/registry';
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { num } from '@/i18n/format';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { C } from '@/render/art/tokens';
import { GRID_COLORS, POWER_GROUP_COLOR, SOURCE_COLOR, SOURCE_ICON, viewIconCanvas, type ViewIcon } from '@/render/art/view-icons';
import { DAY_EPOCHS } from '@/sim/constants';
import { dayEpoch, sunPermille } from '@/sim/power/network';
import { POWER_GROUPS, SOURCES, type GridReport, type PowerFlag, type PowerGroup, type PowerMark, type Source } from '@/sim/readouts/power';
import type { Sim } from '@/sim/state';
import { buildingIcon } from '../build-bar';
import { BUILDING_IDS } from '@/content/registry';

/** The flags a chip counts, in order (short of power is the grid's, its card says it; no wire and asleep are the « not linked » group's). */
const FLAGS: ReadonlyArray<Exclude<PowerFlag, 'low' | null>> = ['dark', 'site'];
/** The groups' chips, in the legend's order; then what needs no power. */
const GROUP_ORDER: readonly PowerGroup[] = ['producer', 'consumer', 'storage', 'unlinked'];
/** Consumers listed per grid. */
const TOP = 4;
/** The chart's size (CSS px). */
const CHART_W = 272, CHART_H = 80;

/** The hour (0–23) on the HUD's clock at the start of a day epoch (midnight mid-night). */
const hourOf = (de: number): number => Math.floor((((de - 6 + DAY_EPOCHS) % DAY_EPOCHS) / DAY_EPOCHS) * 24);

export interface PowerPanelHost {
  /** Select a building and bring the camera to it. */
  focus(id: number): void;
}

interface Card {
  net: number;
  root: HTMLElement;
  pct: HTMLElement;
  size: HTMLElement;
  segs: Map<Source, HTMLElement>;
  demand: HTMLElement;
  srcs: Map<Source, { chip: HTMLElement; kw: HTMLElement }>;
  totals: HTMLElement;
  acc: HTMLElement;
  accFill: HTMLElement;
  accPct: HTMLElement;
  chart: HTMLCanvasElement;
  chartSig: string;
  top: HTMLElement;
  topSig: string;
}

export class PowerPanel {
  readonly root: HTMLElement;
  private readonly groups = el('div.vp-groups');
  private readonly groupChips = new Map<PowerGroup | 'none', { node: HTMLElement; n: HTMLElement }>();
  private readonly flags = el('div.vp-flags');
  private readonly flagChips = new Map<string, { node: HTMLElement; n: HTMLElement }>();
  private readonly cardsEl = el('div.vp-cards');
  private readonly none = el('p.insp-note.vp-none');
  private cards: Card[] = [];
  private sig = '';
  /** The grid unfolded (−1: the Core's, until the player picks one). */
  private open = -1;
  /** Per flag: the next of its buildings a click goes to. */
  private readonly cursor = new Map<string, number>();
  private marks: readonly PowerMark[] = [];

  constructor(private readonly atlas: Atlas, private readonly host: PowerPanelHost) {
    for (const g of [...GROUP_ORDER, 'none'] as const) {
      const n = el('b');
      const node = el(g === 'none' ? 'span.vp-group' : 'button.vp-group', { type: g === 'none' ? null : 'button', 'data-group': g, onclick: g === 'none' ? null : () => this.nextOf(g) }, [
        el('i.vp-swatch', { style: `background:${POWER_GROUP_COLOR[g][0]};border-color:${POWER_GROUP_COLOR[g][1]}` }), n,
      ]);
      this.groupChips.set(g, { node, n });
      this.groups.append(node);
    }
    for (const f of FLAGS) {
      const n = el('b');
      const node = el('button.vp-flag', { type: 'button', 'data-flag': f, onclick: () => this.next(f) }, [viewIconCanvas(f as ViewIcon, 20), n]);
      this.flagChips.set(f, { node, n });
      this.flags.append(node);
    }
    this.root = el('div.vp-power', {}, [this.groups, this.flags, this.cardsEl, this.none]);
  }

  /** Go to the next building of a group (round the list). */
  private nextOf(g: PowerGroup): void {
    const ids = this.marks.filter((m) => m.group === g).map((m) => m.ent);
    if (!ids.length) return;
    const i = (this.cursor.get(`g:${g}`) ?? 0) % ids.length;
    this.cursor.set(`g:${g}`, i + 1);
    this.host.focus(ids[i]!);
  }

  /** Go to the next building carrying a flag (round the list). */
  private next(f: string): void {
    const ids = this.marks.filter((m) => m.flag === f).map((m) => m.ent);
    if (!ids.length) return;
    const i = (this.cursor.get(f) ?? 0) % ids.length;
    this.cursor.set(f, i + 1);
    this.host.focus(ids[i]!);
  }

  refresh(sim: Sim, grids: readonly GridReport[], marks: readonly PowerMark[], idle: number): void {
    this.marks = marks;
    // The groups: a chip each in the world's wash with its count (the not linked hidden at zero); a click goes to the next.
    for (const g of [...POWER_GROUPS, 'none'] as const) {
      const c = this.groupChips.get(g);
      if (!c) continue;
      const n = g === 'none' ? idle : marks.reduce((k, m) => k + (m.group === g ? 1 : 0), 0);
      setText(c.n, String(n));
      setAttr(c.node, 'hidden', g === 'unlinked' && !n ? '' : null);
      setAttr(c.node, 'data-tone', g === 'unlinked' && n ? 'bad' : null);
      const label = t(`mapview.group.${g}` as MsgKey);
      setAttr(c.node, 'title', g === 'none' ? label : t('mapview.next', { label }));
    }
    // The flags: a chip per kind with its count, hidden at zero.
    for (const f of FLAGS) {
      const c = this.flagChips.get(f)!;
      const n = marks.reduce((k, m) => k + (m.flag === f ? 1 : 0), 0);
      setText(c.n, String(n));
      setAttr(c.node, 'hidden', n ? null : '');
      setAttr(c.node, 'title', t('mapview.next', { label: t(`mapview.flag.${f}` as MsgKey) }));
    }
    setText(this.none, t('mapview.power.none'));
    setAttr(this.none, 'hidden', grids.length ? '' : null);
    // The cards: rebuilt when the grids change (their ids) or the language does.
    const home = sim.graph?.netOfEnt.get(sim.hearthId) ?? -1;
    const order = [...grids].sort((a, b) => (b.net === home ? 1 : 0) - (a.net === home ? 1 : 0) || b.members - a.members || a.net - b.net);
    const sig = `${order.map((g) => g.net).join(',')}|${locale()}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.cards = order.map((g) => this.card(g));
      this.cardsEl.replaceChildren(...this.cards.map((c) => c.root));
    }
    const open = order.some((g) => g.net === this.open) ? this.open : (order[0]?.net ?? -1);
    for (const g of order) {
      const c = this.cards.find((k) => k.net === g.net);
      if (c) this.fill(sim, c, g, g.net === open);
    }
  }

  private card(g: GridReport): Card {
    const col = GRID_COLORS[g.net % GRID_COLORS.length]!;
    const pct = el('b.vp-pct'), size = el('small.vp-size');
    const head = el('button.vp-grid-head', { type: 'button', onclick: () => { this.open = g.net; } }, [
      el('i.vp-swatch', { style: `background:${col}` }), el('span.vp-name.lettering', {}, t('mapview.grid', { n: g.net + 1 })), size, pct,
    ]);
    const segs = new Map<Source, HTMLElement>();
    for (const s of SOURCES) segs.set(s, el('span.vp-seg', { 'data-src': s, style: `background:${SOURCE_COLOR[s]}` }));
    const demand = el('i.vp-demand');
    const srcs = new Map<Source, { chip: HTMLElement; kw: HTMLElement }>();
    const srcRow = el('div.vp-srcs');
    for (const s of SOURCES) {
      const kw = el('small');
      const chip = el('span.vp-src', { 'data-src': s, title: t(`mapview.src.${s}` as MsgKey) }, [viewIconCanvas(SOURCE_ICON[s], 18), kw]);
      srcs.set(s, { chip, kw });
      srcRow.append(chip);
    }
    const totals = el('small.vp-totals');
    const accFill = el('span.vp-acc-fill'), accPct = el('small');
    const acc = el('div.vp-acc', { title: t('mapview.charge') }, [viewIconCanvas('acc', 18), el('span.vp-acc-bar', {}, [accFill]), accPct]);
    const chart = el('canvas.vp-chart', { width: CHART_W * 2, height: CHART_H * 2, title: t('mapview.day.tip') }) as HTMLCanvasElement;
    chart.style.width = `${CHART_W}px`;
    chart.style.height = `${CHART_H}px`;
    const top = el('div.vp-top');
    const root = el('section.vp-grid', { 'data-net': String(g.net), style: `--grid:${col}` }, [
      head,
      el('div.vp-supply', {}, [el('div.vp-segs', {}, [...segs.values()]), demand]),
      el('div.vp-under', {}, [srcRow, totals]),
      el('div.vp-more', {}, [
        acc,
        el('h4.vp-h', {}, t('mapview.day')),
        chart,
        el('div.vp-axis'),
        el('h4.vp-h', {}, t('mapview.top')),
        top,
      ]),
    ]);
    return { net: g.net, root, pct, size, segs, demand, srcs, totals, acc, accFill, accPct, chart, chartSig: '', top, topSig: '' };
  }

  private fill(sim: Sim, c: Card, g: GridReport, open: boolean): void {
    setAttr(c.root, 'data-open', open ? '' : null);
    const served = g.live ? Math.round(g.sat / 10) : 0;
    setText(c.pct, t('hud.powerPct', { v: served }));
    setAttr(c.pct, 'data-tone', served >= 100 ? 'good' : served > 0 ? 'warn' : 'bad');
    setText(c.size, tr('mapview.grid.members', { n: g.members }));
    // The stacked bar: each source's share of max(supply, demand); the demand's mark on the same scale.
    const supply = SOURCES.reduce((k, s) => k + g.kw[s], 0);
    const scale = Math.max(1, supply, g.demand);
    for (const s of SOURCES) {
      const w = (g.kw[s] * 100) / scale;
      const seg = c.segs.get(s)!;
      setStyle(seg, 'width', `${w.toFixed(1)}%`);
      setAttr(seg, 'title', `${t(`mapview.src.${s}` as MsgKey)} · ${t('insp.kw', { v: num(g.kw[s]) })}`);
      const chip = c.srcs.get(s)!;
      setAttr(chip.chip, 'hidden', g.kw[s] > 0 ? null : '');
      setText(chip.kw, num(g.kw[s]));
    }
    setStyle(c.demand, 'left', `${((g.demand * 100) / scale).toFixed(1)}%`);
    setAttr(c.demand, 'title', `${t('mapview.demand')} · ${t('insp.kw', { v: num(g.demand) })}`);
    setText(c.totals, t('mapview.grid.kw', { s: num(supply), d: num(g.demand) }));
    // The accumulators' charge.
    setAttr(c.acc, 'hidden', g.accMax > 0 ? null : '');
    const charge = g.accMax > 0 ? g.accE / g.accMax : 0;
    setStyle(c.accFill, 'transform', `scaleX(${charge.toFixed(3)})`);
    setText(c.accPct, t('hud.powerPct', { v: Math.round(charge * 100) }));
    if (!open) return;
    this.chart(c, g);
    this.top(sim, c, g);
  }

  /** The next 24 hours, a bar an epoch stacked by source; the demand dotted, the night greyed, the charge a line, a shortfall in coral. */
  private chart(c: Card, g: GridReport): void {
    const f = g.forecast;
    const sig = f.map((s) => `${s.ep}:${SOURCES.map((k) => s.kw[k]).join('.')}:${s.demand}:${s.sat}:${s.charge}`).join('|');
    if (sig === c.chartSig) return;
    c.chartSig = sig;
    const cv = c.chart, g2 = cv.getContext('2d');
    if (!g2 || !f.length) return;
    // The bottom strip is the day and night ribbon (sun amber, night ink), the bars above it.
    const W = cv.width, H = cv.height, pad = 4, strip = 12, base = H - strip - 4;
    g2.clearRect(0, 0, W, H);
    const top = Math.max(1, ...f.map((s) => Math.max(s.demand, SOURCES.reduce((k, x) => k + s.kw[x], 0)))) * 1.08;
    const bw = (W - 2 * pad) / f.length;
    const y = (kw: number): number => base - ((base - pad) * kw) / top;
    f.forEach((s, i) => {
      const x = pad + i * bw;
      // The night: no sun on this hour — greyed behind the bars, ink on the ribbon (amber by day, paler at dawn and dusk).
      const sun = sunPermille(s.ep);
      if (sun <= 0) { g2.fillStyle = 'rgba(30,27,46,0.1)'; g2.fillRect(x, 0, bw, base); }
      g2.fillStyle = sun <= 0 ? C.inkSoft : sun >= 1000 ? C.warn : C.peach;
      g2.fillRect(x, H - strip, bw + 0.5, strip);
      let h = 0;
      for (const k of SOURCES) {
        const v = s.kw[k];
        if (v <= 0) continue;
        g2.fillStyle = SOURCE_COLOR[k];
        g2.fillRect(x + 1, y(h + v), bw - 2, y(h) - y(h + v));
        h += v;
      }
      // What it cannot serve: a coral cap up to the demand.
      if (s.sat < 1000 && s.demand > h) { g2.fillStyle = C.coral; g2.globalAlpha = 0.85; g2.fillRect(x + 1, y(s.demand), bw - 2, y(h) - y(s.demand)); g2.globalAlpha = 1; }
    });
    // The demand, dotted; the accumulators' charge, a line on the full height.
    g2.strokeStyle = C.ink; g2.lineWidth = 2.4; g2.setLineDash([5, 4]);
    g2.beginPath();
    f.forEach((s, i) => { const x = pad + i * bw; if (i === 0) g2.moveTo(x, y(s.demand)); g2.lineTo(x + bw, y(s.demand)); });
    g2.stroke();
    g2.setLineDash([]);
    if (g.accMax > 0) {
      g2.strokeStyle = C.lilacD; g2.lineWidth = 2.6;
      g2.beginPath();
      f.forEach((s, i) => { const x = pad + (i + 0.5) * bw, yy = base - ((base - pad) * s.charge) / 1000; if (i === 0) g2.moveTo(x, yy); else g2.lineTo(x, yy); });
      g2.stroke();
    }
    // Now: an ink tick at the left edge.
    g2.fillStyle = C.ink; g2.fillRect(pad - 2, pad, 3, H - pad);
    g2.strokeStyle = C.ink; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(0, base + 1); g2.lineTo(W, base + 1); g2.stroke();
    g2.strokeRect(1, H - strip, W - 2, strip - 1);
    // The axis: the hours every six, on the HUD's clock.
    const axis = c.chart.nextElementSibling as HTMLElement | null;
    if (axis) {
      const ticks: HTMLElement[] = [];
      f.forEach((s, i) => {
        const h = hourOf(dayEpoch(s.ep)), prev = i ? hourOf(dayEpoch(f[i - 1]!.ep)) : -1;
        if (i > 0 && h % 6 === 0 && h !== prev) ticks.push(el('small', { style: `left:${((i * bw + pad) / W) * 100}%` }, t('hud.time', { h })));
      });
      axis.replaceChildren(...ticks);
    }
  }

  /** The biggest consumers: a row each (icon, name, a bar of its share, its kW), a click goes to it. */
  private top(sim: Sim, c: Card, g: GridReport): void {
    const rows = g.top.slice(0, TOP);
    const sig = rows.map((r) => r.ent).join(',') + locale();
    const max = Math.max(1, ...rows.map((r) => r.kw));
    if (sig !== c.topSig) {
      c.topSig = sig;
      const L = locale();
      c.top.replaceChildren(...rows.map((r) => {
        const e = sim.ents.get(r.ent);
        const id = e ? BUILDING_IDS[e.def]! : '';
        return el('button.vp-row', { type: 'button', 'data-ent': String(r.ent), onclick: () => this.host.focus(r.ent) }, [
          e ? buildingIcon(this.atlas, id, 22) : null,
          el('span.vp-row-name', {}, e ? buildingDef(e.def).name[L] : ''),
          el('span.vp-row-bar', {}, [el('span.vp-row-fill')]),
          el('small.vp-row-kw'),
        ]);
      }));
    }
    rows.forEach((r, i) => {
      const row = c.top.children[i] as HTMLElement | undefined;
      if (!row) return;
      setStyle(row.querySelector<HTMLElement>('.vp-row-fill')!, 'transform', `scaleX(${(r.kw / max).toFixed(3)})`);
      setText(row.querySelector('.vp-row-kw')!, t('insp.kw', { v: num(r.kw) }));
    });
  }
}
