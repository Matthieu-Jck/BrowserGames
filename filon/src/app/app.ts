// app.ts — the shell's hub: owns the stage, the camera, input, the colony (Sim), the world
// views and the in-game UI, wires them, and runs the frame. The parts live next door:
// view.ts (iso ⇄ plan morph), picking.ts (screen ⇄ world), build-mode.ts (construction),
// screens.ts (full screens), sim-events.ts (colony events → feedback), controls.ts (keys and
// pointer), views.ts (the specialised views, D88). The sim ticks at a fixed 10 Hz inside the render loop (≤ 8 ticks per frame;
// longer gaps are the offline catch-up's job); the DOM UI refreshes at 4 Hz.
//
// One frame: morph → input → sim ticks → drain events → camera → terrain & relief → ghost,
// overlays, the view's marks, items → tip → stats sample → (4 Hz) the view's readings, HUD, bar, inspector, screen →
// render → perf.
import { reliefSun } from '@/render/world/cast-shadows';
import { SHADOW_REACH } from '@/render/art/terrain';
import { MAX_LEVEL } from '@/render/relief';
import type { Stage } from '@/render/stage';
import type { Atlas } from '@/render/art/atlas';
import { Layers } from '@/render/layers';
import { Camera } from '@/render/camera';
import { PerfMeter } from '@/render/perf-overlay';
import { apply } from '@/render/projection';
import { StressSpike } from '@/render/stress';
import { TerrainChunks } from '@/render/world/terrain-chunks';
import { BuildingsView } from '@/render/world/buildings-view';
import { ReliefView } from '@/render/world/relief-view';
import { GhostView } from '@/render/world/ghost-view';
import { OverlaysView } from '@/render/world/overlays-view';
import { VEIL, ViewsView } from '@/render/world/views-view';
import { ItemsView } from '@/render/world/items-view';
import { GleanersView } from '@/render/world/gleaners-view';
import { CargoView } from '@/render/world/cargo-view';
import { LandingView } from '@/render/world/landing-view';
import { DayNight } from '@/render/daynight';
import { CloudShadows, LightsView } from '@/render/world/lights-view';
import { NeighboursView } from '@/render/world/neighbours-view';
import { neighbourBanner, neighbourName } from '@/ui/land-facts';
import { NeighbourCard } from '@/ui/neighbour-card';
import { WindHints } from '@/render/world/wind-hints-view';
import { RiversView } from '@/render/world/rivers-view';
import { COS64, SIN64 } from '@/content/world';
import { prevailing } from '@/sim/world/wind';
import { Input } from '@/input/input';
import { Tools, type Preview } from '@/input/tools';
import { buildingIdx } from '@/content/registry';
import { LinkTool } from '@/input/link-tool';
import { LandTool } from '@/input/land-tool';
import { WiresView } from '@/render/world/wires-view';
import { BuildBar } from '@/ui/build-bar';
import { Hud } from '@/ui/hud';
import { Inspector } from '@/ui/inspector/inspector';
import { Toasts } from '@/ui/toasts';
import { Tip } from '@/ui/tip';
import { DepositCard } from '@/ui/deposit-card';
import { installSheet } from '@/ui/sheet';
import type { FlowLine } from '@/ui/purse-facts';
import { parcelCentre } from '@/sim/world/land';
import { LandPanel } from '@/ui/land-panel';
import { ViewBar } from '@/ui/views/view-bar';
import { ViewPanel } from '@/ui/views/view-panel';
import { analyticsOn } from '@/ui/analytics';
import type { MapView } from '@/core/kinds';
import { revealed } from '@/sim/systems/quests';
import { parcelUnder } from '@/ui/land-facts';
import { BuildingCard } from '@/ui/building-card';
import { Guide } from '@/ui/guide';
import { QuestLog } from '@/ui/quest-log';
import { NightNotice } from '@/ui/night-notice';
import { ContractNotice } from '@/ui/contract-notice';
import { GleanCard } from '@/ui/gleaners-card';
import { ResearchScreen } from '@/ui/screens/research';
import { StatsScreen } from '@/ui/screens/stats';
import { ExpertiseScreen } from '@/ui/screens/expertise';
import { CrierScreen } from '@/ui/screens/crier';
import type { OrbitLift } from '@/ui/orbit/orbit-view';
import { footprint } from '@/sim/entities';
import { StatsRecorder } from '@/ui/stats';
import type { Sim } from '@/sim/state';
import type { Grid } from '@/sim/world/grid';
import { CENTER, CHUNKS, TICK_MS } from '@/sim/constants';
import type { AwayReport } from '@/sim/offline/report';
import type { RemapNote } from '@/sim/save-remap';
import type { Persistence } from './persistence';
import { bus } from '@/core/bus';
import { t, tr } from '@/i18n/i18n';
import { BuildMode } from './build-mode';
import { Controls } from './controls';
import { Picker } from './picking';
import { ScreenHost } from './screens';
import { drainSimEvents } from './sim-events';
import type { SoundShell } from './sound';
import { ViewState } from './view';
import { MapViews } from './views';

const MAX_TICKS_PER_FRAME = 8;
/** Under a full screen the world is drawn every this many seconds (D100). */
const COVERED_S = 0.1;

export class App {
  // ── engine side ───────────────────────────────────────────────────────────
  readonly layers: Layers;
  readonly camera: Camera;
  readonly input: Input;
  readonly perf: PerfMeter;
  readonly view = new ViewState();
  readonly picker: Picker;
  // ── world views ───────────────────────────────────────────────────────────
  readonly terrain: TerrainChunks;
  readonly buildings: BuildingsView;
  readonly relief: ReliefView;
  readonly ghost: GhostView;
  readonly overlays: OverlaysView;
  /** The specialised views' veil, flat marks and badges (D88). */
  readonly viewsView: ViewsView;
  /** The power wires, above the buildings in both views (D25). */
  readonly wires: WiresView;
  readonly items: ItemsView;
  /** The Gleaners at night and the glazed ribbons' glass (D103). */
  readonly gleaners: GleanersView;
  readonly cargo: CargoView;
  /** The intro's landing: the Heart coming down from the Ring (D31; driven by app/intro.ts). */
  readonly landing: LandingView;
  /** Day / night: the grade on the world, night lights and solar panel states, cloud shadows. */
  readonly dayNight: DayNight;
  readonly lights: LightsView;
  /** The neighbouring bases near the view (D110). */
  readonly neighbours: NeighboursView;
  readonly clouds: CloudShadows;
  /** The wind's rare hints on the land (D95): gust streaks, sand off the tops. */
  readonly windHints: WindHints;
  /** The rivers' running water at near zooms (D94). */
  readonly rivers: RiversView;
  readonly stressSpike: StressSpike;
  // ── interaction & UI ──────────────────────────────────────────────────────
  readonly tools: Tools;
  /** The « Relier » tool: string and cut power wires (D25). */
  readonly link: LinkTool;
  /** The land mode (D60, I): the parcels, and the one picked to buy or lease. */
  readonly landTool = new LandTool();
  /** The land mode's card (where the inspector sits): the legend, the picked parcel, buy / lease. */
  readonly landPanel: LandPanel;
  /** The specialised views (D88): which one is on show and what it reads; the selector; the side card. */
  readonly views: MapViews;
  readonly viewBar: ViewBar;
  readonly viewPanel: ViewPanel;
  readonly build: BuildMode;
  readonly controls: Controls;
  readonly screens: ScreenHost;
  readonly crier: CrierScreen;
  readonly hud: Hud;
  readonly bar: BuildBar;
  readonly inspector: Inspector;
  readonly toasts = new Toasts();
  readonly tip: Tip;
  /** The deposit card (D99): what a known deposit is and what works it, with nothing in hand. */
  readonly depositCard: DepositCard;
  readonly neighbourCard = new NeighbourCard();
  /** What a building does: opens above the build bar when the pointer rests on a tray slot. */
  readonly card: BuildingCard;
  /** The tutorial (D28): the guide's arrow and the quest log with CrierBelt's naming modal. */
  readonly guide: Guide;
  readonly quests: QuestLog;
  /** The one-time notice before the first night (D101). */
  readonly night: NightNotice;
  /** The starter contract fulfilled: continue at the market's price, or stop (D101). */
  readonly contract: ContractNotice;
  /** The Gleaners' cards (D103): their first night, each morning's report. */
  readonly gleanCard: GleanCard;
  readonly stats = new StatsRecorder();
  /** Music, ambience and cues (app/sound.ts; `installSound` sets it after the app is built). */
  sound: SoundShell | null = null;
  /** Inspected entity (0 = none). */
  selected = 0;
  paused = false;
  private acc = 0;
  /** The catch-up report waiting for the player (« Jouer », a long return): the 'absence' screen shows it (M7). */
  away: AwayReport | null = null;
  /** What this version of the game changed in the save at load (D47), shown on the same screen. */
  changes: RemapNote | null = null;
  /** The base's saves and clock (M7; app/persistence.ts), once installed. */
  persistence: Persistence | null = null;
  /** Starts full: the first frame refreshes the DOM UI at once (the build bar's tabs, the HUD's reveals), no stale quarter second after boot. */
  private uiClock = 0.25;
  private time = 0;
  /** Cargo lifts not yet shown in the orbital view. */
  private lifts: OrbitLift[] = [];

  constructor(readonly stage: Stage, readonly atlas: Atlas, public sim: Sim) {
    this.layers = new Layers(stage.root);
    this.camera = new Camera(CENTER + 0.5, CENTER + 0.5, 1);
    this.camera.P = this.view.P;
    this.perf = new PerfMeter(stage.renderer);
    this.picker = new Picker({ camera: this.camera, view: this.view, size: () => ({ w: stage.width, h: stage.height }), sim: () => this.sim, atlas });
    this.tools = new Tools(() => this.sim);
    this.link = new LinkTool(() => this.sim);
    this.controls = new Controls(this);
    this.input = new Input(stage.renderer.canvas, this.camera, () => ({ w: stage.width, h: stage.height }), {
      toolActive: () => this.controls.toolActive,
      onAction: (a, e) => this.controls.action(a, e),
      // 0 (the tenth slot) shows the whole tech tree while it is open (D111); the build bar otherwise.
      onSlot: (slot, shift) => { if (!this.screens.modal && !(slot === 9 && !shift && this.screens.zoomKey('fit'))) this.build.slot(slot, shift); },
      onPointerDown: (p) => this.controls.down(p),
      onPointerMove: (p) => this.controls.move(p),
      onPointerUp: (p) => this.controls.up(p),
      touchTool: () => this.controls.touchTool,
      onPointerCancel: () => this.controls.cancelDrag(),
    });

    // World views, back to front (layers.ts holds the z-order).
    const worker = new Worker(new URL('../render/art/terrain.worker.ts', import.meta.url), { type: 'module' });
    // The land the terrain and relief views paint is the colony in play (`setSim` swaps it): they
    // hold this live view of `this.sim.grid` rather than the first colony's grid.
    const land = new Proxy({} as Grid, {
      get: (_t, k) => {
        const g = this.sim.grid as unknown as Record<PropertyKey, unknown>;
        const v = g[k];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(this.sim.grid) : v;
      },
    });
    this.terrain = new TerrainChunks(this.layers.get('terrain'), this.layers.get('relief'), land, worker);
    this.buildings = new BuildingsView(this.layers.get('belts'), this.layers.get('objects'), this.layers.get('plan'), atlas, this.layers.get('shadows'));
    this.relief = new ReliefView(this.layers.get('objects'), land);
    this.ghost = new GhostView(this.layers.get('ghost'), atlas);
    this.overlays = new OverlaysView(this.layers.get('grid'), this.layers.get('overlays'), this.layers.get('land'));
    this.viewsView = new ViewsView(this.layers.get('veil'), this.layers.get('viewFlat'), this.layers.get('viewMarks'));
    this.wires = new WiresView(this.layers.get('wires'), this.layers.get('wiresPlan'));
    this.items = new ItemsView(this.layers.get('items'), atlas, this.layers.get('itemsOver'), this.layers.get('belts'), { volumes: this.layers.get('objects'), plan: this.layers.get('plan') });
    this.buildings.carHeight = (x, y) => this.items.lift.carAt(x, y); // the traction elevators' cars ride with their items
    this.gleaners = new GleanersView(this.layers.get('glass'), this.layers.get('items'), this.layers.get('lights'), this.layers.get('objects'), atlas, this.items);
    this.cargo = new CargoView(this.layers.get('fxTop'), this.layers.get('fxGlow'));
    this.landing = new LandingView(this.layers.get('fxTop'), this.layers.get('fxGlow'), atlas);
    this.dayNight = new DayNight([this.layers.lit, this.layers.get('status'), this.layers.get('fxTop')], stage.renderer);
    this.lights = new LightsView(this.layers.get('lights'), this.layers.get('objects'), this.layers.get('plan'), atlas);
    this.lights.work = this.buildings.work; // a production building that does not work shows no light (D83)
    // The neighbouring bases near the view (D110): their buildings, lamps, wires, dress, goods, smoke, names and drones.
    this.neighbours = new NeighboursView({
      buildings: this.buildings, lights: this.lights, wires: this.wires, cargo: this.cargo, atlas,
      layers: { decals: this.layers.get('decals'), objects: this.layers.get('objects'), plan: this.layers.get('plan'), items: this.layers.get('items'), status: this.layers.get('status'), fx: this.layers.get('fxTop') },
      name: (h) => neighbourBanner(this.sim, h),
    });
    this.clouds = new CloudShadows(this.layers.get('shade'), this.lights.cloudTextures());
    this.windHints = new WindHints(this.layers.get('shade'));
    this.rivers = new RiversView(this.layers.get('decals'));
    this.stressSpike = new StressSpike(this.layers.get('fxTop'));
    this.buildings.rebuild(sim);
    this.items.rebuild(sim);
    this.lights.rebuild(sim);

    // In-game UI.
    this.build = new BuildMode({
      sim: () => this.sim, tools: this.tools, view: this.view, bar: () => this.bar, toasts: this.toasts, deselect: () => this.select(0), link: this.link, select: (id) => this.select(id),
      land: this.landTool,
      zoom: { get: () => this.camera.target.zoom, glide: (z) => this.camera.glideTo(this.camera.target.tx, this.camera.target.ty, z) },
    });
    this.views = new MapViews({ sim: () => this.sim, land: this.landTool, setLand: (on) => this.build.land(on), lit: (id) => this.buildings.work.isLit(id) });
    this.screens = new ScreenHost(document.getElementById('screens'));
    const notify = (k: 'good' | 'bad' | 'info' | 'warn', txt: string): void => this.toasts.show(k, txt);
    this.screens.register('research', new ResearchScreen(atlas, { sim: () => this.sim, close: () => this.screens.open(null), notify, focus: () => { const f = this.treeFocus; this.treeFocus = null; return f ?? this.guide?.focusNode() ?? null; } }));
    this.screens.register('stats', new StatsScreen(atlas, this.stats, { close: () => this.screens.open(null), sim: () => this.sim }));
    this.screens.register('expertise', new ExpertiseScreen(atlas, { sim: () => this.sim, close: () => this.screens.open(null), notify }));
    const openExpertise = (): void => { if (this.screens.current !== 'expertise') this.screens.open('expertise'); };
    this.crier = new CrierScreen(atlas, {
      sim: () => this.sim, close: () => this.screens.open(null), notify,
      takeLifts: () => this.lifts.splice(0),
    });
    this.screens.register('market', this.crier);
    const openCrier = (tab?: 'trade'): void => {
      if (tab) this.crier.show(tab);
      if (this.screens.current !== 'market') this.screens.open('market');
    };
    this.hud = new Hud(atlas, { sim: () => this.sim, building: () => !!this.build.category, toggleBuild: () => this.build.toggle(), openResearch: () => this.screens.open('research'), openCrier: () => openCrier(), openMenu: () => this.screens.open('menu'), worldTick: () => this.dayNight.worldTick(this.sim), openStats: () => this.screens.open('stats'), covered: () => !!this.screens.current || this.quests.modalOpen,
      openPower: () => { if (this.viewShown('power')) this.views.toggle('power'); }, powerShown: () => this.viewShown('power'), powerOn: () => this.views.current === 'power', buildNew: () => this.bar?.hasNew() ?? false,
      openExpertise, purseGo: (f) => this.goToFlow(f),
    });
    this.viewBar = new ViewBar({ current: () => this.views.current, pick: (v) => (v === 'normal' ? this.views.set('normal') : this.views.toggle(v)), shows: (v) => this.viewShown(v) });
    this.hud.views.append(this.viewBar.root);
    this.bar = new BuildBar(atlas, {
      sim: () => this.sim,
      category: () => this.build.category,
      openCategory: (c) => this.build.open(c),
      current: () => this.tools.def,
      demolishing: () => this.tools.state?.k === 'remove',
      marking: () => this.tools.state?.k === 'mark',
      pick: (def) => this.build.pick(def),
      demolish: () => this.build.demolish(),
      mark: () => this.build.mark(),
      hint: () => this.build.hint(),
      notify: (k, txt) => this.toasts.show(k, txt, 5000),
      link: () => this.build.link(),
      linking: () => this.link.active,
      rotate: () => this.tools.rotate(1),
    });
    this.inspector = new Inspector(atlas, {
      sim: () => this.sim,
      selected: () => this.selected,
      select: (id) => this.select(id),
      remove: (id) => this.removeEntity(id),
      setRecipe: (id, r) => { this.sim.setRecipe(id, r); },
      openResearch: () => this.screens.open('research'),
      openCrier,
      openExpertise,
      notify,
      link: (id) => this.build.link(id),
      linkSource: () => (this.link.active ? this.link.source : 0),
      // A building clicked in a view opens on that view's part (D88).
      facet: () => { const v = this.views.current; return v === 'power' || v === 'logistics' || v === 'production' ? v : v === 'wind' ? 'power' : null; },
    });
    this.landPanel = new LandPanel({ sim: () => this.sim, active: () => this.landTool.active, selected: () => this.landTool.selected, close: () => this.build.land(false), notify });
    this.viewPanel = new ViewPanel(atlas, {
      sim: () => this.sim, view: () => this.views.current, data: () => this.views.data, covered: () => !!this.selected,
      close: () => this.views.set('normal'), focus: (id) => this.focus(id), goTo: (x, y) => this.camera.glideTo(x, y),
    });
    const tipNode = document.getElementById('tooltip') ?? document.body.appendChild(document.createElement('div'));
    this.tip = new Tip(tipNode, atlas);
    this.depositCard = new DepositCard(atlas);
    document.body.append(this.depositCard.root);
    this.neighbourCard.atlas = this.atlas;
    document.body.append(this.neighbourCard.root); // a neighbouring base's card, on a click on its pieces (D110)
    document.getElementById('ui')?.append(this.hud.root, this.hud.stock.root, this.hud.purse.root, this.inspector.root, this.landPanel.root, this.viewPanel.root, this.bar.root, this.toasts.root);
    // On a narrow window the side panels and the Stock are bottom sheets with a grip (D96, ui/sheet.ts).
    for (const panel of [this.inspector.root, this.landPanel.root, this.viewPanel.root, this.hud.stock.root, this.hud.purse.root]) installSheet(panel);
    // The building card listens on the bar (event delegation). It lives on <body> above the
    // tutorial's guide (the player is reading it), below the naming modal and the tip.
    this.card = new BuildingCard(atlas, { sim: () => this.sim, covered: () => !!this.screens.current }, this.bar.root);
    document.body.append(this.card.root);
    // The tutorial: the quest log under the HUD, the guide over the UI and the screens (below the
    // tooltip), CrierBelt's naming modal on top (ui/quest-log.ts, ui/guide.ts).
    this.guide = new Guide({
      sim: () => this.sim,
      category: () => this.build.category,
      tool: () => (this.link.active ? { k: 'link', def: null } : this.tools.state ? { k: this.tools.state.k, def: this.tools.def } : null),
      screen: () => this.screens.current,
      selected: () => this.selected,
      tileToScreen: (x, y) => this.picker.tileToScreen(x, y),
      lookAt: (x, y) => this.camera.glideTo(x + 0.5, y + 0.5),
      blocked: () => this.quests.modalOpen,
      linkSource: () => (this.link.active ? this.link.source : 0),
      land: () => ({ active: this.landTool.active, selected: this.landTool.selected }),
    });
    this.quests = new QuestLog(atlas, { sim: () => this.sim, screenOpen: () => !!this.screens.current, step: () => this.guide.step, guide: this.guide, view: () => this.views.current });
    this.night = new NightNotice(atlas, { sim: () => this.sim, covered: () => !!this.screens.current || this.quests.modalOpen, powerView: () => this.viewShown('power'), openPowerView: () => this.views.set('power') });
    this.gleanCard = new GleanCard(atlas, { sim: () => this.sim, covered: () => !!this.screens.current || this.quests.modalOpen, openView: () => this.views.set('logistics') });
    // The starter contract fulfilled (D101): its question, under the night notice, top right.
    this.contract = new ContractNotice({ sim: () => this.sim, covered: () => !!this.screens.current || this.quests.modalOpen, notify });
    const notices = document.createElement('div');
    notices.className = 'notices';
    // The Gleaners' cards (D103) take the night notice's place, top right under the HUD, with the others:
    // appended beside them, the card fell to the top left, under the HUD's left cluster and the quest log.
    notices.append(this.night.root, this.contract.root, this.gleanCard.root);
    document.getElementById('ui')?.append(this.quests.root, notices);
    document.body.append(this.guide.root, this.quests.modal);
  }

  // ── selection & colony ────────────────────────────────────────────────────
  select(id: number): void {
    if (this.selected === id) return;
    this.selected = id;
    this.inspector?.refresh();
    bus.emit('selection:changed', { entity: id || null });
  }

  /** The node the tech tree opens on next (the purse's card asked for a running project, D102). */
  private treeFocus: string | null = null;

  /**
   * Where a line of the purse is managed (D102, the purse's card): an item sold or a standing
   * order on the Crier's Trade tab (the order's line, or the post's card, brought into view and
   * flashed); other trade on that tab; tokens, the Compute Plan or the servers' rental in the tech
   * tree (on the first running project, whose header holds the plan and the bill); the rent in the
   * land mode, the first lease's parcel picked; an auto-sold item (D127) in the Stock panel, where it is set.
   */
  goToFlow(f: FlowLine): void {
    switch (f.kind) {
      case 'sale': case 'order': case 'trade':
        this.crier.show('trade');
        if (f.order || f.post !== undefined) this.crier.focusLine(f.order ? `[data-order="${f.order}"]` : `[data-post="${f.post}"]`);
        if (this.screens.current !== 'market') this.screens.open('market');
        break;
      case 'auto':
        if (this.screens.current) this.screens.open(null);
        this.hud.setStock(true);
        break;
      case 'tokens': case 'fee': case 'rental':
        this.treeFocus = this.sim.projects[0]?.id ?? null;
        this.screens.open('research');
        break;
      case 'rent': {
        const p = f.parcels?.[0];
        if (this.screens.current) this.screens.open(null);
        this.views.set('land');
        if (p === undefined) break;
        const [x, y] = parcelCentre(p);
        this.camera.glideTo(x, y);
        this.landTool.click(p);
        break;
      }
    }
  }

  /** Select a building and bring the camera to it (a view's panel: the next one in trouble). */
  focus(id: number): void {
    const e = this.sim.ents.get(id);
    if (!e) return;
    const [w, h] = footprint(e.def, e.rot);
    this.camera.glideTo(e.x + w / 2, e.y + h / 2);
    this.select(id);
  }

  /**
   * Is a view offered yet? The tutorial reveals each with the quest whose trouble it shows
   * (`view:*` in content/quests.ts, D32): Production with the smelter, Électricité with the wind,
   * Logistique with the shared coal line, Terrain (the land mode's button) with the quartz parcel —
   * its key I works from building on (controls.ts), as the off-land refusal says. Before the first,
   * no selector at all; everything once the tutorial is over or skipped. Vent (D95) comes with the
   * Anémométrie plan, tutorial or not.
   */
  viewShown(v: MapView): boolean {
    if (v === 'wind') return analyticsOn(this.sim, 'wind');
    const rv = revealed(this.sim);
    if (!rv || v === 'normal') return true;
    return rv.has(`view:${v}`);
  }

  removeEntity(id: number): void {
    const e = this.sim.ents.get(id);
    if (e && this.sim.remove(e.x, e.y)) {
      this.toasts.show('info', tr('toast.removed', { n: 1 }));
      bus.emit('sfx', { cue: 'demolish' });
    }
  }

  /** A trade post lifted cargo: a cargo drone at its deck in the world, a flight in the orbital view. */
  /** Purchases landed in a post's container: one drone brings them down, however many shipments landed at that tick. */
  private land(ev: { post: number }): void {
    const e = this.sim.ents.get(ev.post);
    if (!e || this.landedAt.get(ev.post) === this.sim.tick) return;
    this.landedAt.set(ev.post, this.sim.tick);
    const [w, h] = footprint(e.def, e.rot);
    this.cargo.launch({ x: e.x, y: e.y, w, h, rot: e.rot }, 'buy');
  }
  private readonly landedAt = new Map<number, number>();

  private lift(ev: { post: number; soldMu: number; boughtMu: number; from: number[] }): void {
    const e = this.sim.ents.get(ev.post);
    if (e) {
      const [w, h] = footprint(e.def, e.rot);
      const pad = { x: e.x, y: e.y, w, h, rot: e.rot };
      // A sale goes up at once; a purchase comes down when it lands in the container (`land`).
      if (ev.soldMu) this.cargo.launch(pad, 'sell');
    }
    this.lifts.push({ tick: this.sim.tick, soldMu: ev.soldMu, boughtMu: ev.boughtMu, from: ev.from });
    if (this.lifts.length > 64) this.lifts.splice(0, this.lifts.length - 64);
  }

  /**
   * Swap in another colony (a debug base and back, M7's load / import): selection and tools
   * dropped, the views rebuilt, the land repainted where it differs from the colony before (all of
   * it on other seeds or another map version; else the chunks either one dug or filled), the statistics and pending cargo
   * lifts cleared (they belong to the colony before).
   */
  setSim(sim: Sim): void {
    const old = this.sim;
    this.sim = sim;
    this.select(0);
    this.tools.state = null;
    this.link.stop();
    this.build.land(false);
    this.views.reset();
    this.buildings.rebuild(sim);
    this.items.rebuild(sim);
    this.lights.rebuild(sim);
    // The same land: the same seeds AND the same map version (D63: a debug base on map 2 and the
    // player's claim founded on map 1 share their seeds, not their land — the paint of one showed
    // mountains the other does not have; owner, 2026-10-14: « la montagne n'existe pas »).
    const sameLand = old.worldSeed === sim.worldSeed && old.playerSeed === sim.playerSeed && (old.grid.source.mapV ?? 1) === (sim.grid.source.mapV ?? 1);
    const chunks = new Set<number>();
    if (!sameLand) for (let ck = 0; ck < CHUNKS * CHUNKS; ck++) chunks.add(ck);
    else for (const g of [old.grid, sim.grid]) for (const t of [...g.terrainDiff.keys(), ...g.oreDiff.keys()]) chunks.add(((t >> 10) >> 5) * CHUNKS + ((t & 1023) >> 5)); // tile y·1024 + x → its chunk
    for (const ck of chunks) { this.terrain.invalidate(ck); this.relief.invalidate(ck); }
    if (chunks.size) this.wires.landChanged();
    sim.grid.dirtyChunks.clear();
    this.stats.fine.length = 0;
    this.stats.coarse.length = 0;
    this.lifts.length = 0;
    this.cargo.clear();
    bus.emit('sim:structure');
  }

  /**
   * After an offline catch-up of this base (M7): the fixed-step clock starts afresh, and after a
   * long one (not ticked one by one) the views are rebuilt as for a new colony — whole regimes
   * were extrapolated, constructions finished, tiles dug.
   */
  caughtUp(report: AwayReport): void {
    this.acc = 0;
    if (report.mode !== 'direct') this.setSim(this.sim);
  }

  /** Perf rig: n particles orbiting the Hearth. */
  stress(n: number): void {
    this.stressSpike.set(n);
    this.perf.set('sprites', n);
  }

  // ── the frame ─────────────────────────────────────────────────────────────
  frame(dt: number): void {
    const t0 = performance.now();
    this.time += dt;
    this.view.update(dt);
    this.camera.P = this.view.P;
    this.layers.setView(this.view.P, this.view.te);
    if (!this.screens.modal) this.input.frame(dt); // keyboard pans wait behind the main menu
    this.tickSim(dt);
    const colonies = (): ReturnType<typeof this.sim.market.snapshot>['colonies'] => this.sim.market.snapshot().colonies;
    if (drainSimEvents(this.sim.events, { toasts: this.toasts, colonies, epoch: this.sim.absEpoch(), lift: (ev) => this.lift(ev), land: (ev) => this.land(ev), gleaners: (ev) => this.gleanCard.event(ev) })) {
      this.buildings.rebuild(this.sim);
      this.items.rebuild(this.sim);
      this.lights.rebuild(this.sim);
      bus.emit('sim:structure');
    }
    for (const ck of this.sim.grid.dirtyChunks) { this.terrain.invalidate(ck); this.relief.invalidate(ck); }
    if (this.sim.grid.dirtyChunks.size) this.wires.landChanged(); // a wire behind a dug or filled cliff
    this.sim.grid.dirtyChunks.clear();
    // Under a full screen (the tree, the statistics, the Crier: 94 % paper and a backdrop blur) the
    // world is drawn 10 times a second, not every frame: it still moves behind the paper, and the
    // blur over it is not redone at every frame (D100). The sim, its events and the DOM keep their pace.
    this.worldDt += dt;
    const drawn = !this.screens.covers || this.time - this.worldAt >= COVERED_S;
    if (drawn) { this.drawWorld(this.worldDt); this.worldDt = 0; this.worldAt = this.time; }
    // The inspector's progress bars move every frame, on the game time between ticks.
    this.inspector.frame(this.sim.tick + (this.paused ? 0 : this.acc / TICK_MS));
    this.hud.counts(); // the stock numbers follow the items landing, frame by frame
    this.uiClock += dt;
    if (this.uiClock >= 0.25) {
      this.uiClock = 0;
      this.views.refresh(0.25);
      this.hud.refresh(performance.now());
      this.viewBar.refresh();
      this.bar.refresh();
      this.card.refresh();
      this.inspector.refresh();
      this.landPanel.refresh();
      this.viewPanel.refresh();
      this.screens.refresh();
      this.guide.refresh();
      this.quests.refresh();
      this.night.refresh();
      this.contract.refresh();
      this.gleanCard.refresh();
    }
    this.screens.frame(dt);
    this.guide.frame();
    if (!drawn) return;
    const t1 = performance.now();
    this.stage.renderer.render(this.stage.root);
    const t2 = performance.now();
    this.reportPerf(t2 - t1, t2 - t0, dt);
  }
  /** The world's time not drawn yet (under a full screen) and when it was last drawn (s of `time`). */
  private worldDt = 0;
  private worldAt = -Infinity;

  /** Fixed-step simulation: whole 100 ms ticks, at most 8 per frame. */
  private tickSim(dt: number): void {
    if (this.paused) return;
    this.acc += dt * 1000;
    let n = 0;
    const ts = performance.now();
    while (this.acc >= TICK_MS && n < MAX_TICKS_PER_FRAME) { this.sim.step(); this.acc -= TICK_MS; n++; }
    if (n === MAX_TICKS_PER_FRAME) this.acc = 0; // long gaps are the catch-up's job
    if (n) this.perf.set('tickMs', (performance.now() - ts) / n);
  }

  private drawWorld(dt: number): void {
    const W = this.stage.width, H = this.stage.height;
    const { P, te } = this.view;
    this.camera.update(dt);
    this.camera.apply(this.layers.world, W, H, this.stage.resolution, this.view.settled);
    const cam = this.camera.state;
    this.terrain.update(cam, W, H, this.stage.resolution, P, te);
    this.relief.update(cam, W, H, this.terrain.visible, P, te);
    const vt = this.view.visibleTiles(cam, W, H);
    const pointer = this.controls.pointer;
    const over = !!pointer?.overCanvas;
    const pre: Preview | null = this.view.building && over ? this.tools.preview() : null;
    this.ghost.draw(pre, this.sim, this.tools.hover, this.view.building && over);
    // The Link tool aims at the building under the cursor (volumes in iso, tiles in plan).
    if (this.link.active) this.link.hover = over && pointer ? this.picker.entityAt(pointer.sx, pointer.sy) : 0;
    const linkPre = this.link.active ? this.link.preview() : null;
    // A pole or pylon in hand shows its reach and what it could wire where it would stand.
    const held = !linkPre && pre && !pre.box && this.tools.state?.k === 'build' && pre.pieces.length === 1 ? pre.pieces[0]! : null;
    this.overlays.linking = linkPre ?? (held ? this.link.ghost(buildingIdx(held.def), held.x, held.y, held.rot) : null);
    // The land mode (D60) aims at the parcel under the cursor (the ground tile, through the current P).
    const land = this.landTool;
    land.hover = land.active && over && pointer ? parcelUnder(...this.picker.tileAt(pointer.sx, pointer.sy)) : -1;
    this.overlays.landOn = land.active;
    this.overlays.landHover = land.hover;
    this.overlays.landSel = land.selected;
    this.overlays.neighbourLabel ??= (colony) => `${t('land.state.neighbour')}\n${neighbourName(this.sim, colony)}`;
    const view = this.views.current;
    // Under the Logistique and Production views the wires fade with the base (Électricité draws them bold).
    const wiresA = this.views.veiled && view !== 'power' ? 0.3 : 1;
    this.layers.get('wires').alpha = wiresA;
    this.layers.get('wiresPlan').alpha = wiresA;
    this.wires.update(this.sim, te, dt, linkPre, view === 'power');
    this.overlays.update(this.sim, vt, te, cam.zoom, this.selected, (x, y) => this.relief.level(x, y), this.build.ghostReach());
    // The view's marks (D88): Électricité shows a pillar's reach under the cursor (the Link tool's own hover when it is in hand).
    const hover = view !== 'power' ? 0 : this.link.active ? this.link.hover : over && pointer ? this.picker.entityAt(pointer.sx, pointer.sy) : 0;
    this.viewsView.update(this.sim, { view, P, te, zoom: cam.zoom, dt, tiles: vt, levelAt: (x, y) => this.relief.level(x, y), hover }, this.views.data);
    const simTicks = this.sim.tick + (this.paused ? 0 : this.acc / TICK_MS); // interpolated game time
    // Day / night from the world clock (the sun the sim uses): grade, night lights, solar panels, clouds.
    const worldTick = this.dayNight.worldTick(this.sim, simTicks);
    const grade = this.dayNight.update(worldTick, te);
    const sun = reliefSun(grade.hour, grade.night, SHADOW_REACH, MAX_LEVEL); // the rock's shadows follow the sun
    this.terrain.setSun(...sun);
    this.relief.setSun(...sun);
    this.lights.update(grade, P, te, worldTick / 10);
    if (this.views.veiled) this.layers.get('lights').alpha *= 1 - (VEIL[view] ?? 0); // night glows under the view's veil
    const pb = prevailing(this.sim.worldSeed);
    this.clouds.setDrift(-COS64[pb]! / 1024, -SIN64[pb]! / 1024); // downwind of the world's wind (D95)
    this.clouds.update(grade, P, te, this.camera.cur.tx, this.camera.cur.ty, cam.zoom, worldTick / 10);
    this.windHints.update(this.sim, P, te, this.paused ? 0 : dt, cam.zoom, vt, (x, y) => {
      const [sx, sy] = this.picker.tileToScreen(x + 0.5, y + 0.5);
      return sx >= 0 && sy >= 0 && sx <= this.stage.width && sy <= this.stage.height;
    }, (x, y) => this.relief.level(x, y));
    this.rivers.update(this.sim, vt, cam.zoom, this.paused ? 0 : dt);
    this.cargo.update(P, te, this.paused ? 0 : dt, grade.night);
    this.landing.update(P, te, dt); // a cinematic: real time, even paused
    this.buildings.setPlanness(te);
    this.neighbours.update(this.sim, vt, P, te, cam.zoom, simTicks / 10, this.sim.absEpoch()); // the neighbouring bases near the view (D110)
    this.buildings.cull(vt); // off-screen buildings culled by 16-tile squares, when the view's range of them changes (D92)
    this.items.update(this.sim, simTicks, P, te, cam.zoom, vt, this.buildings.shadowAt, this.relief.floorShadeAt); // first: it moves the elevators' cars the buildings view draws (the shadows' shade on the items sorted among the volumes, D130)
    this.gleaners.update(this.sim, P, te, simTicks, vt, cam.zoom); // the Gleaners at night (D103, D112): after the items, whose tokens on their posts they take
    this.buildings.animate(this.sim, simTicks / 10, grade); // moving parts on game time; cast shadows with the sun
    if (pre && this.tools.state && pointer) this.tip.show(this.sim, this.tools.def, pre, pointer.sx, pointer.sy);
    else if (land.hover >= 0 && pointer) this.tip.land(this.sim, land.hover, pointer.sx, pointer.sy); // the parcel's price
    else this.tip.hide();
    // The deposit card (D99): the pointer resting on a known deposit with nothing in hand (not while placing: D53).
    const bare = !this.tools.state && !this.link.active && !land.active && over && pointer;
    this.depositCard.update(this.sim, bare ? this.picker.seenTileAt(pointer.sx, pointer.sy) : null, pointer?.sx ?? 0, pointer?.sy ?? 0);
    if (pointer) this.neighbourCard.update(pointer.sx, pointer.sy);
    this.stats.sample(this.sim);
    const [ox, oy] = apply(P, CENTER + 0.5, CENTER + 0.5);
    this.stressSpike.update(this.time, ox, oy);
  }

  private reportPerf(renderMs: number, frameMs: number, dt: number): void {
    const ts = this.terrain.stats(), rs = this.relief.stats();
    this.perf.set('renderMs', renderMs);
    this.perf.set('chunks', ts.chunks);
    this.perf.set('chunksMissing', this.terrain.missing.count);
    this.perf.set('vramMB', ts.vramMB);
    this.perf.set('reliefSprites', rs.sprites);
    this.perf.set('reliefBaked', rs.baked);
    this.perf.set('items', this.items.count);
    this.perf.set('lights', this.lights.count);
    this.perf.set('wires', this.wires.count);
    this.perf.set('culled', this.buildings.cullStats().culled);
    this.perf.set('viewMarks', this.viewsView.count);
    this.perf.frame(frameMs, dt);
  }
}
