// app.ts — the shell's hub: owns the stage, the camera, input, the colony (Sim), the world
// views and the in-game UI, wires them, and runs the frame. The parts live next door:
// view.ts (iso ⇄ plan morph), picking.ts (screen ⇄ world), build-mode.ts (construction),
// screens.ts (full screens), sim-events.ts (colony events → feedback), controls.ts (keys and
// pointer). The sim ticks at a fixed 10 Hz inside the render loop (≤ 8 ticks per frame;
// longer gaps are the offline catch-up's job); the DOM UI refreshes at 4 Hz.
//
// One frame: morph → input → sim ticks → drain events → camera → terrain & relief → ghost,
// overlays, drifters, items → tip → stats sample → (4 Hz) HUD, bar, inspector, screen →
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
import { ItemsView } from '@/render/world/items-view';
import { DriftersView } from '@/render/world/drifters-view';
import { CargoView } from '@/render/world/cargo-view';
import { LandingView } from '@/render/world/landing-view';
import { DayNight } from '@/render/daynight';
import { CloudShadows, LightsView } from '@/render/world/lights-view';
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
import { LandPanel } from '@/ui/land-panel';
import { parcelUnder } from '@/ui/land-facts';
import { BuildingCard } from '@/ui/building-card';
import { Guide } from '@/ui/guide';
import { QuestLog } from '@/ui/quest-log';
import { ResearchScreen } from '@/ui/screens/research';
import { StatsScreen } from '@/ui/screens/stats';
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
import { tr } from '@/i18n/i18n';
import { BuildMode } from './build-mode';
import { Controls } from './controls';
import { Picker } from './picking';
import { ScreenHost } from './screens';
import { drainSimEvents } from './sim-events';
import type { SoundShell } from './sound';
import { ViewState } from './view';

const MAX_TICKS_PER_FRAME = 8;

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
  /** The power wires, above the buildings in both views (D25). */
  readonly wires: WiresView;
  readonly items: ItemsView;
  readonly drifters: DriftersView;
  readonly cargo: CargoView;
  /** The intro's landing: the Heart coming down from the Ring (D31; driven by app/intro.ts). */
  readonly landing: LandingView;
  /** Day / night: the grade on the world, night lights and solar panel states, cloud shadows. */
  readonly dayNight: DayNight;
  readonly lights: LightsView;
  readonly clouds: CloudShadows;
  readonly stressSpike: StressSpike;
  // ── interaction & UI ──────────────────────────────────────────────────────
  readonly tools: Tools;
  /** The « Relier » tool: string and cut power wires (D25). */
  readonly link: LinkTool;
  /** The land mode (D60, I): the parcels, and the one picked to buy or lease. */
  readonly landTool = new LandTool();
  /** The land mode's card (where the inspector sits): the legend, the picked parcel, buy / lease. */
  readonly landPanel: LandPanel;
  readonly build: BuildMode;
  readonly controls: Controls;
  readonly screens: ScreenHost;
  readonly crier: CrierScreen;
  readonly hud: Hud;
  readonly bar: BuildBar;
  readonly inspector: Inspector;
  readonly toasts = new Toasts();
  readonly tip: Tip;
  /** What a building does: opens above the build bar when the pointer rests on a tray slot. */
  readonly card: BuildingCard;
  /** The tutorial (D28): the guide's arrow and the quest log with CrierBelt's naming modal. */
  readonly guide: Guide;
  readonly quests: QuestLog;
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
      onSlot: (slot, shift) => { if (!this.screens.modal) this.build.slot(slot, shift); },
      onPointerDown: (p) => this.controls.down(p),
      onPointerMove: (p) => this.controls.move(p),
      onPointerUp: (p) => this.controls.up(p),
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
    this.terrain = new TerrainChunks(this.layers.get('terrain'), this.layers.get('relief'), this.layers.get('fog'), land, worker, () => this.sim.explored);
    this.buildings = new BuildingsView(this.layers.get('belts'), this.layers.get('objects'), this.layers.get('plan'), atlas, this.layers.get('shadows'));
    this.relief = new ReliefView(this.layers.get('objects'), land);
    this.ghost = new GhostView(this.layers.get('ghost'), atlas);
    this.overlays = new OverlaysView(this.layers.get('grid'), this.layers.get('overlays'), this.layers.get('land'));
    this.wires = new WiresView(this.layers.get('wires'), this.layers.get('wiresPlan'));
    this.items = new ItemsView(this.layers.get('items'), atlas, this.layers.get('itemsOver'), this.layers.get('belts'), { volumes: this.layers.get('objects'), plan: this.layers.get('plan') });
    this.buildings.carHeight = (x, y) => this.items.lift.carAt(x, y); // the traction elevators' cars ride with their items
    this.drifters = new DriftersView(this.layers.get('status'));
    this.cargo = new CargoView(this.layers.get('fxTop'), this.layers.get('fxGlow'));
    this.landing = new LandingView(this.layers.get('fxTop'), this.layers.get('fxGlow'), atlas);
    this.dayNight = new DayNight([this.layers.lit, this.layers.get('fog'), this.layers.get('status'), this.layers.get('fxTop')], stage.renderer);
    this.lights = new LightsView(this.layers.get('lights'), this.layers.get('objects'), this.layers.get('plan'), atlas);
    this.clouds = new CloudShadows(this.layers.get('shade'), this.lights.cloudTextures());
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
    this.screens = new ScreenHost(document.getElementById('screens'));
    const notify = (k: 'good' | 'bad' | 'info' | 'warn', txt: string): void => this.toasts.show(k, txt);
    this.screens.register('research', new ResearchScreen(atlas, { sim: () => this.sim, close: () => this.screens.open(null), notify, focus: () => this.guide?.focusNode() ?? null }));
    this.screens.register('stats', new StatsScreen(atlas, this.stats, { close: () => this.screens.open(null), sim: () => this.sim }));
    this.crier = new CrierScreen(atlas, {
      sim: () => this.sim, close: () => this.screens.open(null), notify,
      takeLifts: () => this.lifts.splice(0),
    });
    this.screens.register('market', this.crier);
    const openCrier = (tab?: 'trade'): void => {
      if (tab) this.crier.show(tab);
      if (this.screens.current !== 'market') this.screens.open('market');
    };
    this.hud = new Hud(atlas, { sim: () => this.sim, building: () => !!this.build.category, toggleBuild: () => this.build.toggle(), openResearch: () => this.screens.open('research'), openCrier: () => openCrier(), openMenu: () => this.screens.open('menu'), worldTick: () => this.dayNight.worldTick(this.sim), openStats: () => this.screens.open('stats'), covered: () => !!this.screens.current || this.quests.modalOpen, toggleLand: () => this.build.land(), landOn: () => this.landTool.active });
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
    });
    this.inspector = new Inspector(atlas, {
      sim: () => this.sim,
      selected: () => this.selected,
      select: (id) => this.select(id),
      remove: (id) => this.removeEntity(id),
      setRecipe: (id, r) => { this.sim.setRecipe(id, r); },
      openResearch: () => this.screens.open('research'),
      openCrier,
      notify,
      link: (id) => this.build.link(id),
      linkSource: () => (this.link.active ? this.link.source : 0),
    });
    this.landPanel = new LandPanel({ sim: () => this.sim, active: () => this.landTool.active, selected: () => this.landTool.selected, close: () => this.build.land(false), notify });
    const tipNode = document.getElementById('tooltip') ?? document.body.appendChild(document.createElement('div'));
    this.tip = new Tip(tipNode, atlas);
    document.getElementById('ui')?.append(this.hud.root, this.inspector.root, this.landPanel.root, this.bar.root, this.toasts.root);
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
    });
    this.quests = new QuestLog(atlas, { sim: () => this.sim, screenOpen: () => !!this.screens.current, step: () => this.guide.step, guide: this.guide });
    document.getElementById('ui')?.append(this.quests.root);
    document.body.append(this.guide.root, this.quests.modal);
  }

  // ── selection & colony ────────────────────────────────────────────────────
  select(id: number): void {
    if (this.selected === id) return;
    this.selected = id;
    this.inspector?.refresh();
    bus.emit('selection:changed', { entity: id || null });
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
    if (drainSimEvents(this.sim.events, { toasts: this.toasts, colonies, epoch: this.sim.absEpoch(), lift: (ev) => this.lift(ev), land: (ev) => this.land(ev) })) {
      this.buildings.rebuild(this.sim);
      this.items.rebuild(this.sim);
      this.lights.rebuild(this.sim);
      bus.emit('sim:structure');
    }
    for (const ck of this.sim.grid.dirtyChunks) { this.terrain.invalidate(ck); this.relief.invalidate(ck); }
    this.sim.grid.dirtyChunks.clear();
    this.drawWorld(dt);
    // The inspector's progress bars move every frame, on the game time between ticks.
    this.inspector.frame(this.sim.tick + (this.paused ? 0 : this.acc / TICK_MS));
    this.hud.counts(); // the stock numbers follow the items landing, frame by frame
    this.uiClock += dt;
    if (this.uiClock >= 0.25) {
      this.uiClock = 0;
      this.hud.refresh(performance.now());
      this.bar.refresh();
      this.card.refresh();
      this.inspector.refresh();
      this.landPanel.refresh();
      this.screens.refresh();
      this.guide.refresh();
      this.quests.refresh();
    }
    this.screens.frame(dt);
    this.guide.frame();
    const t1 = performance.now();
    this.stage.renderer.render(this.stage.root);
    const t2 = performance.now();
    this.reportPerf(t2 - t1, t2 - t0, dt);
  }

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
    this.wires.update(this.sim, te, dt, linkPre, this.overlays.powerOn);
    this.overlays.update(this.sim, vt, te, cam.zoom, this.selected, (x, y) => this.relief.level(x, y), this.build.ghostReach());
    const simTicks = this.sim.tick + (this.paused ? 0 : this.acc / TICK_MS); // interpolated game time
    // Day / night from the world clock (the sun the sim uses): grade, night lights, solar panels, clouds.
    const worldTick = this.dayNight.worldTick(this.sim, simTicks);
    const grade = this.dayNight.update(worldTick, te);
    const sun = reliefSun(grade.hour, grade.night, SHADOW_REACH, MAX_LEVEL); // the rock's shadows follow the sun
    this.terrain.setSun(...sun);
    this.relief.setSun(...sun);
    this.lights.update(grade, P, te, worldTick / 10);
    this.clouds.update(grade, P, te, this.camera.cur.tx, this.camera.cur.ty, cam.zoom, worldTick / 10);
    this.drifters.update(this.sim, P, te, simTicks / 10);
    this.cargo.update(P, te, this.paused ? 0 : dt, grade.night);
    this.landing.update(P, te, dt); // a cinematic: real time, even paused
    this.buildings.setPlanness(te);
    this.items.update(this.sim, simTicks, P, te, cam.zoom, vt); // first: it moves the elevators' cars the buildings view draws
    this.buildings.animate(this.sim, simTicks / 10, grade); // moving parts on game time; cast shadows with the sun
    if (pre && this.tools.state && pointer) this.tip.show(this.sim, this.tools.def, pre, pointer.sx, pointer.sy);
    else if (land.hover >= 0 && pointer) this.tip.land(this.sim, land.hover, pointer.sx, pointer.sy); // the parcel's price
    else this.tip.hide();
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
    this.perf.frame(frameMs, dt);
  }
}
