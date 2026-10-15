// debug.ts — window.FL: a deterministic handle for the console and the headless smoke test
// (like agora's window.AG and replicatas' window.RP). Grows with each milestone.
import type { App } from './app/app';
import type { MenuShell } from './app/screens';
import type { IntroShell } from './app/intro';
import type { Persistence } from './app/persistence';
import type { SlotInfo } from '@/persist/slots';
import { forecast } from '@/persist/colony';
import { firstStop } from '@/ui/screens/report-panels';
import type { MenuPage } from '@/ui/screens/menu';
import type { Locale, MapView, ScreenId, ViewMode } from '@/core/kinds';
import { locale, setLocale, tr } from '@/i18n/i18n';
import type { PerfStats } from '@/render/perf-overlay';
import { gradeAt, MOMENTS, phaseAt } from '@/render/daynight';
import { temperatureAt } from '@/sim/world/climate';
import { buildDemo, connect, powerLine, learnPlans } from '@/sim/dev';
import { BUILDING_IDS, ITEM_IDS } from '@/content/registry';
import { QUEST_IDS } from '@/content/quests';
import { isResearch } from '@/content/research';
import { questProgress } from '@/sim/systems/quests';
import { isScenario } from '@/sim/scenarios';
import { buildArtboard } from '@/ui/screens/artboard';
import { eventLine } from '@/ui/gazette';
import type { Rot } from '@/sim/types';
import { CENTER } from '@/sim/constants';
import { veinSpots } from '@/sim/scenario-quartz';
import { PARCEL, parcelAt, parcelCentre, ringOf } from '@/sim/world/land';

export interface FilonDebug {
  app: App;
  ready(): boolean;
  fps(): number;
  perf(): PerfStats;
  stress(o: { items?: number }): void;
  /** Camera centre in TILE coords (and zoom); with arguments, jumps there first. */
  camera(tx?: number, ty?: number, zoom?: number): { tx: number; ty: number; zoom: number };
  /** The view (iso to look, plan to build); with an argument, switches (morphs) to it. */
  view(mode?: ViewMode): { mode: ViewMode; t: number };
  /** Open a construction category (null closes building and returns to iso). */
  category(cat?: string | null): string | null;
  /**
   * The specialised view on show (D88: normal, power, logistics, production, land); with an
   * argument, shows it first (its readings at once). `marks`: the badges up; `panel`: the side card shown.
   */
  mapView(v?: MapView): { view: MapView; marks: number; panel: boolean; version: number };
  /** Take a building in hand ('demolish' for the demolition tool, 'link' for the Link tool, null to drop it). */
  tool(def?: string | null): { k: string; def: string | null } | null;
  /** Screen px (CSS) of a tile's centre in the current view. */
  tileToScreen(tx: number, ty: number): [number, number];
  /** The inspected entity (0 = none); with an id, selects it. */
  selected(id?: number): number;
  /** An entity at a tile, briefly. */
  entityAt(x: number, y: number): { id: number; def: string; x: number; y: number; rot: number } | null;
  /** Items currently drawn on ribbons. */
  itemsOnRibbons(): number;
  /**
   * Trace rigs: with true, the items view records every item it draws each frame (with false,
   * it stops); returns the last frame's items — stable id, tile coords, height (iso px), item index.
   */
  itemsTrace(on?: boolean): Array<{ id: number; x: number; y: number; z: number; item: number }>;
  /** Cumulative production of an item (items). */
  produced(item: string): number;
  /** A free spot for a building near a tile (search radius r). */
  freeSpot(def: string, x: number, y: number, r?: number, rot?: number): [number, number] | null;
  /** Visible text of the toasts, newest last. */
  toasts(): string[];
  /** Wire an entity into the Heart's grid: a wire from a pillar in reach, else a line of masts placed and wired (dev helper; real, paid commands). Returns the masts placed. */
  powerTo(id: number): number;
  /** Lay a ribbon from an output port of `from` to an input port of `to` (dev helper: BFS route, real paid commands; port indices among outputs / inputs, -1 = the closest). Returns the tiles laid (0 = no route). */
  connect(from: number, to: number, outIdx?: number, inIdx?: number): number;
  /** Command: string a wire from `a` (a pillar or the Heart) to `b` → done, or why not (D25). */
  link(a: number, b: number): { ok: boolean; reason: string };
  /** Command: cut the wire between a and b. */
  unlink(a: number, b: number): boolean;
  /** The ids an entity is wired to (ascending). */
  links(id: number): number[];
  /** The grid an entity is on (-1: none) and that grid's satisfaction ‰ and supply (kW) last tick. */
  grid(id: number): { net: number; sat: number; supply: number; demand: number };
  /** The Link tool: with an argument starts it (from that pillar, 0 = none chosen) or puts it away (null); returns its state. */
  linking(source?: number | null): { active: boolean; source: number; hover: number; verdict: string | null };
  /** Wires drawn by the wires view. */
  wires(): number;
  /**
   * The production buildings' looks (D83): how many are watched, how many look switched off, unlit
   * pictures baked and still waiting; with an id, whether that building looks at work.
   */
  workLook(id?: number): { watched: number; off: number; baked: number; waiting: number; lit?: boolean };
  /** Item index of an item id. */
  itemIndex(id: string): number;
  /** Sandbox: drop science straight into the first observatory's store. */
  feedLab(item: string, n: number): boolean;
  /** Perf rig: a serpentine of ribbons (rows × cols) from (x, y), materials granted. */
  ribbonField(x: number, y: number, rows: number, cols: number): number;
  /** Perf rig: pack every ribbon with an item (ignores conservation — sandbox only). */
  fillRibbons(item: string): number;
  /** Centre the camera on a tile. */
  lookAt(tx: number, ty: number, zoom?: number): void;
  setLocale(l: Locale): void;
  locale(): Locale;
  t(key: string, params?: Record<string, string | number>): string;
  echo(msg: string): Promise<unknown>;
  pause(): void;
  resume(): void;
  tick(n?: number): void;
  place(def: string, x: number, y: number, rot?: Rot, recipe?: string): { ok: boolean; reason: string; id?: number };
  stocks(): Record<string, number>;
  hash(): string;
  demo(): Record<string, number>;
  open(s: ScreenId): void;
  close(): void;
  screen(): ScreenId | null;
  /** Ocelles in hand (◉). */
  credits(): number;
  /** The parcel `dx` east and `dy` south of the Heart's, in parcels (D60): its id, middle tile and ring (the starting square is ring ≤ 1, D74). */
  parcel(dx: number, dy: number): { p: number; at: [number, number]; ring: number };
  /** The parcel holding tile (x, y). */
  parcelAt(x: number, y: number): number;
  /** The land's quartz vein (D87: map 3): its face tiles, the way they look, the floor spots of its face cutters (top-left, rot); null on maps 1–2. */
  vein(): { x: number; y: number; dx: number; dy: number; n: number; look: number; parcel: number; spots: Array<[number, number, number]> } | null;
  /** This epoch's bid / ask of an item (◉). */
  price(item: string): { bid: number; ask: number };
  /** The first built trade post (0 = none). */
  tradePost(): number;
  /** The Gazette now: announced and active events, as their lines of text. */
  gazette(): { announced: string[]; active: string[] };
  /** Research: with an id, starts it; returns the projects and what is learnt. */
  research(id?: string): { ok: boolean; reason: string | null; projects?: Array<{ id: string; permille: number }>; done?: string[] };
  /**
   * The tech tree (D33): unlock a plan through commands — its cost granted first, so the stock is
   * unchanged, and its missing prerequisites with it; no id: every plan. A research id is learnt
   * outright (sandbox, outside commands). Returns the ids unlocked.
   */
  unlock(id?: string): string[];
  archetype(): string;
  /**
   * Day / night: with an hour of the 24-hour clock (5 dawn, 12 noon, 19 dusk, 0 midnight) or a
   * moment's name, shows that time of day — the look and the HUD clock only, the sim keeps the
   * world clock (power, solar panels' output); time then flows on from there. null returns to the
   * world clock. Returns the moment shown: hour, sun (0–1), night factor, temperature (°C).
   */
  dayPhase(at?: number | 'dawn' | 'noon' | 'dusk' | 'night' | null): { hour: number; sun: number; night: number; tempC: number; shifted: boolean };
  /** The main menu: is it open? With true / false, opens (on a page: 'settings', 'about') / closes it first. */
  menu(open?: boolean, page?: MenuPage): boolean;
  /**
   * The tutorial (D28): the current quest, its objectives' progress, what is done, the rewards in
   * force, and where the guide points ({ quest, step, at }: a selector-like tag, or 'hidden').
   */
  quests(): {
    current: string | null; index: number; named: boolean; name: string; done: string[]; titles: string[];
    progress: Array<{ have: number; need: number; met: boolean; measuring?: boolean }>;
    guide: { quest: string | null; step: number; at: string };
  };
  /** Dev: complete every quest up to and including `id`, in order, regardless of objectives (logged `quest` commands, rewards paid). Returns the current quest after. */
  completeQuest(id: string): string | null;
  /** Name (or rename) the claim — the `name` command; quest 0 completes with it. */
  nameColony(name: string): boolean;
  /** The naming modal: is it open? With true / false, opens / closes it first. */
  nameModal(open?: boolean): boolean;
  /**
   * The intro (D31; skipped by itself under automation): its state — open, the beat on screen
   * ('city', 'investor', 'crierbelt', 'name', 'landing'), the landing running and its time (s),
   * the Heart still hidden. With true opens it (at 'story', the register 'name', or straight at
   * the 'landing'); with false closes it (the Heart shown, a signed name registered).
   */
  intro(open?: boolean, at?: 'story' | 'name' | 'landing'): { open: boolean; panel: string | null; landing: boolean; t: number; heartHidden: boolean };
  /**
   * The spotlight (D41, ui/focus.ts): with an analytics plan's id, plays its reveal now — even
   * under automation, where reveals never play by themselves (false: no reveal for that id); null
   * skips the one on screen. Returns the spotlight's state: open, the shot's id, its phase
   * ('in', 'hold', 'out'), the shots queued.
   */
  focusReveal(id?: string | null): { open: boolean; id: string | null; phase: string | null; queued: number; played?: boolean };
  /**
   * The debug bases (the main menu's « Débogage » page; dev server or ?debug): the level ids by
   * advancement, the one in play (null: the player's own base), and the player's base's hash —
   * wherever it is, in play or kept aside (it must not change while a debug base is in).
   */
  debugSaves(): { levels: string[]; current: string | null; realHash: string } | null;
  /**
   * Build a debug base (a level id of `debugSaves()`) on the player's land and play it, the player's
   * base kept aside — what the build did: the time (ms), game ticks run, quests forced, parts the
   * map did not allow, research granted outside the commands, the quest now and the base's hash.
   * null: back to the player's own base, as it was left. `{ ok: false }` when the page is off.
   */
  debugSave(id: string | null): { ok: boolean; level: string | null; ms?: number; ticks?: number; forced?: string[]; skipped?: string[]; granted?: string[]; quest?: string | null; hash?: string };
  /** M7: save the player's base now; its hash and sequence number (null: this page saves nothing, ?demo). */
  save(): Promise<{ hash: string; seq: number } | null>;
  /** The save slots as stored (sandbox database under automation). */
  saves(): Promise<SlotInfo[]>;
  /** As if the player had been away `hours`: the catch-up, then the report (opened when long enough). */
  simulateAbsence(hours: number): Promise<{ ticks: number; mode: string; produced: number; computeMs: number } | null>;
  /** The export file's text (saved first). */
  exportText(): Promise<string | null>;
  /** Replace the base by an export file's text and reload into it (false: not a whole save). */
  importText(text: string): Promise<boolean>;
  /** Give the base back (a pre-wipe copy is kept) and reload onto a new one. */
  wipe(): Promise<void>;
  /** The world clock: 'live' follows the wall clock (pays the time owed), 'manual' only moves by ticks (automation's default). */
  clock(mode?: 'live' | 'manual'): 'live' | 'manual';
  /** The absence report: open (true) / close (false); whether it is open. */
  absence(open?: boolean): boolean;
  /** « Avant de partir »: `hours` caught up on a copy of the base (the base itself does not move): what stops first, when, and what it earns. */
  forecast(hours: number): { ticks: number; mode: string; stop: { kind: string; item: string | null; afterMin: number } | null; creditsDelta: number; produced: number; hash: string };
}

const ITEM_SAFE = (def: number): string => BUILDING_IDS[def] ?? '?';

export function installDebug(app: App, extras: { echo(msg: string): Promise<unknown>; menu: MenuShell; intro: IntroShell; persistence: Persistence }): void {
  let artboard: HTMLElement | null = null;
  const close = (): void => app.screens.open(null);
  const api: FilonDebug = {
    app,
    ready: () => true,
    fps: () => app.perf.stats.fps,
    perf: () => ({ ...app.perf.stats }),
    stress: (o) => app.stress(o.items ?? 0),
    camera: (tx, ty, zoom) => {
      if (tx !== undefined && ty !== undefined) app.camera.jumpTo(tx, ty, zoom);
      const c = app.camera.cur;
      return { tx: c.tx, ty: c.ty, zoom: c.zoom };
    },
    view: (mode) => {
      if (mode) app.view.setMode(mode);
      return { mode: app.view.mode, t: app.view.t };
    },
    category: (cat) => {
      if (cat !== undefined) app.build.open(cat as never);
      return app.build.category;
    },
    mapView: (v) => {
      if (v !== undefined) { app.views.set(v); app.viewPanel.refresh(); }
      return { view: app.views.current, marks: app.viewsView.count, panel: !app.viewPanel.root.hidden, version: app.views.data.version };
    },
    tool: (def) => {
      if (def === 'demolish') app.build.demolish();
      else if (def === 'mark') app.build.mark();
      else if (def === 'link') { app.build.link(); return app.link.active ? { k: 'link', def: null } : null; }
      else if (def === null) { app.tools.state = null; app.link.stop(); }
      else if (def !== undefined) app.build.pick(def);
      const s = app.tools.state;
      return s ? { k: s.k, def: s.k === 'build' || s.k === 'belt' ? s.def : null } : null;
    },
    tileToScreen: (tx, ty) => app.picker.tileToScreen(tx, ty),
    selected: (id) => {
      if (id !== undefined) app.select(id);
      return app.selected;
    },
    entityAt: (x, y) => {
      const e = app.sim.entityAt(x, y);
      return e ? { id: e.id, def: ITEM_SAFE(e.def), x: e.x, y: e.y, rot: e.rot } : null;
    },
    itemsOnRibbons: () => app.items.count,
    itemsTrace: (on) => {
      if (on !== undefined) app.items.debugOn = on;
      return app.items.debugSnapshot().map((d) => ({ ...d }));
    },
    produced: (item) => app.sim.produced[ITEM_IDS.indexOf(item as never)]! / 1000,
    freeSpot: (def, x, y, r = 12, rot = 0) => {
      for (let d = 0; d <= r; d++) {
        for (let dy = -d; dy <= d; dy++) {
          for (let dx = -d; dx <= d; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
            const c = app.sim.canPlace(def, x + dx, y + dy, rot as Rot);
            if (c.ok && c.replaces.length === 0) return [x + dx, y + dy];
          }
        }
      }
      return null;
    },
    toasts: () => [...document.querySelectorAll('.toast')].map((n) => n.textContent ?? ''),
    powerTo: (id) => powerLine(app.sim, id),
    connect: (from, to, outIdx = -1, inIdx = -1) => connect(app.sim, from, to, outIdx, inIdx),
    link: (a, b) => { const r = app.sim.link(a, b); return { ok: r.ok, reason: r.reason }; },
    unlink: (a, b) => app.sim.unlink(a, b),
    links: (id) => [...app.sim.linksOf(id)],
    grid: (id) => {
      app.sim.ensureCompiled();
      const net = app.sim.graph.netOfEnt.get(id) ?? -1;
      const np = net >= 0 ? app.sim.netPower[net] : undefined;
      return { net, sat: np?.sat ?? 0, supply: np ? np.renew + np.fuel : 0, demand: np?.demand ?? 0 };
    },
    linking: (source) => {
      if (source === null) app.link.stop();
      else if (source) app.build.link(source);
      else if (source === 0 && !app.link.active) app.build.link();
      const l = app.link;
      return { active: l.active, source: l.source, hover: l.hover, verdict: l.active ? l.preview().verdict : null };
    },
    wires: () => app.wires.count,
    workLook: (id) => ({ ...app.buildings.workLook(), ...(id === undefined ? {} : { lit: app.buildings.work.isLit(id) }) }),
    itemIndex: (id) => ITEM_IDS.indexOf(id as never),
    feedLab: (item, n) => {
      const sim = app.sim;
      sim.ensureCompiled();
      const lab = sim.ents.sorted().find((e) => BUILDING_IDS[e.def] === 'observatory' && e.builtAt === 0);
      const st = lab ? sim.stores.get(lab.id) : undefined;
      if (!st) return false;
      st[ITEM_IDS.indexOf(item as never)] = (st[ITEM_IDS.indexOf(item as never)] ?? 0) + n * 1000;
      return true;
    },
    ribbonField: (x, y, rows, cols) => {
      // Sandbox rig: lift the fog over the field, grant the plates, lay a dense serpentine
      // (rows one tile apart, U-turns at the ends). Where the land steps (D77: a ribbon never
      // faces another level), a traction ribbon takes the step, as a player would lay it.
      app.sim.explored.push([x + (cols >> 1), y + (rows >> 1), Math.ceil(Math.hypot(cols, rows) / 2) + 2]);
      app.sim.grant('iron_plate', rows * cols * 4);
      app.sim.grant('copper_wire', rows * cols);
      const path: Array<[number, number, Rot]> = [];
      for (let r = 0; r < rows; r++) {
        const ltr = r % 2 === 0;
        for (let c = 0; c < cols; c++) {
          const last = c === cols - 1 && r < rows - 1;
          path.push([ltr ? x + c : x + cols - 1 - c, y + r, (last ? 2 : ltr ? 1 : 3) as Rot]);
        }
      }
      const n = app.sim.placeBelts('ribbon', path); // the plan lays the traction steps itself (D73)
      // Off the claim's land the kites would take a while: finish the rig at once.
      for (const e of app.sim.ents.map.values()) if (e.builtAt !== 0) e.builtAt = 0;
      app.sim.markDirty();
      return n;
    },
    fillRibbons: (item) => {
      const sim = app.sim;
      sim.ensureCompiled();
      const it = ITEM_IDS.indexOf(item as never);
      let n = 0;
      for (const c of sim.graph.chains) {
        // One item on every free square (a conduit: its parcels spread along it).
        if (!c.fluid) { for (let i = 0; i < c.length; i++) if (c.itemAt(i) < 0) { c.place(i, it); n++; } continue; }
        for (let k = 1; c.content + 1000 <= c.capMu; k++) { c.push(it, 1000, sim.tick + Math.min(c.transit, Math.round(k * c.ticksPerTile))); n++; }
      }
      return n;
    },
    lookAt: (tx, ty, zoom) => app.camera.centerOnTile(tx, ty, zoom),
    setLocale: (l) => setLocale(l),
    locale: () => locale(),
    t: (k, p) => tr(k, p),
    echo: (m) => extras.echo(m),
    pause: () => { app.paused = true; },
    resume: () => { app.paused = false; },
    tick: (n = 1) => app.sim.run(n),
    place: (def, x, y, rot = 0, recipe) => {
      const r = app.sim.place(def, x, y, rot);
      if (r.ok && recipe && r.id) app.sim.setRecipe(r.id, recipe);
      return { ok: r.ok, reason: r.reason, id: r.id };
    },
    stocks: () => Object.fromEntries(ITEM_IDS.map((id, i) => [id, app.sim.stock[i]! / 1000]).filter(([, v]) => (v as number) > 0)),
    hash: () => app.sim.hash(),
    demo: () => buildDemo(app.sim),
    open: (s) => {
      if (s === 'artboard' && !artboard) {
        // The dev art board is built on first use and then behaves like any screen.
        artboard = buildArtboard(app.atlas, app.sim.grid, close);
        app.screens.register('artboard', { root: artboard, refresh: () => {} });
      }
      if (app.screens.current !== s) app.screens.open(s);
    },
    close,
    screen: () => app.screens.current,
    credits: () => app.sim.credits / 100,
    parcel: (dx, dy) => {
      const p = parcelAt(CENTER + dx * PARCEL, CENTER + dy * PARCEL);
      return { p, at: parcelCentre(p), ring: ringOf(p) };
    },
    parcelAt: (x, y) => parcelAt(x, y),
    vein: () => {
      const V = app.sim.grid.source.quartzVein;
      return V ? { x: V.x, y: V.y, dx: V.dx, dy: V.dy, n: V.n, look: V.look, parcel: parcelAt(V.x, V.y), spots: veinSpots(app.sim) } : null;
    },
    price: (item) => {
      const i = ITEM_IDS.indexOf(item as never);
      return { bid: (app.sim.prices.bid[i] ?? 0) / 100, ask: (app.sim.prices.ask[i] ?? 0) / 100 };
    },
    tradePost: () => app.sim.tradePosts()[0]?.id ?? 0,
    gazette: () => {
      const snap = app.sim.market.snapshot();
      return { announced: snap.events.announced.map((e) => eventLine(e, snap.colonies)), active: snap.events.active.map((e) => eventLine(e, snap.colonies)) };
    },
    unlock: (id) => {
      const sim = app.sim;
      if (id && isResearch(id)) {
        if (sim.done.has(id)) return [];
        sim.done.add(id);
        sim.rebuildDerived();
        return [id];
      }
      return learnPlans(sim, id ? [id] : undefined);
    },
    research: (id) => {
      if (id) { const r = app.sim.startResearch(id); if (!r.ok) return { ok: false, reason: r.reason }; }
      return { ok: true, reason: null, projects: app.sim.projects.map((p) => ({ id: p.id, permille: Math.min(1000, Math.floor(p.el / Math.max(1, p.dur))) })), done: [...app.sim.done] };
    },
    archetype: () => {
      const src = app.sim.grid.source as unknown as { archetype?: string; secondary?: string };
      return `${src.archetype ?? '?'}/${src.secondary ?? '?'}`;
    },
    dayPhase: (at) => {
      if (at !== undefined) app.dayNight.setHour(typeof at === 'string' ? MOMENTS[at] : at, app.sim);
      const T = app.dayNight.worldTick(app.sim);
      const g = gradeAt(phaseAt(T));
      return { hour: g.hour, sun: g.sun, night: g.night, tempC: temperatureAt(Math.floor(T), app.sim.worldSeed) / 10, shifted: app.dayNight.offsetTicks !== 0 };
    },
    menu: (open, page) => {
      if (open === true) extras.menu.open(page);
      else if (open === false) extras.menu.close();
      return extras.menu.isOpen();
    },
    quests: () => {
      const sim = app.sim, st = sim.quests;
      const cur = QUEST_IDS[st.cur] ?? null;
      return {
        current: cur, index: st.cur, named: st.named, name: sim.colonyName, done: [...st.done], titles: [...st.titles],
        progress: questProgress(sim).map((p) => ({ ...p })), guide: app.guide.describe(),
      };
    },
    completeQuest: (id) => {
      const target = QUEST_IDS.indexOf(id as never);
      const sim = app.sim;
      while (target >= 0 && sim.quests.cur <= target) {
        const cur = QUEST_IDS[sim.quests.cur];
        if (!cur || !sim.completeQuest(cur, true)) break;
      }
      app.guide.refresh();
      app.quests.refresh();
      return QUEST_IDS[sim.quests.cur] ?? null;
    },
    nameColony: (name) => {
      const ok = app.sim.nameColony(name);
      app.quests.refresh();
      return ok;
    },
    nameModal: (open) => {
      if (open === true) app.quests.openNaming();
      else if (open === false) app.quests.closeNaming();
      return app.quests.modalOpen;
    },
    intro: (open, at) => {
      if (open === true) extras.intro.open(at);
      else if (open === false) extras.intro.close();
      return extras.intro.state();
    },
    focusReveal: (id) => {
      if (id === null) { app.hud.spotlight.skip(); return app.hud.spotlight.state; }
      if (id === undefined) return app.hud.spotlight.state;
      const played = app.hud.reveal(id, true);
      return { ...app.hud.spotlight.state, played };
    },
    save: async () => {
      const e = await extras.persistence.save();
      return e ? { hash: extras.persistence.realSim().hash(), seq: e.seq } : null;
    },
    saves: async () => (await extras.persistence.slots?.list()) ?? [],
    simulateAbsence: async (hours) => {
      const r = await extras.persistence.simulateAbsence(hours);
      return r ? { ticks: r.toTick - r.fromTick, mode: r.mode, produced: r.produced.reduce((a, b) => a + b, 0) / 1000, computeMs: r.computeMs } : null;
    },
    exportText: () => extras.persistence.exportText(),
    importText: (text) => extras.persistence.importText(text),
    wipe: () => extras.persistence.wipe(),
    clock: (mode) => {
      if (mode) extras.persistence.live = mode === 'live';
      return extras.persistence.live ? 'live' : 'manual';
    },
    forecast: (hours) => {
      const { report: r, sim } = forecast(app.sim, Math.round(hours * 36_000));
      const s = firstStop(r);
      return {
        ticks: r.toTick - r.fromTick, mode: r.mode, creditsDelta: r.creditsDelta / 100,
        produced: r.produced.reduce((a, b) => a + b, 0) / 1000, hash: sim.hash(),
        stop: s ? { kind: s.kind, item: s.item !== undefined ? ITEM_IDS[s.item] ?? null : null, afterMin: Math.round((s.tick - r.fromTick) / 600) } : null,
      };
    },
    absence: (open) => {
      if (open === true && app.screens.current !== 'absence') app.screens.open('absence');
      if (open === false && app.screens.current === 'absence') app.screens.open(null);
      return app.screens.current === 'absence';
    },
    debugSaves: () => {
      const b = extras.menu.bases;
      return b ? { levels: [...b.levels], current: b.current(), realHash: b.realSim().hash() } : null;
    },
    debugSave: (id) => {
      const b = extras.menu.bases;
      if (!b) return { ok: false, level: null };
      if (id === null) return { ok: b.restore(), level: null, hash: app.sim.hash() };
      if (!isScenario(id)) return { ok: false, level: b.current() };
      const { report, ms } = b.load(id);
      return {
        ok: true, level: id, ms, ticks: report.ticks, forced: [...report.forced], skipped: [...report.skipped], granted: [...report.granted],
        quest: QUEST_IDS[app.sim.quests.cur] ?? null, hash: app.sim.hash(),
      };
    },
  };
  (window as unknown as { FL: FilonDebug }).FL = api;
}
