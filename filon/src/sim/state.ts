// state.ts — the colony: its whole state, its public API, and the online tick. The Sim is a
// facade: the state lives here, the rules live in the systems (src/sim/systems/*: build,
// configure, research, landscape, land, freight, power, trade, quests), each a set of functions over the Sim.
// Command methods validate, apply and log themselves (commands.ts); the shell drains `events`.
// What the base may build is the unlock tree's (D33): `done` holds the plans unlocked and the
// research learnt, and `unlocked(id)` answers for both.
// Pure: no DOM, no clock — the shell decides when ticks happen and how much time passed.
//
// One online tick (`step`), in order:
//   1. remote constructions whose kite arrived become buildings
//   2. recompile the flow graph if anything structural changed (`dirty`)
//   3. power: per grid, demands vs weather → satisfaction ‰, dispatch, accumulators
//   4. flow phases A (offers/accepts) → B (transfers) → C (machines, drills, internal updates)
//   5. research projects pay their data and advance; servers make tokens; the Heart and the
//      autonomous labs make data files (systems/research.ts)
//   6. landscape: dig / fill jobs advance and finish
//   7. freight: drifter routes move goods between skydocks
//   8. tick++; at every epoch boundary (each game minute) the trade posts trade and the Crier
//      settles (systems/trade.ts), the leases due take their hour's rent or lapse
//      (systems/land.ts), then research's tokens are billed (systems/research.ts `tokenEpoch`) —
//      the catch-up calls the same functions — then an 'epoch' event
//   9. quests: rate windows at epoch boundaries, a completion check every second (systems/quests.ts)
import { isEmblem, type Emblem } from '@/content/emblem';
import { BAL } from '@/content/balance';
import { LocalMarketService } from '@/market/service';
import type { MarketService, PriceTable } from '@/market/types';
import { N_ITEMS, buildingDef, buildingIdx, hasResearch, itemIdx } from '@/content/registry';
import { isPlan } from '@/content/research';
import { StateHasher } from '@/core/hash';
import type { Command, SimEvent } from './commands';
import { CENTER, EPOCH } from './constants';
import { Entities } from './entities';
import type { Chain } from './flow/chain';
import type { FNode, TickCtx } from './flow/node';
import type { MachineNode, ReservoirNode } from './flow/nodes';
import { makeCtx, runPhases } from './flow/step';
import { compileGraph, type Graph } from './graph/compile';
import { computeMods, type Mods } from './research/modifiers';
import type { BranchId, Project, StartBlock } from './research/runtime';
import type { Job, JobKind, Route } from './space';
import * as build from './systems/build';
import * as beltPlan from './systems/belt-plan';
import * as configure from './systems/configure';
import * as freight from './systems/freight';
import * as landscape from './systems/landscape';
import * as power from './systems/power';
import * as research from './systems/research';
import * as reserve from './systems/reserve';
import * as trade from './systems/trade';
import * as quests from './systems/quests';
import * as value from './systems/value';
import { newTradeState, type SpotSide, type TradeRefusal, type TradeState } from './trade';
import type { Ent, Rot } from './types';
import { Grid, inWorld, tileIndex, type TerrainSource } from './world/grid';
import { PowerLinks } from './power/links';
import { Land } from './world/land';
import * as land from './systems/land';
import { hash32 } from '@/core/hash';

export type { Command, SimEvent } from './commands';
export type { Cost, PlaceCheck, PlaceReason } from './systems/build';
export type { BeltPath, BeltStep } from './systems/belt-plan';
export type { PlanBlock, RespecBlock } from './systems/research';
export type { LinkCheck } from './systems/power';
export type { LinkReason } from './power/links';
export { recipeOf } from './cfg';

export interface SimOptions {
  worldSeed: number;
  playerSeed: number;
  source: TerrainSource;
  /** Absolute world epoch at founding: minutes since the Unix epoch (the world began at WORLD_EPOCH0, 2026-01-01). */
  foundingEpoch: number;
  colonyName?: string;
  /** The Crier (default: the simulated NPC market of this world). */
  market?: MarketService;
}

/** Last tick's power of one grid (for the HUD), kW. */
export interface NetPower { demand: number; renew: number; fuel: number; sat: number }

/** A minute's token bill (D68) and the running totals: tokens used, covered by the claim's servers, bought; centi-◉. */
export interface TokenStats {
  used: number; fromServers: number; bought: number; cents: number; supply: number; rental: number;
  totalUsed: number; totalBought: number; totalCents: number;
}
export const newTokenStats = (): TokenStats => ({ used: 0, fromServers: 0, bought: 0, cents: 0, supply: 0, rental: 0, totalUsed: 0, totalBought: 0, totalCents: 0 });

export class Sim {
  // ── identity & clock ──────────────────────────────────────────────────────
  tick = 0;
  readonly worldSeed: number;
  readonly playerSeed: number;
  readonly foundingEpoch: number;
  colonyName: string;
  /** The claim's emblem, designed on the register (content/emblem.ts); null: none yet (it flies `defaultEmblem(playerSeed)`). */
  emblem: Emblem | null = null;

  // ── the land and what stands on it ────────────────────────────────────────
  readonly ents = new Entities();
  readonly grid: Grid;
  /** The claim's land: its parcels (world/land.ts; the rules in systems/land.ts). */
  readonly land: Land;
  /** Explored discs [cx, cy, r] (the fog lifts for good). Saved. */
  readonly explored: Array<[number, number, number]> = [];
  /** The power wires (D25): explicit pairs of entity ids; grids are their components. Saved. */
  readonly links = new PowerLinks();

  // ── the Hearth and the stores ─────────────────────────────────────────────
  /** The Hearth's central stock, milli-items per item. */
  readonly stock = new Float64Array(N_ITEMS);
  credits = 0; // centi-ocelles
  hearthLevel = 1;
  hearthId = 0;
  /** Stores of reservoir buildings other than the Hearth (silos, waystations, docks…), by entity. */
  readonly stores = new Map<number, Float64Array>();
  /** Energy held by each accumulator (kW·tick), by entity. */
  readonly accEnergy = new Map<number, number>();

  // ── the unlock tree: plans and research (D33) ────────────────────────────
  /** Tree nodes done: plans unlocked and research learnt (one id set; saved, hashed). */
  readonly done = new Set<string>();
  /** Research in progress, in start order (one per lab; reconversions hold a slot). */
  projects: Project[] = [];
  /** The Research Queue (an_queue): the node each lab starts once its project is done. Saved. */
  readonly labQueue = new Map<number, string>();
  // AI tokens (D68): never held — used as research runs, billed at each minute boundary.
  /** Tokens research used since the last minute boundary (to bill). Saved, hashed. */
  tokenUse = 0;
  /** The servers' output since the last boundary, in token·‰·ticks (÷ 600 000 = tokens). Saved, hashed. */
  serverAcc = 0;
  /** The purse is in the red: research holds until it is back above zero. Saved, hashed. */
  researchHeld = false;
  /** Subscribed to CrierBelt's Compute Plan (cm_plan). Saved, hashed. */
  tokenPlan = false;
  /** Last minute's token bill and the totals (statistics for the UI: saved, not hashed). */
  tokenStats: TokenStats = newTokenStats();
  /** Carried fractions of the data makers (the Heart, autonomous labs), by entity: mu·‰·ticks. Saved, hashed. */
  readonly dataAcc = new Map<number, number>();
  /** Archive notes (centi-◉ of science value), refunded by reconversions, spent on research. */
  notes = 0;
  respecs = 0;
  lastRespec = -1;
  /** Research effects compiled into one table (rebuilt with `rebuildDerived`). */
  mods: Mods = computeMods(new Set());

  // ── space ─────────────────────────────────────────────────────────────────
  /** Tiles marked for digging (rock) or filling (water, salt flats), in marking order. Saved. */
  readonly designated = new Map<number, JobKind>();
  /** One running dig / fill per excavator / backfiller. Saved. */
  jobs: Job[] = [];
  /** Drifters owned per skydock, and the freight routes between docks. Saved. */
  readonly fleet = new Map<number, number>();
  routes: Route[] = [];
  nextRouteId = 1;

  // ── trade: the Crier Ring ─────────────────────────────────────────────────
  /** The world market (saved with the colony: its state depends on the player's flows). */
  market: MarketService;
  /** This epoch's prices (centi-◉ per item): what streams, orders and the UI use. */
  prices: PriceTable;
  /** Export streams, import orders, goods in flight, the ledger. Saved. */
  readonly trade: TradeState = newTradeState(N_ITEMS);

  // ── the tutorial (systems/quests.ts) ──────────────────────────────────────
  /** Quests done, the current one's baselines and rate windows, rewards in force. Saved. */
  quests: quests.QuestState = quests.newQuestState();
  /** The claim's value over time (systems/value.ts, D50). */
  value: value.ValueState = value.newValueState();

  // ── the compiled flow graph (derived, rebuilt when `dirty`) ──────────────
  graph!: Graph;
  ctx!: TickCtx;
  /** @internal Nodes per power grid (power system). */
  nodesByNet: FNode[][] = [];
  /** @internal Set by the systems when the flow graph must be recompiled. */
  dirty = true;
  /** @internal Set when marks or machines changed: idle excavators / backfillers look for work. */
  jobsDirty = true;

  // ── journal & reports ─────────────────────────────────────────────────────
  /** Commands applied, with their tick (replay / server validation). */
  readonly log: Array<{ tick: number; cmd: Command }> = [];
  /** Events since the shell last drained them. */
  readonly events: SimEvent[] = [];
  /** Last tick's power per grid (for the HUD). */
  netPower: NetPower[] = [];
  /** Cumulative statistics (milli-items). */
  readonly produced = new Float64Array(N_ITEMS);
  readonly consumed = new Float64Array(N_ITEMS);
  /**
   * What the base brought into the Hearth while ticking (milli-items, cumulative): its ports'
   * intake, the ore of dug tiles, a lost trade post's deliveries — the HUD's « +12/min » beside
   * the Heart's stocks. Never what commands put in or take out (a building's cost or refund, a
   * plan, a sale, a reward): the rate is the base's, and nothing flows out of the Heart by itself,
   * so it is never negative. Neither saved nor hashed: a statistic of live play (the catch-up's
   * reservoirs are virtual and leave it alone; an absence has its report, and the HUD starts its
   * minute afresh after a catch-up).
   */
  readonly hearthIn = new Float64Array(N_ITEMS);

  constructor(opts: SimOptions, fresh = true) {
    this.worldSeed = opts.worldSeed;
    this.playerSeed = opts.playerSeed;
    this.foundingEpoch = opts.foundingEpoch;
    this.colonyName = opts.colonyName ?? '';
    this.grid = new Grid(opts.source);
    this.land = new Land(hash32(opts.worldSeed, opts.playerSeed));
    this.market = opts.market ?? new LocalMarketService({ worldSeed: opts.worldSeed, foundingEpoch: opts.foundingEpoch });
    this.prices = this.market.prices();
    if (fresh) {
      const hdef = buildingIdx('hearth');
      const hearth = this.ents.add({ def: hdef, x: CENTER - 2, y: CENTER - 2, rot: 0, cfg: 0, builtAt: 0, portItems: buildingDef(hdef).ports.map(() => -1) });
      this.hearthId = hearth.id;
      build.occupy(this, hearth);
      for (const [id, n] of Object.entries(BAL.startStock)) this.stock[itemIdx(id)] = n * 1000;
      this.credits = BAL.startCredits * 100;
      this.explored.push([CENTER, CENTER, BAL.startReveal]);
    }
    this.rebuildDerived();
  }

  // ── derived state ─────────────────────────────────────────────────────────
  hearthCap(): number {
    return BAL.hearthCap[Math.min(BAL.hearthCap.length, this.hearthLevel) - 1]! * 1000;
  }

  absEpoch(tick = this.tick): number {
    return this.foundingEpoch + Math.floor(tick / EPOCH);
  }

  /** After research changes: modifiers and a recompile. */
  rebuildDerived(): void {
    this.mods = computeMods(this.done);
    this.dirty = true;
  }

  markDirty(): void { this.dirty = true; }

  ensureCompiled(): void {
    if (!this.dirty && this.graph) return;
    // Wires of buildings gone by any path (one replaced inside a ribbon drag…) go with them.
    this.links.prune((id) => this.ents.map.has(id));
    const old = this.graph ?? null;
    this.graph = compileGraph({
      ents: this.ents, grid: this.grid, mods: this.mods, now: this.tick,
      hearthStock: this.stock, hearthCap: this.hearthCap(), stores: this.stores, old,
      refund: (item, mu) => this.refund(item, mu),
      labAccepts: research.labAccepts(this),
      tradeAccepts: trade.exportAccepts(this),
      tradeBuys: trade.importItems(this),
      tradeCap: trade.tradeCap(this),
      dormant: (e) => this.isDormant(e),
      busy: new Set(this.jobs.map((j) => j.ent)),
      links: this.links,
    });
    const ctx = makeCtx(this.graph, this.graph.nets.length, N_ITEMS);
    if (this.ctx) { ctx.produced = this.ctx.produced; ctx.consumed = this.ctx.consumed; ctx.hearthIn = this.ctx.hearthIn; }
    else { ctx.produced = this.produced; ctx.consumed = this.consumed; ctx.hearthIn = this.hearthIn; }
    this.ctx = ctx;
    this.nodesByNet = this.graph.nets.map(() => []);
    for (const n of this.graph.nodes) if (n.net >= 0) this.nodesByNet[n.net]!.push(n);
    this.dirty = false;
  }

  /** Items with nowhere to go return to the Hearth (above its cap too: nothing vanishes). */
  refund(item: number, mu: number): void {
    this.stock[item] = this.stock[item]! + mu;
  }

  // ── unlocks & fog ─────────────────────────────────────────────────────────
  /** Is an `unlock` held: 'start', or a node of the unlock tree (a plan or a research node, D33) that is done? */
  unlocked(unlock: string): boolean {
    if (unlock === 'start') return true;
    if (unlock === 'never') return false;
    return (hasResearch(unlock) || isPlan(unlock)) && this.done.has(unlock);
  }

  revealed(x: number, y: number): boolean {
    for (const [cx, cy, r] of this.explored) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  // ── commands: structures (systems/build.ts) ──────────────────────────────
  /** Would it fit here, at what cost, after what delay, replacing what (`replaces`)? */
  canPlace(defId: string, x: number, y: number, rot: Rot): build.PlaceCheck { return build.canPlace(this, defId, x, y, rot); }
  /** The rotation `place` would really use (a routing block dropped on a ribbon follows it). */
  placementRot(defId: string, x: number, y: number, rot: Rot): Rot { return build.placementRot(this, defId, x, y, rot); }
  /** Place a building over free tiles or over what it may replace (`cfg` omitted: a re-placed building keeps its settings). */
  place(defId: string, x: number, y: number, rot: Rot, cfg?: number): build.PlaceCheck & { id?: number } {
    const r = build.place(this, defId, x, y, rot, cfg);
    // Wires: carried over from what it replaced; a new pillar wires itself to the nearest one (D25).
    if (r.ok && r.id) power.placed(this, r.id, r.replaces);
    return r;
  }
  /** How a ribbon drag would go as a whole (kept, laid, replaced, a junction, a traction step, a bridge pair, D73): the preview `placeBelts` follows. */
  planBelts(defId: string, path: beltPlan.BeltPath): beltPlan.BeltStep[] { return beltPlan.planBelts(this, defId, path); }
  placeBelts(defId: string, path: beltPlan.BeltPath): number { return beltPlan.placeBelts(this, defId, path); }
  remove(x: number, y: number): boolean {
    const id = this.entityAt(x, y)?.id ?? 0;
    if (!build.remove(this, x, y)) return false;
    power.removed(this, id); // its wires go with it
    return true;
  }
  upgradeHearth(): ReturnType<typeof build.upgradeHearth> { return build.upgradeHearth(this); }
  /** Finish the remote constructions due by `now` (online: each tick; offline: at their event). */
  completeConstructions(now = this.tick): number[] { return build.completeConstructions(this, now); }

  // ── commands: power wires (systems/power.ts, D25) ────────────────────────
  /** May `a` (the end the player starts from) and `b` be wired now, and if not, why? */
  canLink(a: number, b: number): power.LinkCheck { return power.canLink(this, a, b); }
  /** String a wire between two buildings (one end a pillar or the Hearth). */
  link(a: number, b: number): power.LinkCheck { return power.link(this, a, b); }
  /** Cut the wire between two buildings. */
  unlink(a: number, b: number): boolean { return power.unlink(this, a, b); }
  /** The buildings an entity is wired to (ascending ids). */
  linksOf(id: number): readonly number[] { return this.links.of(id); }

  // ── commands: settings (systems/configure.ts) ────────────────────────────
  setRecipe(id: number, recipe: string | null): boolean { return configure.setRecipe(this, id, recipe); }
  setPortItem(id: number, port: number, item: string | null): boolean { return configure.setPortItem(this, id, port, item); }
  setForkFilter(id: number, side: Rot, item: string | null): boolean { return configure.setForkFilter(this, id, side, item); }

  /** Sandbox / rewards: items straight into the Hearth (logged). */
  grant(item: string, n: number): void {
    const i = itemIdx(item);
    this.stock[i] = this.stock[i]! + n * 1000;
    this.log.push({ tick: this.tick, cmd: { k: 'grant', item, n } });
  }

  /** Sandbox / rewards: ocelles (centi-◉, logged). */
  grantCredits(cents: number): void {
    this.credits += cents;
    this.log.push({ tick: this.tick, cmd: { k: 'credits', cents } });
  }

  // ── commands: the unlock tree — plans and research (systems/research.ts, D33) ──
  /** Why a plan cannot be unlocked now (null = it can). */
  planBlock(id: string): research.PlanBlock | null { return research.planBlock(this, id); }
  /** Unlock a plan: paid from the Heart at once; what it unlocks can be built from this tick. */
  unlockPlan(id: string): { ok: boolean; reason: research.PlanBlock | null } { return research.unlockPlan(this, id); }
  /** Does it stand dormant: its unlock given up (reconversion), or the land under it no longer the claim's (a lease lapsed)? */
  isDormant(e: Ent): boolean {
    return this.dormancy(e) !== null;
  }

  /**
   * Why it sleeps, for the UI to say (null: awake): `research`, its unlock given up by a
   * reconversion; `land`, a building that needs the claim's land standing where the claim no
   * longer holds it (a lease lapsed or ended). Asleep, it is cut from every grid: its wires stay,
   * drawn dashed, and carry nothing until it wakes.
   */
  dormancy(e: Ent): 'research' | 'land' | null {
    if (research.isDormant(this, e)) return 'research';
    return buildingDef(e.def).needsZone && !this.land.coversFootprint(e.def, e.x, e.y, e.rot) ? 'land' : null;
  }

  // ── land (docs/land.md) ───────────────────────────────────────────────────
  /** Buy a parcel (a leased one too). null when bought, else why not. */
  buyLand(p: number): land.LandRefusal | null { return land.buyLand(this, p); }
  /** Lease a parcel by the hour (Land Registry): the first hour paid now. */
  rentLand(p: number): land.LandRefusal | null { return land.rentLand(this, p); }
  /** Give a lease up. */
  endLease(p: number): land.LandRefusal | null { return land.endLease(this, p); }
  /** Parcel Resale: sell a bought parcel back to CrierBelt. */
  sellLand(p: number): land.LandRefusal | null { return land.sellLand(this, p); }
  resalePrice(p: number): number { return land.resalePrice(this, p); }
  /** Why buying, leasing or selling back parcel `p` would be refused now (null: it would go through), for the UI. */
  buyBlock(p: number): land.LandRefusal | null { return land.buyBlock(this, p); }
  leaseBlock(p: number): land.LandRefusal | null { return land.leaseBlock(this, p); }
  sellBlock(p: number): land.LandRefusal | null { return land.sellBlock(this, p); }
  /** What a parcel costs to buy now, and its rent for an hour's lease (centi-ocelles). */
  landPrice(p: number): number { return land.landPrice(this, p); }
  landRent(p: number): number { return land.landRent(this, p); }
  /** The leases' hour at a minute boundary (online: from step; offline: the catch-up). Whether one lapsed. */
  landEpoch(): boolean { return land.landEpoch(this); }
  idleLabs(): number[] { return research.idleLabs(this); }
  researchBlock(id: string): StartBlock | null { return research.researchBlock(this, id); }
  startResearch(id: string, lab = 0): { ok: boolean; reason: StartBlock | null } { return research.startResearch(this, id, lab); }
  cancelResearch(id: string): boolean { return research.cancelResearch(this, id); }
  /** Research Queue: the node a lab starts once its project is done (null: none). */
  queueResearch(lab: number, id: string | null): boolean { return research.queueResearch(this, lab, id); }
  queueBlock(lab: number, id: string): ReturnType<typeof research.queueBlock> { return research.queueBlock(this, lab, id); }
  /** Subscribe to (or leave) CrierBelt's Compute Plan. */
  setTokenPlan(on: boolean): boolean { return research.setTokenPlan(this, on); }
  /** CrierBelt's price for 1 000 tokens now (centi-◉). */
  tokenPriceK(): number { return research.tokenPriceK(this); }
  /** The minute boundary's token bill (online: from step; offline: the catch-up). Whether research's hold changed. */
  tokenEpoch(): boolean { return research.tokenEpoch(this); }
  respecBlock(branch: BranchId): research.RespecBlock | null { return research.respecBlock(this, branch); }
  respec(branch: BranchId): boolean { return research.respec(this, branch); }
  projectStock(p: Project): Float64Array | null { return research.projectStock(this, p); }
  projectSat(p: Project, satOf: (net: number) => number): number { return research.projectSat(this, p, satOf); }
  finishProjects(): string[] { return research.finishProjects(this); }

  // ── CrierBelt's restart reserve (systems/reserve.ts, D36): queries, no state ──
  /** What paying `cost` from the Heart for good would leave short of the reserve (`unlocking`: the plan it buys); empty: the base can still rebuild. */
  reserveShort(cost: build.Cost, unlocking?: string): build.Cost { return reserve.reserveShort(this, cost, unlocking); }
  /** What the Heart's stock itself must keep of an item (mu): the reserve, less what the buildings would refund. */
  reserveFloor(item: number): number { return reserve.reserveFloor(this, item); }

  // ── commands: landscape (systems/landscape.ts) ───────────────────────────
  designate(tiles: readonly number[], on = true): number { return landscape.designate(this, tiles, on); }
  /** Assign jobs now if anything changed (the offline catch-up calls it between segments). */
  assignJobsIfNeeded(force = false): void { if (this.jobsDirty || force) landscape.assignJobs(this); }
  jobStore(j: Job): Float64Array | null { return landscape.jobStore(this, j); }
  jobCap(j: Job): number { return landscape.jobCap(j); }
  jobSat(j: Job, satOf: (net: number) => number): number { return landscape.jobSat(this, j, satOf); }
  advanceJobs(ticks: number, satOf: (net: number) => number, sats?: (j: Job) => number): boolean { return landscape.advanceJobs(this, ticks, satOf, sats); }
  completeJobs(): boolean { return landscape.completeJobs(this); }

  // ── commands: freight (systems/freight.ts) ───────────────────────────────
  dockNode(id: number): ReservoirNode | null { return freight.dockNode(this, id); }
  routeRateNow(r: Route, satOf: (net: number) => number): number { return freight.routeRateNow(this, r, satOf); }
  moveFreight(r: Route, ticks: number, satOf?: (net: number) => number, exactMu = true): number { return freight.moveFreight(this, r, ticks, satOf, exactMu); }
  buyDrifter(dock: number): boolean { return freight.buyDrifter(this, dock); }
  freeShips(dock: number): number { return freight.freeShips(this, dock); }
  addRoute(from: number, to: number, item: string, ships: number): number { return freight.addRoute(this, from, to, item, ships); }
  removeRoute(id: number): boolean { return freight.removeRoute(this, id); }

  // ── commands: trade (systems/trade.ts) ───────────────────────────────────
  addImport(post: number, item: string, perMin: number, maxCents: number, express = false): number | TradeRefusal { return trade.addImport(this, post, item, perMin, maxCents, express); }
  /** Price Forecast: the Crier's prices `minutes` from now, trade-free (pure; null for a remote market). */
  priceForecast(minutes: number): ReturnType<typeof trade.priceForecast> { return trade.priceForecast(this, minutes); }
  /** Floor Prices: the bid (centi-◉ an item) under which the posts hold an item back (null: none). */
  setFloorPrice(item: string, cents: number | null): boolean { return trade.setFloorPrice(this, item, cents); }
  cancelImport(id: number): boolean { return trade.cancelImport(this, id); }
  spotTrade(item: string, side: SpotSide, n: number): { cents: number } | { refused: TradeRefusal } { return trade.spotTrade(this, item, side, n); }
  quoteSpot(item: number, side: SpotSide, n: number): ReturnType<typeof trade.quoteSpot> { return trade.quoteSpot(this, item, side, n); }
  tradePosts(): Ent[] { return trade.tradePosts(this); }
  /** A post's cargo (D64): what it bought and holds or awaits, sorted. */
  cargoOf(post: number): readonly number[] { return trade.cargoOf(this, post); }
  /**
   * The epoch boundary (online: from step; offline: from the catch-up — the same call): trade
   * posts trade and the Crier settles, then the claim's value is sampled when due.
   */
  tradeEpoch(): boolean {
    const changed = trade.tradeEpoch(this);
    value.valueEpoch(this);
    return changed;
  }
  /** The claim's value now, in centi-ocelles (systems/value.ts). */
  claimValue(): ReturnType<typeof value.claimValue> { return value.claimValue(this); }

  // ── commands: quests (systems/quests.ts) ─────────────────────────────────
  /** Name (or rename) the claim: quest 0. */
  nameColony(name: string): boolean { return quests.nameColony(this, name); }
  /** Set the claim's emblem (the register; the Heart's flag shows it). Cosmetic: not hashed. */
  setEmblem(e: Emblem): boolean {
    if (!isEmblem(e)) return false;
    this.emblem = { shape: e.shape, symbol: e.symbol, field: e.field, ink: e.ink };
    this.log.push({ tick: this.tick, cmd: { k: 'emblem', e: { ...this.emblem } } });
    return true;
  }
  /** Skip the tutorial: the whole interface shows, no more quests. */
  skipTutorial(): boolean { return quests.skipTutorial(this); }
  /** Complete quest `id` if it is the current one and holds (`force`: regardless — debug). */
  completeQuest(id: string, force = false): boolean { return quests.completeQuest(this, id, force); }
  /** Complete whatever holds now; the shell calls it right after a catch-up (`step` checks every second). */
  checkQuests(): string[] { return quests.checkQuests(this); }

  // ── the online tick ───────────────────────────────────────────────────────
  step(): void {
    build.completeConstructions(this);
    this.ensureCompiled();
    this.ctx.now = this.tick;
    power.powerTick(this);
    runPhases(this.graph, this.graph.nodes, this.ctx, this.graph.accOrder);
    research.researchTick(this);
    landscape.landscapeTick(this);
    freight.freightTick(this);
    this.tick++;
    if (this.tick % EPOCH === 0) {
      this.tradeEpoch();
      this.landEpoch();
      this.tokenEpoch();
      this.events.push({ k: 'epoch', epoch: this.absEpoch() });
    }
    quests.questStep(this);
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /** Online power for the current tick (exposed for tests and the catch-up's checks). */
  powerTick(): void { power.powerTick(this); }

  // ── queries ───────────────────────────────────────────────────────────────
  hearth(): ReservoirNode | null {
    this.ensureCompiled();
    return this.graph.hearth;
  }

  entityAt(x: number, y: number): Ent | undefined {
    if (!inWorld(x, y)) return undefined;
    const id = this.grid.occ[tileIndex(x, y)]!;
    return id ? this.ents.get(id) : undefined;
  }

  chainAt(x: number, y: number): Chain | undefined {
    this.ensureCompiled();
    return this.graph.chainByTile.get(tileIndex(x, y));
  }

  stockOf(item: string): number {
    return this.stock[itemIdx(item)]! / 1000;
  }

  /** Total of an item held anywhere (Hearth, stores, buffers, ribbons) — for conservation tests. */
  totalHeld(item: number): number {
    this.ensureCompiled();
    let t = this.stock[item]!;
    for (const st of this.stores.values()) t += st[item]!;
    for (const n of this.graph.nodes) t += heldIn(n, item);
    return t;
  }

  /** Engine state hash: same save + same commands ⇒ same hash. */
  hash(): string {
    this.ensureCompiled();
    const h = new StateHasher();
    h.int(this.tick).int(this.credits).int(this.hearthLevel).ints(this.stock);
    for (const e of this.ents.sorted()) h.int(e.id).int(e.def).int(e.x).int(e.y).int(e.rot).int(e.cfg).int(e.builtAt);
    for (const [id, st] of [...this.stores].sort((a, b) => a[0] - b[0])) h.int(id).ints(st);
    for (const [id, v] of [...this.accEnergy].sort((a, b) => a[0] - b[0])) h.int(id).int(v);
    h.int(this.links.size);
    for (const [a, b] of this.links.pairs()) h.int(a).int(b);
    for (const id of [...this.done].sort()) h.str(id);
    h.int(this.notes).int(this.respecs).int(this.lastRespec);
    for (const p of this.projects) { h.str(p.id).int(p.lab).int(p.dur).int(p.el).ints(p.paid).int(p.tokens ?? 0).int(p.tokUsed ?? 0); }
    for (const [lab, id] of [...this.labQueue].sort((a, b) => a[0] - b[0])) h.int(lab).str(id);
    h.int(this.tokenUse).int(this.serverAcc).int(this.researchHeld ? 1 : 0).int(this.tokenPlan ? 1 : 0);
    for (const [id, v] of [...this.dataAcc].sort((a, b) => a[0] - b[0])) h.int(id).int(v);
    for (const [t, k] of this.designated) h.int(t).int(k === 'dig' ? 1 : 2);
    for (const j of this.jobs) h.int(j.ent).int(j.tile).int(j.dur).int(j.el).int(j.mu).int(j.moved).int(j.quarry ? 1 : 0);
    for (const [d, n] of [...this.fleet].sort((a, b) => a[0] - b[0])) h.int(d).int(n);
    for (const r of this.routes) h.int(r.id).int(r.from).int(r.to).int(r.item).int(r.ships).int(Math.floor(r.carry * 1e6));
    h.int(this.nextRouteId);
    // The land as changed by play: terrain / ore diffs, the parcels held, the lifted fog.
    for (const [t, v] of [...this.grid.terrainDiff].sort((a, b) => a[0] - b[0])) h.int(t).int(v);
    for (const [t, v] of [...this.grid.levelDiff].sort((a, b) => a[0] - b[0])) h.int(t).int(v);
    for (const [t, v] of [...this.grid.oreDiff].sort((a, b) => a[0] - b[0])) h.int(t).int(v);
    h.ints([...this.land.bought].sort((a, b) => a - b)).ints([...this.land.granted].sort((a, b) => a - b));
    for (const [p, l] of [...this.land.leases].sort((a, b) => a[0] - b[0])) h.int(p).int(l.next).int(l.cents);
    for (const [cx, cy, r] of this.explored) h.int(cx).int(cy).int(r);
    // Trade: cargo, orders, goods in flight, the ocelles' history, and the market's own state.
    const t = this.trade;
    for (const [post, items] of [...t.cargo].sort((a, b) => a[0] - b[0])) h.int(post).ints(items);
    for (const o of t.orders) h.int(o.id).int(o.post).int(o.item).int(o.perMin).int(o.maxCents).int(o.active ? 1 : 0);
    for (const sh of t.inflight) h.int(sh.post).int(sh.item).int(sh.mu).int(sh.arrive);
    h.int(t.nextOrderId).int(t.earned).int(t.spent).ints(t.sold).ints(t.bought);
    h.str(JSON.stringify(this.market.save()));
    quests.hashQuests(this.quests, h);
    for (const n of this.graph.nodes) { h.int(n.ent); n.hash(h, this.tick); }
    return h.digest();
  }
}

/** Every item buffered inside a node, added to `out` (milli-items per item): `heldIn` for all items at once. */
export function addHeld(n: FNode, out: Float64Array): void {
  const anyN = n as unknown as Record<string, number>;
  switch (n.kind) {
    case 'chain': {
      const c = n as Chain;
      if (c.fluid) { for (const r of c.contents()) out[r.item] = out[r.item]! + r.mu; return; }
      for (let i = 0; i < c.cells.length; i++) { const v = c.cells[i]!; if (v) out[v - 1] = out[v - 1]! + 1000; }
      if (c.stageMu > 0) out[c.stageItem] = out[c.stageItem]! + c.stageMu;
      return;
    }
    case 'machine': {
      const m = n as MachineNode;
      m.recipe?.ins.forEach((s, j) => { out[s.item] = out[s.item]! + m.inBuf[j]!; });
      m.recipe?.outs.forEach((s, j) => { out[s.item] = out[s.item]! + m.outBuf[j]!; });
      return;
    }
    case 'drill': if (anyN.item! >= 0) out[anyN.item!] = out[anyN.item!]! + anyN.outBuf!; return;
    case 'fork': if (anyN.item! >= 0) out[anyN.item!] = out[anyN.item!]! + anyN.mu!; return;
    case 'generator': if (anyN.fuelItem! >= 0) out[anyN.fuelItem!] = out[anyN.fuelItem!]! + anyN.fuel!; return;
    default: return;
  }
}

/** Items of a kind buffered inside a node. */
export function heldIn(n: FNode, item: number): number {
  const anyN = n as unknown as Record<string, unknown>;
  switch (n.kind) {
    case 'chain': {
      const c = n as Chain;
      let t = 0;
      if (c.fluid) { for (const r of c.contents()) if (r.item === item) t += r.mu; return t; }
      for (let i = 0; i < c.cells.length; i++) if (c.cells[i] === item + 1) t += 1000;
      return c.stageItem === item ? t + c.stageMu : t;
    }
    case 'machine': {
      const m = n as MachineNode;
      let t = 0;
      m.recipe?.ins.forEach((s, j) => { if (s.item === item) t += m.inBuf[j]!; });
      m.recipe?.outs.forEach((s, j) => { if (s.item === item) t += m.outBuf[j]!; });
      return t;
    }
    case 'drill': return (anyN.item === item ? (anyN.outBuf as number) : 0);
    case 'fork': return (anyN.item === item ? (anyN.mu as number) : 0);
    case 'generator': return (anyN.fuelItem === item ? (anyN.fuel as number) : 0);
    default: return 0;
  }
}
