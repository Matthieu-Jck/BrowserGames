// stats.ts (screen) — the Statistics (G, or the HUD's chip), the Analytics path's screen (D41):
// production and consumption per item over a chosen window (1 min, 10 min, 1 h, 10 h): made, used
// and net per minute with a sparkline of the net (the ledger, `statistics`); above it, with the
// Diagnostics, the machines' states — how many run, wait, are blocked or unpowered, and which
// (`machineStates`); under it, with the Power Log, the grids' power, demand against what is
// available. Each part shows only once its plan is unlocked (`analyticsOn`). Every number says
// what it is (per minute, averaged over the window), every item shows its icon (mention.ts), and
// an empty table says why and what to do. Labels are written on each refresh, so a language
// switch shows at once. Read-only; refreshed at 4 Hz while open.
import { N_ITEMS, buildingDef } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import { num } from '@/i18n/format';
import type { Atlas } from '@/render/art/atlas';
import { C } from '@/render/art/tokens';
import type { Sim } from '@/sim/state';
import { analyticsOn, machineStates, type MachineState } from '../analytics';
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
  starved: 'insp.status.starved', blocked: 'insp.status.blocked', nojob: 'insp.status.nojob', lowpower: 'insp.status.lowpower',
  ok: 'insp.status.ok', idle: 'insp.status.idle', building: 'insp.status.building', dormant: 'insp.status.dormant',
};
const STATE_TONE: Record<MachineState, 'good' | 'warn' | 'bad' | 'idle'> = {
  unlinked: 'bad', unpowered: 'bad', nofuel: 'bad', starved: 'warn', blocked: 'warn', nojob: 'warn', lowpower: 'warn',
  ok: 'good', idle: 'idle', building: 'idle', dormant: 'idle',
};

export class StatsScreen {
  readonly root: HTMLElement;
  private win: StatWindow = '10m';
  private readonly tabs = new Map<StatWindow, HTMLButtonElement>();
  private readonly table = el('div.st-table');
  private readonly power = el('canvas.st-power') as HTMLCanvasElement;
  private readonly powerLegend = el('div.st-legend');
  private readonly powerDemand = el('span.st-leg', { 'data-tone': 'demand' });
  private readonly powerSupply = el('span.st-leg', { 'data-tone': 'supply' });
  private readonly empty = el('p.st-empty');
  /** What the numbers are: per minute, over the window. */
  private readonly note = el('p.st-note');
  /** The power history (the Power Log) and the machines' states (the Diagnostics): shown once unlocked. */
  private readonly powerPart: HTMLElement;
  private readonly powerTitle = el('h2.lettering');
  private readonly powerNote = el('p.st-note');
  private readonly machinesPart: HTMLElement;
  private readonly machinesTitle = el('h2.lettering');
  private readonly machinesNote = el('p.st-note');
  private readonly machines = el('div.st-states');
  private machinesSig = '';
  /** Labels written on each refresh (they follow a language switch). */
  private readonly labels: Array<[HTMLElement, () => string]> = [];
  private rows = new Map<number, { node: HTMLElement; made: HTMLElement; used: HTMLElement; net: HTMLElement; spark: HTMLCanvasElement }>();
  private rowsLocale = '';

  constructor(_atlas: Atlas, private readonly rec: StatsRecorder, private readonly host: StatsHost) {
    const label = <E extends HTMLElement>(node: E, text: () => string): E => { this.labels.push([node, text]); return node; };
    const tabs = el('div.st-tabs', {}, (Object.keys(WINDOWS) as StatWindow[]).map((w) => {
      const b = label(el<'button'>('button.btn.st-tab', { 'data-st-window': w, onclick: () => { this.win = w; this.refresh(); } }), () => t(`stats.window.${w}` as MsgKey));
      this.tabs.set(w, b);
      return b;
    }));
    this.power.width = 640; this.power.height = 120;
    this.powerLegend.append(this.powerDemand, this.powerSupply);
    this.machinesPart = el('section.st-part', { 'data-st-part': 'machines', hidden: true }, [this.machinesTitle, this.machinesNote, this.machines]);
    this.powerPart = el('section.st-part', { 'data-st-part': 'power', hidden: true }, [this.powerTitle, this.powerNote, this.power, this.powerLegend]);
    const close = el('button.btn.rs-close', { onclick: () => host.close() }, '✕');
    this.root = el('section.screen.stats', { 'data-screen': 'stats' }, [
      el('header.rs-head', {}, [label(el('h1.lettering'), () => t('screen.stats')), tabs, close]),
      el('div.st-body.cartouche', {}, [
        this.machinesPart,
        el('section.st-part', { 'data-st-part': 'ledger' }, [
          label(el('h2.lettering'), () => t('stats.ledger')),
          this.note,
          el('div.st-row.st-headrow', {}, [
            label(el('span'), () => t('stats.item')), label(el('span.st-num'), () => t('stats.made')),
            label(el('span.st-num'), () => t('stats.used')), label(el('span.st-num'), () => t('stats.net')),
            label(el('span.st-mid'), () => t('stats.trend')),
          ]),
          this.empty, this.table,
        ]),
        this.powerPart,
      ]),
    ]);
    this.labels.push([close, () => '✕']);
    setAttr(close, 'title', t('screen.close'));
  }

  private row(i: number): { node: HTMLElement; made: HTMLElement; used: HTMLElement; net: HTMLElement; spark: HTMLCanvasElement } {
    let r = this.rows.get(i);
    if (!r) {
      const made = el('span.st-num'), used = el('span.st-num'), net = el('span.st-num');
      const spark = el('canvas.st-spark') as HTMLCanvasElement;
      spark.width = 120; spark.height = 24;
      const node = el('div.st-row', { 'data-item': i }, [el('span.st-item', {}, itemMention(i)), made, used, net, spark]);
      r = { node, made, used, net, spark };
      this.rows.set(i, r);
    }
    return r;
  }

  refresh(): void {
    // A language switch: the rows (their names) are made again.
    if (locale() !== this.rowsLocale) { this.rowsLocale = locale(); this.rows.clear(); this.machinesSig = ''; }
    for (const [node, text] of this.labels) setText(node, text());
    for (const [w, b] of this.tabs) setAttr(b, 'data-on', w === this.win ? '' : null);
    const { made, used, span } = this.rec.rates(this.win);
    setText(this.note, t('stats.note', { window: t(`stats.window.${this.win}` as MsgKey) }));
    const active: number[] = [];
    for (let i = 0; i < N_ITEMS; i++) if (Math.abs(made[i]!) > 0.01 || Math.abs(used[i]!) > 0.01) active.push(i);
    active.sort((a, b) => made[b]! + used[b]! - (made[a]! + used[a]!) || a - b);
    // Nothing to show: either too few samples yet, or nothing moved in the window.
    setText(this.empty, !span ? t('stats.empty') : active.length ? '' : t('stats.none'));
    setAttr(this.empty, 'hidden', !span || !active.length ? null : '');
    const nodes = active.map((i) => this.row(i).node);
    if (nodes.length !== this.table.children.length || nodes.some((n, k) => this.table.children[k] !== n)) this.table.replaceChildren(...nodes);
    const ser = this.rec.series(this.win);
    for (const i of active) {
      const r = this.row(i);
      const net = made[i]! - used[i]!;
      setText(r.made, made[i]! > 0.01 ? num(made[i]!) : '—');
      setText(r.used, used[i]! > 0.01 ? num(used[i]!) : '—');
      setText(r.net, `${net > 0 ? '+' : net < 0 ? '−' : ''}${num(Math.abs(net))}`);
      setAttr(r.net, 'data-sign', net > 0.01 ? '+' : net < -0.01 ? '-' : null);
      this.spark(r.spark, ser.map((s) => (s.prod[i]! - s.cons[i]!) / 1000));
    }
    // The Analytics path's later steps (D41): each part once its plan is taken.
    const sim = this.host.sim?.();
    const powerOn = !sim || analyticsOn(sim, 'power');
    setAttr(this.powerPart, 'hidden', powerOn ? null : '');
    if (powerOn) {
      setText(this.powerTitle, t('stats.power'));
      setText(this.powerNote, t('stats.power.note', { window: t(`stats.window.${this.win}` as MsgKey) }));
      this.drawPower(ser);
    }
    const machinesOn = !!sim && analyticsOn(sim, 'machines');
    setAttr(this.machinesPart, 'hidden', machinesOn ? null : '');
    if (sim && machinesOn) this.refreshMachines(sim);
  }

  /** The Diagnostics: one chip per state (worst first) with its count; the tooltip names the buildings. */
  private refreshMachines(sim: Sim): void {
    const L = locale();
    setText(this.machinesTitle, t('stats.machines'));
    setText(this.machinesNote, t('stats.machines.note'));
    const states = machineStates(sim);
    const sig = `${L}:${states.map((s) => `${s.state}=${[...s.defs].map(([d, n]) => `${d}x${n}`).join('.')}`).join(',')}`;
    if (sig === this.machinesSig) return;
    this.machinesSig = sig;
    if (!states.length) { this.machines.replaceChildren(el('span.st-none', {}, t('stats.machines.none'))); return; }
    this.machines.replaceChildren(...states.map((s) => {
      const which = [...s.defs].map(([d, n]) => `${buildingDef(d).name[L]}${n > 1 ? ` ×${n}` : ''}`).join(', ');
      return el('span.st-state', { 'data-state': s.state, 'data-tone': STATE_TONE[s.state], title: which }, [
        el('b', {}, num(s.n)), t(STATE_LABEL[s.state]),
      ]);
    }));
  }

  /** Net rate between consecutive samples, as a small inked line around zero. */
  private spark(cv: HTMLCanvasElement, cum: number[]): void {
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    if (cum.length < 3) return;
    const d = cum.slice(1).map((v, k) => v - cum[k]!);
    const m = Math.max(1e-6, ...d.map(Math.abs));
    g.strokeStyle = C.inkSoft; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(0, 12); g.lineTo(cv.width, 12); g.stroke();
    g.globalAlpha = 1; g.strokeStyle = C.turqD; g.lineWidth = 1.6; g.beginPath();
    d.forEach((v, k) => { const x = (k / (d.length - 1)) * (cv.width - 2) + 1, y = 12 - (v / m) * 10; if (k) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }

  private drawPower(ser: ReadonlyArray<{ demand: number; supply: number }>): void {
    const cv = this.power, g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    if (ser.length < 2) { setText(this.powerDemand, ''); setText(this.powerSupply, ''); return; }
    const max = Math.max(1, ...ser.map((s) => Math.max(s.demand, s.supply))) * 1.1;
    const line = (pick: (s: { demand: number; supply: number }) => number, color: string, w: number): void => {
      g.strokeStyle = color; g.lineWidth = w; g.beginPath();
      ser.forEach((s, k) => { const x = (k / (ser.length - 1)) * (cv.width - 4) + 2, y = cv.height - 4 - (pick(s) / max) * (cv.height - 8); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    };
    g.fillStyle = 'rgba(63,184,175,0.12)'; g.fillRect(0, 0, cv.width, cv.height);
    line((s) => s.supply, C.turqD, 2.4);
    line((s) => s.demand, C.coralD, 2);
    const last = ser[ser.length - 1]!;
    setText(this.powerDemand, `${t('stats.demand')} ${t('insp.kw', { v: num(last.demand) })}`);
    setText(this.powerSupply, `${t('stats.supply')} ${t('insp.kw', { v: num(last.supply) })}`);
  }
}
