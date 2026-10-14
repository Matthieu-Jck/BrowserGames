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
//   smelter   quests 0–2: two iron drills into the Heart, wired, telemetry → at « La fonderie »
//   survey    quests 0–5: + the smelter (a router splits the second iron line), the coal, two
//             wind turbines, the workshop, the glass smelter (two sand collectors; a router
//             shares the coal) → at « Données d'arpentage »
//   tutorial  all twelve quests: + survey data into the observatory (Mechanics under way), the
//             trade post (glass for its quest, then an iron ore line in: its stream; and an
//             outlet set to iron plates, a short ribbon from it into the Heart, fed by a small
//             import order: what the base builds with), the copper line, a beacon past the
//             Crown, more wind and a coal generator — the whole tutorial factory running
//   grown     later on: every plan of the tree, Mechanics and a few research nodes learnt for
//             real, a gear workshop, a silo
//   late      the grown base with the deep research granted outside the commands (so its log
//             does not replay to it: `report.granted`): an excavator on marked rock (its stone line
//             with an overflow gate onto an incinerator), the parcels by a deposit past the Crown
//             bought, a drill on it whose ore climbs over the Crown on traction ribbons into the
//             Heart (its poles climbing terrace by terrace), two skydocks with drifters on a plate
//             route, the plate line upgraded to swift ribbons with a bridge pair leaping two of its
//             tiles (owner, 2026-10-13: "improve the late stage debug save to have more of the
//             features we developed, such as the ribbons that can go up mountains"); then the
//             advanced part (`advanced`: "make the late game bases even more advanced, using a lot
//             of the tech tree"): the Heart at level 4, solar panels, the cirque's plates served
//             first, the far copper into its mill, and the outer works on the plain (`outerWorks`)
//
// Each level is founded at sunrise (`scenarioEpoch`) so its build runs in full sun: the early
// base's power is the Heart's panel. From the tutorial level on, a level ends with its power
// topped up (`powerUp`: wind until the night's draw is covered) and the base must pay its way:
// money that grows, machines that run (scenarios.test.ts checks both, owner 2026-10-13). Building one takes tens of milliseconds to a few hundred
// (the scenario test measures them); the shell keeps the player's own base aside meanwhile
// (src/app/debug-session.ts).
import { buildingDef, buildingIdx, ITEM_IDS, itemIdx } from '@/content/registry';
import { BAL } from '@/content/balance';
import { QUEST_IDS, type QuestId } from '@/content/quests';
import { planDef, researchNode, treePrereq } from '@/content/research';
import { CIRQUE, WORLD_SEED } from '@/content/world';
import { CENTER, DAY_EPOCHS, EPOCH, PERMILLE, SOLAR } from './constants';
import { isqrt } from '@/core/fixed';
import { besideRoutingBlock, branch, checkpoint, connect, join, keepOff, lay, layFrom, learnPlans, placeFed, placeFeeding, powerLine, rollback, routeOver, spotsNear, type BeltTiles, type Feed } from './dev';
import { footprint, rotatePoint, worldPorts, type WorldPort } from './entities';
import { Sim } from './state';
import { Chain } from './flow/chain';
import type { FNode } from './flow/node';
import { boardTop } from './systems/quests';
import { inReach } from './systems/landscape';
import { DX, DY, isFloor, isRock, isWater, opposite, T, type Rot } from './types';
import { inWorld, tileIndex } from './world/grid';
import { parcelAt } from './world/land';
import { MapGen } from './world/mapgen';
import { deliveryTicks, tradeLevel } from './trade';

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
}

/** Full sun's first minute of the day (the first `SOLAR` step at 1000 ‰). */
const SUNRISE = SOLAR.findIndex((s) => s >= PERMILLE);

/** The last world minute at or before `near` when full sun begins: a level built from there runs in daylight. */
export function scenarioEpoch(near: number): number {
  return near - ((((near - SUNRISE) % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS);
}

/** A new base on the player's land, built to level `id`. */
export function foundScenario(id: ScenarioId, o: ScenarioOptions): { sim: Sim; report: ScenarioReport } {
  const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: o.playerSeed, source: new MapGen(WORLD_SEED, o.playerSeed), foundingEpoch: scenarioEpoch(o.near) });
  return { sim, report: buildScenario(sim, id, o.name) };
}

/** Build level `id` on a new base (founded, nothing built yet). */
export function buildScenario(sim: Sim, id: ScenarioId, name: string): ScenarioReport {
  const b = new Builder(sim, id);
  const upTo = SCENARIO_IDS.indexOf(id);
  if (!sim.nameColony(name)) b.until('claim'); // an unusable name: quest 0 is forced
  if (upTo >= 3) tradeSpot(b); // the trade post's place by the Heart, taken before the lines ring it
  if (upTo >= 1) { firstStrike(b); ribbonLines(b); }
  if (upTo >= 2) { bloomKiln(b); firstWind(b); glassworks(b); }
  if (upTo >= 3) { fieldJournal(b); crierCalls(b); tiredVein(b); firstPurchase(b); theBoard(b); beyondCrown(b); morePower(b); postLine(b); tradeLine(b); }
  if (upTo >= 4) grown(b);
  if (upTo >= 5) late(b);
  if (upTo >= 2) powerUp(b);
  sim.ensureCompiled();
  return b.report;
}

// ── the builder: a player's hands ───────────────────────────────────────────

/** Game minutes a quest gets to complete on its own before it is forced. */
const QUEST_WAIT_MIN = 6;

class Builder {
  readonly report: ScenarioReport;
  readonly ids: Record<string, number>;
  /** The laid lines, by role (branches split them). */
  readonly lines: Record<string, BeltTiles> = {};
  readonly heart: [number, number] = [CENTER, CENTER];

  constructor(readonly sim: Sim, id: ScenarioId) {
    this.report = { id, ticks: 0, forced: [], skipped: [], granted: [], ids: {} };
    this.ids = this.report.ids;
  }

  get H(): number { return this.sim.hearthId; }

  skip(what: string): void { this.report.skipped.push(what); }

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

  /** A drill on `item`: the spot nearest `near` (default the Heart) on whole-deposit tiles, its output facing the Heart. */
  drill(role: string, item: string, near: readonly [number, number] = this.heart, r = 30): number {
    return this.put(role, 'drill', near, { item, r, toward: this.heart });
  }

  /** A building fed by its lines and sending on to `to` (see `placeFed`); its id (0: skipped). */
  fed(role: string, def: string, near: readonly [number, number], feeds: ReadonlyArray<Feed | 0 | undefined>, to: number | null, outRole?: string): number {
    if (feeds.some((f) => !f)) { this.skip(role); return 0; }
    const routers = feeds.filter((f) => typeof f !== 'number').length;
    this.affordAll([def, 1], ['router', routers], this.spare);
    let r = placeFed(this.sim, def, near, feeds as Feed[], to, { r: 14 });
    if (!r && this.junctions()) { this.affordAll([def, 1], ['router', routers], this.spare); r = placeFed(this.sim, def, near, feeds as Feed[], to, { r: 14 }); }
    // A crowded base: farther out, more spots (only when the near ones all failed: a base that
    // builds near stays as it was).
    if (!r) r = placeFed(this.sim, def, near, feeds as Feed[], to, { r: 22, tries: 160 });
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
  source(role: string, def: string, near: readonly [number, number], into: number | string, opts: { item?: string; r?: number } = {}): number {
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

  /** The middle tile of a laid line (the Heart's centre when there is none). */
  middle(role: string): [number, number] {
    const l = this.lines[role];
    const t = l?.[l.length >> 1];
    return t ? [t[0], t[1]] : this.heart;
  }

  /**
   * A point `dist` tiles from the Heart, in the one of eight directions farthest from every
   * cirque deposit and the lake (content offsets; `rank` 1: the next best): where power and
   * storage go, out of the lines' way.
   */
  quietSide(dist: number, rank = 0): [number, number] {
    const marks: Array<readonly [number, number]> = [...CIRQUE.deposits.map((d) => [d.dx, d.dy] as const), [CIRQUE.lake.dx, CIRQUE.lake.dy]];
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
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
function postAtHeart(b: Builder): number {
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
function firstStrike(b: Builder): void {
  b.source('iron1', 'drill', b.heart, b.H, { item: 'iron_ore', r: 30 });
  b.wire('iron1');
  b.until('first_strike');
}

/** 2 · telemetry, a second iron drill and its line. */
function ribbonLines(b: Builder): void {
  b.plan('telemetry');
  b.source('iron2', 'drill', b.heart, b.H, { item: 'iron_ore', r: 30 });
  b.wire('iron2');
  b.until('ribbon_lines');
}

/** 3 · the smelter toward the coal: its iron from a router on an iron line, its plates into the Heart; a coal drill's line into it. */
function bloomKiln(b: Builder): void {
  b.plan('kiln', 'router');
  const iron = b.laid('iron2', 'iron1');
  b.fed('kiln1', 'kiln', b.mid(b.deposit('coal')), [iron.length ? { lines: iron } : 0], b.H, 'plates');
  if (b.ids.kiln1) b.source('coal', 'drill', b.centre('kiln1'), b.ids.kiln1, { item: 'coal', r: 30 });
  b.recipe('kiln1', 'iron_plate');
  b.wire('coal');
  b.until('bloom_kiln');
}

/** 4 · two wind turbines on the quiet side, wired; the workshop near the plate line, wired. */
function firstWind(b: Builder): void {
  b.plan('wind_flower', 'workshop');
  // Where the levels have always planted them, on the floor: they give little now (D44), but moving
  // them reshapes every line laid after and leaves the later levels no room to branch. The base's
  // wind comes from the Crown (`morePower`, `powerUp`).
  const spot = b.quietSide(9);
  b.put('wind1', 'wind_flower', spot, { r: 8 });
  b.put('wind2', 'wind_flower', spot, { r: 8 });
  b.wire('wind1', 'wind2');
  b.put('workshop', 'workshop', b.middle('plates'), { r: 10 });
  b.wire('workshop');
  b.until('first_wind');
}

/** 5 · glass: a second smelter fed coal by a router on the coal line, sand by two collectors (their lines joined); its glass into the Heart. */
function glassworks(b: Builder): void {
  b.plan('sand_collector');
  const coal = b.laid('coal');
  b.fed('kiln2', 'kiln', b.middle('coal'), [coal.length ? { lines: coal } : 0], b.H, 'glass');
  b.recipe('kiln2', 'glass');
  if (b.ids.kiln2) b.source('sand1', 'sand_collector', b.centre('kiln2'), b.ids.kiln2);
  if (b.ids.sand1) b.source('sand2', 'sand_collector', b.centre('sand1'), 'sand1');
  b.wire('sand1', 'sand2');
  b.until('glassworks');
}

/** 6 · survey data: routers on the plate and glass lines feed the workshop, its data runs into the observatory; Mechanics starts. */
function fieldJournal(b: Builder): void {
  b.plan('observatory');
  if (!surveyLine(b) && !(b.junctions() && surveyLine(b))) b.skip('observatory');
  b.recipe('workshop', 'journal_1');
  b.wire('workshop', 'observatory');
  if (b.ids.observatory && !b.sim.startResearch('tr1').ok) b.skip('research:tr1');
  b.until('field_journal');
}

/**
 * The survey line, each way taken back up if it does not close: the workshop of quest 4 where it
 * stands (a router on each line into it, the observatory fed from it); else the observatory
 * first and a workshop beside it, fed by both lines and sending into it (the old one goes); else
 * the workshop first, the observatory after.
 */
function surveyLine(b: Builder): boolean {
  const sim = b.sim, plates = b.laid('plates'), glass = b.laid('glass');
  if (!plates.length || !glass.length) return false;
  const feeds: Feed[] = [{ lines: plates }, { lines: glass }];
  b.affordAll(['router', 2], ['observatory', 1], ['workshop', 1], b.spare);
  const ws = b.ids.workshop;
  if (ws) {
    const cp = checkpoint(sim);
    const p = branch(sim, plates, ws, 0), g = p && branch(sim, glass, ws, 1);
    const obs = g ? placeFed(sim, 'observatory', b.centre('workshop'), [ws], null, { r: 10 }) : null;
    if (p && g && obs) { b.ids.observatory = obs.id; b.lines['plates.ws'] = p.path; b.lines['glass.ws'] = g.path; return true; }
    rollback(sim, cp);
    const e = sim.ents.get(ws);
    if (e) sim.remove(e.x, e.y);
    delete b.ids.workshop;
  }
  const near = b.middle('plates');
  for (const [x, y, rot] of spotsNear(sim, 'observatory', near, { r: 10 }).slice(0, 12)) {
    const cp = checkpoint(sim);
    const o = sim.place('observatory', x, y, rot);
    const w = o.ok ? placeFed(sim, 'workshop', [x, y], feeds, o.id!, { r: 8, tries: 12 }) : null;
    if (w) { b.ids.observatory = o.id!; b.ids.workshop = w.id; b.lines['plates.ws'] = w.lines[0]!; b.lines['glass.ws'] = w.lines[1]!; return true; }
    rollback(sim, cp);
  }
  const cp = checkpoint(sim);
  const w = placeFed(sim, 'workshop', near, feeds, null, { r: 14 });
  const o = w ? placeFed(sim, 'observatory', b.centre('workshop'), [w.id], null, { r: 10 }) : null;
  if (w && o) { b.ids.workshop = w.id; b.ids.observatory = o.id; b.lines['plates.ws'] = w.lines[0]!; b.lines['glass.ws'] = w.lines[1]!; return true; }
  rollback(sim, cp);
  return false;
}

/** 7 · the trade post against the Heart (placed at the start), wired, selling glass. */
function crierCalls(b: Builder): void {
  b.plan('trade_post');
  if (!b.ids.post) postAtHeart(b);
  b.wire('post');
  if (b.ids.post && b.sim.setExport(b.ids.post, 0, 'glass') !== null) b.skip('export:glass');
  b.until('crier_calls');
}

/** 8 · the tired copper vein: a wire mill toward it, its wire into the Heart; a copper drill's line into it. */
function tiredVein(b: Builder): void {
  b.plan('wire_mill');
  b.fed('mill', 'wire_mill', b.mid(b.deposit('copper_ore')), [], b.H, 'wire');
  if (b.ids.mill) b.source('copper', 'drill', b.centre('mill'), b.ids.mill, { item: 'copper_ore', r: 30 });
  b.recipe('mill', 'copper_wire');
  b.wire('copper', 'mill');
  b.until('tired_vein');
}

/** 9 · a standing import order of copper ore (up to twice this minute's ask). */
function firstPurchase(b: Builder): void {
  const post = b.ids.post;
  const ask = b.sim.prices.ask[itemIdx('copper_ore')]!;
  const order = post ? b.sim.addImport(post, 'copper_ore', 10, 2 * ask) : null;
  if (typeof order !== 'number') b.skip('import:copper_ore');
  b.until('first_purchase');
  // The quest wants a first purchase, not a standing drain: the copper drill feeds the wire mill,
  // and imported ore would only pile up in the Heart while the order eats the money.
  if (typeof order === 'number') b.sim.cancelImport(order);
}

/** 10 · an export stream on the best line of « Ce qui rapporte », taken off once the quest is met (it would sell the Heart's stock down). */
function theBoard(b: Builder): void {
  const post = b.ids.post, top = boardTop(b.sim, 3)[0];
  if (!post || top === undefined || b.sim.setExport(post, 1, ITEM_IDS[top]!) !== null) b.skip('export:board');
  b.until('the_board');
  if (post) b.sim.setExport(post, 1, null);
}

/** 11 · a survey beacon past the Crown (the quest's own reach), on the nearest free tile out there. */
function beyondCrown(b: Builder): void {
  b.plan('beacon');
  b.affordDef('beacon');
  const r = CIRQUE.crownOuter, sim = b.sim;
  const out: Array<[number, number, number]> = [];
  for (let y = CENTER - r - 6; y <= CENTER + r + 6; y++) {
    for (let x = CENTER - r - 6; x <= CENTER + r + 6; x++) {
      const d = (x - CENTER) * (x - CENTER) + (y - CENTER) * (y - CENTER);
      if (d >= r * r && d <= (r + 6) * (r + 6)) out.push([x, y, d]);
    }
  }
  out.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
  const at = out.find(([x, y]) => { const c = sim.canPlace('beacon', x, y, 0); return c.ok && !c.replaces.length; });
  const id = at ? sim.place('beacon', at[0], at[1], 0).id : undefined;
  if (id) b.ids.beacon = id;
  else b.skip('beacon');
  b.until('beyond_crown');
}

/** After the tutorial: two more wind turbines and the coal generator (quest 4's kit), fed by its own coal drill. */
function morePower(b: Builder): void {
  b.plan('brazier');
  const crown = b.crown();
  b.put('wind3', 'wind_flower', crown, { r: 9, onRock: true });
  b.put('wind4', 'wind_flower', crown, { r: 9, onRock: true });
  b.wire('wind3', 'wind4');
  // The generator only with a coal drill of its own (the deposit is small: sharing the smelters' coal would starve them).
  b.optional(() => {
    if (!b.fed('generator', 'brazier', b.mid(b.deposit('coal')), [], null)) return;
    if (b.source('coalGen', 'drill', b.centre('generator'), b.ids.generator!, { item: 'coal', r: 30 })) { b.wire('generator', 'coalGen'); return; }
    const e = b.sim.ents.get(b.ids.generator!)!;
    b.sim.remove(e.x, e.y);
    delete b.ids.generator;
  });
  b.run(2 * EPOCH);
}

// ── later on ────────────────────────────────────────────────────────────────

/** Research nodes the grown base learns for real, in order, after Mechanics. */
const GROWN_RESEARCH = ['en1', 'dn1'];
/** Game minutes each may take before it is granted instead. */
const RESEARCH_WAIT_MIN = 40;

/**
 * The trade post fed by a line of its own, as a player sets it up once the tutorial is done: a
 * router on an iron ore line (the Heart only piles ore up) and a ribbon into the post, whose
 * stream sells iron ore instead of the glass the Heart needs to build (owner, 2026-10-13: "the
 * money is drying out, the tradepost is linked to nothing… Just put one output to the tradepost").
 */
function tradeLine(b: Builder): void {
  const post = b.ids.post;
  if (!post) return;
  if (b.sim.setExport(post, 0, 'iron_ore') !== null) b.skip('export:iron_ore');
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
function postLine(b: Builder): void {
  const post = b.ids.post;
  if (!post) return;
  const iron = b.laid('iron1', 'iron2'), stub = b.lines['post.stub'];
  // Onto the stub's tail when it stands (the tile behind it, pointing in), else into the entrance.
  const onto = stub ? new Map([[tileIndex(stub[0]![0] - DX[stub[0]![2]]!, stub[0]![1] - DY[stub[0]![2]]!), stub[0]![2]]]) : undefined;
  b.affordAll(['router', 1], b.spare);
  let r = iron.length ? branch(b.sim, iron, post, -1, onto) : null;
  if (!r && b.junctions()) { b.affordAll(['router', 1], b.spare); r = branch(b.sim, iron, post, -1, onto); }
  if (r) b.lines['post.in'] = [...r.path, ...(stub ?? [])]; else b.skip('line:post');
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

/** The plates the debug bases buy (items per minute): what their iron ore sales pay for. */
const PLATES_PER_MIN = 3;

/**
 * Wind turbines on the Crown (D44) until the night is covered — the turbines at their mean wind,
 * fuel generators at what they gave, the Heart's steady core (its sun is a day's bonus) — against
 * the grid's draw: what the base drew over a minute, or most of what its
 * buildings are rated for (a starved machine draws little and would hide the need). A base
 * left short runs every machine slow and starves its lines. At most `cap` turbines.
 */
function powerUp(b: Builder, cap = 12): void {
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
  const need = Math.max(drew, Math.floor((rated * 85) / 100));
  sim.ensureCompiled();
  let night = fuel;
  for (const p of sim.graph.nets[grid()]?.producers ?? []) {
    if (p.kind === 'hearth') night += p.base ?? 0;
    else if (p.kind === 'wind') night += Math.floor((p.kw * p.local) / PERMILLE);
    else if (p.kind === 'geo') night += p.kw;
  }
  // A turbine out of the zone comes by kite: count what it will give from where it stands.
  const kw = Math.floor((buildingDef(buildingIdx('wind_flower')).gen!.kw * sim.mods.windOut * sim.mods.genOut) / 1e6);
  for (let k = 0; k < cap && night < need; k++) {
    const role = `power${k + 1}`;
    const id = b.put(role, 'wind_flower', b.crown(k >> 2), { r: 9, onRock: true });
    if (!id) return;
    b.wire(role);
    const e = sim.ents.get(id)!, t = sim.grid.terrain(e.x, e.y);
    night += Math.floor((kw * (isRock(t) ? BAL.windRock[t - T.Rock1]! : BAL.windCirque)) / PERMILLE);
  }
  b.run(EPOCH); // the kites land
}

/** Every plan; a second coal drill on the coal line; Mechanics and a few nodes learnt for real; a gear workshop and a silo off the plate and glass lines. */
function grown(b: Builder): void {
  const sim = b.sim;
  learnPlans(sim);
  // More coal for both smelters (the science runs on their plates and glass), where the deposit has room: a drill joining the coal line.
  b.optional(() => { if (b.source('coal2', 'drill', b.centre('coal'), 'coal', { item: 'coal', r: 30 })) b.wire('coal2'); });
  // Research, one node after another in the observatory, for real: time runs until the node is
  // learnt; past the wait it is granted (reported).
  const learn = (id: string): void => {
    if (!sim.done.has(id) && !sim.projects.some((p) => p.id === id) && !sim.startResearch(id).ok) { b.grantNode(id); return; }
    for (let t = 0; t < RESEARCH_WAIT_MIN * EPOCH && !sim.done.has(id); t += EPOCH) b.run(EPOCH);
    if (!sim.done.has(id)) b.grantNode(id);
  };
  learn('tr1');
  for (const id of GROWN_RESEARCH) learn(id);
  // Gears (Mechanics' recipe) off a plate line, into the Heart; a silo off a glass line (a store to draw from: unloaders, D34).
  const plates = b.laid('plates', 'plates.ws'), glass = b.laid('glass', 'glass.ws');
  b.fed('gears', 'workshop', b.middle('plates'), [plates.length ? { lines: plates } : 0], b.H, 'gears.out');
  b.recipe('gears', 'gear');
  b.wire('gears');
  b.fed('silo', 'silo', b.middle('glass'), [glass.length ? { lines: glass } : 0], null);
  b.run(2 * EPOCH);
}

/** Research the late base is given outside the commands (the trunk to the skydocks, digging, the land's first research). */
const LATE_RESEARCH = ['tr2', 'tr3', 'tr4', 'tr6', 'ex1', 'xp1', 'dn1'];

/** Research granted, the Heart at level 2, an excavator on marked rock, land past the Crown, a drifter route between two skydocks; then the advanced part. */
function late(b: Builder): void {
  const sim = b.sim;
  // Deep research takes hours of science: granted, prerequisites first (not a command: this log no longer replays).
  for (const id of LATE_RESEARCH) b.grantNode(id);
  // The Heart, level 2 (a command; its materials granted if short).
  const up = BAL.hearthUpgrades[sim.hearthLevel - 1];
  if (up) b.afford(up.cost);
  if (!sim.upgradeHearth().ok) b.skip('hearth:2');
  excavate(b);
  b.optional(() => surplus(b));
  // The deposit nearest past the Crown, its parcels bought (when the starting square does not
  // hold them already): a drill on it, its ore over the Crown; a skydock beside.
  const far = farDeposit(b);
  const site = far ? far.at : b.quietSide(CIRQUE.crownOuter + 8);
  b.landAround(site, 10);
  if (far) b.optional(() => overCrown(b, far));
  // A skydock fed by a third router on the plate line, another by the far deposit, two drifters between.
  const plates = b.laid('plates', 'plates.ws', 'gears.in0');
  const dockA = b.fed('dockA', 'skydock', b.middle('plates'), [plates.length ? { lines: plates } : 0], null);
  const dockB = b.put('dockB', 'skydock', site, { r: 10 });
  b.wire('dockA', 'dockB');
  b.run(EPOCH);
  if (dockA && dockB) {
    sim.ensureCompiled();
    for (let i = 0; i < 2; i++) {
      b.afford(Object.entries(BAL.drifterCost));
      if (!sim.buyDrifter(dockA)) b.skip('drifter');
    }
    if (sim.addRoute(dockA, dockB, 'iron_plate', 2) <= 0) b.skip('route');
  } else b.skip('route');
  b.optional(() => swiftPlates(b));
  b.run(2 * EPOCH);
  advanced(b);
}

/**
 * Research the advanced part of the late base is given on top of `LATE_RESEARCH` (granted,
 * prerequisites first; owner, 2026-10-13: "make the late game bases even more advanced, using a
 * lot of the tech tree"): the trunk's second desk; the branches up to five or six deep — digging and
 * the deep bore, compact machines, speed modules, distributors, express ribbons, solar panels,
 * double accumulators, the charger, geothermal power, the broker's slate, standing orders, the
 * second wharf — and `xp2` and `cm4` are left to research for real, on Survey Data and on Mechanics
 * Data (the tree's only nodes left that their data reaches).
 */
const ADVANCED_RESEARCH = ['tr5', 'ex2', 'ex3', 'ex5', 'dn3', 'dn4', 'dn5', 'dn6', 'en2', 'en3', 'en4', 'en5', 'cm1', 'cm2', 'cm3'];
/** What its first observatory researches for real, on Survey Data (a depth-2 node). */
const SURVEY_PROJECT = 'xp2';
/** What the outer works' observatory researches for real, on their Mechanics Data: a depth-4 node. */
const ADVANCED_PROJECT = 'cm4';

/**
 * The late base's advanced part (each piece skipped, and reported, where the map does not allow
 * it): the Heart to level 4; solar panels and accumulators for the night, the coal generator
 * retired; the first observatory's next project; the outer works past the Crown (`outerWorks`);
 * the longest plain line upgraded to express ribbons.
 */
function advanced(b: Builder): void {
  const sim = b.sim;
  for (const id of ADVANCED_RESEARCH) b.grantNode(id);
  // The Heart up to level 4 (commands; their materials granted if short).
  for (let k = 0; k < 3; k++) {
    const up = BAL.hearthUpgrades[sim.hearthLevel - 1];
    if (!up) break;
    b.afford(up.cost);
    if (!sim.upgradeHearth().ok) { b.skip(`hearth:${sim.hearthLevel + 1}`); break; }
  }
  // The coal generator retired (the solar panels and accumulators carry the night): its drill's
  // coal joins the smelters' coal line, where it was short.
  b.optional(() => solarField(b));
  b.optional(() => moreCoal(b));
  // The first observatory's next project, on Survey Data (its workshop stood blocked).
  if (b.ids.observatory && !sim.startResearch(SURVEY_PROJECT, b.ids.observatory).ok) b.skip(`research:${SURVEY_PROJECT}`);
  // The cirque's plates are short (its ore shared with the Heart and the post, its coal with the
  // glass): the plate smelter served first off the ore lines and the coal line (the glass smelter
  // takes what it leaves), the survey workshop off the plate and glass lines.
  serveFirst(b, 'kiln1.in0');
  serveFirst(b, 'kiln2.in0', 'overflow_gate');
  serveFirst(b, 'plates.ws');
  serveFirst(b, 'glass.ws');
  b.optional(() => farCopper(b));
  outerWorks(b); // DEBUG: b.optional(() => outerWorks(b));
  // The longest plain line left, upgraded to express ribbons.
  b.optional(() => expressLine(b));
  b.run(4 * EPOCH);
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
  const thin = b.lines['copper'] ?? [], { x: cx, y: cy, rot: cr } = cu;
  for (const [x, y] of thin) if (sim.entityAt(x, y)) sim.remove(x, y);
  sim.remove(cx, cy);
  b.affordAll(['router', 1], b.spare);
  const r = branch(sim, [climb], mill);
  if (!r) {
    // Put the thin drill and its line back as they were.
    b.affordAll(['drill', 1]);
    b.afford([['iron_plate', thin.length]]);
    sim.place('drill', cx, cy, cr);
    sim.placeBelts('ribbon', thin);
    b.skip('farCopper');
    return false;
  }
  delete b.ids.copper;
  b.lines['copper'] = r.path;
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

/**
 * What the outer works buy a minute (standing orders at the second post), by plan: with their own
 * wire, glass and plates for ten circuits' worth; buying their circuits (two hours away, paid as
 * ordered), a few — the speed modules they make still pay for them — and the plates their gears take.
 */
const OUTER_BUY: { wire: Record<string, number>; buy: Record<string, number> } = {
  wire: { glass: 10, iron_plate: 24 },
  buy: { circuit: 2, iron_plate: 6 },
};
/** The longest the build waits for the outer works' purchases (the glass's and plates' quarter hour; not the circuits' two hours). */
const OUTER_WARM_MAX = 25 * EPOCH;

/**
 * The outer works' plan (owner, 2026-10-13: "make the late game bases even more advanced, using a
 * lot of the tech tree. Check if it makes sense then"): drawn once, laid as a whole where it fits
 * (a crowded base's machines placed one by one box each other's lines in). Row 0 is the line of
 * tiles above the plan (y −1). Everything turned half round (rot 2): inputs at the top, outputs at
 * the bottom, the goods flowing down.
 * - the post (P, its 5×5 pad and flame apron, D62) buys glass (or circuits) and plates; both come
 *   out of its one exit, below, in turn: a sorter (Z) sends the glass (circuits) straight on, the
 *   plates aside into the gear workshop (g);
 * - the wire mill (M), its copper coming in from above (the deep bore's), its wire along the left
 *   into the circuit workshop (C), the glass from above;
 * - the circuits down into the speed-module workshop (B), a router (R) dealing some to the compact
 *   great workshop (J); the gears down into B, a router dealing some across a junction (+) into J,
 *   and an overflow gate (%) before B spilling what neither takes onto the return line (sold): the
 *   gears never back up, so the plates bought never fill the post's one container and hold the
 *   glass in the air;
 * - J's ceramic comes in from the left (the tile marked above it), its Mechanics Data down into the
 *   observatory (O);
 * - the return line (↑ → ↓ ←: the speed modules, the spilled gears, and the bore's ore joining it)
 *   up the right and over the top into the post's one entrance.
 * Where the plain has no copper, `WORKS_BUY`: the post buys circuits, straight down the same line;
 * without water for the ceramic, the `_DRY` plans, without J and O. Laid turned as the ground
 * allows (`planOf`): the blocks and arrows turn with it.
 */
const WORKS_WIRE: readonly string[] = [
  '       ↓←←←←←←',
  ' .   PPPPP   ↑',
  ' M   PPPPP   ↑',
  ' M   PPPPP   ↑',
  ' v   PPPPP   ↑',
  ' v   PPPPP   ↑',
  ' v     v     ↑',
  ' v    .Z>>v  ↑',
  ' >>>>>vv  gg ↑',
  '      CC  gg ↑',
  '      CC   v ↑',
  '       v   v ↑',
  '     v<+<<<R.↑',
  '    .v v   v ↑',
  '    JJ<R.  v ↑',
  '    JJ v   %→↑',
  '    v  v v<< ↑',
  '   OO  BBB   ↑',
  '   OO  BBB   ↑',
  '       BBB   ↑',
  '        →→→→→↑',
];
const WORKS_BUY: readonly string[] = [
  '       ↓←←←←←←',
  '     PPPPP   ↑',
  '     PPPPP   ↑',
  '     PPPPP   ↑',
  '     PPPPP   ↑',
  '     PPPPP   ↑',
  '       v     ↑',
  '      .Z>>v  ↑',
  '       v  gg ↑',
  '       v  gg ↑',
  '       v   v ↑',
  '       v   v ↑',
  '     v<+<<<R.↑',
  '    .v v   v ↑',
  '    JJ<R.  v ↑',
  '    JJ v   %→↑',
  '    v  v v<< ↑',
  '   OO  BBB   ↑',
  '   OO  BBB   ↑',
  '       BBB   ↑',
  '        →→→→→↑',
];
const WORKS_WIRE_DRY: readonly string[] = [
  '       ↓←←←←←←',
  ' .   PPPPP   ↑',
  ' M   PPPPP   ↑',
  ' M   PPPPP   ↑',
  ' v   PPPPP   ↑',
  ' v   PPPPP   ↑',
  ' v     v     ↑',
  ' v    .Z>>v  ↑',
  ' >>>>>vv  gg ↑',
  '      CC  gg ↑',
  '      CC   v ↑',
  '       v   v ↑',
  '       v   v ↑',
  '       v   v ↑',
  '       v   v ↑',
  '       v   %→↑',
  '       v v<< ↑',
  '       BBB   ↑',
  '       BBB   ↑',
  '       BBB   ↑',
  '        →→→→→↑',
];
const WORKS_BUY_DRY: readonly string[] = [
  '       ↓←←←←←←',
  '     PPPPP   ↑',
  '     PPPPP   ↑',
  '     PPPPP   ↑',
  '     PPPPP   ↑',
  '     PPPPP   ↑',
  '       v     ↑',
  '      .Z>>v  ↑',
  '       v  gg ↑',
  '       v  gg ↑',
  '       v   v ↑',
  '       v   v ↑',
  '       v   v ↑',
  '       v   v ↑',
  '       v   v ↑',
  '       v   %→↑',
  '       v v<< ↑',
  '       BBB   ↑',
  '       BBB   ↑',
  '       BBB   ↑',
  '        →→→→→↑',
];

/** The plan's buildings by letter: role, building, recipe (all turned half round). */
const WORKS_KEY: Record<string, readonly [string, string, string | null]> = {
  P: ['post2', 'trade_post', null],
  M: ['mill2', 'wire_mill', 'copper_wire'],
  g: ['gears2', 'workshop', 'gear'],
  C: ['circuits', 'workshop', 'circuit'],
  J: ['journal2', 'great_workshop_compact', 'journal_2'],
  O: ['observatory2', 'observatory', null],
  B: ['bells', 'great_workshop', 'pace_bell'],
  Z: ['sorter2', 'sorter', null],
};
const ARROW: Record<string, Rot> = { '^': 0, '>': 1, 'v': 2, '<': 3 };
/** The return line's arrows: into the post's entrance (laid like the others, kept as `works.return`). */
const RETURN: Record<string, Rot> = { '↑': 0, '→': 1, '↓': 2, '←': 3 };

/** A plan turned `q` quarter turns clockwise: its tiles (but the blanks) and its size. */
interface Plan { w: number; h: number; q: Rot; cells: ReadonlyArray<readonly [number, number, string]> }

function planOf(rows: readonly string[], q: Rot): Plan {
  const H = rows.length, W = Math.max(...rows.map((r) => r.length));
  const cells: Array<readonly [number, number, string]> = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < rows[j]!.length; i++) {
      const c = rows[j]![i]!;
      if (c !== ' ') cells.push([...rotatePoint(i, j, W, H, q), c] as const);
    }
  }
  return { w: q & 1 ? H : W, h: q & 1 ? W : H, q, cells };
}

/** May the claim build on a tile: its land, or a parcel no sister claim owns (CrierBelt's, to buy)? */
function buyable(sim: Sim, x: number, y: number): boolean {
  return sim.land.covers(x, y) || sim.land.sister(parcelAt(x, y)) < 0;
}

/** Every tile of a plan laid at (ax, ay): free, revealed, level floor the claim holds or may buy. */
function planFits(sim: Sim, plan: Plan, ax: number, ay: number): boolean {
  const level = sim.grid.level(ax, ay);
  for (const [i, j] of plan.cells) {
    const x = ax + i, y = ay + j;
    if (!inWorld(x, y) || !sim.revealed(x, y) || sim.grid.occ[tileIndex(x, y)] !== 0 || !isFloor(sim.grid.terrain(x, y))) return false;
    if (sim.grid.level(x, y) !== level || !buyable(sim, x, y)) return false;
  }
  return true;
}

/** Lay a plan at (ax, ay): its buildings (their cost granted), routers, gate and junction, then its ribbons; false (nothing left) if any fails. */
function layPlan(b: Builder, plan: Plan, ax: number, ay: number): boolean {
  const sim = b.sim, cp = checkpoint(sim);
  const rot = ((2 + plan.q) & 3) as Rot; // the plan's buildings and blocks, turned with it
  const at = new Map<string, [number, number]>(), blocks: Array<[string, number, number]> = [];
  const belts: BeltTiles = [], ret: BeltTiles = [];
  for (const [i, j, c] of plan.cells) {
    const x = ax + i, y = ay + j;
    if (WORKS_KEY[c]) { const p = at.get(c); at.set(c, p ? [Math.min(p[0], x), Math.min(p[1], y)] : [x, y]); }
    else if (c === 'R' || c === '+' || c === '%') blocks.push([c, x, y]);
    else if (ARROW[c] !== undefined) belts.push([x, y, ((ARROW[c]! + plan.q) & 3) as Rot]);
    else if (RETURN[c] !== undefined) ret.push([x, y, ((RETURN[c]! + plan.q) & 3) as Rot]);
  }
  belts.push(...ret);
  const parts: Array<[string, number, number]> = [...[...at].map(([c, [x, y]]) => [c, x, y] as [string, number, number]), ...blocks];
  const ids: Record<string, number> = {};
  for (const [c, x, y] of parts) {
    const def = c === 'R' ? 'router' : c === '+' ? 'crossing' : c === '%' ? 'overflow_gate' : WORKS_KEY[c]![1];
    b.affordDef(def);
    const r = sim.place(def, x, y, rot);
    if (!r.ok) { rollback(sim, cp); return false; }
    if (WORKS_KEY[c]) ids[WORKS_KEY[c]![0]] = r.id!;
  }
  b.afford([['iron_plate', belts.length]]);
  for (const t of belts) if (sim.placeBelts('ribbon', [t]) !== 1) { rollback(sim, cp); return false; }
  Object.assign(b.ids, ids);
  b.lines['works.return'] = ret;
  for (const c of at.keys()) {
    const k = WORKS_KEY[c]!;
    if (k[2]) b.recipe(k[0], k[2]);
  }
  return true;
}

/** Where a plan fits (any of its four turns), round a point within 20 tiles: nearest first. */
function planSpots(sim: Sim, rows: readonly string[], at: readonly [number, number]): Array<[Plan, number, number, number]> {
  const spots: Array<[Plan, number, number, number]> = [];
  for (const q of [0, 1, 2, 3] as const) {
    const plan = planOf(rows, q);
    for (let dy = -20; dy <= 20; dy++) {
      for (let dx = -20; dx <= 20; dx++) {
        const ax = at[0] + dx - (plan.w >> 1), ay = at[1] + dy - (plan.h >> 1);
        if (planFits(sim, plan, ax, ay)) spots.push([plan, ax, ay, dx * dx + dy * dy]);
      }
    }
  }
  return spots.sort((p, q) => p[3] - q[3] || p[0].q - q[0].q || p[2] - q[2] || p[1] - q[1]);
}

/**
 * The outer works: the advanced industry on the open plain past the Crown, by the far deposit
 * (the cirque has no room left: its lines box the old ones in), in a plan of its own
 * (`WORKS_WIRE`) round a second trade post — the second wharf — on parcels bought for it. A deep
 * bore on the plain's deposit: copper into the plan's wire mill (else the post buys circuits:
 * `WORKS_BUY`), the rest of its ore sold. Ceramic from an excavator's stone (the rock nearest the
 * water, dug) and a pump's water, their parcels bought too, into the great workshop; one speed
 * module, bought, fitted to the mill the bore outruns. Each part skipped, and reported, where the
 * map does not allow it.
 */
function outerWorks(b: Builder): void {
  const sim = b.sim;
  const site = b.ids.farDrill ? b.centre('farDrill') : b.ids.dockB ? b.centre('dockB') : null;
  if (!site) { b.skip('outerWorks'); return; }
  // The deposit first (before anything stands on it), its parcels bought: a deep bore, its output facing the plain.
  const dep = nearestTile(b, site, 16, (x, y) => sim.grid.ore(x, y) >= 0 && buyable(sim, x, y) && sim.grid.occ[tileIndex(x, y)] === 0);
  const ore = dep ? ITEM_IDS[sim.grid.ore(dep[0], dep[1])]! : '';
  if (dep) b.landAround(dep, 4);
  const bore = dep ? b.put('bore', 'deep_bore', dep, { item: ore, r: 8, toward: toward(site, b.heart, -8) }) : 0;
  if (!bore) b.skip('bore');
  // Water for the ceramic: the nearest the claim may hold. The plan where it fits (turned as the
  // ground allows) on land the claim holds or may buy, its parcels bought: by the deposit when
  // its copper feeds the plan's mill, else by the water (the ceramic's line is the long one).
  const wire = ore === 'copper_ore';
  // Water past the Crown only: the cirque's lake shore is taken.
  const crown = CIRQUE.crownOuter * CIRQUE.crownOuter;
  const wet = (x: number, y: number): boolean => isWater(sim.grid.terrain(x, y)) && sim.grid.level(x, y) === 0 && buyable(sim, x, y)
    && (x - CENTER) * (x - CENTER) + (y - CENTER) * (y - CENTER) > crown;
  const water = nearestTile(b, site, 48, wet);
  const at = wire || !water ? toward(site, b.heart, -10) : toward(water, site, 12);
  const rows = wire ? (water ? WORKS_WIRE : WORKS_WIRE_DRY) : water ? WORKS_BUY : WORKS_BUY_DRY;
  const spots = planSpots(sim, rows, at);
  if (!spots.some(([plan, ax, ay]) => b.landFor(plan.cells.map(([i, j]) => [ax + i, ay + j] as const)) && layPlan(b, plan, ax, ay))) { b.skip('works:plan'); return; }
  const post = b.ids.post2!, gw = b.ids.journal2 ?? 0, obs = b.ids.observatory2 ?? 0;
  // The post's trade: it buys glass (or circuits) and plates — out of its one exit, in turn; the
  // sorter sends the glass (circuits) straight on, the plates aside — and its entrance sells the
  // speed modules, the spilled gears and the bore's ore.
  const ask = (it: string): number => Math.floor((sim.prices.ask[itemIdx(it)]! * 3) / 2);
  const straight = wire ? 'glass' : 'circuit';
  if (!sim.setForkFilter(b.ids.sorter2!, 0, straight)) b.skip('sorter');
  for (const item of [straight, 'iron_plate']) {
    if (typeof sim.addImport(post, item, OUTER_BUY[wire ? 'wire' : 'buy'][item]!, ask(item)) !== 'number') b.skip(`import:${item}`);
  }
  if (sim.setExport(post, 0, 'pace_bell') !== null || sim.setExport(post, 2, 'gear') !== null) b.skip('export:works');
  if (obs && !sim.startResearch(ADVANCED_PROJECT, obs).ok) b.skip(`research:${ADVANCED_PROJECT}`);
  // The bore: its copper into the mill, the rest of its ore into the post (sold).
  if (bore && wire && !lay(sim, bore, b.ids.mill2!)) b.skip('line:bore');
  if (bore && (!join(sim, bore, b.laid('works.return')[0] ?? []) || sim.setExport(post, 1, ore) !== null)) {
    b.skip(`export:${ore}`);
    // A bore with nowhere to send its ore stands blocked: taken back up (refunded) where it has no mill either.
    if (!wire) { const e = sim.ents.get(bore)!; sim.remove(e.x, e.y); delete b.ids.bore; }
  }
  // Ceramic into the great workshop: an excavator against the rock nearest the water, an oven by
  // the shore, the pump's water piped in first (a conduit crosses no ribbon), then the stone in
  // and the ceramic on — each spot tried whole, taken back up when a line cannot be laid.
  const rock = water && gw ? nearestRock(b, water) : null;
  if (water && rock) b.landAround(b.mid(water, rock), Math.max(Math.abs(water[0] - rock[0]), Math.abs(water[1] - rock[1])) / 2 + 8);
  const dig = rock ? digSpot(b, 'excavator2', rock, water!) : 0;
  const oven = dig ? ovenSpot(b, dig, water!, gw) : 0;
  if (oven) { b.recipe('ceramics', 'ceramic'); markAround(b, dig); } else if (gw) b.skip('ceramics');
  // Power last (its masts would stand in the lines' way).
  b.wire('bore', 'post2', 'bells', 'journal2', 'observatory2', 'circuits', 'gears2', 'mill2', 'excavator2', 'pump', 'ceramics');
  // A speed module, bought, fitted to the mill the bore outruns.
  if (b.ids.mill2 && bore) {
    b.afford([['pace_bell', 1]]);
    if (!sim.setModule(b.ids.mill2, true)) b.skip('module');
  }
  // On until the first purchases land, the base opening with its works running — but for the
  // circuits, which come from colonies two hours away (their speed modules start later).
  const level = tradeLevel(sim.mods);
  const wait = Math.max(0, ...sim.trade.orders.filter((o) => o.post === post).map((o) => deliveryTicks(level, sim.market.sources(o.item)[0]?.delayMin ?? 0, sim.mods)));
  b.run(Math.min(wait, OUTER_WARM_MAX) + 3 * EPOCH);
}

/** An oven by the water fed by a pump's conduit, the excavator's stone and sending on into `to`: its id (0: none fits). */
function ovenSpot(b: Builder, dig: number, water: readonly [number, number], to: number): number {
  const sim = b.sim, dest = b.centre('journal2');
  b.affordAll(['ceramic_oven', 1], ['pump', 1], ['conduit', 40], b.spare);
  for (const [x, y, rot] of spotsNear(sim, 'ceramic_oven', water, { r: 7, toward: dest }).slice(0, 16)) {
    const cp = checkpoint(sim);
    const o = sim.place('ceramic_oven', x, y, rot);
    if (!o.ok) continue;
    let piped = 0;
    for (const [px, py, pr] of spotsNear(sim, 'pump', water, { r: 5, toward: [x, y] }).slice(0, 6)) {
      const p = sim.place('pump', px, py, pr);
      if (!p.ok) continue;
      if (connect(sim, p.id!, o.id!, -1, -1, 'conduit')) { piped = p.id!; break; }
      sim.remove(px, py);
    }
    if (piped && lay(sim, dig, o.id!) && lay(sim, o.id!, to)) { b.ids.pump = piped; return (b.ids.ceramics = o.id!); }
    rollback(sim, cp);
  }
  return 0;
}

/**
 * An excavator on the spot round a rock point with the most rock it digs (H1, H2) in its reach
 * (D54), its stone's way out facing `out` (the oven goes that way): its id (0: skipped).
 */
function digSpot(b: Builder, role: string, near: readonly [number, number], out: readonly [number, number]): number {
  const sim = b.sim, def = buildingIdx('excavator');
  let best: [number, number, Rot, number, number] | null = null;
  b.affordDef('excavator');
  for (const [x, y, rot] of spotsNear(sim, 'excavator', near, { r: 6, toward: out }).slice(0, 80)) {
    if (!sim.canPlace('excavator', x, y, rot).ok) continue;
    const e = { def, x, y, rot } as const;
    let n = 0;
    for (let ty = y - BAL.digReach; ty < y + 3 + BAL.digReach; ty++) {
      for (let tx = x - BAL.digReach; tx < x + 3 + BAL.digReach; tx++) {
        const t = sim.grid.terrain(tx, ty);
        if ((t === T.Rock1 || t === T.Rock2) && inReach(e, tx, ty)) n++;
      }
    }
    // The stone's way out: its front open, two tiles on (not against the rock).
    const p = worldPorts(e).find((q) => q.io === 'out')!;
    if (!isFloor(sim.grid.terrain(p.fx + DX[p.dir]!, p.fy + DY[p.dir]!))) continue;
    const d = (p.fx - out[0]) * (p.fx - out[0]) + (p.fy - out[1]) * (p.fy - out[1]);
    if (!best || n > best[3] || (n === best[3] && d < best[4])) best = [x, y, rot, n, d];
  }
  if (!best || !best[3]) { b.skip(role); return 0; }
  const r = sim.place('excavator', best[0], best[1], best[2]);
  if (!r.ok) { b.skip(role); return 0; }
  return (b.ids[role] = r.id!);
}

/** The tile nearest a point within `r` that passes `ok` (revealed), or null. */
function nearestTile(b: Builder, at: readonly [number, number], r: number, ok: (x: number, y: number) => boolean): [number, number] | null {
  let best: [number, number, number] | null = null;
  for (let y = at[1] - r; y <= at[1] + r; y++) {
    for (let x = at[0] - r; x <= at[0] + r; x++) {
      if (!inWorld(x, y) || !b.sim.revealed(x, y) || !ok(x, y)) continue;
      const d = (x - at[0]) * (x - at[0]) + (y - at[1]) * (y - at[1]);
      if (d <= r * r && (!best || d < best[2])) best = [x, y, d];
    }
  }
  return best ? [best[0], best[1]] : null;
}

/** The rock an excavator digs without research (H1, H2), revealed, nearest a point within 24 tiles. */
function nearestRock(b: Builder, at: readonly [number, number]): [number, number] | null {
  return nearestTile(b, at, 24, (x, y) => { const t = b.sim.grid.terrain(x, y); return t === T.Rock1 || t === T.Rock2; });
}

/** The rock within an excavator's reach marked for digging (as the jobs measure it: from its footprint's edge, D54). */
function markAround(b: Builder, id: number): void {
  const sim = b.sim, e = sim.ents.get(id);
  if (!e) return;
  const [w, h] = footprint(e.def, e.rot);
  const tiles: number[] = [];
  for (let y = e.y - BAL.digReach; y < e.y + h + BAL.digReach; y++) {
    for (let x = e.x - BAL.digReach; x < e.x + w + BAL.digReach; x++) if (isRock(sim.grid.terrain(x, y)) && inReach(e, x, y)) tiles.push(tileIndex(x, y));
  }
  if (!sim.designate(tiles, true)) b.skip('designate');
}

/** The coal generator taken down and its drill's coal sent into the smelters' coal line instead. */
function moreCoal(b: Builder): void {
  const sim = b.sim;
  const gen = b.ids.generator && sim.ents.get(b.ids.generator), drill = b.ids.coalGen && sim.ents.get(b.ids.coalGen);
  const coal = b.laid('coal');
  if (!gen || !drill || !coal.length) { b.skip('moreCoal'); return; }
  sim.remove(gen.x, gen.y);
  delete b.ids.generator;
  for (const [x, y] of b.lines['coalGen'] ?? []) if (sim.entityAt(x, y)) sim.remove(x, y);
  delete b.lines['coalGen'];
  const l = join(sim, drill.id, coal[0]!);
  if (l) b.lines['coalGen'] = l; else b.skip('moreCoal:join');
  // And a deep bore on the deposit's free part, joining the same line (its second outlet feeds the glass of the advanced industry).
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

/** `k` tiles from `p` toward `q`. */
function toward(p: readonly [number, number], q: readonly [number, number], k: number): [number, number] {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const d = Math.max(1, isqrt(dx * dx + dy * dy));
  return [p[0] + Math.round((dx * k) / d), p[1] + Math.round((dy * k) / d)];
}

/** The deposit nearest the Heart past the Crown (the floor beyond its foot, revealed): where the far drill goes. */
function farDeposit(b: Builder): { at: [number, number]; item: string } | null {
  const sim = b.sim, R = 46;
  let best: { at: [number, number]; item: string; d: number } | null = null;
  for (let y = CENTER - R; y <= CENTER + R; y++) {
    for (let x = CENTER - R; x <= CENTER + R; x++) {
      const dx = x - CENTER, dy = y - CENTER, d = dx * dx + dy * dy;
      if (d <= (CIRQUE.crownOuter + 1) ** 2 || d > R * R || (best && d >= best.d)) continue;
      const ore = sim.grid.ore(x, y);
      if (ore < 0 || !isFloor(sim.grid.terrain(x, y)) || sim.grid.level(x, y) !== 0 || !sim.revealed(x, y)) continue;
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
  // The longest line of plain ribbons laid in the cirque (the far line climbs: its traction ribbons stay).
  const line = Object.entries(b.lines).filter(([role]) => role !== 'overCrown').map(([, l]) => l).sort((p, q) => q.length - p.length)[0];
  if (!line || line.length < 6) { b.skip('swift'); return; }
  b.afford([['iron_plate', line.length + 6], ['gear', line.length + 6]]);
  if (sim.placeBelts('swift_ribbon', line) <= 0) { b.skip('swift'); return; }
  sim.ensureCompiled();
  const kind = (x: number, y: number): string | null => { const e = sim.ents.get(sim.grid.occ[tileIndex(x, y)]!); return e ? (buildingDef(e.def).kind as string) : null; };
  const straight = (x: number, y: number, r: Rot): boolean => (sim.graph.feedDirs.get(tileIndex(x, y)) ?? 0) === 1 << opposite(r);
  for (let i = 0; i + 3 < line.length; i++) {
    const run = line.slice(i, i + 4);
    const r = run[0]![2];
    if (!run.every(([x, y, d]) => d === r && kind(x, y) === 'belt')) continue;
    // The two leapt tiles take only the line itself (no join, no branch): they can go.
    if (!run.slice(1, 3).every(([x, y]) => straight(x, y, r))) continue;
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
  let best: [number, number, number] | null = null;
  for (let y = CENTER - R; y <= CENTER + R; y++) {
    for (let x = CENTER - R; x <= CENTER + R; x++) {
      if (sim.grid.terrain(x, y) !== T.Rock1 || !sim.revealed(x, y)) continue;
      const d = (x - CENTER) * (x - CENTER) + (y - CENTER) * (y - CENTER);
      if (!best || d < best[2]) best = [x, y, d]; // scanned row by row: ties keep the first (smallest y, then x)
    }
  }
  if (!best) { b.skip('excavator:rock'); return; }
  const [rx, ry] = best;
  // It digs what it touches and the next row (D54): it stands against the rock, its line into the Heart.
  if (!b.source('excavator', 'excavator', toward([rx, ry], b.heart, 3), b.H, { r: 4 })) return;
  b.wire('excavator');
  // The rock within its reach marked (as the jobs measure it: from its footprint's edge, D54).
  const e = sim.ents.get(b.ids.excavator!)!;
  const [w, h] = footprint(e.def, e.rot);
  const reach = BAL.digReach;
  const tiles: number[] = [];
  for (let y = e.y - reach; y < e.y + h + reach; y++) {
    for (let x = e.x - reach; x < e.x + w + reach; x++) {
      if (isRock(sim.grid.terrain(x, y)) && inReach(e, x, y)) tiles.push(tileIndex(x, y));
    }
  }
  if (!sim.designate(tiles, true)) b.skip('designate');
}
