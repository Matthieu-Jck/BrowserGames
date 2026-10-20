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
import { BUILDING_IDS, ITEM_IDS, RESEARCH_IDS, buildingIdx, costOf } from '@/content/registry';
import { sellingOf } from '@/sim/systems/trade';
import { QUEST_IDS } from '@/content/quests';
import { isResearch, researchNode } from '@/content/research';
import { projectPermille } from '@/sim/research/runtime';
import { EXPERTISES, EXPERTISE_IDS, isExpertise } from '@/content/expertises';
import { archiveOpen, tierTwoOpen } from '@/sim/systems/expertise';
import { questProgress } from '@/sim/systems/quests';
import { isScenario } from '@/sim/scenarios';
import { buildArtboard } from '@/ui/screens/artboard';
import { eventLine } from '@/ui/gazette';
import type { Rot } from '@/sim/types';
import { CENTER, EPOCH } from '@/sim/constants';
import { catchUp } from '@/sim/offline/catchup';
import { GLEAN_WINDOW, RAID_ARRIVE, RAID_STAGGER, RAID_TAKE, raidBandOf } from '@/sim/flow/chain';
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
   * The specialised view on show (D88: normal, power, logistics, production, wind (D95), land); with an
   * argument, shows it first (its readings at once). `marks`: the badges up; `panel`: the side card shown.
   */
  mapView(v?: MapView): { view: MapView; marks: number; panel: boolean; version: number };
  /** Take a building in hand ('demolish' for the demolition tool, 'link' for the Link tool, null to drop it). */
  tool(def?: string | null): { k: string; def: string | null } | null;
  /**
   * Blueprints (D154): the tool in hand's blueprint side (a paste's turn, mirror and pieces; its plan at
   * the hover: laid, kept, skipped, short), the clipboard's pieces, the library (id, name, pieces), the
   * undo steps held. 'copy' / 'paste' / 'upgrade' in `tool()` take those tools.
   */
  blueprint(): {
    paste: { rot: number; mirror: boolean; pieces: number } | null;
    plan: { n: number; kept: number; skipped: number; short: boolean } | null;
    clipboard: number;
    library: Array<{ id: number; name: string; pieces: number; icon: string }>;
    undo: number;
    panel: boolean;
  };
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
  /** The content's ids by index (buildings, items): what the sim's numbers name, for scripts. */
  ids(): { buildings: readonly string[]; items: readonly string[] };
  /** Sandbox: bank `n` tokens for research (D122: what an older save's data became), given to the projects at the next minute's end. */
  bankTokens(n: number): number;
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
  /** The sea's coast straight out from the cirque (map 4, D94); with a zoom, the camera jumps there. Null where there is no sea. */
  sea(zoom?: number): [number, number] | null;
  /** The field of rock spires (map 6, D147): its middle tile, its wedge's bearing (64ths) and radii, its needles' count and the tallest (levels); with a zoom, the camera jumps to look at it. Null on maps 1–5. */
  spires(zoom?: number): { x: number; y: number; bearing: number; r0: number; r1: number; count: number; tallest: number } | null;
  /** Map 6's rare huge mountains (D157): their summits (tile, foot radius, level); with a zoom, the camera jumps to look at the `n`th (D149: its beacon's wreck on top). [] on maps 1–5. */
  peaks(zoom?: number, n?: number): Array<{ x: number; y: number; R: number; top: number }>;
  /** This epoch's bid / ask of an item (◉). */
  price(item: string): { bid: number; ask: number };
  /** The first built trade post (0 = none). */
  tradePost(): number;
  /** The Gazette now: announced and active events, as their lines of text. */
  gazette(): { announced: string[]; active: string[] };
  /** Research: with an id, starts it; returns the projects and what is learnt. */
  research(id?: string): { ok: boolean; reason: string | null; projects?: Array<{ id: string; permille: number }>; done?: string[] };
  /** A research node's tier (D118: Tiers 2–4 wait for the Core's levels 3–5); 0 for anything else. */
  researchTier(id: string): number;
  /** The research nodes of a tier, in the table's order (a smoke rig opens Tier 2 with Tier 1 whole). */
  tierNodes(tier: number): string[];
  /**
   * The tech tree (D33): unlock a plan through commands — its cost granted first, so the stock is
   * unchanged, and its missing prerequisites with it; no id: every plan. A research id is learnt
   * outright (sandbox, outside commands). Returns the ids unlocked.
   */
  unlock(id?: string): string[];
  /**
   * The expertises (D93): ranks, slots, each feat's value, the next réorientation's price (◉),
   * whether Tier 2 is open. `earnExpertise` sets a rank outright (sandbox, outside commands, as if
   * its feat had reached it); `chooseExpertise` / `reorientExpertise` are the commands (null: done,
   * else why not).
   */
  expertise(): { ranks: Record<string, number>; slots: Array<{ id: string; on: boolean; at: number } | null>; feats: Record<string, number>; reorientCost: number; tierTwo: boolean; archive: boolean };
  earnExpertise(id: string, rank?: number): boolean;
  chooseExpertise(slot: number, id: string): string | null;
  reorientExpertise(slot: number, id: string): string | null;
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
  /** The night notice (D101): `true` shows it now, whatever the hour; whether it is on show. */
  nightNotice(show?: boolean): boolean;
  /**
   * The Gleaners (D103): whether they are out, the ribbon tiles they reach and those kept from them
   * (and the first few exposed tiles, to aim a camera), what they took (lifetime and the night so
   * far / the last one, by item id), the figures on screen, the card on show. `toNight: m` runs the
   * base on to `m` minutes into the next night — a catch-up, sandbox; `card` shows a card now with
   * what they took (null closes it).
   */
  gleaners(o?: { toNight?: number; card?: 'night' | 'dawn' | null }): {
    night: boolean; exposed: number; guarded: number; exposedTiles: Array<[number, number]>; guardedTiles: Array<[number, number]>;
    gleaned: Record<string, number>; tonight: Record<string, number>; card: 'night' | 'dawn' | null; tick: number;
    /** The figures on screen last frame: all, gliding in, waiting at a post, an arm out, grabbing, carrying, at the glass, by a fence. */
    figures: number; arriving: number; waiting: number; reaching: number; grabbing: number; carrying: number; tapping: number; prowling: number;
    /** The takes shown so far (D112): foreseen with their token gone from the belt, a token still on the belt, foreseen otherwise, not foreseen at all, first shown late (off screen, or ticks jumped). */
    paired: number; onBelt: number; unforeseen: number; unseen: number; late: number;
    /** Of the Gleaners shown, how many travel under the sand (a bulge and its furrow) and how many are risen out of it. */
    under: number; risen: number;
    /** The next posts' turns on the exposed lines from now on (tile, tick), soonest first. */
    next: Array<{ x: number; y: number; tick: number }>;
    /** The next raids (D112), soonest first: when each starts and its posts (tiles), middle post first for aiming. */
    raids: Array<{ at: number; x: number; y: number; posts: Array<[number, number]>; band: number }>;
    /** A raid's timing (ticks from its slot): the band's crawl in, how long it takes, its posts' stagger. */
    timing: { arrive: number; take: number; stagger: number };
  };
  /** A goal quest's hint (D101): `true` asks for it, `false` puts it away; the guide's hint state. */
  questHint(show?: boolean): { goal: boolean; shown: boolean; left: boolean; auto: boolean };
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
  /**
   * CrierBelt's delivery orders (D153): those standing (items by id; `due` −1 while offered), the last
   * closed, the lifetime figures, and the claim's last standings.
   */
  orders(): {
    open: Array<{ id: number; item: string; n: number; got: number; cents: number; due: number; offerEnd: number; windowMin: number; first: boolean; event: boolean; reward: string | null }>;
    past: Array<{ id: number; item: string; n: number; got: number; paid: number; what: string }>;
    filled: number; missed: number; paid: number;
    ranking: { epoch: number; value: number; rank: number; best: number };
  };
  /**
   * A sandbox rig for the orders (D153; shots and the smoke, not replayable): the first standing order
   * made to ask `n` of `item` (its price the bid plus its premium, as drawn), and a silo holding `stock`
   * of it set beside the first trade post, a ribbon from it into the post's entrance — the order fills
   * through the post as a line would bring it. Where no ribbon reaches the entrance (the demo base's post
   * stands against the Core), the stock goes straight into the entrance's store, as a line would have
   * brought it. Returns the order's id and the ribbons laid (0: the stock put in the entrance).
   */
  orderRig(item: string, n: number, stock?: number): { id: number; ribbons: number } | null;
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
      else if (def === 'copy') app.build.copy();
      else if (def === 'paste') app.build.paste();
      else if (def === 'upgrade') app.build.upgrade();
      else if (def === 'link') { app.build.link(); return app.link.active ? { k: 'link', def: null } : null; }
      else if (def === null) { app.tools.state = null; app.link.stop(); }
      else if (def !== undefined) app.build.pick(def);
      const s = app.tools.state;
      return s ? { k: s.k, def: s.k === 'build' || s.k === 'belt' ? s.def : null } : null;
    },
    blueprint: () => {
      const s = app.tools.state;
      const pre = s?.k === 'paste' || s?.k === 'upgrade' ? app.tools.preview().plan : undefined;
      return {
        paste: s?.k === 'paste' ? { rot: s.rot, mirror: s.mirror, pieces: s.bp.pieces.length } : null,
        plan: pre ? { n: pre.n, kept: pre.kept, skipped: pre.skipped, short: pre.short } : null,
        clipboard: app.tools.clipboard?.pieces.length ?? 0,
        library: app.sim.blueprints.map((b) => ({ id: b.id, name: b.name, pieces: b.pieces.length, icon: b.icon })),
        undo: app.tools.undo.size,
        panel: app.library.open,
      };
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
    ids: () => ({ buildings: [...BUILDING_IDS], items: [...ITEM_IDS] }),
    bankTokens: (n) => (app.sim.tokenBank += Math.max(0, Math.floor(n))),
    ribbonField: (x, y, rows, cols) => {
      // Sandbox rig: grant the plates, lay a dense serpentine
      // (rows one tile apart, U-turns at the ends). Where the land steps (D77: a ribbon never
      // faces another level), a traction ribbon takes the step, as a player would lay it.
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
    sea: (zoom) => {
      const p = app.sim.grid.source.seaPoint?.() ?? null;
      if (p && zoom !== undefined) app.camera.centerOnTile(p[0], p[1], zoom);
      return p;
    },
    peaks: (zoom, n = 0) => {
      const src = app.sim.grid.source as { peakSites?: () => ReadonlyArray<{ x: number; y: number; R: number; top: number }> };
      const all = (src.peakSites?.() ?? []).map(({ x, y, R, top }) => ({ x, y, R, top }));
      // A top `top` levels up shows `top` tiles back along −x −y in iso: look between it and its foot.
      const p = all[n];
      if (p && zoom !== undefined) app.camera.centerOnTile(p.x - (p.top >> 1), p.y - (p.top >> 1), zoom);
      return all;
    },
    spires: (zoom) => {
      const src = app.sim.grid.source as { spireField?: { x: number; y: number; bearing: number; r0: number; r1: number } | null; spiresIn?: (x0: number, y0: number, x1: number, y1: number) => Array<{ level: number }> };
      const f = src.spireField;
      if (!f) return null;
      const all = src.spiresIn?.(f.x - f.r1, f.y - f.r1, f.x + f.r1, f.y + f.r1) ?? [];
      // In iso a needle's top shows a few tiles back along −x −y from its foot: look a little past the middle.
      if (zoom !== undefined) app.camera.centerOnTile(f.x - 4, f.y - 4, zoom);
      return { ...f, count: all.length, tallest: all.reduce((m, s) => Math.max(m, s.level), 0) };
    },
    price: (item) => {
      const i = ITEM_IDS.indexOf(item as never);
      return { bid: (app.sim.prices.bid[i] ?? 0) / 100, ask: (app.sim.prices.ask[i] ?? 0) / 100 };
    },
    tradePost: () => app.sim.tradePosts()[0]?.id ?? 0,
    orders: () => {
      const st = app.sim.deliveries;
      return {
        open: st.open.map((o) => ({ id: o.id, item: ITEM_IDS[o.item]!, n: o.n, got: o.got, cents: o.cents, due: o.due, offerEnd: o.offerEnd, windowMin: o.windowMin, first: !!o.first, event: !!o.event, reward: o.reward ? o.reward.k : null })),
        past: st.past.map((o) => ({ id: o.id, item: ITEM_IDS[o.item]!, n: o.n, got: o.got, paid: o.paid, what: o.what })),
        filled: st.filled, missed: st.missed, paid: st.paid, ranking: { ...app.sim.ranking },
      };
    },
    orderRig: (item, n, stock = n) => {
      const sim = app.sim, post = sim.tradePosts()[0], o = sim.deliveries.open[0];
      const it = ITEM_IDS.indexOf(item as never);
      if (!post || !o || it < 0) return null;
      o.item = it;
      o.n = n;
      o.cents = Math.max(o.cents, Math.ceil(((sim.prices.bid[it] ?? 0) * 1150) / 1000));
      // A silo on free floor near the post (its cost granted: a rig), holding the stock, led into the entrance.
      const intoEntrance = (): { id: number; ribbons: number } => {
        const st = sellingOf(sim, post.id);
        st[it] = st[it]! + stock * 1000;
        return { id: o.id, ribbons: 0 };
      };
      const spot = api.freeSpot('silo', post.x + 2, post.y + 7, 14);
      if (!spot) return intoEntrance();
      for (const c of costOf(buildingIdx('silo'))) sim.stock[c.item] = sim.stock[c.item]! + c.mu;
      const s = sim.place('silo', spot[0]!, spot[1]!, 0);
      if (!s.ok || !s.id) return intoEntrance();
      sim.ensureCompiled();
      sim.stores.get(s.id)![it] = stock * 1000;
      (sim.graph.nodeByEnt.get(s.id) as unknown as { locked: number }).locked = it;
      const ribbons = connect(sim, s.id, post.id);
      if (ribbons > 0) return { id: o.id, ribbons };
      sim.remove(spot[0]!, spot[1]!); // no way into the entrance: the silo back up (its stock refunded to the Core)
      return intoEntrance();
    },
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
    expertise: () => {
      const sim = app.sim;
      return {
        ranks: Object.fromEntries(sim.expertise.ranks), slots: sim.expertise.slots.map((x) => (x ? { ...x } : null)),
        feats: Object.fromEntries(EXPERTISE_IDS.map((id) => [id, sim.featValue(EXPERTISES[id].feat)])),
        reorientCost: sim.reorientCost() / 100, tierTwo: tierTwoOpen(sim), archive: archiveOpen(sim),
      };
    },
    earnExpertise: (id, rank = 1) => {
      if (!isExpertise(id)) return false;
      app.sim.expertise.ranks.set(id, Math.max(1, Math.min(3, rank)));
      app.sim.rebuildDerived();
      return true;
    },
    chooseExpertise: (slot, id) => app.sim.chooseExpertise(slot, id),
    reorientExpertise: (slot, id) => app.sim.reorient(slot, id),
    research: (id) => {
      if (id) { const r = app.sim.startResearch(id); if (!r.ok) return { ok: false, reason: r.reason }; }
      return { ok: true, reason: null, projects: app.sim.projects.map((p) => ({ id: p.id, permille: projectPermille(p) })), done: [...app.sim.done] };
    },
    researchTier: (id) => researchNode(id)?.tier ?? 0,
    tierNodes: (tier) => RESEARCH_IDS.filter((id) => researchNode(id)?.tier === tier),
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
    nightNotice: (show) => {
      if (show === true) app.night.show();
      return app.night.shown;
    },
    gleaners: (o = {}) => {
      const sim = app.sim;
      if (o.toNight !== undefined) {
        // On to the next nightfall (a night already begun counts from its start), then m minutes in.
        let e = sim.absEpoch();
        if (sim.gleanNight()) while (sim.gleanNight((e - 1 - sim.foundingEpoch) * EPOCH)) e--;
        else while (!sim.gleanNight((e - sim.foundingEpoch) * EPOCH)) e++;
        const to = (e - sim.foundingEpoch) * EPOCH + Math.round(o.toNight * EPOCH);
        if (to > sim.tick) catchUp(sim, to - sim.tick);
        app.gleaners.rebuild(sim);
      }
      if (o.card === null) app.gleanCard.hide();
      if (o.card) app.gleanCard.show(o.card, sim.gleanedTonight());
      sim.ensureCompiled();
      const byId = (pairs: ReadonlyArray<readonly [number, number]>): Record<string, number> => Object.fromEntries(pairs.map(([i, mu]) => [ITEM_IDS[i]!, mu / 1000]));
      const g = sim.graph.glean;
      return {
        night: sim.gleanNight(), exposed: g.exposed.length, guarded: g.guarded.length,
        exposedTiles: [...g.exposed].slice(0, 24).map((t) => [t & 1023, t >> 10] as [number, number]),
        guardedTiles: [...g.guarded].slice(0, 24).map((t) => [t & 1023, t >> 10] as [number, number]),
        gleaned: byId([...sim.gleaned].map((mu, i) => [i, mu] as const).filter(([, mu]) => mu > 0)),
        tonight: byId(sim.gleanedTonight()), card: app.gleanCard.shown, tick: sim.tick,
        figures: app.gleaners.shown, arriving: app.gleaners.arriving, waiting: app.gleaners.waiting, reaching: app.gleaners.reaching,
        grabbing: app.gleaners.grabbing, carrying: app.gleaners.carrying, tapping: app.gleaners.tapping, prowling: app.gleaners.prowling,
        paired: app.gleaners.paired, onBelt: app.gleaners.onBelt, unforeseen: app.gleaners.unforeseen, unseen: app.gleaners.unseen, late: app.gleaners.late,
        under: app.gleaners.under, risen: app.gleaners.risen, timing: { arrive: RAID_ARRIVE, take: RAID_TAKE, stagger: RAID_STAGGER },
        // The next raids' posts (D112): each post's turn (the raid's slot, the band's crawl in, its stagger).
        next: sim.graph.chains.flatMap((c) => Array.from(c.raidPosts, (cell, p) => {
          const t = sim.tick - (sim.tick % GLEAN_WINDOW) + c.raidAt + RAID_ARRIVE + p * RAID_STAGGER;
          const tile = c.tiles[cell]!;
          return { x: tile & 1023, y: tile >> 10, tick: t > sim.tick ? t : t + GLEAN_WINDOW };
        })).sort((a, b) => a.tick - b.tick).slice(0, 24),
        raids: sim.graph.chains.filter((c) => c.raidPosts.length > 0).map((c) => {
          const t = sim.tick - (sim.tick % GLEAN_WINDOW) + c.raidAt;
          const posts = Array.from(c.raidPosts, (cell) => [c.tiles[cell]! & 1023, c.tiles[cell]! >> 10] as [number, number]);
          const mid = posts[posts.length >> 1]!;
          return { at: t > sim.tick ? t : t + GLEAN_WINDOW, x: mid[0], y: mid[1], posts, band: raidBandOf(c.raidHeld) };
        }).sort((a, b) => a.at - b.at || a.x - b.x || a.y - b.y).slice(0, 24),
      };
    },
    questHint: (show) => {
      const h = app.guide.hintState();
      if (show !== undefined && show !== h.shown) app.guide.toggleHint();
      app.quests.refresh();
      return app.guide.hintState();
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
