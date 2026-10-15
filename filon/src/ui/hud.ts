// hud.ts — the top bar, in separate inked cartouches (D88; owner, 2026-10-15: « Plus clair, plus
// séparé »): the Heart's stocks (glyph, amount, change per minute — the first few, the rest behind
// a « +n » chip that opens a drawer under them), the economy (the ocelles with the recurring trade
// per hour; a click opens the Crier when the shell allows it), the energy (the Heart grid's power
// and a bar of it; a click opens the Électricité view), the time of day with the cirque's air
// temperature (the sun's % in its tooltip). On the right, the view selector (ui/views/view-bar.ts,
// the shell puts it in `views`), the button that opens building (the plan view) or goes back to
// the view — a coral dot on it when something new may be built — and the main menu.
// Under them, the tech tree's chip (D33: plans and research, T; a badge counts the plans the
// Heart can pay for right now), the Statistics chip (G) once the ledger is unlocked, and one chip
// per research project.
// What the Analytics path unlocks (D41, ui/analytics.ts) shows here: the stocks' rates with the
// telemetry, the Statistics chip with the ledger. When an analytics plan is taken, the HUD plays
// its reveal (ui/focus.ts): the base dims and the new readout is lifted out with CrierBelt's line,
// as soon as no screen covers the HUD (`HudHost.covered`).
// A stock chip's change reads « +12/min »: what the base brought into the Heart over the last
// minute (`Sim.hearthIn`), so it speaks of the number beside it — never negative, since nothing
// leaves the Heart by itself (a building's cost is no rate). Its tooltip says it in words (the
// item, what the Heart holds, what came in over the last minute).
// Refreshed at 4 Hz; the DOM is only written when something changed.
import { ITEM_IDS, itemIdx, N_ITEMS } from '@/content/registry';
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { locale, t, tr } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import type { Sim } from '@/sim/state';
import { itemIcon } from './build-bar';
import { nameOf } from './mention';
import { PLAN_IDS, RESEARCH, nodeName, type ResearchId } from '@/content/research';
import type { ResearchDef } from '@/content/types';
import { projectPermille } from '@/sim/research/runtime';
import { dayEpoch, sunPermille } from '@/sim/power/network';
import { EPOCH, DAY_EPOCHS, TPS } from '@/sim/constants';
import { temperatureAt } from '@/sim/world/climate';
import { revealed } from '@/sim/systems/quests';
import { duration } from '@/i18n/format';
import type { MsgKey } from '@/i18n/i18n';
import { oc, tradePerHour } from './trade-view';
import { ANALYTICS_REVEALS, UnlockWatch, analyticsOn } from './analytics';
import { Spotlight, type FocusShot } from './focus';

/** More ticks than this between two one-second samples: a catch-up ran (play runs `TPS` a second). */
const CATCH_UP_TICKS = 3 * TPS;
/** Items shown first when held (the early chain), then anything else in stock. */
const ORDER = ['iron_ore', 'iron_plate', 'sand', 'glass', 'coal', 'copper_ore', 'copper_wire', 'journal_1', 'journal_2', 'gear', 'circuit', 'ceramic', 'stone', 'salt'];
/** Stocks on the bar itself (the most stocked); the rest wait behind the « +n » chip (D88). */
const MAIN_STOCKS = 5;

const compact = (n: number): string => {
  const L = locale();
  if (Math.abs(n) >= 10000) return `${new Intl.NumberFormat(L, { maximumFractionDigits: 1 }).format(n / 1000)} k`;
  return new Intl.NumberFormat(L, { maximumFractionDigits: 0 }).format(n);
};

const SVG = 'http://www.w3.org/2000/svg';

/** The tech tree's mark: an inked trunk forking into three branches, a node at each tip. */
function treeGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'hud-tree-glyph');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M10 18 V10 M10 12 L4.5 6.5 M10 10 V4 M10 12 L15.5 6.5');
  svg.append(path);
  for (const [x, y] of [[4, 6], [10, 3.5], [16, 6]] as const) {
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', '2.3');
    svg.append(c);
  }
  return svg;
}

/** The Statistics mark: three inked bars on a base line and a rising trend over them. */
function statsGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'hud-tree-glyph');
  for (const [x, y] of [[3, 12], [8.3, 8.5], [13.6, 10.5]] as const) {
    const r = document.createElementNS(SVG, 'rect');
    r.setAttribute('x', String(x)); r.setAttribute('y', String(y)); r.setAttribute('width', '3.4'); r.setAttribute('height', String(17.5 - y)); r.setAttribute('rx', '0.6');
    svg.append(r);
  }
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M1.5 17.5 H18.5 M3.5 7.5 L9 3.8 L12.6 5.8 L17 2');
  svg.append(path);
  return svg;
}

export interface HudHost {
  sim(): Sim;
  building(): boolean;
  toggleBuild(): void;
  openResearch(): void;
  /** Open the Crier (M); when given, the ocelles chip opens it. */
  openCrier?(): void;
  /** Open the main menu; when given, a menu button sits right of « Construire ». */
  openMenu?(): void;
  /** The absolute world tick the clock shows (default: the sim's; the shell adds FL.dayPhase's offset). */
  worldTick?(): number;
  /** Open the Statistics screen; when given, the Statistics chip (once the ledger is unlocked) opens it. */
  openStats?(): void;
  /** Is something over the HUD (a full screen, the menu, a modal)? A reveal waits until it is gone. */
  covered?(): boolean;
  /** The energy chip's click: the Électricité view (D88), and whether it is on. */
  openPower?(): void;
  powerOn?(): boolean;
  /** Is something newly unlocked waiting in the build bar's trays (a dot on « Construire »)? */
  buildNew?(): boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly stocks: HTMLElement;
  private readonly chips = new Map<number, { node: HTMLElement; val: HTMLElement; delta: HTMLElement }>();
  private readonly credits: HTMLElement;
  private readonly creditsChip: HTMLElement;
  /** The bar's cartouches (D88): stocks, economy, energy, time. */
  private readonly stocksGrp: HTMLElement;
  private readonly ecoGrp: HTMLElement;
  private readonly timeGrp: HTMLElement;
  /** « +n »: the stocks not on the bar, in a drawer under it. */
  private readonly moreBtn: HTMLButtonElement;
  private readonly drawer: HTMLElement;
  private drawerOpen = false;
  /** Where the shell puts the view selector (ui/views/view-bar.ts), left of « Construire ». */
  readonly views: HTMLElement;
  /** The colony's recurring trade, ◉ per hour (streams and orders). */
  private readonly creditsRate: HTMLElement;
  private readonly power: HTMLElement;
  private readonly powerVal: HTMLElement;
  private readonly powerFill: HTMLElement;
  private readonly buildBtn: HTMLButtonElement;
  /** The main menu (three inked strokes), right of the build button. */
  private readonly menuBtn: HTMLButtonElement | null;
  private readonly research: HTMLElement;
  /** The tech tree's chip (D33), first in the research row, and its parts. */
  private readonly tree: HTMLElement;
  private readonly treeName: HTMLElement;
  private readonly treeBadge: HTMLElement;
  /** The Statistics chip (G), right of the tree's, once the ledger (analytics) is unlocked. */
  private readonly stats: HTMLElement;
  private readonly statsName: HTMLElement;
  /** The spotlight the analytics reveals play in (D41); FL.focusReveal drives it too. */
  readonly spotlight = new Spotlight({ auto: !(typeof navigator !== 'undefined' && navigator.webdriver) });
  /** Which analytics plans were just taken: each plays its reveal once. */
  private readonly unlocks = new UnlockWatch(Object.keys(ANALYTICS_REVEALS));
  /** The time of day: sun or moon and the hour, then the air temperature; the sun's % in the tooltip. */
  private readonly clock: HTMLElement;
  private readonly clockTime: HTMLElement;
  private readonly clockTemp: HTMLElement;
  private researchSig = '';
  /** Chips the shell pins at the end of the research row (the debug base's badge). */
  private readonly pinned: HTMLElement[] = [];
  /** The Heart's intake counters (`Sim.hearthIn`), one sample per second, for the rates (last 60). */
  private samples: Float64Array[] = [];
  private lastSample = -1;
  /** The tick of the last sample: a jump (a catch-up) starts the minute afresh. */
  private lastTick = -1;
  /** The colony the samples are of (a swap starts them afresh). */
  private knownSim: unknown = null;

  constructor(private readonly atlas: Atlas, private readonly host: HudHost) {
    this.stocks = el('div.hud-stocks', { 'data-hud-stocks': '' });
    this.credits = el('span.hud-val');
    this.creditsRate = el('span.hud-delta');
    const open = host.openCrier ? (): void => host.openCrier?.() : null;
    this.creditsChip = el('div.hud-chip.hud-credits', { 'data-hud-crier': open ? '' : null, onclick: open }, [el('span.hud-coin', {}, '◉'), this.credits, this.creditsRate]);
    this.powerVal = el('span.hud-val');
    this.powerFill = el('span.hud-pbar-fill');
    const openPower = host.openPower ? (): void => host.openPower?.() : null;
    this.power = el(openPower ? 'button.hud-grp.hud-power.cartouche' : 'div.hud-grp.hud-power.cartouche', { type: openPower ? 'button' : null, 'data-hud-power': '', onclick: openPower }, [
      el('span.hud-chip', {}, [el('span.hud-bolt', {}, '⚡'), this.powerVal]),
      el('span.hud-pbar', {}, [this.powerFill]),
    ]);
    this.buildBtn = el('button.btn.primary.hud-build', { onclick: () => host.toggleBuild() }, t('view.toPlan')) as HTMLButtonElement;
    this.menuBtn = host.openMenu
      ? el<'button'>('button.btn.hud-menu', { type: 'button', onclick: () => host.openMenu?.() }, [el('i'), el('i'), el('i')])
      : null;
    this.research = el('div.hud-research', { onclick: () => host.openResearch() });
    this.treeName = el('span.hud-rs-name.lettering');
    this.treeBadge = el('span.hud-tree-badge');
    this.tree = el('button.hud-rs.hud-tree.cartouche', { 'data-hud-tree': '' }, [treeGlyph(), this.treeName, this.treeBadge]);
    this.statsName = el('span.hud-rs-name.lettering');
    // Its own action: the row's click opens the tree, so this one stops there.
    this.stats = el('button.hud-rs.hud-tree.hud-stats.cartouche', {
      type: 'button', 'data-hud-stats': '', hidden: true,
      onclick: (e: Event) => { e.stopPropagation(); host.openStats?.(); },
    }, [statsGlyph(), this.statsName]);
    this.clockTime = el('span.hud-time');
    this.clockTemp = el('span.hud-temp');
    this.clock = el('div.hud-chip.hud-clock', {}, [this.clockTime, this.clockTemp]);
    this.moreBtn = el<'button'>('button.hud-more', { type: 'button', 'data-hud-more': '', onclick: () => { this.drawerOpen = !this.drawerOpen; this.refreshDrawer(); } });
    this.drawer = el('div.hud-drawer.cartouche', { 'data-hud-drawer': '', hidden: true });
    this.stocksGrp = el('div.hud-grp.hud-stocks-grp.cartouche', {}, [this.stocks, this.moreBtn]);
    this.ecoGrp = el('div.hud-grp.cartouche', { 'data-hud-eco': '' }, [this.creditsChip]);
    this.timeGrp = el('div.hud-grp.cartouche', { 'data-hud-time': '' }, [this.clock]);
    this.views = el('div.hud-views');
    this.root = el('header.hud', { 'data-screen': 'hud' }, [
      el('div.hud-left', {}, [
        el('div.hud-row', {}, [this.stocksGrp, this.ecoGrp, this.power, this.timeGrp]),
        this.drawer,
        this.research,
      ]),
      el('div.hud-right', {}, [this.views, this.buildBtn, this.menuBtn]),
    ]);
  }

  /** The drawer of the stocks not on the bar: shown while open and there are some. */
  private refreshDrawer(): void {
    const extra = this.extra.length;
    if (!extra) this.drawerOpen = false;
    setAttr(this.drawer, 'hidden', this.drawerOpen && extra ? null : '');
    setAttr(this.moreBtn, 'data-on', this.drawerOpen ? '' : null);
    setAttr(this.moreBtn, 'aria-expanded', this.drawerOpen ? 'true' : 'false');
  }

  private chip(item: number): { node: HTMLElement; val: HTMLElement; delta: HTMLElement } {
    let c = this.chips.get(item);
    if (!c) {
      const val = el('span.hud-val'), delta = el('span.hud-delta');
      const node = el('div.hud-chip', { 'data-item': ITEM_IDS[item] }, [itemIcon(this.atlas, item, 22), val, delta]);
      c = { node, val, delta };
      this.chips.set(item, c);
    }
    return c;
  }

  /** Keep a chip of the shell's at the end of the research row (it flows with the row, never over the world). */
  pin(node: HTMLElement): void {
    this.pinned.push(node);
    this.research.append(node);
  }

  /** The tech tree's chip (the way into the tree, D33), then one chip per project: a progress ring, the name, the time left. */
  private refreshResearch(sim: Sim): void {
    const L = locale();
    const sig = sim.projects.map((p) => p.id).join(',') + L;
    if (sig !== this.researchSig) {
      this.researchSig = sig;
      const chips = sim.projects.map((p) => {
        const name = p.id.startsWith('respec:')
          ? t('research.respecName', { branch: t(`research.branch.${p.id.slice(7)}` as MsgKey) })
          : (RESEARCH[p.id as ResearchId] as ResearchDef).name[L];
        return el('button.hud-rs.cartouche', { 'data-id': p.id }, [el('span.hud-ring'), el('span.hud-rs-name.lettering', {}, name), el('span.hud-rs-eta')]);
      });
      setText(this.treeName, t('tree.hud'));
      this.research.replaceChildren(this.tree, this.stats, ...chips, ...this.pinned);
    }
    // The Statistics chip: the ledger's way in (G), shown once it is unlocked (D41).
    setAttr(this.stats, 'hidden', analyticsOn(sim, 'ledger') ? null : '');
    setText(this.statsName, t('hud.stats'));
    setAttr(this.stats, 'title', t('hud.stats.tip'));
    // The plans the Heart can pay for right now (prerequisites met): an invitation to open the tree.
    const ready = PLAN_IDS.filter((id) => sim.planBlock(id) === null).length;
    setText(this.treeBadge, ready ? String(ready) : '');
    setAttr(this.tree, 'data-ready', ready ? '' : null);
    setAttr(this.tree, 'title', ready ? `${t('tree.hud.tip')} · ${tr('tree.hud.ready', { n: ready })}` : t('tree.hud.tip'));
    // A purse in the red holds every project (its tokens cannot be paid): each chip turns coral
    // and says so, the purse in its tip — beside the toast, the lab's inspector and the tree.
    const heldTip = sim.researchHeld ? t('tree.rs.held.tip', { v: oc(sim.credits) }) : null;
    for (const p of sim.projects) {
      const chip = this.research.querySelector(`[data-id="${p.id}"]`) as HTMLElement | null;
      if (!chip) continue;
      const pm = projectPermille(p);
      (chip.querySelector('.hud-ring') as HTMLElement).style.setProperty('--p', `${pm / 10}%`);
      const net = p.lab ? sim.graph?.nodeByEnt.get(p.lab)?.net ?? -1 : -1;
      const sat = p.lab ? (net >= 0 ? sim.netPower[net]?.sat ?? 0 : 0) : 1000;
      const left = sat > 0 ? Math.max(0, p.dur * 1000 - p.el) / sat / 10 : Infinity;
      const short = p.el >= p.dur * 1000 && pm < 1000;
      const stop = sim.researchHeld && p.lab !== 0; // as `projectSat`: a reconversion (no lab) runs on
      setAttr(chip, 'data-held', stop ? '' : null);
      setAttr(chip, 'title', stop ? heldTip : null);
      setText(chip.querySelector('.hud-rs-eta')!, stop ? t('hud.rs.held') : short ? t('research.waiting') : Number.isFinite(left) ? duration(left) : '—');
    }
  }

  /** The stock chips on show (refresh picks them; `counts` keeps their numbers live): on the bar, in the drawer. */
  private shown: number[] = [];
  private extra: number[] = [];

  /**
   * Every frame, the stock counts alone (change-only writes): an item lands in the Heart whole,
   * on the tick it reaches it, and its +1 shows with it — not up to a quarter second later.
   */
  counts(): void {
    const sim = this.host.sim();
    for (const i of this.shown) setText(this.chip(i).val, compact(Math.floor(sim.stock[i]! / 1000)));
    if (this.drawerOpen) for (const i of this.extra) setText(this.chip(i).val, compact(Math.floor(sim.stock[i]! / 1000)));
  }

  refresh(nowMs: number): void {
    const sim = this.host.sim();
    // Another colony in play (a debug base, the player's own back): its rates start afresh.
    if (sim !== this.knownSim) { this.knownSim = sim; this.samples = []; this.lastSample = -1; this.lastTick = -1; }
    // One sample per second; the rate against the oldest (up to a minute back).
    const sec = Math.floor(nowMs / 1000);
    if (sec !== this.lastSample) {
      this.lastSample = sec;
      // A catch-up (the tab back, a resync) runs many ticks at once: its intake is no rate of the
      // last minute, so the window starts afresh (a second of play is 10 ticks).
      if (this.lastTick >= 0 && (sim.tick < this.lastTick || sim.tick - this.lastTick > CATCH_UP_TICKS)) this.samples = [];
      this.lastTick = sim.tick;
      // What came into the Heart (owner, 2026-10-14: "the number of resources should only take
      // into account what's in the Core, and nothing goes out of it"): not the base's net
      // production, which a machine eating what was bought, or what waited in a silo or on a
      // ribbon, made read −5/min beside a Heart stock that never moved.
      this.samples.push(sim.hearthIn.slice());
      if (this.samples.length > 61) this.samples.shift();
    }
    const old = this.samples[0];
    const span = Math.max(1, this.samples.length - 1);
    const held = ORDER.map((id) => itemIdx(id)).filter((i) => sim.stock[i]! >= 1000);
    for (let i = 0; i < N_ITEMS; i++) if (!held.includes(i) && sim.stock[i]! >= 1000) held.push(i);
    // During the tutorial, a stock shows once the tutorial has introduced it, or once the base
    // has made some itself: nothing on screen before it means something to the player.
    const rv = revealed(sim);
    const tele = analyticsOn(sim, 'rates');
    const all = held.filter((i) => !rv || rv.has(`stock:${ITEM_IDS[i]}`) || sim.produced[i]! > 0);
    // On the bar: the most stocked (a stock of one is no headline), kept in the chain's order so the chips never shuffle.
    const top = new Set([...all].sort((a, b) => sim.stock[b]! - sim.stock[a]! || a - b).slice(0, MAIN_STOCKS));
    const want = all.filter((i) => top.has(i));
    // The groups (D88): each cartouche shows once the tutorial has introduced what it holds.
    setAttr(this.stocksGrp, 'hidden', want.length ? null : '');
    setAttr(this.ecoGrp, 'hidden', rv && !rv.has('credits') ? '' : null);
    setAttr(this.power, 'hidden', rv && !rv.has('power') ? '' : null);
    setAttr(this.timeGrp, 'hidden', rv && !rv.has('clock') ? '' : null);
    setAttr(this.research, 'hidden', rv && !rv.has('research') ? '' : null);
    // No Build button with nothing to build; a coral dot on it when a tray holds something new.
    setAttr(this.buildBtn, 'hidden', !rv || rv.has('build') ? null : '');
    setAttr(this.buildBtn, 'data-new', !this.host.building() && this.host.buildNew?.() ? '' : null);
    setAttr(this.buildBtn, 'title', !this.host.building() && this.host.buildNew?.() ? t('build.newHud') : null);
    this.shown = want;
    this.extra = all.filter((i) => !top.has(i));
    const nodes = want.map((i) => this.chip(i).node);
    if (nodes.length !== this.stocks.children.length || nodes.some((n, k) => this.stocks.children[k] !== n)) this.stocks.replaceChildren(...nodes);
    // The rest behind « +n »: a drawer under the bar, built from the same chips.
    setText(this.moreBtn, this.extra.length ? t('hud.more', { n: this.extra.length }) : '');
    setAttr(this.moreBtn, 'hidden', this.extra.length ? null : '');
    setAttr(this.moreBtn, 'title', t('hud.more.tip'));
    const more = this.extra.map((i) => this.chip(i).node);
    if (more.length !== this.drawer.children.length || more.some((n, k) => this.drawer.children[k] !== n)) this.drawer.replaceChildren(...more);
    this.refreshDrawer();
    for (const i of all) {
      const c = this.chip(i);
      setText(c.val, compact(Math.floor(sim.stock[i]! / 1000)));
      // Rates are an unlock: the telemetry, the Analytics path's first plan (D41).
      const last = this.samples[this.samples.length - 1];
      const d = tele && old && last ? ((last[i]! - old[i]!) / 1000) * (60 / span) : 0;
      const dv = Math.abs(d) >= 0.5 ? `${d > 0 ? '+' : '−'}${compact(Math.abs(d))}` : '';
      setText(c.delta, dv ? t('hud.perMin', { v: dv }) : '');
      setAttr(c.delta, 'data-sign', d > 0 ? '+' : d < 0 ? '-' : null);
      // What the chip says, in words: the item, what the Heart holds, and (with the telemetry) what came in.
      const n = compact(Math.floor(sim.stock[i]! / 1000));
      setAttr(c.node, 'title', tele ? t('hud.stock.tipRate', { item: nameOf(i), n, rate: t('hud.perMin', { v: dv || '0' }) }) : t('hud.stock.tip', { item: nameOf(i), n }));
    }
    setText(this.credits, compact(sim.credits / 100));
    const perHour = tradePerHour(sim) / 100;
    setText(this.creditsRate, Math.abs(perHour) >= 0.5 ? t('hud.perHour', { v: `${perHour > 0 ? '+' : '−'}${compact(Math.abs(perHour))}` }) : '');
    setAttr(this.creditsRate, 'data-sign', perHour >= 0.5 ? '+' : perHour <= -0.5 ? '-' : null);
    setAttr(this.creditsChip, 'title', this.host.openCrier ? `${t('hud.credits')} · ${t('crier.hud.tip')}` : t('hud.credits'));
    // Power of the Hearth's grid.
    const net = sim.graph?.netOfEnt.get(sim.hearthId);
    const np = net !== undefined ? sim.netPower[net] : undefined;
    if (np) {
      const pct = Math.round(np.sat / 10);
      setText(this.powerVal, t('hud.powerPct', { v: pct }));
      setAttr(this.power, 'data-low', pct < 100 ? '' : null);
      setAttr(this.power, 'data-out', pct <= 0 ? '' : null);
      setStyle(this.powerFill, 'transform', `scaleX(${(pct / 100).toFixed(3)})`);
      setAttr(this.power, 'title', `${t('hud.powerTip', { d: Math.round(np.demand), s: Math.round(np.renew + np.fuel) })}${this.host.openPower ? ` · ${t('hud.power.open')}` : ''}`);
    }
    setAttr(this.power, 'data-on', this.host.powerOn?.() ? '' : null);
    // Accumulators on the Hearth's grid.
    if (np && net !== undefined) {
      let E = 0, cap = 0;
      for (const a of sim.graph.nets[net]?.accs ?? []) { E += sim.accEnergy.get(a.ent) ?? 0; cap += a.cap; }
      if (cap > 0) setAttr(this.power, 'title', `${t('hud.powerTip', { d: Math.round(np.demand), s: Math.round(np.renew + np.fuel) })} · ${t('hud.gourds', { v: Math.round((E * 100) / cap) })}${this.host.openPower ? ` · ${t('hud.power.open')}` : ''}`);
    }
    // Time of day: a 36-minute day on a 24-hour clock (midnight mid-night), from the world clock
    // (the shell may shift it for FL.dayPhase); the air temperature of the cirque; the sun in the tooltip.
    const T = Math.floor(this.host.worldTick?.() ?? sim.foundingEpoch * EPOCH + sim.tick);
    const ep = Math.floor(T / EPOCH), de = dayEpoch(ep);
    const phase = de + (T - ep * EPOCH) / EPOCH;
    const hour = Math.floor((((phase - 6 + DAY_EPOCHS) % DAY_EPOCHS) / DAY_EPOCHS) * 24);
    const sun = sunPermille(ep);
    setText(this.clockTime, `${sun > 0 ? '☀' : '☾'} ${t('hud.time', { h: hour })}`);
    setText(this.clockTemp, t('hud.temp', { v: Math.round(temperatureAt(T, sim.worldSeed) / 10) }));
    const part = sun >= 1000 ? 'hud.day' : sun <= 0 ? 'hud.night' : de < DAY_EPOCHS / 2 ? 'hud.dawn' : 'hud.dusk';
    setAttr(this.clock, 'title', t('hud.clockTip', { phase: t(part), sun: Math.round(sun / 10) }));
    this.refreshResearch(sim);
    setText(this.buildBtn, this.host.building() ? t('view.toIso') : t('view.toPlan'));
    setAttr(this.buildBtn, 'data-on', this.host.building() ? '' : null);
    if (this.menuBtn) {
      setAttr(this.menuBtn, 'title', t('menu.open'));
      setAttr(this.menuBtn, 'aria-label', t('menu.open'));
    }
    // An analytics plan just taken plays its reveal, once the HUD above is written and nothing
    // covers it (the tree is usually still open: it plays when the player comes back to the base).
    for (const id of this.unlocks.fresh(sim)) {
      const shot = this.revealShot(id);
      if (shot) this.spotlight.queue(shot);
    }
    this.spotlight.pump(!this.host.covered?.());
  }

  /** The reveal of an analytics plan (D41): what it lifts out, and CrierBelt's line. Null for any other id. */
  private revealShot(id: string): FocusShot | null {
    const r = ANALYTICS_REVEALS[id];
    if (!r) return null;
    return {
      id, target: r.target, voice: t('focus.voice'), caption: t(r.caption), hint: t('focus.skip'),
      kicker: `${t('tree.lane.analytics')} · ${nodeName(id)[locale()]}`,
    };
  }

  /** Play an analytics plan's reveal now (`force`: even under automation — FL.focusReveal). Returns whether it plays. */
  reveal(id: string, force = false): boolean {
    const shot = this.revealShot(id);
    return !!shot && this.spotlight.play(shot, force);
  }
}
