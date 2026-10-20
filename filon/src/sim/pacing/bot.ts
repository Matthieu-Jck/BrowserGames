// pacing/bot.ts — a headless player that plays a new base for its first hours and records how
// they go (D146): the minute each quest is met, the purse, the power through every night, where
// the player waited and on what, the Core's stock and the production rates at each hour's end.
//
// It plays as a competent first-time player does: the quests in order, the guide's way (the
// scenarios' builders — the debug bases' « player's hands », scenarios.ts — lay each quest's
// factory on the real map), building what a goal asks as soon as the Core can pay for it; past
// the tutorial, Tier 1's research one node after another on the Core's compute, the lines its
// resources need where the base has room, CrierBelt's market for what it cannot make, the Core's
// level 3, two expertises, Tier 2. Through commands only (placements, ribbons, wires, recipes,
// plans, research launches, the starter contract, spot purchases, parcels): every rule a player
// meets, it meets. No grant of any kind — the `Builder`'s « grant what is short » becomes « wait
// until the base has it », and each wait is recorded with what it waited for (the pacing's dead
// zones). A wait has a cap: past it the step goes on without what it waited for (a building not
// placed, a quest not met) and the run reports it as a problem.
//
// Deterministic (the same land and founding minute give the same run), integers only, no clock:
// engine code, like the scenarios. pacing.test.ts runs it on lands 1–3 and keeps the main
// milestones within bounds; `PACING_OUT` writes the raw measurements (docs/pacing.md).
import { BAL } from '@/content/balance';
import { BUILDINGS } from '@/content/buildings';
import { EXPERTISE_IDS } from '@/content/expertises';
import { QUESTS, type QuestDef, type QuestId } from '@/content/quests';
import { BUILDING_KIND, buildingIdx, itemIdx } from '@/content/registry';
import { CATEGORIES, CATEGORY_IDS, planDef, RESEARCH, researchNode } from '@/content/research';
import { CIRQUE, WORLD_SEED } from '@/content/world';
import { CENTER, DAY_EPOCHS, EPOCH, SOLAR, WORLD_EPOCH0 } from '../constants';
import { branch, checkpoint, join, powerLine, rollback, spotsNear, type Feed } from '../dev';
import { worldPorts } from '../entities';
import { DX, DY, isFloor } from '../types';
import { inWorld, tileIndex } from '../world/grid';
import { PURSE_KINDS } from '../purse';
import { machineRefusals } from '../readouts/core-door';
import { nightCover } from '../readouts/night';
import { bloomKiln, Builder, coreUpgrade, fieldJournal, firstStrike, glassworks, ironSurplus, postAtHeart, postGlass, postLine, scenarioEpoch, starterDone, tiredVein, tradeLine } from '../scenarios';
import { brickWorks, intoCore } from '../scenario-basics';
import { quartzWorks, wallQuartz } from '../scenario-quartz';
import { steamPower } from '../scenario-steam';
import { filterFeed, sortWaste } from '../scenario-waste';
import { Sim } from '../state';
import { archiveOpen, rankOf, tierTwoOpen } from '../systems/expertise';
import { currentQuest, objectiveProgress, planOffered, questProgress } from '../systems/quests';
import { tierCoreOpen } from '../systems/research';
import { handsOut, tradePosts } from '../systems/trade';
import { parcelAt } from '../world/land';
import { MapGen } from '../world/mapgen';

// ── what is recorded ────────────────────────────────────────────────────────

/** What a wait was for: the pacing's dead zones by cause. */
export type WaitKind = 'items' | 'money' | 'quest' | 'research' | 'lab' | 'idle';

export interface Wait {
  /** Game minute it began, and its length in game minutes (tenths). */
  at: number;
  min: number;
  kind: WaitKind;
  /** What exactly (the items short, the parcel's price, the quest's progress…), as it stood when the wait began. */
  what: string;
  /** What the player was doing (the quest, or the step past the tutorial). */
  doing: string;
}

/** One night: from the dusk to the full sun again (the stretch the Core's panel gives less than its best). */
export interface Night {
  n: number;
  /** Game minutes the dusk began and the full sun came back. */
  from: number;
  to: number;
  /** The Core's grid's lowest satisfaction (‰), and the game minutes it stood under 1000 ‰ with a demand (tenths). */
  minSat: number;
  below: number;
  /** `nightCover` at dusk (« Tenir la nuit »'s measure, %), and the grid's demand then (kW). */
  cover: number;
  demand: number;
  /** Turbines and steam boilers standing at dusk. */
  turbines: number;
  boilers: number;
}

/** An hour's end: the Core's stock, and what the base made, took into the Core and sold a minute (over the hour's last 20 minutes). */
export interface HourMark {
  h: number;
  stock: Record<string, number>;
  /** Items a minute (tenths): made (`sim.produced`), into the Core (`hearthIn`), sold (`soldTotal`). */
  made: Record<string, number>;
  intoCore: Record<string, number>;
  sold: Record<string, number>;
  /** The purse (◉) and its change over the hour; that change by kind (`purseLog`, ◉). */
  purse: number;
  perHour: number;
  byKind: Record<string, number>;
  /** Items paid so far into the buildings standing, the plans, the research launched and the Core's levels. */
  spent: { buildings: Record<string, number>; plans: Record<string, number>; research: Record<string, number>; core: Record<string, number> };
}

export interface PacingRun {
  land: number;
  /** World minute founded (the last sunrise at or before the run's `near`). */
  founded: number;
  minutes: number;
  /** Game minute (tenths) each milestone was reached; absent: not within the run. */
  milestones: Record<string, number>;
  /** The purse (whole ◉) at each game minute's end. */
  purse: number[];
  nights: Night[];
  /** Each day's lowest satisfaction (‰) and minutes under 1000 ‰ (tenths): daylight shortages. */
  days: Array<{ n: number; minSat: number; below: number }>;
  waits: Wait[];
  hours: HourMark[];
  /** Spot purchases (whole items) and what they cost (◉). */
  bought: Record<string, number>;
  boughtCost: number;
  /** What the map did not allow (`Builder.report.skipped`): room on the land. */
  skipped: string[];
  /** Anything impossible or absurd met on the way: a quest not met, a plan not offered, a grant asked for… */
  problems: string[];
  /** Research: node → [launched, learnt] game minutes (tenths; learnt null: not within the run). */
  research: Record<string, [number, number | null]>;
  /** The lab's idle minutes, by why the next node could not start. */
  labIdle: Record<string, number>;
  /** The game minutes the player added turbines after a night that dipped. */
  powerAdds: number[];
  /** The expertises chosen, in order. */
  expertises: string[];
}

/** The items followed at each hour's end. */
export const KEY_ITEMS = [
  'iron_ore', 'coal', 'sand', 'copper_ore', 'quartz', 'iron_plate', 'glass', 'copper_wire', 'copper_coil',
  'oscillator', 'gear', 'motor', 'copper_plate', 'brick', 'steel',
] as const;

// ── the player's choices (the bot's, not the game's) ─────────────────────────

/** Ticks between two looks while waiting (5 s): the waits are measured to this. */
const LOOK = 50;
/** Game minutes a wait may last before the step goes on without it (reported as a problem). */
const ITEM_CAP = 45, QUEST_CAP = 60, MONEY_CAP = 60;
/** Minutes a research node or the Core's level waits on items before the player buys what is short. */
const BUY_AFTER = 8;
/** ◉ (cents) the player keeps in the purse when buying. */
const BUY_KEEP = 10_000;
/** Do « La verrerie »'s hints point at a coal drill of its own (D146), rather than a router on the coal line? */
const GLASS_HINTS_DRILL = ((QUESTS.glassworks as QuestDef).hints ?? []).some((h) => h.target.k === 'build' && h.target.def === 'drill');
/** The shortest glass line the player leaves (« La Criée » branches it with a router). */
const GLASS_LINE = 6;
/** « Tenir la nuit »: at most this many turbines while the night does not hold (its hints name four). */
const NIGHT_TURBINES = 6;
/** Turbines added the day after a night that dipped, and the most the bot ever stands. */
const DIP_TURBINES = 2, MAX_TURBINES = 24;
/** A turbine's spot must be at least this exposed (‰, D95); the guide's arrow points at the windiest. */
const WINDY = 900;
/**
 * Tier 1's nodes in the order the player takes them: what the base makes already first (plates,
 * wire, glass), what the next lines need after; the Synthesis last. The lab runs the first that can start.
 */
const TIER1_ORDER = [
  'tr1', 'dn_quartzshop', 'en_pitch', 'xp_swift', 'ex_fastdrill', 'cm_post2', 'dn_copper', 'an_data', 'ex_brick',
  'dn3', 'en2', 'xp_bigsilo', 'xp_guard', 'dn_steel', 'dn_wiremill', 'dn_esmelt', 'cm_floor', 'tr_synth',
];
/**
 * Tier 2's, once it opens (the Core's level 3, two expertises). Far Claim (Tier 1 since D161) with
 * them, before the camouflaged ribbon whose category it gates (D128): this base buys no far parcel,
 * so it takes the node only once Tier 2 is open (`keepResearch`), and Tier 1 runs as before.
 */
const TIER2_ORDER = ['cm2', 'cm_autosell', 'an_servers', 'workshop', 'en_heavyacc', 'xp_far', 'xp_camo', 'tr3', 'tr2', 'dn4'];
/** Nodes of Tier 1 the bot leaves until Tier 2 opens (the Core's level for it). */
const AFTER_TIER1: ReadonlySet<string> = new Set(['xp_far']);

/** The run's last tick passed: thrown by `run`, caught by `playPacing`. */
class TimeUp extends Error {}

const tenths = (ticks: number): number => Math.round(ticks / 60) / 10;
const costOf = (def: string): ReadonlyArray<readonly [string, number]> => (BUILDINGS as Record<string, { cost: ReadonlyArray<readonly [string, number]> }>)[def]?.cost ?? [];
const needOf = (cost: ReadonlyArray<readonly [string, number]>, times = 1): Map<string, number> => {
  const m = new Map<string, number>();
  for (const [it, n] of cost) if (n * times > 0) m.set(it, (m.get(it) ?? 0) + n * times);
  return m;
};

// ── the player ──────────────────────────────────────────────────────────────

export class PacingBot extends Builder {
  readonly out: PacingRun;
  /** The last tick it plays to. */
  private readonly end: number;
  /** In a background look (power, research, purchases): nothing there waits. */
  private bg = false;
  /** A foreground wait on items under way: the background launches no research that would take them. */
  private needing: ReadonlyMap<string, number> | null = null;
  /** What it is doing (a wait's `doing`). */
  doing = 'start';
  /** Whether the background may buy what research and the Core's levels lack (past the tutorial). */
  buying = false;
  /** Does the player ask for the goals' hints (« Indice ») and do what they say beyond the quest's objectives? */
  askHints = true;
  /** « La verrerie »'s coal: the glass smelter's own drill (its hints point at one, D146) or a router sharing the coal line. */
  glassCoal = GLASS_HINTS_DRILL;
  /** Called after each step of the tutorial (a debugging look; the test leaves it out). */
  trace?: (b: PacingBot, step: string) => void;
  // Power: the night (or day) under way, its ticks under 1000 ‰.
  private night: Night | null = null;
  private nightBelow = 0;
  private day = { n: 1, minSat: 1000, below: 0 };
  private dayBelow = 0;
  private dipped = 0;
  private lastAdd = -EPOCH;
  // Each minute's counters (for the hour marks).
  private readonly made: Float64Array[] = [];
  private readonly into: Float64Array[] = [];
  private readonly sold: Float64Array[] = [];
  private readonly log0 = PURSE_KINDS.map(() => 0);
  /** Since when (tick) each item has been short for research or the Core's level. */
  private readonly shortSince = new Map<string, number>();

  constructor(sim: Sim, readonly land: number, minutes: number) {
    super(sim, 'tutorial');
    this.end = minutes * EPOCH;
    this.out = {
      land, founded: sim.foundingEpoch, minutes, milestones: {}, purse: [], nights: [], days: [], waits: [], hours: [],
      bought: {}, boughtCost: 0, skipped: this.report.skipped, problems: [], research: {}, labIdle: {}, powerAdds: [], expertises: [],
    };
    // No free grant, ever: a builder that would grant gets nothing, and the run says so.
    sim.grant = (item: string, n: number): void => { this.problem(`grant asked: ${n} ${item}`); };
    sim.grantCredits = (cents: number): void => { this.problem(`grant asked: ${Math.round(cents / 100)} ◉`); };
  }

  problem(s: string): void {
    this.out.problems.push(`${tenths(this.sim.tick)} min · ${this.doing} · ${s}`);
  }

  get minute(): number { return tenths(this.sim.tick); }
  get timeLeft(): boolean { return this.sim.tick < this.end; }

  // ── time ──

  /** Run the base, looking at its power every few seconds and at everything every minute (the record, the background play). */
  override run(ticks: number): void {
    const sim = this.sim;
    let left = ticks;
    while (left > 0) {
      if (sim.tick >= this.end) throw new TimeUp();
      const n = Math.min(left, LOOK, EPOCH - (sim.tick % EPOCH), this.end - sim.tick);
      sim.run(n);
      left -= n;
      this.report.ticks += n;
      this.lookPower(n);
      if (sim.tick % EPOCH === 0) this.everyMinute();
    }
  }

  /** Run until `ok()` holds (at most `cap` minutes), the time recorded as a wait on `kind`. In the background: no wait. */
  waitUntil(ok: () => boolean, kind: WaitKind, what: () => string, cap: number): boolean {
    if (ok()) return true;
    if (this.bg) return false;
    const t0 = this.sim.tick, desc = what(), doing = this.doing;
    try {
      while (!ok()) {
        if (this.sim.tick - t0 >= cap * EPOCH) { this.problem(`waited ${cap} min on ${kind}: ${desc}`); break; }
        this.run(LOOK);
      }
    } finally {
      if (this.sim.tick > t0) this.logWait(t0, kind, desc, doing);
    }
    return ok();
  }

  /** A wait from `t0` to now, merged into the last one when it is the same wait going on. */
  private logWait(t0: number, kind: WaitKind, what: string, doing: string): void {
    const w = this.out.waits, last = w[w.length - 1];
    if (last && last.kind === kind && last.what === what && last.doing === doing && Math.abs(last.at + last.min - tenths(t0)) < 0.05) last.min = tenths(this.sim.tick) - last.at;
    else w.push({ at: tenths(t0), min: tenths(this.sim.tick - t0), kind, what, doing });
    if (last && w[w.length - 1] === last) last.min = Math.round(last.min * 10) / 10;
  }

  /** A minute with nothing to build: the base runs, the wait recorded on `kind` (merged with the minute before). */
  pass(kind: WaitKind, what: string): void {
    const t0 = this.sim.tick;
    try { this.run(EPOCH); } finally { this.logWait(t0, kind, what, this.doing); }
  }

  // ── the Builder's grants, turned into waits ──

  /** What of `need` (item → whole items) the Core lacks, as « item have/need ». */
  short(need: ReadonlyMap<string, number>): string[] {
    const out: string[] = [];
    for (const [it, n] of need) {
      const have = Math.floor(this.sim.stock[itemIdx(it)]! / 1000);
      if (have < n) out.push(`${it} ${have}/${n}`);
    }
    return out;
  }

  /** Wait until the Core holds `need` (the background launches nothing that takes from it meanwhile). */
  waitItems(need: ReadonlyMap<string, number>, cap = ITEM_CAP): boolean {
    const was = this.needing;
    this.needing = need;
    try {
      return this.waitUntil(() => this.short(need).length === 0, 'items', () => this.short(need).join(', '), cap);
    } finally { this.needing = was; }
  }

  override afford(cost: ReadonlyArray<readonly [string, number]>, times = 1): void {
    this.waitItems(needOf(cost, times));
  }

  override affordNode(id: string): void {
    const sim = this.sim, r = researchNode(id);
    if (!r) return;
    const need = needOf(r.cost);
    this.waitItems(need);
    this.waitUntil(() => !['slots', 'no_lab'].includes(sim.researchBlock(id) ?? ''), 'lab', () => `${id}: the lab busy (${sim.projects.map((p) => p.id).join(', ')})`, ITEM_CAP);
  }

  override grantNode(id: string): void { this.problem(`research granted asked: ${id}`); }

  override plan(...ids: string[]): void {
    const sim = this.sim;
    for (const p of ids) {
      if (sim.done.has(p)) continue;
      const def = planDef(p);
      if (!def) { this.skip(`plan:${p}`); continue; }
      for (const q of def.prereq) this.plan(q);
      if (!planOffered(sim, p)) { this.problem(`plan ${p} asked for before the tree offers it`); continue; }
      const need = needOf(def.cost);
      this.waitItems(need);
      // The restart reserve (D36) can hold a plan back with its cost in the Core: a wait of its own.
      this.waitUntil(() => { const b = sim.planBlock(p); return b === null || b === 'done'; }, 'items', () => `plan ${p}: ${sim.planBlock(p)}`, ITEM_CAP);
      if (!sim.done.has(p) && !sim.unlockPlan(p).ok) this.skip(`plan:${p}`);
    }
  }

  override landFor(tiles: ReadonlyArray<readonly [number, number]>): boolean {
    const sim = this.sim;
    const need = [...new Set(tiles.map(([x, y]) => parcelAt(x, y)))].filter((p) => !sim.land.holds(p)).sort((p, q) => p - q);
    for (const p of need) {
      this.waitUntil(() => sim.credits >= sim.landPrice(p), 'money', () => `parcel ${p}: ${Math.round(sim.landPrice(p) / 100)} ◉ (purse ${Math.round(sim.credits / 100)} ◉)`, MONEY_CAP);
      if (sim.buyLand(p) !== null) { this.skip(`land:${p}`); return false; }
    }
    return true;
  }

  override until(q: QuestId): void {
    const st = this.sim.quests;
    if (!st.done.includes(q)) this.questTurbines();
    const ok = this.waitUntil(() => st.done.includes(q), 'quest', () => `${q} ${questProgress(this.sim).map((p) => `${p.have}/${p.need}`).join(' ')}`, QUEST_CAP);
    if (!ok) this.problem(`quest ${q} not met after ${QUEST_CAP} min`);
  }

  /**
   * A quest that asks for turbines on the grid (D146: « Le quartz de la paroi »'s four), as its
   * hints play it: turbines at the windiest spots the arrow shows, wired, until the count holds.
   */
  questTurbines(): void {
    const sim = this.sim, q = currentQuest(sim);
    for (const o of q?.def.objectives ?? []) {
      if (o.k !== 'linked' || !o.defs.includes('wind_flower')) continue;
      for (let k = 0; k < 8 && !objectiveProgress(sim, o).met; k++) {
        this.afford([...costOf('wind_flower'), ...costOf('mast').map(([it, n]) => [it, n * 4] as const)]);
        const role = `questWind${k + 1}`;
        if (!this.windyWired(role, 'wind_flower', this.windAnchor(), 10, WINDY) && !this.windyWired(role, 'wind_flower', [CENTER, CENTER], crownR(sim), WINDY)) { this.skip(role); break; }
        sim.ensureCompiled();
      }
    }
  }

  /** Wire buildings into the Core's grid: a few poles' cost in hand, a line, again while it falls short. */
  override wire(...roles: string[]): void {
    const sim = this.sim;
    for (const role of roles) {
      const id = this.ids[role];
      if (!id) continue;
      for (let k = 0; k < 4 && !sim.linksOf(id).length; k++) {
        if (k > 0 || !this.bg) this.afford(costOf('mast'), 4);
        powerLine(sim, id);
        if (this.bg) break;
      }
      if (!sim.linksOf(id).length) this.skip(`wire:${role}`);
    }
  }

  // ── each look: the power ──

  private lookPower(ticks: number): void {
    const sim = this.sim, net = sim.graph?.netOfEnt.get(sim.hearthId);
    const p = net === undefined ? undefined : sim.netPower[net];
    if (!p) return;
    const sun = SOLAR[sim.absEpoch() % DAY_EPOCHS]!;
    if (sun < 1000 && !this.night) {
      const c = nightCover(sim), counts = sim.ents.defCounts();
      this.night = {
        n: this.out.nights.length + 1, from: this.minute, to: this.minute, minSat: 1000, below: 0, cover: c?.pct ?? 0, demand: c?.demand ?? 0,
        turbines: (counts[buildingIdx('wind_flower')] ?? 0) + (counts[buildingIdx('pitch_turbine')] ?? 0), boilers: counts[buildingIdx('steam_boiler')] ?? 0,
      };
      this.nightBelow = 0;
      this.day.below = tenths(this.dayBelow);
      this.out.days.push(this.day);
    } else if (sun >= 1000 && this.night) {
      this.closeNight();
      this.day = { n: this.out.days.length + 1, minSat: 1000, below: 0 };
      this.dayBelow = 0;
    }
    if (this.night) {
      this.night.minSat = Math.min(this.night.minSat, p.sat);
      if (p.sat < 1000 && p.demand > 0) this.nightBelow += ticks;
    } else {
      this.day.minSat = Math.min(this.day.minSat, p.sat);
      if (p.sat < 1000 && p.demand > 0) this.dayBelow += ticks;
    }
  }

  private closeNight(): void {
    const n = this.night!;
    n.to = this.minute;
    n.below = tenths(this.nightBelow);
    this.out.nights.push(n);
    if (n.minSat < 1000) this.dipped = DIP_TURBINES;
    this.night = null;
  }

  /** The run's end: the night or day under way closed as it stands. */
  finish(): void {
    if (this.night) { this.closeNight(); this.out.nights[this.out.nights.length - 1]!.to = this.minute; }
    else { this.day.below = tenths(this.dayBelow); this.out.days.push(this.day); }
  }

  // ── each minute: the record and the background play ──

  private everyMinute(): void {
    const sim = this.sim;
    this.out.purse.push(Math.floor(sim.credits / 100));
    this.made.push(Float64Array.from(sim.produced));
    this.into.push(Float64Array.from(sim.hearthIn));
    this.sold.push(Float64Array.from(sim.trade.soldTotal));
    this.milestones();
    const m = sim.tick / EPOCH;
    if (m % 60 === 0) this.hourMark(m / 60);
    if (this.bg) return;
    this.bg = true;
    try {
      this.keepPower();
      this.keepResearch();
      this.chooseExpertises();
    } finally { this.bg = false; }
  }

  private mark(k: string, holds: boolean): void {
    if (holds && this.out.milestones[k] === undefined) this.out.milestones[k] = this.minute;
  }

  private milestones(): void {
    const sim = this.sim, st = sim.quests;
    st.done.forEach((id, i) => { if (this.out.milestones[`quest:${id}`] === undefined) this.out.milestones[`quest:${id}`] = tenths(st.doneAt[i]!); });
    const counts = sim.ents.defCounts();
    let drills = 0;
    for (let d = 0; d < counts.length; d++) if (counts[d] && BUILDING_KIND[d] === 'drill') drills += counts[d]!;
    this.mark('firstDrill', drills > 0);
    this.mark('firstPost', (counts[buildingIdx('trade_post')] ?? 0) > 0);
    this.mark('firstSale', sim.trade.earned > 0);
    this.mark('lab', (counts[buildingIdx('observatory')] ?? 0) > 0);
    for (let l = 2; l <= 5; l++) this.mark(`core${l}`, sim.hearthLevel >= l);
    for (const c of CATEGORY_IDS) {
      if (CATEGORIES[c].tier !== 1) continue;
      this.mark(`cat:${c}`, Object.entries(RESEARCH).every(([id, r]) => r.cat !== c || sim.done.has(id)));
    }
    this.mark('tier1', sim.done.has('tr_synth'));
    this.mark('tier2', tierCoreOpen(sim, 2) && tierTwoOpen(sim));
    for (const p of sim.projects) if (!this.out.research[p.id]) this.out.research[p.id] = [this.minute, null];
    for (const [id, r] of Object.entries(this.out.research)) if (r[1] === null && sim.done.has(id)) r[1] = this.minute;
  }

  private hourMark(h: number): void {
    const sim = this.sim, k = this.made.length - 1, k0 = Math.max(0, k - 20), span = k - k0 || 1;
    const per = (a: Float64Array[], it: number): number => Math.round(((a[k]![it]! - a[k0]![it]!) * 10) / (1000 * span)) / 10;
    const pick = (f: (it: number) => number): Record<string, number> => Object.fromEntries(KEY_ITEMS.map((id) => [id, f(itemIdx(id))]));
    const byKind: Record<string, number> = {};
    PURSE_KINDS.forEach((kd, i) => {
      const d = Math.round((sim.purseLog[kd] - this.log0[i]!) / 100);
      if (d) byKind[kd] = d;
      this.log0[i] = sim.purseLog[kd];
    });
    const prev = this.out.hours.length ? this.out.hours[this.out.hours.length - 1]!.purse : BAL.startCredits;
    this.out.hours.push({
      h, stock: pick((it) => Math.floor(sim.stock[it]! / 1000)), made: pick((it) => per(this.made, it)), intoCore: pick((it) => per(this.into, it)), sold: pick((it) => per(this.sold, it)),
      purse: Math.floor(sim.credits / 100), perHour: Math.floor(sim.credits / 100) - prev, byKind, spent: spentSoFar(sim),
    });
  }

  // ── background: the night ──

  /**
   * After « Tenir la nuit », a night whose grid dipped under 100 % makes the player add turbines the
   * next day (two, at the windiest spots left, wired), as soon as the Core can pay for them: the
   * player who reads the energy bar in the morning. The best turbine learnt; at most `MAX_TURBINES`.
   */
  private keepPower(): void {
    const sim = this.sim;
    if (!this.dipped || !sim.quests.done.includes('first_wind')) return;
    if (SOLAR[sim.absEpoch() % DAY_EPOCHS]! < 1000 || sim.tick - this.lastAdd < 2 * EPOCH) return;
    const counts = sim.ents.defCounts();
    if ((counts[buildingIdx('wind_flower')] ?? 0) + (counts[buildingIdx('pitch_turbine')] ?? 0) >= MAX_TURBINES) { this.dipped = 0; return; }
    // The best turbine the Core can pay for now, with a few poles: the pitch-control one once learnt
    // and its coils and gears in hand, else the plain one; else not yet (the next minute looks again).
    const withPoles = (d: string): Map<string, number> => needOf([...costOf(d), ...costOf('mast').map(([it, n]) => [it, n * 4] as const)]);
    const def = ['pitch_turbine', 'wind_flower'].find((d) => sim.unlocked(d === 'pitch_turbine' ? 'en_pitch' : 'wind_flower') && !this.short(withPoles(d)).length);
    if (!def) return;
    this.lastAdd = sim.tick;
    const role = `dip${this.out.powerAdds.length + 1}`;
    const id = this.windyWired(role, def, this.windAnchor(def), 10, WINDY) || this.windyWired(role, def, [CENTER, CENTER], crownR(sim), WINDY);
    if (!id) { this.dipped = 0; return; }
    this.out.powerAdds.push(this.minute);
    this.dipped--;
  }

  // ── background: research ──

  /**
   * The lab's next node, as the player launches it: the first in their order that can start; else
   * the reason none can is counted (`labIdle`), and past the tutorial what the first one waiting on
   * resources lacks is bought (`buyShort`) once it has waited `BUY_AFTER` minutes.
   */
  private keepResearch(): void {
    const sim = this.sim;
    if (!sim.unlocked('observatory') || !sim.idleLabs().length || sim.projects.length >= sim.mods.slots) return;
    let why = '';
    for (const id of [...TIER1_ORDER, ...TIER2_ORDER]) {
      if (AFTER_TIER1.has(id) && sim.hearthLevel < BAL.tierCoreLevel[1]!) continue;
      const b = sim.researchBlock(id);
      if (b === 'done' || b === 'active' || b === 'prereq') continue;
      const r = researchNode(id)!, need = needOf(r.cost);
      // A foreground wait on these items: the quest's building comes first.
      if (b === null && this.needing && [...need.keys()].some((it) => this.needing!.has(it))) { why ||= `${id}: the quest's building first`; continue; }
      if (b === null) {
        if (sim.startResearch(id).ok) this.out.research[id] = [this.minute, null];
        for (const it of need.keys()) this.shortSince.delete(it);
        return;
      }
      if (b === 'unaffordable' || b === 'reserve') {
        if (this.buying) this.buyShort(need);
        why ||= `${id}: ${this.short(need).map((s) => s.split(' ')[0]).join(', ') || b}`;
      } else why ||= `${id}: ${b}`;
    }
    const k = why || 'nothing left to launch';
    this.out.labIdle[k] = (this.out.labIdle[k] ?? 0) + 1;
  }

  // ── background: expertises ──

  /** The Archive mounted (the Core's level 3), its empty slots take the highest-ranked expertises earned. */
  private chooseExpertises(): void {
    const sim = this.sim;
    if (!archiveOpen(sim)) return;
    sim.expertise.slots.forEach((s, slot) => {
      if (s) return;
      const pick = EXPERTISE_IDS.filter((id) => rankOf(sim, id) > 0 && !sim.expertise.slots.some((q) => q?.id === id))
        .sort((a, b) => rankOf(sim, b) - rankOf(sim, a))[0];
      if (pick && sim.chooseExpertise(slot, pick) === null) this.out.expertises.push(pick);
    });
  }

  // ── buying what is short ──

  /**
   * Buy at CrierBelt (a spot purchase: its post's exit leads into the Core) what `need` lacks and has
   * lacked for `BUY_AFTER` minutes (at once with `now`), while the purse keeps `BUY_KEEP`; whether
   * anything was bought.
   */
  buyShort(need: ReadonlyMap<string, number>, now = false): boolean {
    const sim = this.sim, post = tradePosts(sim)[0];
    if (!post) return false;
    let any = false;
    for (const [it, n] of need) {
      const i = itemIdx(it), have = Math.floor(sim.stock[i]! / 1000);
      let coming = 0;
      for (const s of sim.trade.inflight) if (s.item === i) coming += s.mu;
      coming += sim.stores.get(post.id)?.[i] ?? 0;
      const lack = n - have - Math.floor(coming / 1000);
      if (lack <= 0) continue;
      if (!this.shortSince.has(it)) this.shortSince.set(it, sim.tick);
      if (!now && sim.tick - this.shortSince.get(it)! < BUY_AFTER * EPOCH) continue;
      if (!handsOut(sim, post, i)) continue;
      const q = sim.quoteSpot(i, 'buy', lack);
      if (!q.ok || sim.credits - q.cents < BUY_KEEP) continue;
      const r = sim.spotTrade(it, 'buy', lack);
      if ('cents' in r) {
        this.out.bought[it] = (this.out.bought[it] ?? 0) + lack;
        this.out.boughtCost += Math.round(-r.cents / 100);
        any = true;
      }
    }
    return any;
  }

  /** Wait until the Core holds `need`, buying what stays short past `BUY_AFTER` minutes. */
  gather(need: ReadonlyMap<string, number>, cap: number): boolean {
    const was = this.needing;
    this.needing = need;
    try {
      return this.waitUntil(() => { this.buyShort(need); return this.short(need).length === 0; }, 'items', () => this.short(need).join(', '), cap);
    } finally { this.needing = was; }
  }
}

// ── the play ────────────────────────────────────────────────────────────────

/**
 * « Tenir la nuit » as its hints play it (D101, D143): the turbine's plan, then turbines at the
 * windiest spots the guide's arrow shows (`{ windy: true }`: the Crown's windiest free spot), each
 * wired pole by pole, while the night does not hold.
 */
function nightTurbines(b: PacingBot): void {
  const sim = b.sim;
  b.plan('wind_flower');
  const o = (QUESTS.first_wind as QuestDef).objectives.find((q) => q.k === 'night');
  const pct = o && o.k === 'night' ? o.pct : 80;
  const holds = (): boolean => (nightCover(sim)?.pct ?? 0) >= pct;
  for (let k = 1; k <= NIGHT_TURBINES && !holds(); k++) {
    b.afford([...costOf('wind_flower'), ...costOf('mast').map(([it, n]) => [it, n * 4] as const)]);
    const id = b.windyWired(`wind${k}`, 'wind_flower', b.windAnchor(), 10, WINDY) || b.windyWired(`wind${k}`, 'wind_flower', [CENTER, CENTER], crownR(sim), WINDY);
    if (!id) { b.skip(`wind${k}`); break; }
    sim.ensureCompiled();
  }
  b.until('first_wind');
}

/**
 * « La verrerie » with the glass smelter's own coal (D146): a second smelter on glass, a coal drill
 * of its own on the cirque's coal (the kit's drill: the plate smelter keeps its whole coal line, D97),
 * two sand collectors; its glass into the Core. Round the first smelter, then the coal; each try
 * taken back up whole. None fits: the router way, sharing the coal line (the scenarios' `glassworks`).
 */
function glassOwnCoal(b: PacingBot): void {
  const sim = b.sim;
  b.plan('sand_collector');
  b.afford([...costOf('kiln'), ...costOf('drill'), ...costOf('sand_collector'), ...costOf('sand_collector')]);
  // A glass line of a few tiles at least: « La Criée » puts a router on it, toward the trade post.
  for (const near of [b.deposit('coal'), b.mid(b.deposit('coal')), b.centre('kiln1')]) {
    const cp = checkpoint(sim), skips = b.report.skipped.length;
    if (b.fed('kiln2', 'kiln', near, [], b.H, 'glass', false) && (b.lines.glass?.length ?? 0) >= GLASS_LINE) {
      b.recipe('kiln2', 'glass');
      if (b.source('coalG', 'drill', b.deposit('coal'), b.ids.kiln2!, { item: 'coal', r: 30 })
        && b.source('sand1', 'sand_collector', b.away('kiln2', 3), b.ids.kiln2!)) {
        b.report.skipped.length = skips;
        if (b.source('sand2', 'sand_collector', b.centre('sand1'), 'sand1')) b.wire('sand2');
        b.wire('coalG', 'sand1');
        b.until('glassworks');
        return;
      }
    }
    rollback(sim, cp);
    b.report.skipped.length = skips;
    for (const r of ['kiln2', 'coalG', 'sand1', 'glass']) { delete b.ids[r]; delete b.lines[r]; }
  }
  glassworks(b);
}

/**
 * « La Criée »'s wire mill out by the copper vein (its hint: « une foreuse dessus, son ruban jusqu’à la
 * tréfileuse »), three quarters of the way from the Core, so its wire comes in along a line the
 * quartz workshop and the bench can branch later; the vein's drill into it. The scenarios set it
 * halfway, a few tiles from the Core: the quartz line, routed after, can wall that short line in.
 */
function wireMill(b: PacingBot): void {
  b.plan('wire_mill');
  const dep = b.deposit('copper_ore');
  b.fed('mill', 'wire_mill', b.mid(dep, b.mid(dep)), [], b.H, 'wire');
  if (!b.ids.mill) { b.unskip('mill'); tiredVein(b); return; }
  b.source('copper', 'drill', b.centre('mill'), b.ids.mill, { item: 'copper_ore', r: 30 });
  b.recipe('mill', 'copper_wire');
  b.wire('copper', 'mill');
}

/**
 * « La Criée »'s trade post and its glass: against the Core where a corner is left (the scenarios'
 * `postAtHeart`, which takes its place before the tutorial's lines ring the Core — a player meets
 * the post only now), else where the floor has room near the glass line, its exit with three free
 * tiles ahead (the contract's line and the purchases leave by it); wired, glass led into its entrance
 * by a router on the glass line (`postGlass`).
 */
function postAndGlass(b: PacingBot): void {
  const sim = b.sim;
  b.plan('telemetry', 'trade_post');
  b.afford(costOf('trade_post'));
  if (postAtHeart(b)) { postGlass(b); return; }
  b.unskip('post');
  const glass = b.laid('glass');
  if (!glass.length) { b.skip('post'); return; }
  const free = (x: number, y: number): boolean => inWorld(x, y) && sim.grid.occ[tileIndex(x, y)] === 0 && isFloor(sim.grid.terrain(x, y));
  const def = buildingIdx('trade_post');
  for (const near of [b.middle('glass'), b.quietSide(10), b.heart] as Array<[number, number]>) {
    for (const [x, y, rot] of spotsNear(sim, 'trade_post', near, { r: 14 }).slice(0, 30)) {
      const outs = worldPorts({ def, x, y, rot }).filter((p) => p.io === 'out');
      if (!outs.every((p) => [0, 1, 2].every((k) => free(p.fx + k * DX[p.dir]!, p.fy + k * DY[p.dir]!)))) continue;
      const cp = checkpoint(sim);
      const r = sim.place('trade_post', x, y, rot);
      if (!r.ok) continue;
      b.afford(costOf('router'));
      const br = branch(sim, glass, r.id!, -1);
      if (br) {
        b.ids.post = r.id!;
        b.lines['post.glass'] = br.path;
        b.wire('post');
        return;
      }
      rollback(sim, cp);
    }
  }
  b.skip('post');
}

/** « La Criée »'s contract: signed on the post, its ore led from the post's exit into the side of the copper drill's line (the scenarios' `starterLine`, its sorting left to « Les scories »). */
function signStarter(b: PacingBot): void {
  const sim = b.sim, post = b.ids.post, copper = b.lines.copper;
  if (!post || !copper) { b.skip('starter'); return; }
  if (typeof sim.takeStarter(post) !== 'number') { b.skip('starter'); return; }
  b.crossings();
  let path = join(sim, post, copper);
  if (!path && b.junctions()) { b.crossings(); path = join(sim, post, copper); }
  if (path) b.lines['post.starter'] = path; else b.skip('line:post.starter');
}

/**
 * « Les scories » as its hints play it: the sorter and the incinerator's plans, a sorter on the tile
 * where the slag waits at the wire mill's door (`{ refused: true }`: laid there it takes the slag in,
 * D139), set to the ore, an incinerator on its free side. No slag waiting yet, or that tile a bend (a
 * sorter takes only from behind): the contract's own line, its last tiles first. On a bend the slag
 * already at the door stays there (D146, docs/pacing.md: a hazard of the tutorial, reported).
 */
function slagSort(b: PacingBot): void {
  const sim = b.sim, ore = BAL.starter.item;
  b.plan('sorter', 'incinerator');
  b.afford([...costOf('sorter'), ...costOf('incinerator')]);
  const copper = b.lines.copper, starter = b.lines['post.starter'];
  sim.ensureCompiled();
  const stuck = machineRefusals(sim).find((r) => r.by === b.ids.mill);
  const at = copper && stuck ? copper.findIndex(([x, y]) => tileIndex(x, y) === stuck.tile) : -1;
  // A tile of the copper line before the contract's joins it would never see the slag: on the copper
  // line only where the slag already waits; else the contract's own line, its last tiles first.
  const s = (copper && at >= 0 ? sortWaste(sim, copper, ore, at) : null)
    ?? (starter ? sortWaste(sim, starter, ore, Math.max(0, starter.length - 3)) ?? sortWaste(sim, starter, ore) : null);
  if (s) { b.ids.slagSorter = s.sorter; b.ids.slagPit = s.pit; } else b.skip('slag');
}

/**
 * « Les pièces de la Synthèse »'s bench (D129): coils of copper wire on iron plates, off the wire
 * line and a plate line, into the Core (`machine`: the Core's inputs are all taken by then, so into
 * the side of a line running there). Where no plate line can be branched (the tutorial's run
 * straight into the Core), a smelter of its own feeds it, as a player builds one.
 */
function coilBench(b: PacingBot): void {
  const sim = b.sim;
  b.plan('assembly_bench');
  const wire = b.laid('wire', 'osc.in1'), plates = b.laid('plates', 'plates4', 'plates.s1');
  if (!wire.length) { b.skip('bench'); return; }
  const at = [b.middle('wire'), b.middle('osc.in1'), b.centre('osc'), b.centre('mill'), b.middle('plates4'), b.heart];
  if (!machine(b, 'bench', 'assembly_bench', at, [{ lines: wire }, { lines: plates }], 1)) return;
  if (plates.length) filterFeed(sim, b.ids.bench!, 'iron_plate', plates);
  filterFeed(sim, b.ids.bench!, 'copper_wire', wire);
  b.recipe('bench', 'copper_coil');
  b.wire('bench');
}

/**
 * « Le Cœur grandit »'s hint when the Core is short of plates (« une deuxième fonderie de fer double
 * le débit »): a second iron smelter with its own drill pair — a coal drill and an iron drill on the
 * cirque's deposits (D97: one pair a smelter) —, its plates into the Core. Each part where the
 * floor has room; what does not fit is left out (reported).
 */
function secondSmelter(b: PacingBot): void {
  const sim = b.sim, coal = b.deposit('coal');
  // Where a player looks: by the coal, then between it and each iron deposit; each try taken back up whole.
  const tries: Array<[number, number]> = [b.mid(coal), b.mid(coal, b.deposit('iron_ore')), b.mid(coal, b.deposit('iron_ore', 1)), coal, b.mid(b.deposit('iron_ore', 1))];
  b.afford([...costOf('kiln'), ...costOf('drill'), ...costOf('drill')]);
  for (const near of tries) {
    const cp = checkpoint(sim), skips = b.report.skipped.length;
    if (b.fed('kiln4', 'kiln', near, [], b.H, 'plates4', false)
      && b.source('coal4', 'drill', coal, b.ids.kiln4!, { item: 'coal', r: 30 })
      && b.source('iron4', 'drill', b.centre('kiln4'), b.ids.kiln4!, { item: 'iron_ore', r: 30 })) {
      b.report.skipped.length = skips;
      b.recipe('kiln4', 'iron_plate');
      b.wire('coal4', 'iron4');
      return;
    }
    rollback(sim, cp);
    b.report.skipped.length = skips;
    for (const r of ['kiln4', 'coal4', 'iron4', 'plates4']) { delete b.ids[r]; delete b.lines[r]; }
  }
  b.skip('kiln4');
}

/** The tutorial, quest by quest, as its guide and hints play it. */
function tutorial(b: PacingBot, name: string): void {
  const sim = b.sim;
  const step = (doing: string, f: () => void): void => { b.doing = doing; f(); b.trace?.(b, doing); };
  step('claim', () => { if (!sim.nameColony(name)) b.problem('the name refused'); });
  step('first_strike', () => firstStrike(b));
  step('bloom_kiln', () => bloomKiln(b));
  step('first_wind', () => nightTurbines(b));
  step('glassworks', () => (b.glassCoal ? glassOwnCoal(b) : glassworks(b)));
  step('steam_power', () => steamPower(b));
  step('crier_trade', () => { postAndGlass(b); wireMill(b); signStarter(b); b.until('crier_trade'); });
  step('slag', () => { slagSort(b); b.until('slag'); starterDone(b); });
  step('core_upgrade', () => {
    // The hint on plates comes when the Core lacks them (the one smelter makes a few a minute): a
    // player who asks for hints builds the second smelter it names.
    if (b.askHints && sim.stock[itemIdx('iron_plate')]! < BAL.hearthUpgrades[0]!.cost[0]![1] * 1000) secondSmelter(b);
    coreUpgrade(b);
  });
  step('field_journal', () => fieldJournal(b));
  step('wall_quartz', () => wallQuartz(b, () => undefined));
  // The post's iron ore line (it sells what comes in) and its exit into the Core (what is bought comes there).
  step('trade lines', () => {
    postLine(b);
    tradeLine(b);
    // The scenarios' small standing order of plates is not this player's: it buys what it lacks, when it lacks it.
    for (const o of [...sim.trade.orders]) if (o.starter === undefined) sim.cancelImport(o.id);
  });
  step('synth_parts', () => {
    b.waitUntil(() => sim.done.has('dn_quartzshop'), 'research', () => `dn_quartzshop: ${sim.researchBlock('dn_quartzshop') ?? 'under way'}`, QUEST_CAP);
    quartzWorks(b);
    // Each branch's router filtered to what the workshop takes from it: the quartz line can run into
    // the wire line's side (the Core's inputs taken), and a mixed branch jams on the item it has enough of.
    if (b.ids.osc) { filterFeed(sim, b.ids.osc, 'quartz', b.laid('quartz')); filterFeed(sim, b.ids.osc, 'copper_wire', b.laid('wire')); }
    coilBench(b);
    b.until('synth_parts');
  });
  step('iron surplus', () => ironSurplus(b));
}

/**
 * A smelter of its own on iron plates for one machine (`role`'s): coal off the coal lines, an iron
 * drill of its own, its plates out to nothing yet (the caller leads them into its machine); round
 * `near`. Its id, or 0 (nothing left standing).
 */
function ownSmelter(b: PacingBot, role: string, near: readonly [number, number]): number {
  const sim = b.sim, coal = b.laid('coal', 'coal2', 'coalB', 'coal4');
  if (!coal.length) return 0;
  const cp = checkpoint(sim), skips = b.report.skipped.length;
  const kiln = b.fed(role, 'kiln', near, [{ lines: coal }], null, undefined, false);
  if (kiln && b.source(`${role}.iron`, 'drill', b.centre(role), kiln, { item: 'iron_ore', r: 30 })) {
    b.report.skipped.length = skips;
    b.recipe(role, 'iron_plate');
    b.wire(`${role}.iron`);
    return kiln;
  }
  rollback(sim, cp);
  b.report.skipped.length = skips;
  delete b.ids[role]; delete b.ids[`${role}.iron`];
  return 0;
}

/**
 * A machine (`role`) of `def` fed by `feeds` with its output into the Core, round each of
 * `anchors` in turn; else, when `plates` says which feed is its plates, by a smelter of its own
 * standing in for that feed. Its id, or 0 (reported).
 */
function machine(b: PacingBot, role: string, def: string, anchors: ReadonlyArray<readonly [number, number]>, feeds: Feed[], plates = -1): number {
  const sim = b.sim;
  b.afford(costOf(def));
  // Placed with its feeds, then its output led home: into a free input of the Core, else into the
  // side of a line running into it (`intoCore`: the Core's inputs are all taken by then); taken back up whole when it cannot.
  const home = (near: readonly [number, number], fs: Feed[]): number => {
    const cp = checkpoint(sim), skips = b.report.skipped.length;
    const id = b.fed(role, def, near, fs, null, undefined, false);
    const out = id ? intoCore(b, id) : null;
    b.report.skipped.length = skips;
    if (id && out) { b.lines[`${role}.out`] = out; return id; }
    if (id) rollback(sim, cp);
    delete b.ids[role];
    return 0;
  };
  if (feeds.every((f) => typeof f === 'number' || f.lines.length)) {
    for (const near of anchors) { const id = home(near, feeds); if (id) return id; }
  }
  if (plates >= 0) {
    for (const near of anchors) {
      const cp = checkpoint(sim);
      const kiln = ownSmelter(b, `${role}.kiln`, near);
      if (!kiln) continue;
      const id = home(b.centre(`${role}.kiln`), feeds.map((f, k) => (k === plates ? kiln : f)));
      if (id) return id;
      rollback(sim, cp);
    }
  }
  b.skip(role);
  return 0;
}

/** Mechanics' press: gears off a plate line (else a smelter of its own), into the Core. */
function gearPress(b: PacingBot): void {
  const plates = b.laid('plates4', 'plates', 'plates.s1');
  const at = [b.middle('plates4'), b.middle('plates'), b.centre('kiln4'), b.centre('kiln1'), b.centre('bench')];
  if (!machine(b, 'gears', 'press', at, [{ lines: plates }], 0)) return;
  b.recipe('gears', 'gear');
  filterFeed(b.sim, b.ids.gears!, 'iron_plate');
  b.wire('gears');
}

/** Motors (two coils and a gear) at a second bench, off the coil and the gear lines, into the Core. */
function motorBench(b: PacingBot): void {
  const coils = b.laid('bench.out'), gears = b.laid('gears.out');
  if (!coils.length || !gears.length) { b.skip('motors'); return; }
  const at = [b.centre('bench'), b.centre('gears'), b.middle('bench.out'), b.middle('gears.out')];
  if (!machine(b, 'motors', 'assembly_bench', at, [{ lines: coils }, { lines: gears }])) return;
  b.recipe('motors', 'motor');
  b.wire('motors');
}

/** Sand into the Core (the Brickworks' research takes 40): a collector near the Core, its line into it. */
function sandCore(b: PacingBot): void {
  if (b.source('sandCore', 'sand_collector', b.heart, b.H, { r: 16 })) b.wire('sandCore');
}

/**
 * Past the tutorial: Tier 1's research (the background launches it), the lines its resources ask
 * for as each opens, what stays short bought, the Core's level 3 once the Synthesis is learnt, then
 * Tier 2 — until the time is up.
 */
function tierOne(b: PacingBot): void {
  const sim = b.sim, done = new Set<string>();
  b.buying = true;
  const once = (k: string, when: boolean, f: () => void): void => {
    if (!when || done.has(k)) return;
    done.add(k);
    b.doing = k;
    f();
  };
  for (;;) {
    once('sand into the Core', !sim.done.has('ex_brick'), () => sandCore(b));
    once('gear press', sim.done.has('tr1'), () => gearPress(b));
    once('motor bench', sim.done.has('tr1') && !!b.ids.bench && !!b.ids.gears, () => motorBench(b));
    once('brickworks', sim.done.has('ex_brick'), () => brickWorks(b));
    // The Core's level 3 (the Synthesis learnt): its materials gathered, what stays short bought.
    if (sim.done.has('tr_synth') && sim.hearthLevel < 3) {
      b.doing = 'core level 3';
      const up = BAL.hearthUpgrades[1]!;
      if (b.gather(needOf(up.cost), 120) && !sim.upgradeHearth().ok) b.problem('the Core\'s level 3 refused with its materials in');
      continue;
    }
    b.doing = 'research';
    b.pass(sim.projects.length ? 'research' : 'idle', sim.projects.length ? sim.projects.map((p) => p.id).join(', ') : 'the lab waits');
  }
}

// ── the run ─────────────────────────────────────────────────────────────────

export interface PacingOptions {
  /** « La verrerie »'s coal by a drill of its own or by a router on the coal line (default: as its hints say). */
  glassCoal?: boolean;
  /** Game minutes after the sunrise the base is founded (default 0: the debug bases' start; 18: at dusk). */
  offset?: number;
  /** Whether the player asks for hints and follows them (default yes); no: only the objectives and the guide's arrow. */
  askHints?: boolean;
  /** Called after each step of the tutorial (debugging). */
  trace?: (b: PacingBot, step: string) => void;
  /** The player's land (`playerSeed`). */
  land: number;
  /** Game minutes played (default three hours). */
  minutes?: number;
  /** A world minute; the base is founded at the last sunrise at or before it (as the debug bases are). */
  near?: number;
  /** The map version (default today's). */
  mapV?: number;
}

/** A new base on `land` played for `minutes` game minutes (default three hours): what it measured. */
export function playPacing(o: PacingOptions): PacingRun {
  const near = o.near ?? DEFAULT_NEAR;
  const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: o.land, source: new MapGen(WORLD_SEED, o.land, o.mapV), foundingEpoch: scenarioEpoch(near) + (o.offset ?? 0) });
  const b = new PacingBot(sim, o.land, o.minutes ?? 180);
  b.trace = o.trace;
  b.askHints = o.askHints ?? true;
  b.glassCoal = o.glassCoal ?? GLASS_HINTS_DRILL;
  try {
    tutorial(b, 'Essai');
    tierOne(b);
  } catch (e) {
    if (!(e instanceof TimeUp)) throw e;
  }
  b.finish();
  return b.out;
}

/** The scenarios' founding minute (their test's `NEAR`): a sunrise, so the first night falls about 20 minutes in. */
const DEFAULT_NEAR = WORLD_EPOCH0 + 1000;

/** The Crown's outer radius, plus one (a Closed Cirque's is its own). */
const crownR = (sim: Sim): number => (sim.grid.source.crownOuter ?? CIRQUE.crownOuter) + 1;

/** What the base has paid in items so far: into the buildings standing, the plans, the research launched, the Core's levels. */
function spentSoFar(sim: Sim): HourMark['spent'] {
  const add = (to: Record<string, number>, cost: ReadonlyArray<readonly [string, number]>, k = 1): void => { for (const [it, n] of cost) to[it] = (to[it] ?? 0) + n * k; };
  const buildings: Record<string, number> = {}, plans: Record<string, number> = {}, research: Record<string, number> = {}, core: Record<string, number> = {};
  const counts = sim.ents.defCounts();
  for (const id of Object.keys(BUILDINGS)) { const n = counts[buildingIdx(id)] ?? 0; if (n) add(buildings, costOf(id), n); }
  for (const id of sim.done) { const p = planDef(id); if (p) add(plans, p.cost); }
  for (const id of [...sim.done, ...sim.projects.map((p) => p.id)]) { const r = researchNode(id); if (r) add(research, r.cost); }
  for (let l = 2; l <= sim.hearthLevel; l++) add(core, BAL.hearthUpgrades[l - 2]!.cost);
  return { buildings, plans, research, core };
}
