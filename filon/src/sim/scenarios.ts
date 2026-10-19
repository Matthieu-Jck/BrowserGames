// scenarios.ts — ready-made bases for debugging (the main menu's « Débogage » page, `FL.debugSave`):
// a base at a few stages of advancement, each built on the real map — Ysmère, the shared
// cirque, this player's land (MapGen) — by a script that plays as a player does: real commands
// (plans, placements, lines, wires, recipes, the claim's name, research, trade) and real time,
// so what a level shows is what the game makes of it. Pure engine code: no DOM, no clock,
// integers only; the same seeds and founding minute give the same base.
//
// Coordinate-free: every spot comes from the map as it stands (dev.ts's layout kit: deposits
// read off the tiles, lines routed around other buildings' ports, routers branching laid
// lines), so the levels follow the content when the cirque changes. What the map does not allow
// is skipped and reported (`report.skipped`), never thrown. A quest whose factory is built but
// has not completed within a few game minutes is completed by force (a logged `quest` with
// `force`, as `FL.completeQuest` does), so each level lands on its quest.
//
// The levels (SCENARIO_IDS, by advancement):
//   claim     the claim named, at the very start of the tutorial (quest 1 current), nothing built
//   smelter   « Premier coup de pioche »: an iron drill into the Heart, wired → at « La fonderie »
//   survey    + the smelter fed by its own drill pair (a second iron drill and the coal, D97, D101),
//             two wind turbines on the floor and two on the Crown's windiest spot (« Tenir la nuit »),
//             the glass smelter (two sand collectors; a router shares the coal) → at « La Criée »
//   tutorial  the tutorial up to its last quest (D101): + the trade post (glass led into its entrance,
//             then the iron ore line joining it — the post sells whatever comes in, D64), the copper
//             line and its wire mill, CrierBelt's starter contract led from the post's exit into the
//             mill (taken up once delivered, the fulfilled contract stopped: the exit then goes into the
//             Heart, fed by a small import order of plates, what the base builds with), the Core raised
//             to level 2 (« Le Cœur grandit »), every plan (the Face Cutter's among them), the research
//             lab on the Core's compute (D122: no ribbon), Mechanics started, the
//             quartz vein's parcel and two face cutters at its wall, their
//             quartz over the Crown into the Heart, and the quartz workshop the quest pays for, its
//             oscillators into the Heart (scenario-quartz.ts, D87) — the whole tutorial factory
//             running; « Les pièces de la Synthèse » current (D90), Mechanics learnt and the lab's next
//             node under way (D107: Tier 1 takes minutes): a base to play the last quest from (the
//             grown level completes it by force)
//   grown     later on: every plan of the tree, Mechanics, Overclocking (the Core's compute raised)
//             and a few research nodes learnt for real, a gear press, a silo; then the cirque's deposits covered by drills and two more
//             smelters on their lines (scenario-cirque.ts `mineCirque`, D82)
//   late      the grown base with most of the tree granted outside the commands (so its log does
//             not replay to it: `report.granted`), the Heart at level 4, an excavator on marked
//             rock (its stone line with an overflow gate onto an incinerator), a drill on the
//             deposit nearest past the Crown whose ore climbs over it on traction ribbons, the plate
//             line upgraded to swift ribbons with a bridge pair (owner, 2026-10-13: "improve the late
//             stage debug save to have more of the features we developed"), solar panels; then the
//             works of scenario-late.ts (owner, 2026-10-14: "actuellement elle n'est pas tres
//             avancée", D66): the Fabrique on the copper field (copper plates, circuits, servomotors in an
//             etcher, its own research lab, round a second trade post), the potteries on the
//             tarn's peak (their ceramic down into the Core), the Ember Fields mine selling its
//             embersalt at a third post on the spot, a coal pit's coal back over the Crown where the
//             cirque is short of it, a geothermal plant where there is a vent, pylon lines — every
//             far good by ribbon or sold where it is made since the skydocks went (D108); first of
//             all D123's works where the cirque leaves room (scenario-basics.ts): a brickworks by the
//             water, a steel line where an iron and a coal line meet, a press rolling its pipes;
//             last, a sand field of arc furnaces on the cirque's free floor (`fillCirque`, D82); and
//             two expertises chosen at the Core's Archive among those its feats earned (D93)
//
// Each level is founded at sunrise (`scenarioEpoch`) so its build runs in full sun: the early
// base's power is the Heart's panel. From the tutorial level on, a level ends with its power
// topped up (`powerUp`: wind until the night's draw is covered) and the base must pay its way:
// money that grows, machines that run (scenarios.test.ts checks both, owner 2026-10-13).
// Building one takes tens of milliseconds to a second or so, the late one two and a half (the
// scenario test measures them on the CPU: docs/testing.md, "Time limits"); the shell keeps the
// player's own base aside meanwhile (src/app/debug-session.ts).
import { BUILDING_IDS, BUILDING_KIND, buildingDef, buildingIdx, ITEM_IDS, itemIdx } from '@/content/registry';
import { BAL } from '@/content/balance';
import { QUEST_IDS, QUESTS, type QuestDef, type QuestId } from '@/content/quests';
import { PLAN_IDS, planDef, researchNode, treePrereq } from '@/content/research';
import { CIRQUE, COS64, SIN64, WORLD_SEED } from '@/content/world';
import { CENTER, DAY_EPOCHS, EPOCH, PERMILLE, SOLAR } from './constants';
import { besideRoutingBlock, branch, checkpoint, join, keepOff, lay, layFrom, learnPlans, placeFed, placeFeeding, powerLine, rollback, routeOver, sideGoals, spotsNear, type BeltTiles, type Feed } from './dev';
import { footprint, worldPorts, type WorldPort } from './entities';
import { isFaceOre } from './face';
import { Sim } from './state';
import { Chain } from './flow/chain';
import { ForkNode } from './flow/nodes';
import type { FNode } from './flow/node';
import { inReach } from './systems/landscape';
import { DX, DY, isFloor, isRock, opposite, T, type Ent, type Rot } from './types';
import { inWorld, MOUNTAIN_LEVEL, tileIndex } from './world/grid';
import { parcelAt } from './world/land';
import { MapGen } from './world/mapgen';
import { producerKw, weatherAt, windKw, windSite } from './power/network';
import { meanExposure } from './world/wind';
import { coalPit, emberMine, geothermal, emberSite, fabrique, potteries, toward, waitKites } from './scenario-late';
import { fillCirque, mineCirque, reattach } from './scenario-cirque';
import { quartzWorks, wallQuartz } from './scenario-quartz';
import { steamPower } from './scenario-steam';
import { filterFeed, sortWaste } from './scenario-waste';
import { basicsWorks } from './scenario-basics';
import { workOf, looksAtWork, type Work } from './systems/work';
import { flows, objectiveProgress } from './systems/quests';
import { autoSellMax, tradables } from './systems/trade';

/** The longest the build waits for the Fabrique's first purchases (their quarter hour and the post's lift). */
const FABRIQUE_WARM_MAX = 26 * EPOCH;

export const SCENARIO_IDS = ['claim', 'smelter', 'survey', 'tutorial', 'grown', 'late'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export const isScenario = (id: string): id is ScenarioId => (SCENARIO_IDS as readonly string[]).includes(id);

/** What building a level did. */
export interface ScenarioReport {
  id: ScenarioId;
  /** Game ticks run while building it. */
  ticks: number;
  /** Quests completed by force: their factory stood, but they had not completed in the time given. */
  forced: string[];
  /** What the map did not allow (a building without a spot, a line without a route…): built without it. */
  skipped: string[];
  /** Research learnt outside the commands (the late level): its log no longer replays to it. */
  granted: string[];
  /** The named buildings, by role. */
  ids: Record<string, number>;
}

export interface ScenarioOptions {
  /** The player's land (the real base's seed: the same ground). */
  playerSeed: number;
  /** A world minute; the level is founded at the last sunrise at or before it. */
  near: number;
  /** The claim's name (the shell's words: the engine writes no text). */
  name: string;
  /** The map version (content `MAPS`, D63); default today's (`MAP_VERSION`). */
  mapV?: number;
}

/** Full sun's first minute of the day (the first `SOLAR` step at 1000 ‰). */
const SUNRISE = SOLAR.findIndex((s) => s >= PERMILLE);

/** The last world minute at or before `near` when full sun begins: a level built from there runs in daylight. */
export function scenarioEpoch(near: number): number {
  return near - ((((near - SUNRISE) % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS);
}

/** A new base on the player's land, built to level `id`. */
export function foundScenario(id: ScenarioId, o: ScenarioOptions): { sim: Sim; report: ScenarioReport } {
  const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: o.playerSeed, source: new MapGen(WORLD_SEED, o.playerSeed, o.mapV), foundingEpoch: scenarioEpoch(o.near) });
  return { sim, report: buildScenario(sim, id, o.name) };
}

/** Build level `id` on a new base (founded, nothing built yet). */
export function buildScenario(sim: Sim, id: ScenarioId, name: string): ScenarioReport {
  const b = new Builder(sim, id);
  const upTo = SCENARIO_IDS.indexOf(id);
  if (!sim.nameColony(name)) b.until('claim'); // an unusable name: quest 0 is forced
  if (upTo >= 3) tradeSpot(b); // the trade post's place by the Heart, taken before the lines ring it
  if (upTo >= 1) firstStrike(b);
  if (upTo >= 2) { bloomKiln(b); firstWind(b); glassworks(b); steamPower(b); }
  // The quartz works before the iron's overflow into the Heart (D115: on land 2 that line ran past
  // the wire line's last tiles, where the works branch their wire from).
  if (upTo >= 3) { crierTrade(b); coreUpgrade(b); fieldJournal(b); wallQuartz(b, () => { powerUp(b, 12, 1000, 'veinPower'); quartzWind(b); }); postLine(b); tradeLine(b); quartzWorks(b); ironSurplus(b); }
  if (upTo >= 4) grown(b);
  if (upTo >= 5) late(b);
  // The rest of the cirque's floor (D82), last: the late base's works take their places first.
  if (upTo >= 4) fillCirque(b);
  if (upTo >= 2) powerUp(b, id === 'late' ? LATE_TURBINES : undefined, id === 'late' ? LATE_POWER_MARGIN : undefined);
  // The tutorial level opens with research under way: the lab's next node, its resources paid, its
  // tokens on their way from the Core's compute (D122: a Tier 1 node in a few minutes).
  if (id === 'tutorial') { labNext(b); b.run(10); }
  // The base run a few minutes, what stood backed up all along taken up (D85).
  if (upTo >= 4) settle(b);
  sim.ensureCompiled();
  return b.report;
}

/** The tutorial's sources the levels keep whatever they do (the scenario test looks for them). */
const KEEP_SOURCES: ReadonlySet<string> = new Set(['iron1', 'iron2', 'coal', 'copper', 'cutter1', 'cutter2']);

/**
 * As a player would after building (D85): the base run a few minutes, and the sources — drills
 * and sand collectors — that stood backed up for minutes on end (their lines carry away less than they
 * dig: the kiln they feed works at the coal's pace, a line is full) taken up, with their own short
 * line, refunded. The tutorial's own sources stay. Costs the build six game minutes.
 */
function settle(b: Builder): void {
  const sim = b.sim, before = sim.tick;
  const idle = idleAfter(sim, SETTLE_MIN, SETTLE_RUN);
  b.report.ticks += sim.tick - before;
  const roleOf = new Map(Object.entries(b.ids).map(([r, id]) => [id, r] as const));
  const belts = new Set([buildingIdx('ribbon'), buildingIdx('swift_ribbon')]);
  for (const it of idle) {
    const e = sim.ents.get(it.id), role = roleOf.get(it.id);
    if (!e || it.work !== 'pause' || BUILDING_KIND[e.def] !== 'drill' || (role && KEEP_SOURCES.has(role))) continue;
    // Its own line (a drill's short line into another one; one that others joined stays, they use it).
    const joined = role && Object.values(b.lines).some((l) => l !== b.lines[role] && l.length && b.lines[role]?.some(([x, y]) => x === l[l.length - 1]![0] + DX[l[l.length - 1]![2]]! && y === l[l.length - 1]![1] + DY[l[l.length - 1]![2]]!));
    if (role && !joined) for (const [x, y, r] of b.lines[role] ?? []) { const o = sim.entityAt(x, y); if (o && belts.has(o.def) && o.rot === r) sim.remove(x, y); }
    sim.remove(e.x, e.y);
    if (role) { delete b.ids[role]; if (!joined) delete b.lines[role]; }
  }
}

/**
 * Game minutes `settle` runs the base, and the stretch backed up that takes a source up: shorter
 * than the scenario test's three minutes, so a source that only starts to back up once another is
 * taken up (the kilns full of coal) goes in the same pass.
 */
const SETTLE_MIN = 6, SETTLE_RUN = 2;

/**
 * The production buildings that stand off for `limit` game minutes in a row or more while the base
 * runs `minutes` more (sampled every five seconds; D85, owner 2026-10-15: « tu devrais tester une
 * fois fini de faire tourner le jeu simulé pendant quelques minutes et voir si une machine reste
 * éteinte plusieurs minutes d'affilée »). Off is D83's look (`workOf`): not 'on'. A fuel generator
 * on standby (the wind covers the grid: 'pause') is the grid's reserve, not a fault, and is left out;
 * so are the sources that feed only such generators, backed up behind it (D114: a steam boiler's
 * coal drill and its pump, waiting with it for the night).
 * So is research waiting on the player's next choice (D101, D107: Tier 1's nodes take a few minutes,
 * so a grown base's lab is soon done): a lab with no project.
 * It runs the base: call it on a copy, or as the last thing done to one.
 */
export function idleAfter(sim: Sim, minutes = 6, limit = 3): Array<{ id: number; def: string; x: number; y: number; work: Work }> {
  const STEP = 50, watch = sim.ents.sorted().filter((e) => looksAtWork(e.def));
  const run = new Map<number, number>(), worst = new Map<number, number>();
  const free = (lab: number): boolean => !sim.projects.some((p) => p.lab === lab);
  // The generators each source feeds (drills, pumps), through ribbons and conduits only.
  const gens = watch.filter((e) => BUILDING_KIND[e.def] === 'generator');
  const feeds = new Map(watch.filter((e) => BUILDING_KIND[e.def] === 'drill' || BUILDING_KIND[e.def] === 'pump')
    .map((e) => [e.id, gens.filter((g) => flows(sim, e.id, g.id))] as const).filter(([, g]) => g.length > 0));
  const resting = (e: Ent): boolean => {
    if (BUILDING_KIND[e.def] === 'lab') return free(e.id);
    const into = feeds.get(e.id);
    return !!into && workOf(sim, e) === 'pause' && into.every((g) => workOf(sim, g) === 'pause'); // backed up behind its generators
  };
  for (let t = 0; t < minutes * 600; t += STEP) {
    sim.run(STEP);
    for (const e of watch) {
      const w = workOf(sim, e);
      const rest = w !== 'on' && resting(e);
      const standby = rest || (w === 'pause' && BUILDING_KIND[e.def] === 'generator');
      const r = w === 'on' || standby ? 0 : (run.get(e.id) ?? 0) + STEP;
      run.set(e.id, r);
      if (r > (worst.get(e.id) ?? 0)) worst.set(e.id, r);
    }
  }
  return watch.filter((e) => (worst.get(e.id) ?? 0) >= limit * 600)
    .map((e) => ({ id: e.id, def: BUILDING_IDS[e.def]!, x: e.x, y: e.y, work: workOf(sim, e) }));
}

// ── the builder: a player's hands ───────────────────────────────────────────

/** Game minutes a quest gets to complete on its own before it is forced. */
const QUEST_WAIT_MIN = 6;

export class Builder {
  readonly report: ScenarioReport;
  readonly ids: Record<string, number>;
  /** What waits for the end of the build (the potteries' digging: the build's hours would dig it out). */
  readonly later: Array<() => void> = [];
  /** The laid lines, by role (branches split them). */
  readonly lines: Record<string, BeltTiles> = {};
  readonly heart: [number, number] = [CENTER, CENTER];
  /** The windiest spot of the Crown (`windAnchor`, D95), and the windy spots no wire reached. */
  private anchor: [number, number] | null = null;
  private readonly unreachable = new Set<number>();
  /** Turbine spots' exposures read so far (`exposure`), and their rankings round a point (`windSpots`). */
  private readonly exposures = new Map<number, number>();
  private readonly rankings = new Map<string, ReadonlyArray<readonly [number, number, number]>>();

  constructor(readonly sim: Sim, id: ScenarioId) {
    this.report = { id, ticks: 0, forced: [], skipped: [], granted: [], ids: {} };
    this.ids = this.report.ids;
  }

  get H(): number { return this.sim.hearthId; }

  skip(what: string): void { this.report.skipped.push(what); }
  /** Take a skip back (a part retried and laid after all). */
  unskip(what: string): void { const i = this.report.skipped.lastIndexOf(what); if (i >= 0) this.report.skipped.splice(i, 1); }

  run(ticks: number): void {
    this.sim.run(ticks);
    this.report.ticks += ticks;
  }

  /** An extra the level can do without: what it could not place is not reported as skipped. */
  optional<T>(f: () => T): T {
    const n = this.report.skipped.length;
    const r = f();
    this.report.skipped.length = n;
    return r;
  }

  /** Learn a tree node outside the commands, prerequisites first (reported: this base's log no longer replays to it). */
  grantNode(id: string): void {
    const sim = this.sim;
    if (sim.done.has(id) || (!researchNode(id) && !planDef(id))) return;
    for (const p of treePrereq(id)) this.grantNode(p);
    sim.done.add(id);
    sim.projects = sim.projects.filter((p) => p.id !== id);
    this.report.granted.push(id);
    sim.rebuildDerived();
  }

  /** Grant what the Heart lacks of `cost` (× `times`): logged grants, so the stock stays near a player's. */
  /**
   * A research node's resources in the Core (D122: paid at its launch), granted where short, and
   * CrierBelt's restart reserve kept (D36: the launch must not eat into it, as a plan's).
   */
  affordNode(id: string): void {
    const r = researchNode(id);
    if (!r) return;
    this.afford(r.cost);
    for (const c of this.sim.reserveShort(r.cost.map(([it, n]) => ({ item: itemIdx(it), mu: n * 1000 })))) this.sim.grant(ITEM_IDS[c.item]!, Math.ceil(c.mu / 1000));
  }

  afford(cost: ReadonlyArray<readonly [string, number]>, times = 1): void {
    const sum = new Map<string, number>();
    for (const [it, n] of cost) sum.set(it, (sum.get(it) ?? 0) + n * times);
    for (const [it, n] of sum) {
      const short = n * 1000 - this.sim.stock[itemIdx(it)]!;
      if (short > 0) this.sim.grant(it, Math.ceil(short / 1000));
    }
  }

  /** What these buildings cost together (`[def, how many]`), granted where the Heart lacks it — together, not one by one. */
  affordAll(...parts: ReadonlyArray<readonly [string, number]>): void {
    this.afford(parts.flatMap(([def, k]) => buildingDef(buildingIdx(def)).cost.map(([it, n]) => [it, n * k] as const)));
  }

  affordDef(def: string, times = 1): void { this.affordAll([def, times]); }

  /** Unlock plans of the tree, paid from the Heart (what it lacks granted); prerequisites through `learnPlans`. */
  plan(...ids: string[]): void {
    for (const p of ids) {
      if (this.sim.done.has(p)) continue;
      const def = planDef(p);
      if (!def) { this.skip(`plan:${p}`); continue; }
      this.afford(def.cost);
      if (!this.sim.unlockPlan(p).ok) learnPlans(this.sim, [p]);
      if (!this.sim.done.has(p)) this.skip(`plan:${p}`);
    }
  }

  /**
   * Lines cross on junctions once their plan is unlocked: a line that cannot be laid around the
   * others makes the builder unlock it (as a player would) and try again. True if it was not yet.
   */
  junctions(): boolean {
    if (this.sim.done.has('junction')) return false;
    this.plan('junction');
    return this.sim.done.has('junction');
  }

  /** A few junctions, once their plan is in: lines may cross on the way (their cost in `affordAll`). */
  get spare(): readonly [string, number] {
    return ['crossing', this.sim.done.has('junction') ? 6 : 0];
  }

  /** Before laying lines: a few junctions' cost in hand (granted if short), once their plan is in. */
  crossings(): void { this.affordAll(this.spare); }

  /** A building on the first spot `spotsNear` gives (its cost granted if short); its id (0: skipped). */
  put(role: string, def: string, near: readonly [number, number], opts: Parameters<typeof spotsNear>[3] = {}): number {
    this.affordDef(def);
    for (const [x, y, rot] of spotsNear(this.sim, def, near, opts)) {
      const r = this.sim.place(def, x, y, rot);
      if (r.ok) return (this.ids[role] = r.id!);
    }
    this.skip(role);
    return 0;
  }

  /**
   * A turbine at the windiest free spot within `r` of `near` (D95: by its exposure over the days),
   * none under `min` ‰ — the ranking read down until a spot takes it, never past the first one
   * under `min`; its id, or 0 (not skipped: the caller decides).
   */
  windy(role: string, def: string, near: readonly [number, number], r: number, min = 0, not: ReadonlySet<number> = new Set()): number {
    this.affordDef(def);
    for (const [x, y, e] of this.windSpots(def, near, r)) {
      if (e < min) break;
      if (not.has(tileIndex(x, y))) continue;
      const c = this.sim.canPlace(def, x, y, 0);
      if (!c.ok || c.replaces.length) continue;
      const p = this.sim.place(def, x, y, 0);
      if (p.ok) return (this.ids[role] = p.id!);
    }
    return 0;
  }

  /**
   * A turbine at the windiest spot within `r` of `near` that a wire reaches (D95), wired: a spot
   * no line reaches (a plateau behind a cliff, map 4) is taken down again (refunded) and the next
   * one tried, at most six. Its id, or 0 (not skipped).
   */
  windyWired(role: string, def: string, near: readonly [number, number], r: number, min = 0): number {
    for (let tries = 0; tries < 6; tries++) {
      const id = this.windy(role, def, near, r, min, this.unreachable);
      if (!id) return 0;
      this.wire(role);
      if (this.sim.linksOf(id).length) return id;
      this.unskip(`wire:${role}`);
      const e = this.sim.ents.get(id)!;
      this.unreachable.add(tileIndex(e.x, e.y));
      this.sim.remove(e.x, e.y);
      delete this.ids[role];
    }
    return 0;
  }

  /**
   * Turbine spots within `r` of `near`, the windiest first, free or not, off the land above the
   * mountains — map 4's spring summit (D115), the windiest of all, its cliffs all round: no mast's
   * wire climbs to it (a player's pylon does). Ranked as `windiest` ranks them (readouts/wind.ts:
   * exposure over the days, then nearer, then by row); each spot's exposure read once a build
   * (`exposure`), each ranking kept (the land as generated: the late base's turbines search the
   * Crown's and the open sand's rings again and again, and reading a 3×3 footprint's wind was most
   * of its build). The caller checks each spot (`canPlace`) as it goes.
   */
  private windSpots(def: string, near: readonly [number, number], r: number): ReadonlyArray<readonly [number, number, number]> {
    const di = buildingIdx(def), key = `${di}:${near[0]},${near[1]}:${r}`;
    const kept = this.rankings.get(key);
    if (kept) return kept;
    const g = this.sim.grid;
    const [w, h] = footprint(di, 0);
    const scored: Array<[number, number, number, number]> = [];
    for (let ty = near[1] - r; ty <= near[1] + r; ty++) for (let tx = near[0] - r; tx <= near[0] + r; tx++) {
      const dx = 2 * tx + w - 2 * near[0], dy = 2 * ty + h - 2 * near[1];
      if (dx * dx + dy * dy > 4 * r * r || !inWorld(tx, ty) || g.level(tx, ty) > MOUNTAIN_LEVEL) continue;
      scored.push([tx, ty, this.exposure(di, tx, ty), dx * dx + dy * dy]);
    }
    scored.sort((a, c) => c[2] - a[2] || a[3] - c[3] || a[1] - c[1] || a[0] - c[0]);
    const out = scored.map(([x, y, e]) => [x, y, e] as const);
    this.rankings.set(key, out);
    return out;
  }

  /** The exposure over the days (‰) of a turbine `di` at (x, y), turned 0: the land as generated, so read once (D95). */
  private exposure(di: number, x: number, y: number): number {
    const key = di * 0x100000 + tileIndex(x, y);
    let e = this.exposures.get(key);
    if (e === undefined) this.exposures.set(key, (e = meanExposure(windSite(this.sim.grid, this.sim.worldSeed, { def: di, x, y, rot: 0 }))));
    return e;
  }

  /** The windiest spot of the Crown a turbine may take (D95), found once: where the base's wind goes. */
  windAnchor(def = 'wind_flower'): [number, number] {
    if (!this.anchor) {
      const R = (this.sim.grid.source.crownOuter ?? CIRQUE.crownOuter) + 1;
      const best = this.windSpots(def, [CENTER, CENTER], R).find(([x, y]) => { const c = this.sim.canPlace(def, x, y, 0); return c.ok && !c.replaces.length; });
      this.anchor = best ? [best[0], best[1]] : this.crown();
    }
    return this.anchor;
  }

  /** A drill on `item`: the spot nearest `near` (default the Heart) on whole-deposit tiles, its output facing the Heart. */
  drill(role: string, item: string, near: readonly [number, number] = this.heart, r = 30): number {
    return this.put(role, 'drill', near, { item, r, toward: this.heart });
  }

  /** A building fed by its lines and sending on to `to` (see `placeFed`); its id (0: skipped). */
  fed(role: string, def: string, near: readonly [number, number], feeds: ReadonlyArray<Feed | 0 | undefined>, to: number | null, outRole?: string, far = true): number {
    if (feeds.some((f) => !f)) { this.skip(role); return 0; }
    const routers = feeds.filter((f) => typeof f !== 'number').length;
    this.affordAll([def, 1], ['router', routers], this.spare);
    let r = placeFed(this.sim, def, near, feeds as Feed[], to, { r: 14 });
    if (!r && this.junctions()) { this.affordAll([def, 1], ['router', routers], this.spare); r = placeFed(this.sim, def, near, feeds as Feed[], to, { r: 14 }); }
    // A crowded base: farther out, more spots (only when the near ones all failed: a base that
    // builds near stays as it was). Not for an extra the level can do without (`far` false): the
    // wide search costs the build up to a second when it finds nothing.
    if (!r && far) r = placeFed(this.sim, def, near, feeds as Feed[], to, { r: 22, tries: 160 });
    if (!r) { this.skip(role); return 0; }
    if (outRole && r.out) this.lines[outRole] = r.out;
    r.lines.forEach((l, k) => { this.lines[`${role}.in${k}`] = l; });
    return (this.ids[role] = r.id);
  }

  /**
   * A source (drill, collector, excavator…) placed only where its own line can be laid: into
   * entity `into`, or joining the line of role `into` from the side (`placeFeeding`). Kept as
   * `ids[role]` and `lines[role]`; its id (0: skipped).
   */
  source(role: string, def: string, near: readonly [number, number], into: number | string, opts: { item?: string; orePart?: number; r?: number; tries?: number } = {}): number {
    const target = typeof into === 'number' ? into : this.lines[into];
    if (!target) { this.skip(role); return 0; }
    this.affordAll([def, 1], this.spare);
    let r = placeFeeding(this.sim, def, near, target, opts);
    if (!r && this.junctions()) { this.affordAll([def, 1], this.spare); r = placeFeeding(this.sim, def, near, target, opts); }
    if (!r) { this.skip(role); return 0; }
    this.lines[role] = r.line;
    return (this.ids[role] = r.id);
  }

  /** Wire buildings (by role) into the Heart's grid (`powerLine`: poles as needed, their cost granted if short). */
  wire(...roles: string[]): void {
    for (const role of roles) {
      const id = this.ids[role];
      if (!id) continue;
      this.affordDef('mast', 8);
      powerLine(this.sim, id);
      if (!this.sim.linksOf(id).length) this.skip(`wire:${role}`);
    }
  }

  /**
   * Wire buildings (by role) to the nearest pole standing in reach, else as `wire` does: the
   * Heart's six wires are kept for the lines that need it (the Crown's turbines).
   */
  wireByPole(...roles: string[]): void {
    const sim = this.sim;
    for (const role of roles) {
      const e = this.ids[role] ? sim.ents.get(this.ids[role]!) : undefined;
      if (!e) continue;
      const d2 = (o: { x: number; y: number }): number => (o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y);
      const pole = [...sim.ents.map.values()]
        .filter((o) => BUILDING_KIND[o.def] === 'pole' && sim.canLink(o.id, e.id).ok)
        .sort((p, q) => d2(p) - d2(q) || p.id - q.id)[0];
      if (pole) sim.link(pole.id, e.id);
      else this.wire(role);
    }
  }

  /** Buy the parcels holding these tiles that the claim does not hold yet (the ocelles granted if short): whether it holds them all. */
  landFor(tiles: ReadonlyArray<readonly [number, number]>): boolean {
    const sim = this.sim;
    const need = [...new Set(tiles.map(([x, y]) => parcelAt(x, y)))].filter((p) => !sim.land.holds(p)).sort((p, q) => p - q);
    for (const p of need) {
      const cents = sim.landPrice(p);
      if (sim.credits < cents) sim.grantCredits(cents - sim.credits);
      if (sim.buyLand(p) !== null) { this.skip(`land:${p}`); return false; }
    }
    return true;
  }

  /** `landFor` every tile within `r` of a point (a square). */
  landAround(at: readonly [number, number], r: number): boolean {
    const tiles: Array<[number, number]> = [];
    const k = Math.ceil(r);
    for (let y = at[1] - k; y <= at[1] + k; y++) for (let x = at[0] - k; x <= at[0] + k; x++) if (inWorld(x, y)) tiles.push([x, y]);
    return this.landFor(tiles);
  }

  recipe(role: string, recipe: string): void {
    const id = this.ids[role];
    if (id && !this.sim.setRecipe(id, recipe)) this.skip(`recipe:${role}`);
  }

  /** Run until quest `q` is done (a few game minutes at most); then force it, and any before it, in order. */
  until(q: QuestId, minutes = QUEST_WAIT_MIN): void {
    const st = this.sim.quests;
    for (let t = 0; t < minutes * EPOCH && !st.done.includes(q) && !st.skipped; t += 60) this.run(60);
    const target = QUEST_IDS.indexOf(q);
    while (!st.done.includes(q) && st.cur <= target) {
      const cur = QUEST_IDS[st.cur]!;
      if (!this.sim.completeQuest(cur, true)) break;
      this.report.forced.push(cur);
    }
  }

  /** A building's centre tile (the Heart's when it is missing). */
  centre(role: string): [number, number] {
    const e = this.sim.ents.get(this.ids[role] ?? this.H);
    if (!e) return this.heart;
    const [w, h] = footprint(e.def, e.rot);
    return [e.x + (w >> 1), e.y + (h >> 1)];
  }

  /** Halfway between two points (tiles). */
  mid(a: readonly [number, number], c: readonly [number, number] = this.heart): [number, number] {
    return [(a[0] + c[0]) >> 1, (a[1] + c[1]) >> 1];
  }

  /** `d` tiles past a building's centre on the side away from the Heart (each axis: the Heart's own row or column stays). */
  away(role: string, d: number): [number, number] {
    const c = this.centre(role), h = this.heart;
    return [c[0] + Math.sign(c[0] - h[0]) * d, c[1] + Math.sign(c[1] - h[1]) * d];
  }

  /** The middle tile of a laid line (the Heart's centre when there is none). */
  middle(role: string): [number, number] {
    const l = this.lines[role];
    const t = l?.[l.length >> 1];
    return t ? [t[0], t[1]] : this.heart;
  }

  /**
   * A point `dist` tiles from the Heart, in the one of the four diagonals (the Heart's corners)
   * farthest from every cirque deposit and the floor's lake (content offsets; `rank` 1: the next
   * best): where the trade post, power and storage go, out of the lines' way. Diagonals only: the
   * post stands at a corner of the Heart, between the smelters' coal and the tired vein, and with
   * the lake up on the Crown (map 2, D63) the open east side would draw it away from the glass.
   */
  quietSide(dist: number, rank = 0): [number, number] {
    const marks: Array<readonly [number, number]> = CIRQUE.deposits.map((d) => [d.dx, d.dy] as const);
    if (!CIRQUE.lake.onCrest) marks.push([CIRQUE.lake.dx, CIRQUE.lake.dy]);
    const dirs = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
    const scored = dirs.map(([ux, uy], k) => {
      const px = ux * dist, py = uy * dist;
      return { k, px, py, d: Math.min(...marks.map(([mx, my]) => (mx - px) * (mx - px) + (my - py) * (my - py))) };
    }).sort((a, b) => b.d - a.d || a.k - b.k);
    const s = scored[rank % scored.length]!;
    return [CENTER + s.px, CENTER + s.py];
  }

  /** A point on the Crown's near slopes (soft rock, just past the floor) on the quiet side (`rank` 1: the next best): where turbines go (D44). */
  crown(rank = 0): [number, number] {
    return this.quietSide(CIRQUE.floorRadius + 3, rank);
  }

  /**
   * A point on the Crown's ridge (its top, three tiles past the floor's rim) at the `k`-th of
   * sixteen bearings, from the quiet diagonal round: where the late base's many turbines go once
   * the quiet side's slopes are taken.
   */
  ridge(k: number): [number, number] {
    const [qx, qy] = this.quietSide(1);
    const base = qx > CENTER ? (qy > CENTER ? 8 : 56) : qy > CENTER ? 24 : 40; // 64 steps, 0 east, 16 south
    const i = (base + 4 * k) & 63, r = CIRQUE.floorRadius + 3;
    return [CENTER + ((COS64[i]! * r) >> 10), CENTER + ((SIN64[i]! * r) >> 10)];
  }

  /** A cirque deposit's centre as the content places it (the `nth` of that item): a hint, the tiles decide. */
  deposit(item: string, nth = 0): [number, number] {
    const d = CIRQUE.deposits.filter((q) => q.item === item)[nth];
    return d ? [CENTER + d.dx, CENTER + d.dy] : this.heart;
  }

  /** The lines of these roles that were laid. */
  laid(...roles: string[]): BeltTiles[] {
    return roles.map((r) => this.lines[r]).filter((l): l is BeltTiles => !!l);
  }
}

// ── the tutorial, quest by quest (content/quests.ts; the scripted run in quests.test.ts) ──

/**
 * The trade post against the Heart, placed before quest 1 (quest 7 only wires it and sets its
 * stream): once the tutorial's lines run into the Heart from every side, no corner is left for it.
 */
function tradeSpot(b: Builder): void {
  b.plan('telemetry', 'trade_post');
  postAtHeart(b);
}

/**
 * The trade post against the Heart where its two flame-proof ribbons (D62) can come and go: three
 * free floor tiles straight out of its entrance and of its exit. Two ribbons are laid at once into
 * its entrance (`post.stub`), so the tutorial's lines, ringing the Heart later, leave the way in
 * open: the iron line joins the stub's tail (`postLine`).
 */
export function postAtHeart(b: Builder): number {
  const sim = b.sim, def = buildingIdx('trade_post');
  b.affordDef('trade_post');
  const open = (x: number, y: number): boolean => inWorld(x, y) && sim.grid.occ[tileIndex(x, y)] === 0 && isFloor(sim.grid.terrain(x, y));
  const out3 = (p: WorldPort): boolean => [0, 1, 2].every((k) => open(p.fx + k * DX[p.dir]!, p.fy + k * DY[p.dir]!));
  // At a corner of the Heart (one tile of its side against the post's), on its quiet side: a 5×5
  // pad against the middle of a side would take every inlet the Heart has there from the
  // tutorial's lines.
  const h = sim.ents.get(b.H)!;
  const along = (x: number, y: number): number => {
    const ox = Math.min(x + 5, h.x + 5) - Math.max(x, h.x), oy = Math.min(y + 5, h.y + 5) - Math.max(y, h.y);
    return Math.max(ox, oy);
  };
  // On the cirque's quiet side (away from the deposits and the lake: the tutorial builds there last).
  const spots = spotsNear(sim, 'trade_post', toward(b.heart, b.quietSide(10), 5), { r: 9, touch: b.H, inputsFree: false })
    .map((sp, k) => [sp, along(sp[0], sp[1]), k] as const).sort((p, q) => p[1] - q[1] || p[2] - q[2]).map(([sp]) => sp);
  for (const [x, y, rot] of spots) {
    const ports = worldPorts({ def, x, y, rot });
    if (!ports.every(out3)) continue;
    const r = sim.place('trade_post', x, y, rot);
    if (!r.ok) continue;
    const inP = ports.find((p) => p.io === 'in')!, back = opposite(inP.dir);
    const stub: BeltTiles = [[inP.fx + DX[inP.dir]!, inP.fy + DY[inP.dir]!, back], [inP.fx, inP.fy, back]];
    if (sim.placeBelts('ribbon', stub) === stub.length) b.lines['post.stub'] = stub;
    return (b.ids.post = r.id!);
  }
  b.skip('post');
  return 0;
}

/** 1 · a drill on iron where its line reaches the Heart, wired. */
export function firstStrike(b: Builder): void {
  b.source('iron1', 'drill', b.heart, b.H, { item: 'iron_ore', r: 30 });
  b.wire('iron1');
  b.until('first_strike');
}

/**
 * 2 · the smelter toward the coal, fed by its own drill pair (D97: one iron drill and one coal drill
 * a smelter; D101: no router yet), its plates into the Heart.
 */
export function bloomKiln(b: Builder): void {
  b.plan('kiln');
  b.fed('kiln1', 'kiln', b.mid(b.deposit('coal')), [], b.H, 'plates');
  if (b.ids.kiln1) {
    b.source('coal', 'drill', b.centre('kiln1'), b.ids.kiln1, { item: 'coal', r: 30 });
    // On the north deposit, beside the first drill: its line takes the way the old router branch did
    // (the north-west deposit's ran down the cirque's west side, where the glass and the post go next).
    b.source('iron2', 'drill', b.deposit('iron_ore'), b.ids.kiln1, { item: 'iron_ore', r: 30 });
  }
  b.recipe('kiln1', 'iron_plate');
  b.wire('coal', 'iron2');
  b.until('bloom_kiln');
}

/**
 * 3 · « Tenir la nuit » (D101): two wind turbines on the quiet side, wired, then two on the Crown's
 * windiest spot (`crownWind`: the floor's give little, D44) — the night holds.
 */
export function firstWind(b: Builder): void {
  b.plan('wind_flower');
  // Where the levels have always planted them, on the floor: they give little now (D44), but moving
  // them reshapes every line laid after and leaves the later levels no room to branch. The base's
  // wind comes from the Crown (`crownWind`, `powerUp`).
  const spot = b.quietSide(9);
  b.put('wind1', 'wind_flower', spot, { r: 8 });
  b.put('wind2', 'wind_flower', spot, { r: 8 });
  b.wire('wind1', 'wind2');
  crownWind(b);
  b.until('first_wind');
}

/**
 * 5 · glass: a second smelter fed coal by a router on the coal line, sand by two collectors (their
 * lines joined); its glass into the Heart. The smelter and its first collector go down together: a
 * spot whose free inlet the coal line and the router's branch box in takes no sand (D104: the coal's
 * irregular patch can run its line along the smelter's inlet row), so the smelter goes back up and
 * tries farther along the coal line, as a player moves it.
 */
export function glassworks(b: Builder): void {
  b.plan('sand_collector', 'router');
  const coal = b.laid('coal'), tiles = b.lines.coal ?? [];
  const along = (f: number): [number, number] => { const t = tiles[Math.min(tiles.length - 1, Math.floor(tiles.length * f))]; return t ? [t[0], t[1]] : b.middle('coal'); };
  const tries = tiles.length ? [0.5, 0.25, 0.75, 0.1, 0.9].map(along) : [b.middle('coal')];
  for (const [k, near] of tries.entries()) {
    const cp = checkpoint(b.sim), skips = b.report.skipped.length;
    b.fed('kiln2', 'kiln', near, [coal.length ? { lines: coal } : 0], b.H, 'glass', k === 0);
    b.recipe('kiln2', 'glass');
    // Its sand from the far side, away from the Heart: the post's glass and ore lines come in on the near side.
    if (b.ids.kiln2) b.source('sand1', 'sand_collector', b.away('kiln2', 3), b.ids.kiln2);
    if ((b.ids.kiln2 && b.ids.sand1) || k === tries.length - 1) break; // the last try stands as it is, its skips reported
    if (b.ids.kiln2) rollback(b.sim, cp);
    b.report.skipped.length = skips;
    for (const r of ['kiln2', 'sand1']) delete b.ids[r];
    for (const l of ['glass', 'kiln2.in0', 'sand1']) delete b.lines[l];
  }
  if (b.ids.sand1) b.source('sand2', 'sand_collector', b.centre('sand1'), 'sand1');
  b.wire('sand1', 'sand2');
  b.until('glassworks');
}

/**
 * 7 · « Le Cœur grandit » (D101): the Core to level 2 by the player's own command (`hearthUp`), its
 * plates, glass and copper wire from the Heart (logged grants where short): it mounts the compute
 * bay whose tokens the lab runs on (D122), and grows the Core's power.
 */
export function coreUpgrade(b: Builder): void {
  const sim = b.sim, up = BAL.hearthUpgrades[sim.hearthLevel - 1];
  if (sim.hearthLevel < 2 && up) {
    b.afford(up.cost);
    if (!sim.upgradeHearth().ok) b.skip('hearth:2');
  }
  b.until('core_upgrade', 1);
}

/**
 * 8 · « Le laboratoire »: every plan left (the Face Cutter's among them, D101), then the research
 * lab's (the gate, D71); the lab well east of the Heart, so the lines the tutorial lays to the Heart
 * later pass between them — east rather than south, where the wire mill's line comes in and the
 * quartz workshop branches off it. D122: no line feeds it; nearer (where the data line put it), it
 * stood in the iron overflow's way on lands 1–2; farther, the quartz line went round the spring's
 * ledge on land 3 and walled the late base's potteries off (measured on lands 1–3). Wired; Mechanics launched, its plates and wire paid from the Core, its tokens from the Core's
 * compute (no ribbon, no data; two minutes).
 */
export function fieldJournal(b: Builder): void {
  b.plan(...PLAN_IDS.filter((id) => planDef(id)!.lane !== 'gate'), 'observatory');
  const sim = b.sim;
  const h = sim.ents.get(sim.hearthId);
  if (h) b.put('observatory', 'observatory', [h.x + footprint(h.def, h.rot)[0] + 8, h.y + 1], { r: 10 });
  b.wireByPole('observatory');
  b.affordNode('tr1');
  if (b.ids.observatory && !sim.startResearch('tr1').ok) b.skip('research:tr1');
  b.until('field_journal');
}

/**
 * The tutorial lab's next project once Mechanics is learnt (D122: a Tier 1 node takes a few minutes
 * of the Core's compute), as a player goes on: the level opens with research under way.
 */
function labNext(b: Builder): void {
  const sim = b.sim, lab = b.ids.observatory;
  if (!lab || sim.projects.some((p) => p.lab === lab)) return;
  const next = TUTORIAL_NEXT.find((id) => { b.affordNode(id); return sim.researchBlock(id) === null; });
  if (!next || !sim.startResearch(next, lab).ok) b.skip('research:next');
}
/** What the tutorial lab starts next, the first that can (first-depth Tier 1 nodes). */
const TUTORIAL_NEXT = ['en_pitch', 'an_data', 'xp_swift', 'dn3', 'ex_fastdrill', 'cm_post2'];

/**
 * Where a ribbon led into the post goes: onto the tail of the stub laid into its entrance
 * (`postAtHeart`), or into its outer tile from either side (D104: on a crowded west side the tail
 * alone can stand boxed in), as `branch` wants its goals.
 */
function stubGoal(b: Builder): Map<number, Rot> | undefined {
  const stub = b.lines['post.stub'];
  if (!stub) return undefined;
  const goals = new Map([[tileIndex(stub[0]![0] - DX[stub[0]![2]]!, stub[0]![1] - DY[stub[0]![2]]!), stub[0]![2]]]);
  for (const [t, d] of sideGoals(b.sim, stub)) if (!goals.has(t)) goals.set(t, d);
  return goals;
}

/**
 * 5 · « La Criée » (D101): the Crier both ways. Glass sold — the trade post against the Heart (placed
 * at the start), wired, glass led into its entrance by a router on the glass line (it sells whatever
 * comes in, D64; the iron ore line joins it later, `postLine`) — and copper bought and used: the
 * wire mill toward the tired vein, its own copper drill, and CrierBelt's starter contract, its ore led
 * from the post's exit into the side of the drill's line into the mill (`starterLine`).
 */
export function crierTrade(b: Builder): void {
  postGlass(b);
  tiredVein(b);
  starterLine(b);
  b.until('crier_trade', 10); // the router shares the glass three ways and the post may stand far off: a slow first lift
  // 7 · « Les scories » (D125, D139): the contract's slag sorted off its line (`starterLine`).
  b.until('slag', 3);
  starterDone(b);
}

/** The trade post wired, and glass led into its entrance by a router on the glass line. */
export function postGlass(b: Builder): void {
  b.plan('trade_post');
  if (!b.ids.post) postAtHeart(b);
  b.wire('post');
  const post = b.ids.post, glass = b.laid('glass');
  b.affordAll(['router', 1], b.spare);
  let r = post && glass.length ? branch(b.sim, glass, post, -1, stubGoal(b)) : null;
  if (!r && post && glass.length && b.junctions()) { b.affordAll(['router', 1], b.spare); r = branch(b.sim, glass, post, -1, stubGoal(b)); }
  if (r) b.lines['post.glass'] = [...r.path, ...(b.lines['post.stub'] ?? [])]; else b.skip('line:post.glass');
}

/** The tired copper vein: a wire mill toward it, its wire into the Heart; a copper drill's line into it. */
export function tiredVein(b: Builder): void {
  b.plan('wire_mill');
  b.fed('mill', 'wire_mill', b.mid(b.deposit('copper_ore')), [], b.H, 'wire');
  if (b.ids.mill) b.source('copper', 'drill', b.centre('mill'), b.ids.mill, { item: 'copper_ore', r: 30 });
  b.recipe('mill', 'copper_wire');
  b.wire('copper', 'mill');
}

/**
 * The starter contract signed (D101: `BAL.starter`, fixed price, off the market) and its ore led
 * from the post's one exit into the side of the copper drill's line, so the wire mill uses what the
 * base bought (owner, 2026-10-16: « Je n'avais même pas relié mon tradepost »).
 */
export function starterLine(b: Builder): void {
  const post = b.ids.post, copper = b.lines.copper;
  if (!post || !copper) { b.skip('starter'); return; }
  if (typeof b.sim.takeStarter(post) !== 'number') { b.skip('starter'); return; }
  b.crossings();
  let path = join(b.sim, post, copper);
  if (!path && b.junctions()) { b.crossings(); path = join(b.sim, post, copper); }
  if (path) b.lines['post.starter'] = path; else { b.skip('line:post.starter'); return; }
  // Its ore comes with its slag (D139: one with every five, `BAL.starter.waste`), which the wire mill
  // refuses: sorted off on the exit's own line before the first lot lands — a sorter set to the ore,
  // an incinerator on its side (`sortWaste`) — the plans taken from the Heart as a player would.
  b.plan('sorter', 'incinerator');
  b.affordAll(['sorter', 1], ['incinerator', 1], b.spare);
  const s = sortWaste(b.sim, path, BAL.starter.item);
  if (s) { b.ids.slagSorter = s.sorter; b.ids.slagPit = s.pit; } else b.skip('slag');
}

/**
 * Once the contract is delivered whole and its last ore has left the container: the fulfilled order
 * stopped, its ribbon taken up, so the post's exit is free for what the base buys later (`tradeLine`). A post's one exit hands
 * out all its cargo in turn (D62): plates led into the mill's line would jam it.
 */
export function starterDone(b: Builder): void {
  const sim = b.sim, post = b.ids.post, line = b.lines['post.starter'];
  if (!post || !line) return;
  const ore = itemIdx(BAL.starter.item), slag = itemIdx(BAL.starter.waste[0]);
  // Its slag too (D139): out of the container and through the sorter, so none is left to go out by
  // the exit's next line (`tradeLine`) nor back into the Core with the ribbons taken up.
  const pending = (): boolean => sim.trade.orders.some((o) => (o.starter ?? 0) > 0)
    || sim.trade.inflight.some((s) => s.post === post && (s.item === ore || s.item === slag))
    || (sim.stores.get(post)?.[ore] ?? 0) >= 1000 || (sim.stores.get(post)?.[slag] ?? 0) > 0
    || line.some(([x, y]) => sim.chainAt(x, y)?.contents().some((c) => c.item === slag) ?? false)
    || (() => { const f = sim.graph.nodeByEnt.get(b.ids.slagSorter ?? 0); return f instanceof ForkNode && f.mu > 0 && f.item === slag; })();
  for (let t = 0; t < 12 * EPOCH && pending(); t += 60) b.run(60);
  // Fulfilled, the contract stands stopped and asks (D101): « Arrêter », the notice's default.
  const done = sim.trade.orders.find((o) => o.starter !== undefined);
  if (done) sim.cancelImport(done.id);
  // Its ribbons go; a junction where it crossed another line goes back to that line's ribbon.
  const ribbon = buildingIdx('ribbon'), crossing = buildingIdx('crossing');
  for (const [x, y] of line) {
    const e = sim.entityAt(x, y);
    if (!e || (e.def !== ribbon && e.def !== crossing)) continue;
    const other = e.def === crossing ? Object.entries(b.lines).find(([r, l]) => r !== 'post.starter' && l.some(([lx, ly]) => lx === x && ly === y)) : undefined;
    const rot = other?.[1].find(([lx, ly]) => lx === x && ly === y)?.[2];
    sim.remove(x, y);
    if (rot !== undefined) sim.placeBelts('ribbon', [[x, y, rot]]);
  }
  // The sorter and its pit go with them (« Les scories » was met there).
  for (const role of ['slagSorter', 'slagPit']) {
    const e = b.ids[role] ? sim.ents.get(b.ids[role]!) : undefined;
    if (e) sim.remove(e.x, e.y);
    delete b.ids[role];
  }
  delete b.lines['post.starter'];
  b.run(EPOCH); // the cargo leaves the post at the next boundary: its entrance takes the ore again
}

/**
 * Two wind turbines on the Crown's windiest spot and next to it (D95: the Sough is read off the land,
 * not guessed): « Tenir la nuit »'s answer (D101), planted there since.
 */
export function crownWind(b: Builder): void {
  const crown = b.windAnchor();
  if (!b.windyWired('wind3', 'wind_flower', crown, 6)) { b.put('wind3', 'wind_flower', b.crown(), { r: 9, onRock: true }); b.wire('wind3'); }
  if (!b.windyWired('wind4', 'wind_flower', crown, 8)) { b.put('wind4', 'wind_flower', b.crown(), { r: 9, onRock: true }); b.wire('wind4'); }
  // A turbine whose line found no way up from the grid of the time: again, now the other's poles stand on the Crown.
  if (b.ids.wind3 && !b.sim.linksOf(b.ids.wind3).length) { b.unskip('wire:wind3'); b.wire('wind3'); }
}

/**
 * « Le quartz de la paroi »'s turbines (D146: its count on the grid, six): after the power top-up,
 * turbines on the Crown's windiest spots left, each wired, until the quest's count holds — as
 * `powerUp` places them (next to the last, the Crown, the open sand round it).
 */
function quartzWind(b: Builder): void {
  const sim = b.sim, o = (QUESTS.wall_quartz as QuestDef).objectives.find((q) => q.k === 'linked');
  if (!o) return;
  const R = (sim.grid.source.crownOuter ?? CIRQUE.crownOuter) + 1;
  for (let k = 1; k <= 8; k++) {
    sim.ensureCompiled();
    if (objectiveProgress(sim, o).met) return;
    const role = `quartzWind${k}`;
    if (!(b.windyWired(role, 'wind_flower', b.windAnchor(), BAL.wind.spacing + 3, WINDY) || b.windyWired(role, 'wind_flower', b.windAnchor(), R, WINDY) || b.windyWired(role, 'wind_flower', [CENTER, CENTER], R + WIDE_WIND, WINDY_OPEN))) break;
  }
}

// ── later on ────────────────────────────────────────────────────────────────

/** Research nodes the grown base learns for real, in order, after Mechanics. */
const GROWN_RESEARCH = ['en_pitch', 'xp_swift'];
/**
 * What its lab runs next when it opens, the first that can start: a Tier 1 node two deep (5 000
 * tokens, D122), which the Core's compute (1 500 a minute with Overclocking) runs in a few minutes;
 * then a first-depth one.
 */
const GROWN_NEXT = ['en2', 'xp_bigsilo', 'cm_floor', 'dn_esmelt', 'ex_fastdrill', 'cm_post2', 'dn3', 'dn_copper', 'ex_brick']; // D123's roots last
/** Game minutes each may take before it is granted instead. */
const RESEARCH_WAIT_MIN = 40;

/**
 * The trade post's exit, as a player sets it up once the tutorial is done: its entrance sells the
 * iron ore led into it (`postLine`: the Heart only piles ore up; owner, 2026-10-13: "the money is
 * drying out, the tradepost is linked to nothing… Just put one output to the tradepost"), and its
 * exit hands out the plates it buys.
 */
export function tradeLine(b: Builder): void {
  const post = b.ids.post;
  if (!post) return;
  // Out: iron plates bought for building, out of its exit along a short ribbon into the Heart
  // (D43: purchases leave the container only by an outlet; D62: its one exit hands out what it
  // bought), so what the post receives is seen going somewhere.
  b.affordAll(b.spare);
  const e = b.sim.ents.get(post)!;
  const outs = worldPorts(e).filter((p) => p.io === 'out');
  let out = lay(b.sim, post, b.H);
  if (!out && b.junctions()) { b.affordAll(b.spare); out = lay(b.sim, post, b.H); }
  let port = out ? outs.find((p) => p.fx === out![0]![0] && p.fy === out![0]![1]) : undefined;
  // An outlet whose front stands beside a router: a junction there first — the router sees
  // through it one way (D42), the outlet's ribbon leaves it the other — then the ribbon on.
  for (const p of out ? [] : outs) {
    if (!besideRoutingBlock(b.sim, p.fx, p.fy) || !b.junctions() && !b.sim.unlocked('junction')) continue;
    b.affordAll(['crossing', 1], b.spare);
    if (!b.sim.place('crossing', p.fx, p.fy, p.dir).ok) continue;
    // Past it, a line already running into the Heart takes the plates in from the side; else a
    // ribbon of their own.
    const bx = p.fx + DX[p.dir]!, by = p.fy + DY[p.dir]!;
    const path = leadsTo(b.sim, bx, by, b.H) ? [] : layFrom(b.sim, [[bx, by]], b.H);
    if (path) { out = [[p.fx, p.fy, p.dir], ...path]; port = p; break; }
    b.sim.remove(p.fx, p.fy);
  }
  if (!out || !port) { b.skip('line:post.out'); return; }
  b.lines['post.out'] = out;
  const ask = b.sim.prices.ask[itemIdx('iron_plate')]!;
  if (typeof b.sim.addImport(post, 'iron_plate', PLATES_PER_MIN, Math.floor((ask * 3) / 2)) !== 'number') b.skip('import:iron_plate');
}

/**
 * A router on an iron ore line and a ribbon onto the stub laid into the post's one entrance when
 * it was placed (`postAtHeart`: the tutorial's lines, ringing the Heart, leave it open; D62).
 */
export function postLine(b: Builder): void {
  const post = b.ids.post;
  if (!post) return;
  const iron = b.laid('iron1', 'iron2'), stub = b.lines['post.stub'], glass = b.lines['post.glass'];
  // Into the side of the glass ribbon already led into it, else onto the stub's tail when it
  // stands (the tile behind it, pointing in), else into the entrance.
  const onto = glass ? sideGoals(b.sim, glass) : stubGoal(b);
  b.affordAll(['router', 1], b.spare);
  let r = iron.length ? branch(b.sim, iron, post, -1, onto) : null;
  if (!r && b.junctions()) { b.affordAll(['router', 1], b.spare); r = branch(b.sim, iron, post, -1, onto); }
  if (r) b.lines['post.in'] = [...r.path, ...(glass ?? stub ?? [])]; else b.skip('line:post');
}

/**
 * The smelter's own iron drill (D101: a drill pair a smelter) cuts more than the smelter takes (11–18
 * ore a minute against 10, D97): an overflow gate on its line sends the rest into the Heart, as a
 * player does once the line backs up — else the drill stands still for minutes on end (D85).
 */
export function ironSurplus(b: Builder): void {
  const line = b.lines.iron2;
  if (!line) return;
  b.affordAll(['router', 1], b.spare);
  let r = branch(b.sim, [line], b.H, -1);
  if (!r && b.junctions()) { b.affordAll(['router', 1], b.spare); r = branch(b.sim, [line], b.H, -1); }
  if (!r) { b.skip('line:iron2.heart'); return; }
  b.lines['iron2.heart'] = r.path;
  // The smelter first, the Heart only what it leaves: an overflow gate where the router went down.
  serveFirst(b, 'iron2.heart', 'overflow_gate');
}

/** Does the ribbon on tile (x, y) run, ribbon after ribbon, into building `to`? */
function leadsTo(sim: Sim, x: number, y: number, to: number): boolean {
  sim.ensureCompiled();
  const g = sim.graph;
  let n: FNode | undefined = g.chainByTile.get(tileIndex(x, y));
  for (let k = 0; n instanceof Chain && k < 64; k++) {
    const e = n.outE[0];
    n = e === undefined ? undefined : g.nodes[g.eDst[e]!];
  }
  return !!n && n.ent === to;
}

/**
 * The plates the debug bases buy (items per minute): enough to show the exit at work, well within
 * what their ore and glass sales bring once CrierBelt has taken its fifth (D64).
 */
const PLATES_PER_MIN = 1;

/**
 * Wind turbines on the Crown's windiest spots (D95) until the grid holds through the next two
 * days — the weather is the world clock's, so the turbines' and the sun's output are known epoch by
 * epoch; fuel generators at what they gave, the Heart's steady core — against the grid's draw: what
 * the base drew over a minute, or most of what its buildings are rated for (a starved machine draws
 * little and would hide the need). A base left short runs every machine slow and starves its lines.
 * The best turbine the claim has learnt, as a player builds: the late base's Great Turbines
 * (`en_bigwind`, among its grants; D132: a calm in the forecast left 40 pitch-control turbines, all
 * the Crown and the open sand held a turbine's room apart, at 83–88 % of the draw). At most `cap`
 * turbines; each next to the last one placed while that stays windy, else at the Crown's windiest
 * spot left, else on the open sand round it.
 */
export function powerUp(b: Builder, cap = 12, margin = 1000, prefix = 'power'): void {
  const sim = b.sim;
  const grid = (): number => sim.graph.netOfEnt.get(b.H) ?? -1;
  let drew = 0, fuel = 0;
  for (let t = 0; t < EPOCH; t += 60) {
    b.run(60);
    const p = sim.netPower[grid()];
    if (p) { drew = Math.max(drew, p.demand); fuel = Math.max(fuel, p.fuel); }
  }
  let rated = 0;
  for (const e of sim.ents.map.values()) if (sim.graph.netOfEnt.get(e.id) === grid()) rated += buildingDef(e.def).kw ?? 0;
  const need = Math.floor((Math.max(drew, Math.floor((rated * 85) / 100)) * margin) / 1000);
  sim.ensureCompiled();
  // The next two days' weather, and what the grid's producers give in each epoch of it.
  const ws = Array.from({ length: 2 * DAY_EPOCHS }, (_, k) => weatherAt(sim.absEpoch() + k, sim.worldSeed, sim.mods));
  const supply = ws.map(() => fuel);
  for (const p of sim.graph.nets[grid()]?.producers ?? []) ws.forEach((w, k) => { supply[k] = supply[k]! + producerKw(p, w); });
  const low = (): number => Math.min(...supply);
  // The best turbine the claim can build (the Pitch-Control Turbine once researched, D70; the Great
  // Turbine once that is). A turbine out of the zone comes by kite: count what it will give from where it stands.
  const turbine = ['big_turbine', 'pitch_turbine', 'wind_flower'].find((t) => sim.unlocked(buildingDef(buildingIdx(t)).unlock)) ?? 'wind_flower';
  const g = buildingDef(buildingIdx(turbine)).gen!;
  const kw = Math.floor((g.kw * sim.mods.windOut * sim.mods.genOut) / 1e6);
  let near = b.windAnchor(turbine);
  const R = (sim.grid.source.crownOuter ?? CIRQUE.crownOuter) + 1;
  // Next to the last one, a turbine's room away (D132: `BAL.wind.spacing`); else the Crown's windiest
  // spot left; else the open sand round it on the claim's land (map 4's, D94), a little less windy.
  const step = BAL.wind.spacing + 3;
  for (let k = 0; k < cap && low() < need; k++) {
    const role = `${prefix}${k + 1}`;
    const id = b.windyWired(role, turbine, near, step, WINDY) || b.windyWired(role, turbine, b.windAnchor(turbine), R, WINDY) || b.windyWired(role, turbine, [CENTER, CENTER], R + WIDE_WIND, WINDY_OPEN);
    if (!id) break; // the windy spots all taken: what stands must do
    const e = sim.ents.get(id)!, local = windSite(sim.grid, sim.worldSeed, e);
    near = [e.x, e.y];
    ws.forEach((w, j) => { supply[j] = supply[j]! + windKw(kw, g.wind!, local, w); });
  }
  // The kites land (turbines off the claim's land come by kite; the late base's all stand on it).
  if (cap <= 12 || [...sim.ents.map.values()].some((e) => e.builtAt > sim.tick)) b.run(EPOCH);
}

/** A debug base's turbines stand where the exposure is at least this (‰, D95): never in a lee. */
const WINDY = 1200;
/** Past the Crown (D132: fewer turbines fit on it, a turbine's room apart): this much farther out, on open ground at least this windy (‰). */
const WIDE_WIND = 18, WINDY_OPEN = 1000;

/** Every plan; a second coal drill on the coal line; Mechanics, Overclocking and a few nodes learnt for real (their resources from the Core, their tokens its compute's, D122); a gear press and a silo off the plate and glass lines. */
function grown(b: Builder): void {
  const sim = b.sim;
  // « Les pièces de la Synthèse » (D90), the quest the tutorial level leaves current: completed by force —
  // its circuit workshop and press take lines off the tutorial level's crowded core, which not every
  // land leaves room to lay by script (quests.test.ts plays it with real commands).
  b.until('synth_parts', 0);
  learnPlans(sim);
  // More coal for both smelters, where the deposit has room: a drill joining the coal line.
  b.optional(() => { if (b.source('coal2', 'drill', b.centre('coal'), 'coal', { item: 'coal', r: 30 })) b.wire('coal2'); });
  // Research, one node after another in the observatory, for real: time runs until the node is
  // learnt; past the wait it is granted (reported).
  const learn = (id: string): void => {
    const begun = (): boolean => sim.done.has(id) || sim.projects.some((p) => p.id === id) || (b.affordNode(id), sim.startResearch(id).ok);
    // One lab, one project: what it runs already (the tutorial level's next node) finishes first.
    for (let t = 0; t < RESEARCH_WAIT_MIN * EPOCH && sim.projects.length && !begun(); t += EPOCH) b.run(EPOCH);
    if (!begun()) { b.grantNode(id); return; }
    for (let t = 0; t < RESEARCH_WAIT_MIN * EPOCH && !sim.done.has(id); t += EPOCH) b.run(EPOCH);
    if (!sim.done.has(id)) b.grantNode(id);
  };
  learn('tr1');
  // Overclocking (D122: it brought the data collector until then): the Core's compute raised.
  learn('an_data');
  for (const id of GROWN_RESEARCH) learn(id);
  // Gears (Mechanics' recipe, the press) off a plate line, into the Heart; a silo off a glass line (a
  // store its outlets empty, D34). Both near their line only (`far` off): on lands 1–3 the plate line
  // is too short to branch, and a press or a silo 20 tiles off a line is not where a player puts one —
  // the wide search found none and cost the grown and late builds a tenth of a second each (D132).
  const plates = b.laid('plates'), glass = b.laid('glass');
  b.fed('gears', 'press', b.middle('plates'), [plates.length ? { lines: plates } : 0], b.H, 'gears.out', false);
  b.recipe('gears', 'gear');
  // Plates only down the branch (D125): what slag passes the tutorial's sorter goes on to the Heart.
  if (b.ids.gears) filterFeed(sim, b.ids.gears, 'iron_plate');
  b.wire('gears');
  // A silo of glass off its line: an extra since D117 retired the unloaders that drew from it (D34);
  // by the line's middle, else by the glass smelter, else left out (D114: where the steam boiler's
  // coal drill took a corner of the deposit, the base's later drills move and can take its room).
  b.optional(() => b.fed('silo', 'silo', b.middle('glass'), [glass.length ? { lines: glass } : 0], null, undefined, false)
    || (glass.length && b.ids.kiln2 ? b.fed('silo', 'silo', b.centre('kiln2'), [{ lines: glass }], null, undefined, false) : 0));
  // Every cirque deposit covered as far as its lines carry (D82, D85).
  mineCirque(b);
  // The assembly bench (D129: Tier 1's, the electronics workshop is Tier 2's) on copper coils, off the
  // wire line and a plate line — the post's outlet of bought plates, the tutorial smelter's or one of
  // the cirque's smelters' (plates only down that branch, D125) —, its coils into the Heart: what the
  // Core's level 3 is paid in, as motors. Near the wire line, else left out (an extra): on lands 1–3
  // today the plate lines into the Heart are three or four tiles, too short to branch, as for the
  // gear press above — the tutorial's scripted run lays it (quests.test.ts).
  const wire = b.laid('wire', 'osc.in1'), anyPlates = b.laid('post.out', 'plates', 'plates.s1', 'plates.s2', 'plates.s3');
  if (wire.length && anyPlates.length && b.optional(() => b.fed('bench', 'assembly_bench', b.middle('wire'), [{ lines: wire }, { lines: anyPlates }], b.H, 'bench.out', false))) {
    filterFeed(sim, b.ids.bench!, 'iron_plate', anyPlates);
    b.recipe('bench', 'copper_coil');
    b.wire('bench');
  }
  // The lab on its next node: a grown base's lab never stands idle (D85).
  const lab = b.ids.observatory;
  if (lab && !sim.projects.some((p) => p.lab === lab) && !GROWN_NEXT.some((id) => { b.affordNode(id); return sim.researchBlock(id) === null && sim.startResearch(id, lab).ok; })) b.skip('research:next');
  b.run(2 * EPOCH);
}

/**
 * Research the late base is given outside the commands, prerequisites first (owner, 2026-10-13:
 * "make the late game bases saves even more advanced, using a lot of the tech tree"; 2026-10-14:
 * "actuellement elle n'est pas tres avancée"): the old trunk (D128: shared out among the
 * categories — Land Registry and its pylons, the second desk, Optics and Resonance; the third
 * desk's Computing waits for the Servers, whose Research Queue the first lab researches for real); Extraction through Excavation to Deep Fill, and the Deep Bore (Drilling) its far mines need; Machines through both specialities (the etcher
 * makes its servomotors, the assembly tower stands ready); Energy through Power Plants to the
 * Sunheart; Expansion through Claims to the Far Claim (its works stand on parcels far from the
 * claim's land); Commerce to The Crier House (D108: the Ember Fields' embersalt is sold at a third
 * post beside the mine, no skydock to fly it home; its second post with « Second comptoir », D107);
 * Analytics to the servers (D68–D70). Most of the tree's research nodes, one more under way in the
 * first lab and one in the Fabrique's (D122: on tokens, their resources from the Core).
 */
const LATE_RESEARCH = ['tr2', 'tr4', 'tr5', 'tr8', 'ex5', 'ex8', 'xp_far', 'dn_etcher', 'dn8', 'enK', 'cmK', 'cm_autosell', 'an_servers'];
/**
 * What its first lab researches for real (a depth-4 node): its resources from the Core, its tokens
 * from the Core's compute, its servers and the flow the launch dialog would propose (D118, D122).
 */
const SURVEY_PROJECT = 'an_queue';
/**
 * What the Fabrique's lab researches for real beside it (D122): Robotics, a Tier 3 node the granted
 * research leaves (D128: the Solar Farm until then, granted now with the Sunheart, whose Great Power
 * Plants wait for the Power Plants finished), hours on the flow the launch dialog proposes — the
 * free flows go to the oldest project first.
 */
const ADVANCED_PROJECT = 'dn7';
/** Servers by the Heart (D68, D118): the research's tokens from the base's own power, a flow bought on top. */
const LATE_SERVERS = 2;
/** The late base's wind sized this much above its draw (‰): its servers draw full power day and night. */
const LATE_POWER_MARGIN = 1150;
/** What the late base's purse holds when it opens (centi-ocelles): its standing orders buy a few minutes' worth ahead. */
const LATE_PURSE = 2_000_000;
/**
 * The late base's turbines at most (`powerUp`): the far works draw megawatts. Great Turbines since
 * D132 (its forecast's calm, a sixth of the rated wind for twenty minutes, asks 9–24 of them on lands 1–3).
 */
const LATE_TURBINES = 40;

/**
 * Research granted, the Heart to level 5 (D118: Tier 4 opens there); the far works first (the Ember Fields mine, the
 * Fabrique: its purchases are twenty minutes away); an excavator on marked rock, land past the
 * Crown and a drill there whose ore climbs over it; a swift line with a bridge pair; then the
 * advanced part.
 */
function late(b: Builder): void {
  const sim = b.sim;
  // Deep research takes hours of science: granted, prerequisites first (not a command: this log no longer replays).
  for (const id of LATE_RESEARCH) b.grantNode(id);
  // The Heart up to its last level, 5 (commands; their materials granted if short): each opens a tier (D118).
  for (let k = 0; k < BAL.hearthUpgrades.length; k++) {
    const up = BAL.hearthUpgrades[sim.hearthLevel - 1];
    if (!up) break;
    b.afford(up.cost);
    if (!sim.upgradeHearth().ok) { b.skip(`hearth:${sim.hearthLevel + 1}`); break; }
  }
  // D123's works (scenario-basics.ts): the brickworks by the water, the steel line where an iron and
  // a coal line meet — before the late works take the floor and the shores.
  basicsWorks(b);
  // The far works first (scenario-late.ts): the Fabrique's purchases are twenty minutes away, and
  // the rest of the build runs meanwhile; the Ember Fields mine and its post, where the land has the site.
  if (emberSite(sim)) emberMine(b);
  fabrique(b);
  // The purse topped up for its purchases (a late base has the ocelles to buy with; the land bought
  // for the works left it bare), before the first lift: its orders buy in full.
  if (sim.credits < LATE_PURSE) sim.grantCredits(LATE_PURSE - sim.credits);
  // On until its first purchases land (the rest is built after, on a smaller base to run): the
  // base opens with its works running.
  const post = b.ids.post2;
  if (post) {
    const due = (): number => Math.min(...sim.trade.inflight.filter((f) => f.post === post).map((f) => f.arrive));
    if (!Number.isFinite(due())) b.run(EPOCH); // its first lift
    const at = due();
    if (Number.isFinite(at)) b.run(Math.min(Math.max(0, at - sim.tick), FABRIQUE_WARM_MAX));
  }
  excavate(b);
  b.optional(() => surplus(b));
  // The potteries on the tarn's peak (the spring's on map 4), their ceramic down into the Core:
  // before the far deposit's climb, which would otherwise take the dry peak's slopes (D115) and
  // fence the oven in; the climb finds its way round them.
  potteries(b);
  // The deposit nearest past the Crown, its parcels bought (when the starting square does not
  // hold them already): a drill on it, its ore over the Crown on traction ribbons.
  const far = farDeposit(b);
  if (far) { b.landAround(far.at, 10); b.optional(() => overCrown(b, far)); }
  b.optional(() => swiftPlates(b));
  advanced(b);
  expertises(b);
  autoSell(b);
}

/**
 * Auto-sell (D127) on the late base's most plentiful item, at this share of what the Core holds of it
 * (‰, in hundreds): it sells at once and then what comes beyond — the Stock's mark mid-way along what
 * it holds, its line and the purse's « Vente automatique » there from the first minutes.
 */
const LATE_AUTOSELL_SHARE = 500;

/** The Core's most plentiful tradable item sold beyond half of what it holds (a command). */
function autoSell(b: Builder): void {
  const sim = b.sim;
  const top = [...tradables()].sort((x, y) => sim.stock[y]! - sim.stock[x]! || x - y)[0];
  if (top === undefined) { b.skip('autosell'); return; }
  const n = Math.floor((sim.stock[top]! * LATE_AUTOSELL_SHARE) / 1000 / 1000 / 100) * 100;
  const at = Math.max(BAL.autoSell.min, Math.min(autoSellMax(sim), n));
  if (!sim.setAutoSell(ITEM_IDS[top]!, at)) b.skip('autosell');
}

/**
 * The expertises the late base holds (D93), in this order of preference among those its feats have
 * earned: Estate (its parcels: land cheaper), Methods (its machines: Machines research faster), then
 * research ones — none changes what its lines carry, so D85's checks hold as before.
 */
const LATE_EXPERTISES = ['estate', 'methods', 'power_eng', 'haulage', 'trading'];

/** Choose two earned expertises at the Archive (commands); a level short of two is reported. */
function expertises(b: Builder): void {
  const sim = b.sim;
  // The ranks as the last minute's boundary read them: no time run for this (the build's CPU budget).
  const earned = LATE_EXPERTISES.filter((id) => (sim.expertise.ranks.get(id) ?? 0) > 0);
  for (let slot = 0; slot < sim.expertise.slots.length; slot++) {
    const id = earned[slot];
    if (!id || sim.chooseExpertise(slot, id)) b.skip(`expertise:${slot}`);
  }
}

/**
 * The late base's advanced part (each piece skipped, and reported, where the map does not allow
 * it): solar panels and accumulators; the first observatory's next
 * project; the cirque's lines served in order; then the rest of the works (scenario-late.ts): the
 * coal pit where the cirque is short of coal (its coal back over the Crown), the Fabrique's research
 * lab on its project, a geothermal plant on a vent (the potteries come before, in `late`); the longest plain line upgraded to express ribbons; and time until
 * the Fabrique's first purchases land.
 */
function advanced(b: Builder): void {
  const sim = b.sim;
  // Solar panels and accumulators for the night, and a deep bore on the coal deposit's free part.
  b.optional(() => solarField(b));
  b.optional(() => coalBore(b));
  // Servers: the research's tokens out of the base's own power (D68).
  b.optional(() => { for (let k = 1; k <= LATE_SERVERS; k++) { b.affordDef('server'); b.put(`server${k}`, 'server', b.quietSide(8), { r: 14 }); b.wire(`server${k}`); } });
  // The first lab's next project, its resources from the Core; its tokens from the Core's compute,
  // the servers and the flow the launch dialog proposes (D118, D122).
  sim.ensureCompiled();
  b.affordNode(SURVEY_PROJECT);
  if (b.ids.observatory && !sim.startResearch(SURVEY_PROJECT, b.ids.observatory, sim.tokenBuyDefault(SURVEY_PROJECT)).ok) b.skip(`research:${SURVEY_PROJECT}`);
  // The cirque's plates are short (its ore shared with the Heart and the post): the plate smelter
  // served first off the ore lines. The coal is shared evenly by the two smelters (the router
  // stays): on a land with one coal drill, the glass smelter served last stood cold.
  // (Since D101 the plate smelter has its own drill, served first by its overflow gate: `ironSurplus`.)
  if (b.lines['kiln1.in0']) serveFirst(b, 'kiln1.in0');
  b.optional(() => farCopper(b));
  // The cirque short of coal (one drill left on its deposit): coal from a pit past the Crown, back over it.
  coalPit(b, sim.grid.source.crownOuter ?? CIRQUE.crownOuter);
  // The Fabrique's lab on its own node (D122: its resources from the Core, its tokens bought).
  if (b.ids.observatory2 && !sim.done.has(ADVANCED_PROJECT)) b.affordNode(ADVANCED_PROJECT);
  if (b.ids.observatory2 && !sim.done.has(ADVANCED_PROJECT) && !sim.startResearch(ADVANCED_PROJECT, b.ids.observatory2, sim.tokenBuyDefault(ADVANCED_PROJECT)).ok) b.skip(`research:${ADVANCED_PROJECT}`);
  // A geothermal plant where the land has a vent: power day and night for the far works.
  b.optional(() => geothermal(b));
  // The longest plain line left, upgraded to express ribbons.
  b.optional(() => expressLine(b));
  // Its lines out in the open desert under glass (D103), before the kites are waited for.
  b.optional(() => glaze(b));
  // The land bought for the other works paid, the purse topped up again.
  if (sim.credits < LATE_PURSE) sim.grantCredits(LATE_PURSE - sim.credits);
  waitKites(b);
  // The base opens: the potteries dig.
  for (const f of b.later.splice(0)) f();
}

/**
 * The late base's lines out in the open desert under glass (D103): every plain ribbon tile the
 * Gleaners reach becomes a glazed ribbon (as fast; its glass granted where short — off the claim's
 * land a ribbon costs thrice, and a kite brings it). Its swift and traction pieces out there stay as
 * they are: a few things still go by night, and the morning report has something to say.
 */
function glaze(b: Builder): void {
  const sim = b.sim;
  sim.ensureCompiled();
  const plain = buildingIdx('ribbon');
  const tiles = [...sim.graph.glean.exposed].filter((t) => sim.ents.get(sim.grid.occ[t]!)?.def === plain);
  for (const t of tiles) {
    const e = sim.ents.get(sim.grid.occ[t]!)!;
    const chk = sim.canPlace('glazed_ribbon', e.x, e.y, e.rot);
    b.afford(chk.cost.map((c) => [ITEM_IDS[c.item]!, Math.ceil(c.mu / 1000)] as const));
    if (!sim.place('glazed_ribbon', e.x, e.y, e.rot).ok) b.skip(`glaze:${e.x},${e.y}`);
  }
}

/**
 * The far copper (over the Crown, into the Heart) into the cirque's wire mill, its thin deposit's
 * drill taken up (2.5 ore a minute: the mill stood starved): a branch off the climb's line, served
 * first, the rest on into the Heart.
 */
function farCopper(b: Builder): boolean {
  const sim = b.sim, climb = b.lines['overCrown'], mill = b.ids.mill, cu = b.ids.copper ? sim.ents.get(b.ids.copper) : undefined;
  const far = b.ids.farDrill ? sim.ents.get(b.ids.farDrill) : undefined;
  if (!climb || !mill || !cu || !far || sim.grid.ore(far.x, far.y) !== itemIdx('copper_ore')) { b.skip('farCopper'); return false; }
  // Its line's own ribbons only: a junction on it carries another line across (the post's).
  const ribbon = buildingIdx('ribbon');
  const thin = (b.lines['copper'] ?? []).filter(([x, y, r]) => { const e = sim.entityAt(x, y); return e?.def === ribbon && e.rot === r; });
  const { x: cx, y: cy, rot: cr } = cu;
  for (const [x, y] of thin) sim.remove(x, y);
  sim.remove(cx, cy);
  b.affordAll(['router', 1], b.spare);
  const r = branch(sim, [climb], mill);
  if (!r) {
    // Put the thin drill and its line back as they were, under its role and on the grid again
    // (D104's layout made this path run on land 2: it stood unwired, idle).
    b.affordAll(['drill', 1]);
    b.afford([['iron_plate', thin.length]]);
    const back = sim.place('drill', cx, cy, cr);
    sim.placeBelts('ribbon', thin);
    if (back.ok) { b.ids.copper = back.id!; b.wire('copper'); } else delete b.ids.copper;
    b.skip('farCopper');
    return false;
  }
  delete b.ids.copper;
  b.lines['copper'] = r.path;
  // The cirque's copper drills joined the thin line just taken up (D82): onto the new one, or up (D85).
  reattach(b, 'copper.', 'copper');
  serveFirst(b, 'copper');
  return true;
}

/**
 * The router a branch line starts beside, made a gate: an underflow gate serves the branch first
 * (the rest on), an overflow gate the line on first (the branch takes what it leaves).
 */
function serveFirst(b: Builder, line: string, gate: 'underflow_gate' | 'overflow_gate' = 'underflow_gate'): void {
  const sim = b.sim, start = b.lines[line]?.[0];
  const router = buildingIdx('router');
  for (let d = 0; d < 4 && start; d++) {
    const e = sim.entityAt(start[0] + DX[d]!, start[1] + DY[d]!);
    if (e?.def !== router) continue;
    b.affordDef(gate);
    if (sim.place(gate, e.x, e.y, e.rot).ok) return;
  }
  b.skip(`serveFirst:${line}`);
}

/** A deep bore on the coal deposit's free part, joining the coal line (its second outlet feeds the glass of the advanced industry). */
function coalBore(b: Builder): void {
  if (b.optional(() => b.source('coalBore', 'deep_bore', b.deposit('coal'), 'coal', { item: 'coal', r: 8 }))) b.wire('coalBore');
}

/** Four solar panels and two accumulators on the quiet side, wired. */
function solarField(b: Builder): void {
  const at = b.quietSide(14, 1);
  for (let k = 0; k < 4; k++) if (b.put(`solar${k + 1}`, 'sun_bulb', at, { r: 8 })) b.wire(`solar${k + 1}`);
  for (let k = 0; k < 2; k++) if (b.put(`acc${k + 1}`, 'accumulator', at, { r: 9 })) b.wire(`acc${k + 1}`);
}

/** The longest line still of plain ribbons (not the climb, not the swift one) upgraded to express ribbons (D24: laid over). */
function expressLine(b: Builder): void {
  const sim = b.sim;
  const ribbon = buildingIdx('ribbon');
  const plain = (l: BeltTiles): boolean => l.every(([x, y]) => sim.ents.get(sim.grid.occ[tileIndex(x, y)]!)?.def === ribbon);
  const line = Object.entries(b.lines).filter(([role]) => role !== 'overCrown').map(([, l]) => l).filter(plain).sort((p, q) => q.length - p.length)[0];
  if (!line || line.length < 6) { b.skip('express'); return; }
  b.afford([['iron_plate', line.length + 4], ['gear', line.length + 4], ['circuit', line.length + 4]]);
  if (sim.placeBelts('express_ribbon', line) <= 0) b.skip('express');
}

/** The deposit nearest the Heart past the Crown (the floor beyond its foot): where the far drill goes. */
function farDeposit(b: Builder): { at: [number, number]; item: string } | null {
  const sim = b.sim, R = 46;
  let best: { at: [number, number]; item: string; d: number } | null = null;
  for (let y = CENTER - R; y <= CENTER + R; y++) {
    for (let x = CENTER - R; x <= CENTER + R; x++) {
      const dx = x - CENTER, dy = y - CENTER, d = dx * dx + dy * dy;
      if (d <= (CIRQUE.crownOuter + 1) ** 2 || d > R * R || (best && d >= best.d)) continue;
      const ore = sim.grid.ore(x, y);
      if (ore < 0 || !isFloor(sim.grid.terrain(x, y)) || sim.grid.level(x, y) !== 0) continue;
      // Past the Crown: rock lies between it and the Heart.
      let rock = false;
      for (let k = 1; k < 10 && !rock; k++) { const [px, py] = toward([x, y], b.heart, k * 2); rock = isRock(sim.grid.terrain(px, py)); }
      if (rock) best = { at: [x, y], item: ITEM_IDS[ore]!, d };
    }
  }
  return best ? { at: best.at, item: best.item } : null;
}

/**
 * A drill on the far deposit (its parcels the claim's), its power on poles climbing the Crown
 * terrace by terrace (`powerLine`), its ore over the Crown into the Heart: up and down on traction
 * ribbons, one level a tile (D45; `routeOver`). Ribbons off the claim's land arrive by kite.
 */
function overCrown(b: Builder, far: { at: [number, number]; item: string }): void {
  const sim = b.sim;
  const id = b.put('farDrill', 'drill', far.at, { item: far.item, r: 6, toward: b.heart });
  if (!id) return;
  b.run(Math.max(0, (sim.ents.get(id)?.builtAt ?? 0) - sim.tick) + 10);
  b.wire('farDrill');
  const out = worldPorts(sim.ents.get(id)!).find((p) => p.io === 'out');
  if (!out) { b.skip('farDrill:port'); return; }
  // Into the Heart; when its free inlets are boxed in by the lines around it, into a silo set at
  // the Crown's inner foot on the drill's side (the climb is the point).
  const inlets = (ent: number): Map<number, Rot> => {
    const goals = new Map<number, Rot>();
    for (const p of worldPorts(sim.ents.get(ent)!)) {
      if (p.io === 'in' && inWorld(p.fx, p.fy) && sim.grid.occ[tileIndex(p.fx, p.fy)] === 0) goals.set(tileIndex(p.fx, p.fy), opposite(p.dir));
    }
    return goals;
  };
  let path = routeOver(sim, [out.fx, out.fy], inlets(b.H));
  if (!path) {
    const foot = toward(b.heart, far.at, CIRQUE.floorRadius - 3);
    const silo = b.put('farSilo', 'silo', foot, { r: 6, toward: far.at });
    if (silo) path = routeOver(sim, [out.fx, out.fy], inlets(silo));
  }
  if (!path) { b.skip('line:overCrown'); return; }
  const lifts = path.filter((p) => p[3] === 'traction_ribbon').length;
  b.afford([['iron_plate', 3 * 2 * lifts + 20], ['copper_wire', 3 * lifts + 10]]); // ×3 outside the zones
  for (let i = 0; i < path.length;) {
    let j = i;
    while (j + 1 < path.length && path[j + 1]![3] === path[i]![3]) j++;
    const run: BeltTiles = path.slice(i, j + 1).map(([x, y, r]) => [x, y, r]);
    if (sim.placeBelts(path[i]![3], run) !== run.length) { b.skip('line:overCrown'); return; }
    i = j + 1;
  }
  b.lines['overCrown'] = path.map(([x, y, r]) => [x, y, r]);
  // A silo's ore is sold, not piled up: its outlet into the side of the line led into the trade post.
  const sell = b.laid('post.in')[0];
  if (b.ids.farSilo && sell) {
    b.crossings();
    const l = join(sim, b.ids.farSilo, sell);
    if (l) b.lines['farSilo.out'] = l; else b.skip('line:farSilo');
  }
  // The kites bring the far squares: wait for the last.
  let last = 0;
  for (const [x, y] of path) last = Math.max(last, sim.ents.get(sim.grid.occ[tileIndex(x, y)]!)?.builtAt ?? 0);
  b.run(Math.max(0, last - sim.tick) + 10);
}

/**
 * The excavator's stone line, with an overflow gate set into it: straight on into the Heart, and
 * to its side an incinerator once the Heart can take no more stone (D51) — the dig never stops.
 */
function surplus(b: Builder): void {
  const sim = b.sim, line = b.lines['excavator'];
  if (!line || line.length < 4) { b.skip('surplus'); return; }
  const avoid = keepOff(sim);
  const freeAt = (x: number, y: number): boolean =>
    inWorld(x, y) && sim.grid.occ[tileIndex(x, y)] === 0 && isFloor(sim.grid.terrain(x, y)) && !avoid.has(tileIndex(x, y));
  for (let k = 1; k < line.length - 2; k++) {
    const [x, y, r] = line[k]!;
    const at = sim.ents.get(sim.grid.occ[tileIndex(x, y)]!);
    if (!at || buildingDef(at.def).kind !== 'belt') continue;
    const sides = [((r + 1) & 3) as Rot, ((r + 3) & 3) as Rot];
    if (!sides.every((d) => freeAt(x + DX[d]!, y + DY[d]!))) continue; // its only way to the side: the incinerator
    b.affordAll(['overflow_gate', 1], ['incinerator', 1]);
    const g = sim.place('overflow_gate', x, y, r);
    if (!g.ok) continue;
    const d = sides[0]!;
    const inc = sim.place('incinerator', x + DX[d]!, y + DY[d]!, 0);
    if (!inc.ok) { sim.remove(x, y); continue; }
    b.ids.gate = g.id!;
    b.ids.incinerator = inc.id!;
    return;
  }
  b.skip('surplus');
}

/** The base's longest line upgraded to swift ribbons (D24: laid over), and a bridge pair leaping two of its tiles. */
function swiftPlates(b: Builder): void {
  const sim = b.sim;
  // The longest line of plain ribbons laid in the cirque, on one level (the far line and the
  // potteries' stone climb: their traction ribbons stay, and a bridge's far end cannot hand on up a
  // step — once the lab stood unfed, D122, such a climbing line could come out the longest).
  const flat = (l: BeltTiles): boolean => l.every(([x, y]) => sim.grid.level(x, y) === sim.grid.level(l[0]![0], l[0]![1]));
  const line = Object.entries(b.lines).filter(([role, l]) => role !== 'overCrown' && l.length && flat(l)).map(([, l]) => l).sort((p, q) => q.length - p.length)[0];
  if (!line || line.length < 6) { b.skip('swift'); return; }
  b.afford([['iron_plate', line.length + 6], ['gear', line.length + 6]]);
  if (sim.placeBelts('swift_ribbon', line) <= 0) { b.skip('swift'); return; }
  sim.ensureCompiled();
  const kind = (x: number, y: number): string | null => { const e = sim.ents.get(sim.grid.occ[tileIndex(x, y)]!); return e ? (buildingDef(e.def).kind as string) : null; };
  // Fed from straight behind only: by the compiled graph, and by what stands round it — a ribbon
  // pointing into its side, or a building's outlet facing it (D129: on land 2 a pipe line joining the
  // steel line from the side was left ending at a bridge's flank, the graph's feeds not showing it).
  const sideFed = (x: number, y: number, r: Rot): boolean => [0, 1, 2, 3].some((d) => {
    if (d === opposite(r)) return false;
    const nx = x + DX[d]!, ny = y + DY[d]!, o = sim.entityAt(nx, ny);
    if (!o) return false;
    if (BUILDING_KIND[o.def] === 'belt') return o.rot === opposite(d as Rot);
    // A routing block deals round it (no fixed ports): D139's sorter on a pipe line's last tile.
    if (BUILDING_KIND[o.def] === 'fork') return true;
    return worldPorts(o).some((p) => p.io === 'out' && p.fx === x && p.fy === y);
  });
  const straight = (x: number, y: number, r: Rot): boolean => (sim.graph.feedDirs.get(tileIndex(x, y)) ?? 0) === 1 << opposite(r) && !sideFed(x, y, r);
  for (let i = 0; i + 3 < line.length; i++) {
    const run = line.slice(i, i + 4);
    const r = run[0]![2];
    if (!run.every(([x, y, d]) => d === r && kind(x, y) === 'belt')) continue;
    // The two leapt tiles take only the line itself (no join, no branch): they can go. The first
    // bridge is entered from straight behind only (D55: a line turning into it there ends at its side).
    if (!run.slice(0, 3).every(([x, y]) => straight(x, y, r))) continue;
    // The far bridge takes the span only: a line joining its flank would end there.
    if (sideFed(run[3]![0], run[3]![1], r)) continue;
    b.afford([['iron_plate', 4]]);
    if (!sim.place('skybridge', run[0]![0], run[0]![1], r).ok || !sim.place('skybridge', run[3]![0], run[3]![1], r).ok) continue;
    sim.remove(run[1]![0], run[1]![1]);
    sim.remove(run[2]![0], run[2]![1]);
    b.ids.bridgeA = sim.grid.occ[tileIndex(run[0]![0], run[0]![1])]!;
    return;
  }
  b.skip('bridge');
}

/** An excavator inside the zone within reach of the nearest soft rock, the rock around it marked, its stone into the Heart. */
function excavate(b: Builder): void {
  const sim = b.sim, R = 40;
  const rocks: Array<[number, number, number]> = [];
  for (let y = CENTER - R; y <= CENTER + R; y++) {
    for (let x = CENTER - R; x <= CENTER + R; x++) {
      if (sim.grid.terrain(x, y) !== T.Rock1) continue;
      rocks.push([x, y, (x - CENTER) * (x - CENTER) + (y - CENTER) * (y - CENTER)]);
    }
  }
  if (!rocks.length) { b.skip('excavator:rock'); return; }
  // The soft rock nearest the Heart first (ties: smallest y, then x), then the next ones at least
  // six tiles from those tried: the cirque worked to the full (D82) may leave no room at the first.
  rocks.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
  const tried: Array<[number, number]> = [];
  // It digs what it touches and the next row (D54): it stands against the rock, its line into the
  // Heart — or, the Heart's sides all taken by the cirque's lines, joining a line that takes
  // anything: the trade post's entrance line (stone sells), the glass line (the Heart, the silo).
  const intos: Array<number | string> = [b.H, ...['post.in', 'glass'].filter((r) => b.lines[r])];
  // The rock within its reach it may dig (as the jobs measure it: from its footprint's edge, D54;
  // free rock — a turbine or a pole may stand on some — and no vein face, D87).
  const reachable = (id: number): number[] => {
    const e = sim.ents.get(id)!;
    const [w, h] = footprint(e.def, e.rot);
    const reach = BAL.digReach, tiles: number[] = [];
    for (let y = e.y - reach; y < e.y + h + reach; y++) {
      for (let x = e.x - reach; x < e.x + w + reach; x++) {
        if (isRock(sim.grid.terrain(x, y)) && inReach(e, x, y) && sim.grid.occ[tileIndex(x, y)] === 0 && !isFaceOre(sim.grid.ore(x, y))) tiles.push(tileIndex(x, y));
      }
    }
    return tiles;
  };
  let placed = false;
  for (const [rx, ry] of rocks) {
    if (tried.length >= 8) break;
    if (tried.some(([tx, ty]) => (tx - rx) * (tx - rx) + (ty - ry) * (ty - ry) < 36)) continue;
    tried.push([rx, ry]);
    const near = toward([rx, ry], b.heart, 3);
    const cp = checkpoint(sim);
    if (!intos.some((into) => b.optional(() => b.source('excavator', 'excavator', near, into, { r: 4 })))) continue;
    if (reachable(b.ids.excavator!).length) { placed = true; break; }
    // The spot found leaves no free rock in its reach (D104's obstacles, turbines on the rock):
    // taken back up with its line, and the next rock tried.
    rollback(sim, cp);
    delete b.ids.excavator;
    delete b.lines.excavator;
  }
  if (!placed) { b.skip('excavator'); return; }
  b.wire('excavator');
  // The rock within its reach marked.
  if (!sim.designate(reachable(b.ids.excavator!), true)) b.skip('designate');
}
