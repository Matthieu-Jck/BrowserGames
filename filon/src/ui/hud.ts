// hud.ts — the top bar, in separate inked cartouches (D88; owner, 2026-10-15: « Plus clair, plus
// séparé »): the Heart's stock behind a « Stock » button (D96; owner, 2026-10-16: « n'affiche plus
// cette barre de ressource… il faut que le joueur clique sur un bouton Stock pour le voir »: a crate,
// the word, a badge when the base lacks an item — ui/stock-facts.ts —, the panel in
// ui/stock-panel.ts, open or closed as this viewer last left it), the economy (the ocelles with the recurring trade
// per hour; a click opens the Crier when the shell allows it), the energy (the Heart grid's power
// and a bar of it; a click opens the Électricité view), the time of day with the cirque's air
// temperature (the sun's % in its tooltip). On the right, the view selector (ui/views/view-bar.ts,
// the shell puts it in `views`), the button that opens building (the plan view) or goes back to
// the view — a coral dot on it when something new may be built — and the main menu.
// Under them, the tech tree's chip (D33: plans and research, T; a badge counts the plans the
// Heart can pay for right now), the Statistics chip (G) once the ledger is unlocked, and one chip
// per research project — the tree's state and a project's clock as the tree screen derives them
// (ui/tree-state.ts). Once the Core mounts its Archive (level 3), the Expertise chip (D93, E): the
// two slots' pictures and a badge of the expertises a free slot could take.
// What the Analytics path unlocks (D41, ui/analytics.ts) shows here: the stocks' rates with the
// telemetry (in the Stock panel), the Statistics chip with the ledger. When an analytics plan is taken, the HUD plays
// its reveal (ui/focus.ts): the base dims and the new readout is lifted out with CrierBelt's line,
// as soon as no screen covers the HUD (`HudHost.covered`).
// An item's rate in the Stock panel reads « +12/min »: what the base brought into the Heart over
// the last minute (`Sim.hearthIn`, sampled here once a second), so it speaks of the number beside
// it — never negative, since nothing leaves the Heart by itself (a building's cost is no rate).
// On a narrow window (D96, styles/responsive.css) the bar wraps and folds: the research row behind one chip (the tree's mark, its
// badge, the first project's ring) and the view selector behind a layers button, each opening as a
// dropdown under the HUD (`data-fold` on the root; a tap elsewhere closes it).
// Refreshed at 4 Hz; the DOM is only written when something changed.
import { tokenFacts } from './token-facts';
import { mark } from './inspector/kit';
import { ITEM_IDS, itemIdx, N_ITEMS } from '@/content/registry';
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { locale, t, tr } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import type { Sim } from '@/sim/state';
import { RESEARCH, nodeName, type ResearchId } from '@/content/research';
import type { ResearchDef } from '@/content/types';
import { dayEpoch, sunPermille } from '@/sim/power/network';
import { EPOCH, DAY_EPOCHS, TPS } from '@/sim/constants';
import { temperatureAt } from '@/sim/world/climate';
import { revealed } from '@/sim/systems/quests';
import { duration } from '@/i18n/format';
import type { MsgKey } from '@/i18n/i18n';
import { oc } from './trade-view';
import { ANALYTICS_REVEALS, UnlockWatch, analyticsOn } from './analytics';
import { projectTiming, projectTimings, readyPlans } from './tree-state';
import { Spotlight, type FocusShot } from './focus';
import { expertiseDef } from '@/content/expertises';
import { archiveOpen } from '@/sim/systems/expertise';
import { archiveGlyph, choosable, choosableText, expertiseIcon } from './screens/expertise';
import { crateGlyph, compact, StockPanel } from './stock-panel';
import { shortages, type Shortage } from './stock-facts';
import { PurseCard, perHour as purseHour } from './purse-card';
import { PurseHistory, purseSummary, type FlowLine, type PurseSummary } from './purse-facts';
import { makeStore } from '@/core/store';

/** More ticks than this between two one-second samples: a catch-up ran (play runs `TPS` a second). */
const CATCH_UP_TICKS = 3 * TPS;
/** Items shown first when held (the early chain), then anything else in stock. */
const ORDER = ['iron_ore', 'iron_plate', 'sand', 'glass', 'coal', 'copper_ore', 'copper_wire', 'gear', 'circuit', 'ceramic', 'stone', 'salt'];
/** Whether this viewer left the Stock panel open (D96): a convenience of this browser's, never the colony's. */
const stockPref = makeStore<{ version: 1; open: boolean }>('filon.stock.v1', 1, () => ({ version: 1, open: false }));

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

/** The views' mark (D96: the folded selector's button): three inked layers, stacked. */
function layersGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'hud-tree-glyph hud-layers-glyph');
  for (const [y, fill] of [[12.5, 'var(--c-paper-d)'], [9, 'var(--c-peach)'], [5.5, 'var(--c-turq)']] as const) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', `M10 ${y - 4} L18 ${y} L10 ${y + 4} L2 ${y} Z`);
    p.setAttribute('style', `fill: ${fill}`);
    svg.append(p);
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
  /** Open the Crier (M); when given, the purse's card ends with « Ouvrir la Criée » (D102). */
  openCrier?(): void;
  /** Go where a recurring flow of the purse is managed (D102: the order in the Crier, the tree, the lease's parcel). */
  purseGo?(f: FlowLine): void;
  /** Open the main menu; when given, a menu button sits right of « Construire ». */
  openMenu?(): void;
  /** The absolute world tick the clock shows (default: the sim's; the shell adds FL.dayPhase's offset). */
  worldTick?(): number;
  /** Open the Statistics screen; when given, the Statistics chip (once the ledger is unlocked) opens it. */
  openStats?(): void;
  /** Is something over the HUD (a full screen, the menu, a modal)? A reveal waits until it is gone. */
  covered?(): boolean;
  /** The energy chip's click: the Électricité view (D88), whether the tutorial offers it yet (D32), and whether it is on. */
  openPower?(): void;
  powerShown?(): boolean;
  powerOn?(): boolean;
  /** Is something newly unlocked waiting in the build bar's trays (a dot on « Construire »)? */
  buildNew?(): boolean;
  /** Open the Expertise window (D93); when given, its chip shows once the Core mounts the Archive. */
  openExpertise?(): void;
}

export class Hud {
  readonly root: HTMLElement;
  /** « Stock » (D96): the crate, the word, the badge of what the base lacks; it opens `stock`. */
  private readonly stockBtn: HTMLButtonElement;
  private readonly stockLabel: HTMLElement;
  private readonly stockBadge: HTMLElement;
  /** The Heart's stock panel; the shell puts its root in #ui. */
  readonly stock: StockPanel;
  /** What the base lacks, worked out once a second (ui/stock-facts.ts). */
  private lacks = new Map<number, Shortage>();
  private readonly credits: HTMLElement;
  private readonly creditsChip: HTMLElement;
  /** What the purse's ◉/h is made of (D102): opened by a click on the purse, or a rest of a mouse on it. */
  readonly purse: PurseCard;
  /** Opened by a click (it stays until closed), not by a passing pointer. */
  private pursePinned = false;
  /** The purse's journal sampled once a game minute (D102), and the summary of its last hour. */
  private readonly purseHist = new PurseHistory();
  private purseSum: PurseSummary | null = null;
  private purseKey = '';
  private purseTimer: ReturnType<typeof setTimeout> | null = null;
  /** The bar's cartouches (D88): economy, energy, time (and « Stock »). */
  private readonly ecoGrp: HTMLElement;
  private readonly timeGrp: HTMLElement;
  /** Where the shell puts the view selector (ui/views/view-bar.ts), left of « Construire ». */
  readonly views: HTMLElement;
  /** Narrow windows (D96): the research row's fold (the tree's mark, its badge, the first project's ring) and the views' (layers). */
  private readonly fold: HTMLButtonElement;
  private readonly foldBadge: HTMLElement;
  private readonly foldRing: HTMLElement;
  private readonly vfold: HTMLButtonElement;
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
  /** The Expertise chip (D93, E): the Archive's mark, the two slots' pictures, a badge of those to choose. */
  private readonly exp: HTMLElement;
  private readonly expName: HTMLElement;
  private readonly expSlots: HTMLElement;
  private readonly expBadge: HTMLElement;
  private expSig = '';
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
    this.stockLabel = el('span.hud-stock-label.lettering');
    this.stockBadge = el('span.hud-stock-badge');
    this.stockBtn = el<'button'>('button.hud-grp.hud-stock.cartouche', { type: 'button', 'data-hud-stock': '', 'aria-expanded': 'false', onclick: () => this.setStock(!this.stock.open) },
      [crateGlyph(), this.stockLabel, this.stockBadge]);
    this.stock = new StockPanel(atlas, () => this.setStock(false));
    this.credits = el('span.hud-val');
    this.creditsRate = el('span.hud-delta');
    this.creditsChip = el('div.hud-chip.hud-credits', { 'data-hud-purse': '', role: 'button', tabindex: '0', 'aria-expanded': 'false',
      onclick: () => this.setPurse(!(this.purse.open && this.pursePinned), true),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') this.setPurse(!this.purse.open, true); } }, [el('span.hud-coin', {}, '◉'), this.credits, this.creditsRate]);
    this.purse = new PurseCard(atlas, {
      sim: () => host.sim(), summary: () => this.purseNow(), go: (f) => { this.setPurse(false); host.purseGo?.(f); }, close: () => this.setPurse(false),
      openCrier: host.openCrier ? () => { this.setPurse(false); host.openCrier?.(); } : undefined,
    });
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
    this.expName = el('span.hud-rs-name.lettering');
    this.expSlots = el('span.hud-exp-slots');
    this.expBadge = el('span.hud-tree-badge');
    this.exp = el('button.hud-rs.hud-tree.hud-exp.cartouche', {
      type: 'button', 'data-hud-expertise': '', hidden: true,
      onclick: (e: Event) => { e.stopPropagation(); host.openExpertise?.(); },
    }, [archiveGlyph(), this.expName, this.expSlots, this.expBadge]);
    this.clockTime = el('span.hud-time');
    this.clockTemp = el('span.hud-temp');
    this.clock = el('div.hud-chip.hud-clock', {}, [this.clockTime, this.clockTemp]);
    this.ecoGrp = el('div.hud-grp.cartouche', { 'data-hud-eco': '' }, [this.creditsChip]);
    this.timeGrp = el('div.hud-grp.cartouche', { 'data-hud-time': '' }, [this.clock]);
    this.views = el('div.hud-views');
    this.foldBadge = el('span.hud-tree-badge');
    this.foldRing = el('span.hud-ring');
    this.fold = el<'button'>('button.hud-rs.hud-tree.hud-fold.cartouche', { type: 'button', 'data-hud-fold': 'research', 'aria-expanded': 'false', onclick: () => this.toggleFold('research') },
      [treeGlyph(), this.foldRing, this.foldBadge, el('span.hud-caret')]);
    this.vfold = el<'button'>('button.btn.hud-vfold', { type: 'button', 'data-hud-fold': 'views', 'aria-expanded': 'false', onclick: () => this.toggleFold('views') },
      [layersGlyph(), el('span.hud-caret')]);
    this.root = el('header.hud', { 'data-screen': 'hud' }, [
      el('div.hud-left', {}, [
        el('div.hud-row', {}, [this.stockBtn, this.ecoGrp, this.power, this.timeGrp, this.fold]),
        this.research,
      ]),
      el('div.hud-right', {}, [this.vfold, this.views, this.buildBtn, this.menuBtn]),
    ]);
    // A fold open: a tap anywhere else closes it; a choice inside it closes it too (after it acts).
    document.addEventListener('pointerdown', (e) => {
      const at = e.target as Node | null;
      const f = this.root.getAttribute('data-fold');
      if (!f || !at) return;
      const keep = f === 'research' ? [this.fold, this.research] : [this.vfold, this.views];
      if (!keep.some((n) => n.contains(at))) this.setFold(null);
    }, true);
    this.research.addEventListener('click', () => this.setFold(null));
    // The Stock panel: a click anywhere but on it or its button closes it (the world, the HUD, a panel).
    document.addEventListener('pointerdown', (e) => {
      const at = e.target as Node | null;
      if (this.stock.open && at && !this.stock.root.contains(at) && !this.stockBtn.contains(at)) this.setStock(false);
    }, true);
    if (stockPref.load().open) this.setStock(true, false);
    // The purse's card: a click elsewhere closes it; a mouse resting on the purse opens it, leaving it (and the card) closes it unless clicked open.
    document.addEventListener('pointerdown', (e) => {
      const at = e.target as Node | null;
      if (this.purse.open && at && !this.purse.root.contains(at) && !this.ecoGrp.contains(at)) this.setPurse(false);
    }, true);
    const hover = typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine)') : null;
    const later = (fn: () => void, ms: number): void => { if (this.purseTimer) clearTimeout(this.purseTimer); this.purseTimer = setTimeout(fn, ms); };
    const enter = (): void => { if (hover?.matches && !this.purse.open) later(() => this.setPurse(true, false), 280); else if (this.purseTimer) clearTimeout(this.purseTimer); };
    const leave = (): void => { if (hover?.matches && !this.pursePinned) later(() => { if (!this.pursePinned) this.setPurse(false); }, 240); else if (this.purseTimer && !this.purse.open) clearTimeout(this.purseTimer); };
    this.ecoGrp.addEventListener('pointerenter', enter);
    this.ecoGrp.addEventListener('pointerleave', leave);
    this.purse.root.addEventListener('pointerenter', () => { if (this.purseTimer) clearTimeout(this.purseTimer); });
    this.purse.root.addEventListener('pointerleave', leave);
    this.views.addEventListener('click', () => setTimeout(() => this.setFold(null), 0));
  }

  /** The fold open on a narrow window (D96): the research row or the views, as a dropdown. */
  private setFold(f: 'research' | 'views' | null): void {
    setAttr(this.root, 'data-fold', f);
    setAttr(this.fold, 'aria-expanded', f === 'research' ? 'true' : 'false');
    setAttr(this.vfold, 'aria-expanded', f === 'views' ? 'true' : 'false');
  }

  private toggleFold(f: 'research' | 'views'): void {
    this.setFold(this.root.getAttribute('data-fold') === f ? null : f);
  }

  /** Open or close the purse's card (D102); `pinned`: by a click (it stays until closed), else by a mouse resting on the purse. */
  setPurse(on: boolean, pinned = false): void {
    if (this.purseTimer) { clearTimeout(this.purseTimer); this.purseTimer = null; }
    if (on && this.stock.open) this.setStock(false);
    this.pursePinned = on && (pinned || this.pursePinned);
    this.purse.show(on);
    setAttr(this.creditsChip, 'aria-expanded', on ? 'true' : 'false');
    setAttr(this.ecoGrp, 'data-on', on ? '' : null);
    if (on) { this.placePurse(); this.purse.refresh(); }
  }

  /** The last hour of the purse (D102): worked out again once a new game minute is sampled. */
  private purseNow(): PurseSummary {
    const sim = this.host.sim();
    this.purseHist.sample(sim);
    const s = this.purseHist.samples, key = `${s.length}:${s[s.length - 1]?.epoch ?? ''}:${locale()}`;
    if (!this.purseSum || key !== this.purseKey) { this.purseKey = key; this.purseSum = purseSummary(sim, this.purseHist); }
    return this.purseSum;
  }

  /** Is the purse's card open (Esc closes it first)? */
  get purseOpen(): boolean { return this.purse.open; }

  /** The card stands under the HUD, its left edge at the purse's (in #ui's zoomed px; a narrow window's sheet ignores it). */
  private placePurse(): void {
    const zoom = Number.parseFloat(document.documentElement.style.getPropertyValue('--ui-zoom')) || 1;
    this.purse.root.style.setProperty('--purse-left', `${Math.round(this.ecoGrp.getBoundingClientRect().left / zoom)}px`);
  }

  /** Open or close the Stock panel (D96); the viewer's choice is remembered (`remember`: a click, Esc — not the start). */
  setStock(on: boolean, remember = true): void {
    if (on && this.purse?.open) this.setPurse(false);
    this.stock.show(on);
    setAttr(this.stockBtn, 'aria-expanded', on ? 'true' : 'false');
    setAttr(this.stockBtn, 'data-on', on ? '' : null);
    if (remember) stockPref.save({ version: 1, open: on });
    if (on) this.refreshStock(this.host.sim());
  }

  /** Is the Stock panel open (Esc closes it first)? */
  get stockOpen(): boolean { return this.stock.open; }

  /** Keep a chip of the shell's at the end of the research row (it flows with the row, never over the world). */
  pin(node: HTMLElement): void {
    this.pinned.push(node);
    this.research.append(node);
  }

  /**
   * The tech tree's chip (the way into the tree, D33), then one chip per project: its token bar (D122:
   * tokens alone, no data; D118: no time; a save's reconversion: its time), the name, what it waits
   * for — its lab's power, its tokens — or when they will be in, and the tokens a minute it gets.
   */
  private refreshResearch(sim: Sim): void {
    const L = locale();
    const sig = sim.projects.map((p) => p.id).join(',') + L;
    if (sig !== this.researchSig) {
      this.researchSig = sig;
      const chips = sim.projects.map((p) => {
        const name = p.id.startsWith('respec:')
          ? t('research.respecName', { branch: t(`research.branch.${p.id.slice(7)}` as MsgKey) })
          : (RESEARCH[p.id as ResearchId] as ResearchDef).name[L];
        const bar = el('span.hud-rs-row', { 'data-k': 'tok' }, [mark('token'), el('span.hud-rs-bar', { 'data-k': 'tok' }, [el('i')])]);
        return el('button.hud-rs.cartouche', { 'data-id': p.id }, [
          el('span.hud-rs-bars', {}, [bar]),
          el('span.hud-rs-name.lettering', {}, name), el('span.hud-rs-eta'), el('span.hud-rs-tok', {}, [mark('token'), el('b')]),
        ]);
      });
      setText(this.treeName, t('tree.hud'));
      this.research.replaceChildren(this.tree, this.stats, this.exp, ...chips, ...this.pinned);
    }
    // The Statistics chip: the ledger's way in (G), shown once it is unlocked (D41).
    setAttr(this.stats, 'hidden', analyticsOn(sim, 'ledger') ? null : '');
    setText(this.statsName, t('hud.stats'));
    setAttr(this.stats, 'title', t('hud.stats.tip'));
    this.refreshExpertise(sim);
    // The plans the Heart can pay for right now (prerequisites met): an invitation to open the tree
    // (tree-state.ts: the tree's own derivation, the same « ready » its cards show).
    const ready = readyPlans(sim).length;
    setText(this.treeBadge, ready ? String(ready) : '');
    setAttr(this.tree, 'data-ready', ready ? '' : null);
    setAttr(this.tree, 'title', ready ? `${t('tree.hud.tip')} · ${tr('tree.hud.ready', { n: ready })}` : t('tree.hud.tip'));
    // A purse in the red holds the tokens bought for research (D118): a chip that buys turns coral
    // and says so, the purse in its tip — beside the toast, the lab's inspector and the tree.
    const heldTip = sim.credits < 0 ? t('tree.rs.held.tip', { v: oc(sim.credits) }) : null;
    const tokens = tokenFacts(sim);
    // The fold (narrow windows, D96) says the row in brief: the ready plans' badge, the first project's ring, coral while held.
    setText(this.foldBadge, ready ? String(ready) : '');
    setAttr(this.fold, 'data-ready', ready ? '' : null);
    setAttr(this.fold, 'title', t('hud.fold.research'));
    setAttr(this.fold, 'aria-label', t('hud.fold.research'));
    const first = sim.projects[0];
    const ft = first ? projectTiming(sim, first) : null;
    setAttr(this.foldRing, 'hidden', ft ? null : '');
    if (ft) this.foldRing.style.setProperty('--p', `${ft.permille / 10}%`);
    setAttr(this.fold, 'data-held', ft?.held ? '' : null);
    const timings = projectTimings(sim);
    for (const p of sim.projects) {
      const chip = this.research.querySelector(`[data-id="${p.id}"]`) as HTMLElement | null;
      const tm = timings.get(p.id);
      if (!chip || !tm) continue;
      // Its state as the tree says it (tree-state.ts, D118, D122): its tokens as one bar (a save's
      // reconversion: its time), what it waits for, when its tokens will be in; held, its bought flow.
      chip.querySelector<HTMLElement>('.hud-rs-bar')!.style.setProperty('--p', `${(tm.usesTokens ? tm.tokens : tm.permille) / 10}%`);
      setAttr(chip, 'data-held', tm.held ? '' : null);
      setAttr(chip, 'data-wait', tm.waiting);
      // Its tokens now (D102): a minute on the chip — free, banked, bought —, their ◉ a minute in its tooltip.
      const tk = tokens.projects.get(p.id);
      const tok = chip.querySelector('.hud-rs-tok') as HTMLElement;
      setAttr(tok, 'hidden', tk && tk.perMin > 0 ? null : '');
      if (tk) setText(tok.querySelector('b')!, t('hud.perMin', { v: compact(Math.round(tk.perMin)) }));
      const tokTip = tk && tk.perMin > 0 ? t('hud.rs.tok.tip', { n: compact(Math.round(tk.perMin)), f: compact(tk.free + tk.bank), b: compact(tk.bought), c: oc(Math.round(tk.centsPerMin), false, 2) }) : null;
      const tokBarTip = tm.usesTokens ? t('hud.rs.tokbar.tip', { got: compact(p.tokIn ?? 0), of: compact(p.tokens ?? 0) }) : null;
      const powerTip = tm.waiting === 'power' ? t('tree.rs.noPower') : null;
      setAttr(chip, 'title', [tm.held ? heldTip : null, powerTip, tokBarTip, tokTip].filter(Boolean).join('\n'));
      const eta = tm.held ? t('hud.rs.held') : tm.waiting === 'power' ? t('research.waitPower')
        : tm.waiting === 'tokens' ? t('research.waitTokens') : Number.isFinite(tm.left) ? duration(tm.left) : '—';
      setText(chip.querySelector('.hud-rs-eta')!, eta);
    }
  }

  /**
   * The Expertise chip (D93): shown once the Core mounts the Archive; the two slots' pictures (dashed
   * while empty, amber while a réorientation's 24 h run), and a badge counting the earned expertises
   * a free slot could take — an invitation, like the tree's.
   */
  private refreshExpertise(sim: Sim): void {
    const on = !!this.host.openExpertise && archiveOpen(sim);
    setAttr(this.exp, 'hidden', on ? null : '');
    if (!on) return;
    setText(this.expName, t('hud.expertise'));
    const sig = sim.expertise.slots.map((s) => (s ? `${s.id}:${s.on}` : '-')).join(',');
    if (sig !== this.expSig) {
      this.expSig = sig;
      this.expSlots.replaceChildren(...sim.expertise.slots.map((s) => {
        const d = s ? expertiseDef(s.id) : undefined;
        return el('span.hud-exp-slot', { 'data-on': s?.on ? '' : null, 'data-coming': s && !s.on ? '' : null }, d ? [expertiseIcon(this.atlas, d.icon, 16)] : []);
      }));
    }
    const n = choosable(sim);
    setText(this.expBadge, n ? String(n) : '');
    setAttr(this.exp, 'data-ready', n ? '' : null);
    setAttr(this.exp, 'title', n ? `${t('hud.expertise.tip')} · ${choosableText(n)}` : t('hud.expertise.tip'));
  }

  /**
   * Every frame, the Stock panel's amounts alone while it is open (change-only writes): an item
   * lands in the Heart whole, on the tick it reaches it, and its +1 shows with it.
   */
  counts(): void {
    this.stock.counts(this.host.sim());
  }

  /**
   * The items the Stock panel lists: those the Heart holds (the early chain first, then any other)
   * and those the base lacks — during the tutorial only what it has introduced or the base has
   * made (nothing on screen before it means something to the player).
   */
  private stockItems(sim: Sim): number[] {
    const rv = revealed(sim);
    const shows = (i: number): boolean => !rv || rv.has(`stock:${ITEM_IDS[i]}`) || sim.produced[i]! > 0;
    const held = ORDER.map((id) => itemIdx(id)).filter((i) => sim.stock[i]! >= 1000);
    for (let i = 0; i < N_ITEMS; i++) if (!held.includes(i) && sim.stock[i]! >= 1000) held.push(i);
    const items = held.filter(shows);
    for (const i of this.lacks.keys()) if (!items.includes(i) && shows(i)) items.push(i);
    return items;
  }

  /** What came into the Heart over the last minute, a minute (null without the telemetry, D41). */
  private rate(sim: Sim, item: number): number | null {
    if (!analyticsOn(sim, 'rates')) return null;
    const old = this.samples[0], last = this.samples[this.samples.length - 1];
    const span = Math.max(1, this.samples.length - 1);
    return old && last ? ((last[item]! - old[item]!) / 1000) * (60 / span) : 0;
  }

  /** The button (shown once there is something to list; its badge) and, while open, the panel. */
  private refreshStock(sim: Sim): void {
    const items = this.stockItems(sim);
    const lacking = [...this.lacks.values()].filter((s) => items.includes(s.item));
    setAttr(this.stockBtn, 'hidden', items.length ? null : '');
    setText(this.stockLabel, t('hud.stock'));
    setText(this.stockBadge, lacking.length ? String(lacking.length) : '');
    setAttr(this.stockBadge, 'data-tone', lacking.length ? (lacking.some((s) => s.out) ? 'out' : 'short') : null);
    setAttr(this.stockBtn, 'title', lacking.length ? `${t('hud.stock.btnTip')} · ${tr('hud.stock.lack', { n: lacking.length })}` : t('hud.stock.btnTip'));
    if (this.stock.open) this.stock.refresh(sim, items, (i) => this.rate(sim, i), this.lacks);
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
      // What the base lacks (D96, the Stock's badge): once a second is enough, it walks the plans.
      this.lacks = new Map(shortages(sim).map((s) => [s.item, s]));
    }
    this.refreshStock(sim);
    // The groups (D88): each cartouche shows once the tutorial has introduced what it holds.
    const rv = revealed(sim);
    setAttr(this.ecoGrp, 'hidden', rv && !rv.has('credits') ? '' : null);
    setAttr(this.power, 'hidden', rv && !rv.has('power') ? '' : null);
    setAttr(this.timeGrp, 'hidden', rv && !rv.has('clock') ? '' : null);
    setAttr(this.research, 'hidden', rv && !rv.has('research') ? '' : null);
    setAttr(this.fold, 'hidden', rv && !rv.has('research') ? '' : null);
    // The views' fold (narrow windows, D96): there while the selector is, lit while a view other than Normal is on.
    const vbar = this.views.querySelector('.vbar');
    const lit = this.views.querySelector('[data-on][data-view]')?.getAttribute('data-view') ?? 'normal';
    setAttr(this.vfold, 'hidden', vbar && !vbar.hasAttribute('hidden') ? null : '');
    setAttr(this.vfold, 'data-on', lit !== 'normal' ? '' : null);
    setAttr(this.vfold, 'title', t('hud.fold.views'));
    setAttr(this.vfold, 'aria-label', t('hud.fold.views'));
    // No Build button with nothing to build; a coral dot on it when a tray holds something new.
    setAttr(this.buildBtn, 'hidden', !rv || rv.has('build') ? null : '');
    setAttr(this.buildBtn, 'data-new', !this.host.building() && this.host.buildNew?.() ? '' : null);
    setAttr(this.buildBtn, 'title', !this.host.building() && this.host.buildNew?.() ? t('build.newHud') : null);
    setText(this.credits, compact(sim.credits / 100));
    // The purse's real recurring change an hour (D102: the engine's journal over the last hour —
    // sales, standing orders, tokens, the Compute Plan, rental, rent; one-offs apart), the same sum
    // the card breaks down. Nothing until a game minute has been seen.
    const ps = this.purseNow();
    const perHour = ps.total / 100;
    setText(this.creditsRate, ps.minutes && Math.abs(perHour) >= 0.5 ? t('hud.perHour', { v: `${perHour > 0 ? '+' : '−'}${compact(Math.abs(perHour))}` }) : '');
    setAttr(this.creditsRate, 'data-sign', perHour >= 0.5 ? '+' : perHour <= -0.5 ? '-' : null);
    setAttr(this.creditsChip, 'title', `${t('hud.credits')} · ${purseHour(perHour * 100)} · ${t('purse.hud.tip')}`);
    if (this.purse.open) { this.placePurse(); this.purse.refresh(); }
    // Power of the Hearth's grid; a click opens Électricité once the tutorial offers it (D32).
    const opens = !!this.host.openPower && (this.host.powerShown?.() ?? true);
    const openTip = opens ? ` · ${t('hud.power.open')}` : '';
    setAttr(this.power, 'aria-disabled', this.host.openPower && !opens ? 'true' : null);
    const net = sim.graph?.netOfEnt.get(sim.hearthId);
    const np = net !== undefined ? sim.netPower[net] : undefined;
    if (np) {
      const pct = Math.round(np.sat / 10);
      setText(this.powerVal, t('hud.powerPct', { v: pct }));
      setAttr(this.power, 'data-low', pct < 100 ? '' : null);
      setAttr(this.power, 'data-out', pct <= 0 ? '' : null);
      setStyle(this.powerFill, 'transform', `scaleX(${(pct / 100).toFixed(3)})`);
      setAttr(this.power, 'title', `${t('hud.powerTip', { d: Math.round(np.demand), s: Math.round(np.renew + np.fuel) })}${openTip}`);
    }
    setAttr(this.power, 'data-on', this.host.powerOn?.() ? '' : null);
    // Accumulators on the Hearth's grid.
    if (np && net !== undefined) {
      let E = 0, cap = 0;
      for (const a of sim.graph.nets[net]?.accs ?? []) { E += sim.accEnergy.get(a.ent) ?? 0; cap += a.cap; }
      if (cap > 0) setAttr(this.power, 'title', `${t('hud.powerTip', { d: Math.round(np.demand), s: Math.round(np.renew + np.fuel) })} · ${t('hud.gourds', { v: Math.round((E * 100) / cap) })}${openTip}`);
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
