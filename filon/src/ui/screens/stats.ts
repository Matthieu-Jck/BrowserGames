// stats.ts (screen) — the Statistics (G, or the HUD's chip), the Analytics path's screen (D41),
// in three kit sections (D89, owner 2026-10-15: « Plus clair, plus séparé »):
// · « Production et consommation » (the ledger, `statistics`): per item, made and used per minute
//   over a chosen window (1 min, 10 min, 1 h, 10 h) as bars on one scale, the net as a diverging
//   bar (turquoise to the right, coral to the left) and a sparkline of the net over the window;
// · « Machines » (with the Diagnostics, `machineStates`): the working buildings as one bar cut by
//   state (worst first), then a chip per state — its mark, its count, its word; the tooltip names
//   the buildings;
// · « Énergie » (with the Power Log): what the grids ask and what they have now, as two figures in
//   the colours of their lines, the history over the window, the load in the header.
// · « Pris par les Glaneurs » (D103): what the Gleaners took off the ribbons by night since the
//   founding, each item by its icon and a count — shown once they have taken anything.
// The ledger takes the left; the machines and the power stand beside it and stay in view while it
// scrolls (one column on a narrow window). Each part shows only once its plan is unlocked
// (`analyticsOn`). The explanations moved to the headers' tooltips (`tip`); every item shows its
// icon (mention.ts), and an empty table says why and what to do. Labels are written on each
// refresh, so a language switch shows at once. Read-only; refreshed at 4 Hz while open.
import { viewIconCanvas } from '@/render/art/view-icons';
import { N_ITEMS, buildingDef } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import { num, pct } from '@/i18n/format';
import type { Atlas } from '@/render/art/atlas';
import { C } from '@/render/art/tokens';
import type { Sim } from '@/sim/state';
import { analyticsOn, machineStates, type MachineState } from '../analytics';
import { glyph } from '../glyphs';
import { kw, mark, meter, section, stat } from '../inspector/kit';
import { itemMention } from '../mention';
import { WINDOWS, type StatsRecorder, type StatWindow } from '../stats';

export interface StatsHost {
  close(): void;
  /** The colony, for what the Analytics path has unlocked (D41); without it the power history shows (the machines' states need it). */
  sim?(): Sim;
}

/** A machine state's label (the inspector's status line, shorter for a missing wire) and tone. */
const STATE_LABEL: Record<MachineState, MsgKey> = {
  unlinked: 'stats.state.unlinked', unpowered: 'insp.status.unpowered', nofuel: 'insp.status.nofuel',
  starved: 'insp.status.starved', blocked: 'insp.status.blocked', nojob: 'insp.status.nojob', lowpower: 'insp.status.weak',
  ok: 'insp.status.ok', idle: 'insp.status.idle', building: 'insp.status.building', dormant: 'insp.status.dormant',
};
const STATE_TONE: Record<MachineState, 'good' | 'warn' | 'bad' | 'idle'> = {
  unlinked: 'bad', unpowered: 'bad', nofuel: 'bad', starved: 'warn', blocked: 'warn', nojob: 'warn', lowpower: 'warn',
  ok: 'good', idle: 'idle', building: 'idle', dormant: 'idle',
};
/** A state's mark, as the inspector's status line draws its reason (a cut plug, a struck bolt, a full box, an empty slot…). */
const STATE_ICON: Record<MachineState, () => HTMLElement> = {
  unlinked: () => glyph('unwired'), unpowered: () => glyph('noPower'), nofuel: () => mark('off'),
  starved: () => mark('pause'), blocked: () => mark('full'), nojob: () => glyph('empty'), lowpower: () => mark('slow'), // at work on a weak grid (D91)
  ok: () => mark('on'), idle: () => mark('pause'), building: () => mark('build'), dormant: () => mark('sleep'),
};

/** The load of the grids (demand / available) above which the header turns amber, then coral. */
const LOAD_WARN = 0.9;

interface LedgerRow {
  node: HTMLElement;
  made: ReturnType<typeof meter>;
  used: ReturnType<typeof meter>;
  net: HTMLElement;
  neg: HTMLElement;
  pos: HTMLElement;
  spark: HTMLCanvasElement;
}

/** A part of the screen: a kit section whose title and tooltip follow the language. */
interface Part { root: HTMLElement; head: HTMLElement; title: HTMLElement; aside: HTMLElement }

export class StatsScreen {
  readonly root: HTMLElement;
  private win: StatWindow = '10m';
  private readonly tabs = new Map<StatWindow, HTMLButtonElement>();
  private readonly table = el('div.st-table');
  private readonly empty = el('p.st-empty');
  /** The three parts (kit sections) and the column the machines and the power share. */
  private readonly ledger: Part;
  private readonly machinesPart: Part;
  private readonly powerPart: Part;
  /** The Gleaners' takings (D103). */
  private readonly gleanPart: Part;
  private readonly gleanList = el('div.st-gleaned');
  private gleanSig = '';
  private readonly side: HTMLElement;
  private readonly body: HTMLElement;
  /** The machines: one bar cut by state, then a chip per state. */
  private readonly stack = el('div.st-stack', { role: 'img' });
  private readonly machines = el('div.st-states');
  private machinesSig = '';
  /** The power: the two figures now, the history, its time axis. */
  private readonly power = el('canvas.st-power') as HTMLCanvasElement;
  private readonly demandV = el('b');
  private readonly supplyV = el('b');
  private readonly axisFrom = el('span');
  private readonly axisNow = el('span');
  /** Labels written on each refresh (they follow a language switch). */
  private readonly labels: Array<[HTMLElement, () => string]> = [];
  private rows = new Map<number, LedgerRow>();
  private rowsLocale = '';

  constructor(_atlas: Atlas, private readonly rec: StatsRecorder, private readonly host: StatsHost) {
    const label = <E extends HTMLElement>(node: E, text: () => string): E => { this.labels.push([node, text]); return node; };
    const tabs = el('div.st-tabs', { role: 'group' }, [
      mark('order'),
      ...(Object.keys(WINDOWS) as StatWindow[]).map((w) => {
        const b = label(el<'button'>('button.btn.st-tab', { type: 'button', 'data-st-window': w, onclick: () => { this.win = w; this.refresh(); } }), () => t(`stats.window.${w}` as MsgKey));
        this.tabs.set(w, b);
        return b;
      }),
    ]);

    // ── the ledger ──
    const swatch = (tone: string): HTMLElement => el('i.st-swatch', { 'data-tone': tone });
    const headRow = el('div.st-row.st-headrow', {}, [
      label(el('span'), () => t('stats.item')),
      el('span.st-col', {}, [swatch('made'), label(el('span'), () => t('stats.made'))]),
      el('span.st-col', {}, [swatch('used'), label(el('span'), () => t('stats.used'))]),
      el('span.st-col.st-col-net', {}, [label(el('span'), () => t('stats.net'))]),
      label(el('span.st-col.st-col-trend'), () => t('stats.trend')),
    ]);
    this.ledger = this.part('ledger', mark('gate'), 'stats.ledger', [headRow, this.empty, this.table]);

    // ── the machines ──
    this.machinesPart = this.part('machines', glyph('building'), 'stats.machines', [this.stack, this.machines]);

    // ── the power ──
    this.power.width = 460; this.power.height = 150;
    const figures = el('div.st-figures', {}, [
      stat(this.demandV, '', swatch('demand')),
      stat(this.supplyV, '', swatch('supply')),
    ]);
    // The captions of the two figures follow the language.
    const caps = figures.querySelectorAll<HTMLElement>('.kstat-cap');
    label(caps[0]!, () => t('stats.demand'));
    label(caps[1]!, () => t('stats.supply'));
    this.powerPart = this.part('power', glyph('power'), 'stats.power', [
      figures, this.power, el('div.st-axis', {}, [this.axisFrom, this.axisNow]),
    ]);

    // ── the Gleaners' takings (D103) ──
    this.gleanPart = this.part('gleaned', viewIconCanvas('moon', 16, false), 'stats.gleaned', [this.gleanList]);

    for (const p of [this.machinesPart, this.powerPart, this.gleanPart]) setAttr(p.root, 'hidden', '');
    this.side = el('div.st-side', {}, [this.machinesPart.root, this.powerPart.root, this.gleanPart.root]);
    this.body = el('div.st-body', {}, [this.ledger.root, this.side]);
    const close = el('button.btn.rs-close', { type: 'button', onclick: () => host.close() }, '✕');
    this.root = el('section.screen.stats', { 'data-screen': 'stats' }, [
      el('header.rs-head', {}, [label(el('h1.lettering'), () => t('screen.stats')), tabs, close]),
      this.body,
    ]);
    this.labels.push([close, () => '✕']);
    setAttr(close, 'title', t('screen.close'));
  }

  /** A kit section tagged `data-st-part` (the smoke test's and the docs' hook). */
  private part(id: 'machines' | 'ledger' | 'power' | 'gleaned', icon: HTMLElement, title: MsgKey, body: HTMLElement[]): Part {
    const aside = el('span.st-aside');
    const root = section({ sec: `st-${id}`, title: () => t(title), icon, aside }, body); // its title follows the language (the kit's `lang`)
    root.setAttribute('data-st-part', id);
    const head = root.querySelector<HTMLElement>('.ksec-head')!;
    const titleEl = root.querySelector<HTMLElement>('.ksec-title')!;
    return { root, head, title: titleEl, aside };
  }

  private row(i: number): LedgerRow {
    let r = this.rows.get(i);
    if (!r) {
      const made = meter(), used = meter();
      const net = el('span.st-num');
      const neg = el('i.st-div-neg'), pos = el('i.st-div-pos');
      const spark = el('canvas.st-spark') as HTMLCanvasElement;
      spark.width = 120; spark.height = 24;
      const node = el('div.st-row', { 'data-item': i }, [
        el('span.st-item', {}, itemMention(i)),
        made.root, used.root,
        el('span.st-net', {}, [el('span.st-div', {}, [neg, pos]), net]),
        spark,
      ]);
      r = { node, made, used, net, neg, pos, spark };
      this.rows.set(i, r);
    }
    return r;
  }

  refresh(): void {
    // A language switch: the rows (their names) are made again.
    if (locale() !== this.rowsLocale) { this.rowsLocale = locale(); this.rows.clear(); this.machinesSig = ''; }
    for (const [node, text] of this.labels) setText(node, text());
    for (const [w, b] of this.tabs) {
      setAttr(b, 'data-on', w === this.win ? '' : null);
      setAttr(b, 'aria-pressed', w === this.win ? 'true' : 'false');
    }
    const winLabel = t(`stats.window.${this.win}` as MsgKey);
    const { made, used, span } = this.rec.rates(this.win);
    setAttr(this.ledger.head, 'title', t('stats.note', { window: winLabel }));
    setText(this.ledger.aside, t('stats.ledger.unit', { window: winLabel }));
    const active: number[] = [];
    for (let i = 0; i < N_ITEMS; i++) if (Math.abs(made[i]!) > 0.01 || Math.abs(used[i]!) > 0.01) active.push(i);
    active.sort((a, b) => made[b]! + used[b]! - (made[a]! + used[a]!) || a - b);
    // Nothing to show: either too few samples yet, or nothing moved in the window.
    setText(this.empty, !span ? t('stats.empty') : active.length ? '' : t('stats.none'));
    setAttr(this.empty, 'hidden', !span || !active.length ? null : '');
    const nodes = active.map((i) => this.row(i).node);
    if (nodes.length !== this.table.children.length || nodes.some((n, k) => this.table.children[k] !== n)) this.table.replaceChildren(...nodes);
    const ser = this.rec.series(this.win);
    // One scale for made and used (the bars compare across rows and columns), one for the net.
    let top = 0, topNet = 0;
    for (const i of active) { top = Math.max(top, made[i]!, used[i]!); topNet = Math.max(topNet, Math.abs(made[i]! - used[i]!)); }
    for (const i of active) {
      const r = this.row(i);
      const net = made[i]! - used[i]!;
      r.made.set(made[i]!, top, 'good', made[i]! > 0.01 ? num(made[i]!) : '—');
      r.used.set(used[i]!, top, 'bad', used[i]! > 0.01 ? num(used[i]!) : '—');
      const sign = net > 0.01 ? '+' : net < -0.01 ? '-' : null;
      setText(r.net, `${sign === '+' ? '+' : sign === '-' ? '−' : ''}${num(sign ? Math.abs(net) : 0)}`);
      setAttr(r.net, 'data-sign', sign);
      const f = topNet > 0 ? Math.round(Math.min(1, Math.abs(net) / topNet) * 1000) / 1000 : 0;
      setAttr(r.pos, 'style', `transform:scaleX(${sign === '+' ? f : 0})`);
      setAttr(r.neg, 'style', `transform:scaleX(${sign === '-' ? f : 0})`);
      this.spark(r.spark, ser.map((s) => (s.prod[i]! - s.cons[i]!) / 1000));
    }
    // The Analytics path's later steps (D41): each part once its plan is taken.
    const sim = this.host.sim?.();
    const powerOn = !sim || analyticsOn(sim, 'power');
    setAttr(this.powerPart.root, 'hidden', powerOn ? null : '');
    if (powerOn) {
      setAttr(this.powerPart.head, 'title', t('stats.power.note', { window: winLabel }));
      setText(this.axisFrom, `−${winLabel}`);
      setText(this.axisNow, t('stats.axis.now'));
      this.drawPower(ser);
    }
    const machinesOn = !!sim && analyticsOn(sim, 'machines');
    setAttr(this.machinesPart.root, 'hidden', machinesOn ? null : '');
    if (sim && machinesOn) {
      setAttr(this.machinesPart.head, 'title', t('stats.machines.note'));
      this.refreshMachines(sim);
    }
    // What the Gleaners took (D103): every item, the most first.
    const taken: Array<[number, number]> = [];
    if (sim) for (let i = 0; i < N_ITEMS; i++) if (sim.gleaned[i]! >= 1000) taken.push([i, Math.floor(sim.gleaned[i]! / 1000)]);
    taken.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const gSig = `${locale()}:${taken.map(([i, n]) => `${i}x${n}`).join(',')}`;
    if (gSig !== this.gleanSig) {
      this.gleanSig = gSig;
      this.gleanList.replaceChildren(...taken.map(([i, n]) => el('span.st-gleaned-chip', { 'data-item': String(i) }, [itemMention(i), el('b', {}, num(n))])));
    }
    setAttr(this.gleanPart.root, 'hidden', taken.length ? null : '');
    setAttr(this.gleanPart.head, 'title', t('stats.gleaned.tip'));
    // The ledger alone takes the whole width.
    setAttr(this.body, 'data-solo', powerOn || machinesOn || taken.length ? null : '');
  }

  /** The Diagnostics: the bar cut by state and a chip per state (worst first) with its count; the tooltips name the buildings. */
  private refreshMachines(sim: Sim): void {
    const L = locale();
    const states = machineStates(sim);
    const sig = `${L}:${states.map((s) => `${s.state}=${[...s.defs].map(([d, n]) => `${d}x${n}`).join('.')}`).join(',')}`;
    if (sig === this.machinesSig) return;
    this.machinesSig = sig;
    const total = states.reduce((a, s) => a + s.n, 0);
    const ok = states.find((s) => s.state === 'ok')?.n ?? 0;
    this.machinesPart.aside.replaceChildren(...(total ? [mark('on'), `${num(ok)} / ${num(total)}`] : []));
    setAttr(this.machinesPart.aside, 'title', total ? `${t('insp.status.ok')} · ${pct(ok / total)}` : null);
    setAttr(this.stack, 'hidden', total ? null : '');
    if (!states.length) { this.stack.replaceChildren(); this.machines.replaceChildren(el('span.st-none', {}, t('stats.machines.none'))); return; }
    const which = (s: (typeof states)[number]): string => [...s.defs].map(([d, n]) => `${buildingDef(d).name[L]}${n > 1 ? ` ×${n}` : ''}`).join(', ');
    setAttr(this.stack, 'aria-label', states.map((s) => `${t(STATE_LABEL[s.state])} ${num(s.n)}`).join(', '));
    this.stack.replaceChildren(...states.map((s) => el('span.st-seg', {
      'data-state': s.state, 'data-tone': STATE_TONE[s.state], style: `flex-grow:${s.n}`,
      title: `${t(STATE_LABEL[s.state])} · ${num(s.n)}\n${which(s)}`,
    })));
    this.machines.replaceChildren(...states.map((s) =>
      el('span.st-state', { 'data-state': s.state, 'data-tone': STATE_TONE[s.state], title: which(s) }, [
        STATE_ICON[s.state](), el('b', {}, num(s.n)), el('span', {}, t(STATE_LABEL[s.state])),
      ])));
  }

  /** Net rate between consecutive samples, as a small inked line around zero. */
  private spark(cv: HTMLCanvasElement, cum: number[]): void {
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    if (cum.length < 3) return;
    const d = cum.slice(1).map((v, k) => v - cum[k]!);
    const m = Math.max(1e-6, ...d.map(Math.abs));
    g.strokeStyle = C.inkSoft; g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 12); g.lineTo(cv.width, 12); g.stroke();
    g.globalAlpha = 1; g.strokeStyle = C.turqD; g.lineWidth = 1.6; g.beginPath();
    d.forEach((v, k) => { const x = (k / (d.length - 1)) * (cv.width - 2) + 1, y = 12 - (v / m) * 10; if (k) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }

  private drawPower(ser: ReadonlyArray<{ demand: number; supply: number }>): void {
    const cv = this.power, g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    if (ser.length < 2) {
      setText(this.demandV, '—'); setText(this.supplyV, '—'); setText(this.powerPart.aside, '');
      return;
    }
    const max = Math.max(1, ...ser.map((s) => Math.max(s.demand, s.supply))) * 1.1;
    const H = cv.height, W = cv.width;
    const xy = (k: number, v: number): [number, number] => [(k / (ser.length - 1)) * (W - 4) + 2, H - 4 - (v / max) * (H - 8)];
    // Faint quarter lines, so the eye reads the levels.
    g.strokeStyle = C.inkSoft; g.globalAlpha = 0.14; g.lineWidth = 1;
    for (let q = 1; q < 4; q++) { const y = Math.round(H - 4 - (q / 4) * (H - 8)) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.globalAlpha = 1;
    // What is available, as a filled area; what is asked, as a line over it.
    g.fillStyle = C.turqL; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(2, H - 4);
    ser.forEach((s, k) => { const [x, y] = xy(k, s.supply); g.lineTo(x, y); });
    g.lineTo(W - 2, H - 4); g.closePath(); g.fill(); g.globalAlpha = 1;
    const line = (pick: (s: { demand: number; supply: number }) => number, color: string, w: number): void => {
      g.strokeStyle = color; g.lineWidth = w; g.lineJoin = 'round'; g.beginPath();
      ser.forEach((s, k) => { const [x, y] = xy(k, pick(s)); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    };
    line((s) => s.supply, C.turqD, 2.4);
    line((s) => s.demand, C.coralD, 2);
    const last = ser[ser.length - 1]!;
    setText(this.demandV, kw(last.demand));
    setText(this.supplyV, kw(last.supply));
    const load = last.supply > 0 ? last.demand / last.supply : last.demand > 0 ? 2 : 0;
    setText(this.powerPart.aside, pct(Math.min(load, 9.99)));
    setAttr(this.powerPart.aside, 'data-tone', load >= 1 ? 'bad' : load >= LOAD_WARN ? 'warn' : 'good');
  }
}
