// compile.ts — grid + entities → flow graph. Ribbon tiles are traced into chains (maximal
// runs of one tier where each tile has exactly one feeder); a tile fed from several sides
// starts a new chain. Buildings become nodes; every port carries at most one edge. Routing
// blocks (kind `fork`: routers, sorters, gates, unloaders) have no fixed ports: they link to
// whatever is around them — ribbons, machine and store ports, other routing blocks, and (an
// unloader) the stores it pulls from — within the sides their logic allows. Junctions pass
// items straight across: whatever faces one (a ribbon, a port, a routing block's side) faces
// the first thing past it, in line (`across`). Node state and
// ribbon contents survive a recompile (contents are redistributed by position; anything
// orphaned is refunded). The graph also tells the views what feeds each ribbon tile.
import { BAL } from '@/content/balance';
import {
  BUILDING_KIND, CRECIPES, N_ITEMS, buildingDef, buildingIdx, itemIdx,
} from '@/content/registry';
import { filterOf, modulesOf, recipeOf } from '../cfg';
import { MU, WORLD } from '../constants';
import { footprint, worldPorts, forTiles, type Entities, type WorldPort } from '../entities';
import { DX, DY, T, isRock, opposite, type Ent, type Rot } from '../types';
import type { RouterLogic } from '@/content/types';
import type { Grid } from '../world/grid';
import { tileIndex } from '../world/grid';
import { CIRQUE } from '@/content/world';
import { CENTER } from '../constants';
import { Chain, VIA_NONE } from '../flow/chain';
import type { FNode } from '../flow/node';
import { DrillNode, ForkNode, GeneratorNode, MachineNode, ReservoirNode, SinkNode } from '../flow/nodes';
import type { Mods } from '../research/modifiers';
import { buildGrids, type Acc, type Net, type Producer, type WireSource } from '../power/network';
import { isLinkPoint, linkable } from '../power/links';

export interface Graph {
  version: number;
  nodes: FNode[];
  chains: Chain[];
  /** Edge arrays. */
  nE: number;
  eSrc: Int32Array;
  eDst: Int32Array;
  eSrcPort: Int32Array;
  eDstPort: Int32Array;
  nodeByEnt: Map<number, FNode>;
  chainByTile: Map<number, Chain>;
  nets: Net[];
  netOfEnt: Map<number, number>;
  reservoirs: ReservoirNode[];
  hearth: ReservoirNode | null;
  /** The servers (D68): each one's entity and its AI tokens a minute at full power; their grid's satisfaction scales it. */
  servers: Array<{ ent: number; net: number; tpm: number }>;
  /** Per ribbon tile: a mask (bit = side, 0 N … 3 W) of where it is fed from — what the views draw. */
  feedDirs: Map<number, number>;
  /**
   * Ribbon tiles whose target is not the next tile: a skybridge leaping to its far end, or a
   * line passing through crossings. Tile → the tile it hands to (views: items glide across).
   */
  jumps: Map<number, number>;
  /**
   * The tick's accept order (flow/step.ts): every node but the ribbons, then the ribbons
   * downstream first (`depth`: how many ribbons lie between a chain and the end of its line), so a
   * full ribbon's head is known to be taken before it says its first tile is free.
   */
  accOrder: FNode[];
}

export interface CompileInput {
  ents: Entities;
  grid: Grid;
  mods: Mods;
  now: number;
  hearthStock: Float64Array;
  hearthCap: number;
  /** Per-entity stocks of silos, docks and trade posts (persisted by the state). */
  stores: Map<number, Float64Array>;
  old: Graph | null;
  /** Return orphaned items to the Hearth. */
  refund(item: number, mu: number): void;
  /** Observatories: the science items each one takes in (absent = idle, takes nothing). */
  labAccepts?: ReadonlyMap<number, ReadonlySet<number>>;
  /** Trade posts: what each one's inlets take (its export streams), and their store size (mu). */
  tradeAccepts?: ReadonlyMap<number, ReadonlySet<number>>;
  /** What each trade post buys (its import orders' items, sorted): what its exit hands out in turn (D62). */
  tradeBuys?: ReadonlyMap<number, readonly number[]>;
  tradeCap?: number;
  /** Buildings whose unlock was given up (reconversion): they stand dormant, no node. */
  dormant?(e: Ent): boolean;
  /** Excavators / backfillers with a job (they draw full power). */
  busy?: ReadonlySet<number>;
  /** The power wires (D25): grids are their connected components. None: every link point stands alone. */
  links?: WireSource;
}

const NO_WIRES: WireSource = { of: () => [] };

/** A research lab's store: enough data files for a while (milli-items per item). */
export const LAB_CAP = 200 * 1000;
const NOTHING: ReadonlySet<number> = new Set();
/** A server's store: it holds nothing (its node only draws the grid's power). */
const NO_STOCK = new Float64Array(0);

const isBeltKind = (k: string): boolean => k === 'belt' || k === 'conduit' || k === 'bridge';
const RUBBLE_IDX = (): number => itemIdx('stone');
const WATER_IDX = (): number => itemIdx('water');
/** The Heart's data outlet (D68): its only `out` port, handing out the data files it makes. */
export const HEART_OUTLET = buildingDef(buildingIdx('hearth')).ports.findIndex((p) => p.io === 'out');
const DATA_IDX = (): number => itemIdx('journal_1');

interface PortRef { node: FNode; port: number; dir: Rot }

export function compileGraph(inp: CompileInput): Graph {
  const { ents, grid, mods } = inp;
  const sorted = ents.sorted();

  // ── 1. ribbons by tile ──────────────────────────────────────────────────
  const beltAt = new Map<number, Ent>();
  for (const e of sorted) if (isBeltKind(BUILDING_KIND[e.def]!) && e.builtAt === 0) beltAt.set(tileIndex(e.x, e.y), e);
  const crossingAt = new Set<number>();
  for (const e of sorted) if (BUILDING_KIND[e.def] === 'crossing' && e.builtAt === 0) crossingAt.add(tileIndex(e.x, e.y));
  // What a port or a ribbon facing tile (x, y) along d faces: the first tile from there on that
  // is not a junction (a junction passes items straight across), -1 off the world. A junction
  // set against a router or a machine no longer cuts its line (owner, 2026-10-12).
  const across = (x: number, y: number, d: Rot): number => {
    while (x >= 0 && y >= 0 && x < WORLD && y < WORLD && crossingAt.has(tileIndex(x, y))) { x += DX[d]!; y += DY[d]!; }
    return x >= 0 && y >= 0 && x < WORLD && y < WORLD ? tileIndex(x, y) : -1;
  };
  // The land's level (D45): a ribbon, a port or a routing block meets only its own level; a
  // traction ribbon (`lift`) hands on one level up or down.
  const lvAt = (t: number): number => grid.level(t % WORLD, Math.floor(t / WORLD));
  const isLift = (e: Ent | undefined): boolean => !!e && !!buildingDef(e.def).lift;

  // ── 2. building nodes (reused across compiles when unchanged) ───────────
  const nodes: FNode[] = [];
  const nodeByEnt = new Map<number, FNode>();
  const reservoirs: ReservoirNode[] = [];
  let hearth: ReservoirNode | null = null;
  const inPortAt = new Map<number, PortRef>();  // key: tile*4 + side
  const outPorts: Array<{ ref: PortRef; fx: number; fy: number }> = [];

  const reuse = (e: Ent, make: () => FNode, same: (old: FNode) => boolean): FNode => {
    const old = inp.old?.nodeByEnt.get(e.id);
    if (old && same(old)) {
      old.inE = []; old.outE = []; old.net = -1; old.group = -1; old.idx = -1;
      return old;
    }
    if (old) refundNode(old, inp.refund);
    return make();
  };

  for (const e of sorted) {
    if (e.builtAt !== 0) continue;
    if (inp.dormant?.(e)) continue;
    const b = buildingDef(e.def);
    const kind = b.kind;
    let node: FNode | null = null;
    switch (kind) {
      case 'hearth': {
        // Its ports are inlets, but for its data outlet: the data files it makes, once the
        // Analytics research has it make some (D68) — never anything else of its stock.
        const items = (e.portItems ?? []).slice();
        while (items.length < b.ports.length) items.push(-1);
        if (HEART_OUTLET >= 0) items[HEART_OUTLET] = mods.heartData > 0 ? DATA_IDX() : -1;
        node = reuse(e, () => new ReservoirNode(e.id, inp.hearthStock, inp.hearthCap, items, mpt(BAL.hearthPortPerMin), false),
          (o) => o.kind === 'reservoir');
        const r = node as ReservoirNode;
        r.cap = inp.hearthCap; r.portItems = items; r.stock = inp.hearthStock;
        hearth = r;
        break;
      }
      case 'storage': {
        let st = inp.stores.get(e.id);
        if (!st) inp.stores.set(e.id, (st = new Float64Array(N_ITEMS)));
        node = reuse(e, () => new ReservoirNode(e.id, st!, (b.storageCap ?? 1000) * 1000, [], mpt(240), true), (o) => o.kind === 'reservoir');
        (node as ReservoirNode).portItems = []; // unloaders' virtual ports are re-added below
        break;
      }
      case 'machine': {
        const r = recipeOf(e.cfg), bells = modulesOf(e.cfg);
        const recipe = r > 0 ? CRECIPES[r - 1] ?? null : null;
        // Speed modules: +30 % speed each (+50 % with Pace II), +40 % power each.
        const kw = Math.floor(((b.kw ?? 0) * (1000 + 400 * bells)) / 1000);
        node = reuse(e, () => new MachineNode(e.id, recipe, kw, b.idleKw ?? 0),
          (o) => o.kind === 'machine' && (o as MachineNode).recipe === recipe);
        const m = node as MachineNode;
        m.kw = kw;
        let speed = Math.floor((mods.craftSpeed * (1000 + (mods.flags.has('modules2') ? 500 : 300) * bells)) / 1000);
        if (b.speed) speed = Math.floor((speed * b.speed) / 1000); // the tree's upgraded machines (D70)
        if (onDugFloor(grid, e)) speed = Math.floor((speed * mods.excavatedSpeed) / 1000);
        m.speed = speed;
        break;
      }
      case 'drill': {
        const { item, rateEp } = drillRate(grid, e, mods);
        node = reuse(e, () => new DrillNode(e.id, item, rateEp, b.kw ?? 0, b.idleKw ?? 0),
          (o) => o.kind === 'drill' && (o as DrillNode).item === item);
        (node as DrillNode).rateEp = rateEp;
        break;
      }
      case 'generator': {
        const fuel = itemIdx(b.gen!.fuel!);
        const burnEp = Math.round((b.gen!.fuelPerMin ?? 0) * 1000);
        const kw = Math.floor((b.gen!.kw * mods.genOut) / 1000);
        node = reuse(e, () => new GeneratorNode(e.id, fuel, burnEp, kw), (o) => o.kind === 'generator');
        (node as GeneratorNode).outKw = kw;
        break;
      }
      case 'fork': {
        const f = reuse(e, () => new ForkNode(e.id), (o) => o.kind === 'fork') as ForkNode;
        f.mode = b.logic ?? 'router';
        const dealer = f.mode === 'router' || f.mode === 'distributor';
        f.sortItem = dealer ? -1 : filterOf(e.cfg, 0);
        f.filtersOn = dealer; // a filter per side, from the start (owner, 2026-10-12)
        f.cap = BAL.forkBufItems * 1000 * b.w * b.h;
        node = f;
        break;
      }
      case 'lab': {
        let st = inp.stores.get(e.id);
        if (!st) inp.stores.set(e.id, (st = new Float64Array(N_ITEMS)));
        const accepts = inp.labAccepts?.get(e.id) ?? null;
        node = reuse(e, () => new ReservoirNode(e.id, st!, LAB_CAP, [], 0, false, b.kw ?? 0), (o) => o.kind === 'reservoir');
        const r = node as ReservoirNode;
        r.accepts = accepts ?? NOTHING;
        // An idle lab only keeps its lights on.
        r.kw = accepts ? b.kw ?? 0 : b.idleKw ?? 0;
        r.idleKw = r.kw;
        break;
      }
      case 'excavator': {
        // A reservoir of dug rubble, emptied through its outlet (digging is the sim's job).
        let st = inp.stores.get(e.id);
        if (!st) inp.stores.set(e.id, (st = new Float64Array(N_ITEMS)));
        node = reuse(e, () => new ReservoirNode(e.id, st!, BAL.excavatorCap * 1000, [RUBBLE_IDX()], mpt(120), false, b.kw ?? 0), (o) => o.kind === 'reservoir');
        const r = node as ReservoirNode;
        r.portItems = [RUBBLE_IDX()];
        r.accepts = NOTHING;
        r.kw = inp.busy?.has(e.id) ? b.kw ?? 0 : b.idleKw ?? 0;
        r.idleKw = r.kw;
        break;
      }
      case 'backfiller': {
        let st = inp.stores.get(e.id);
        if (!st) inp.stores.set(e.id, (st = new Float64Array(N_ITEMS)));
        node = reuse(e, () => new ReservoirNode(e.id, st!, BAL.backfillerCap * 1000, [], 0, false, b.kw ?? 0), (o) => o.kind === 'reservoir');
        const r = node as ReservoirNode;
        r.accepts = new Set([RUBBLE_IDX()]);
        r.kw = inp.busy?.has(e.id) ? b.kw ?? 0 : b.idleKw ?? 0;
        r.idleKw = r.kw;
        break;
      }
      case 'dock': {
        let st = inp.stores.get(e.id);
        if (!st) inp.stores.set(e.id, (st = new Float64Array(N_ITEMS)));
        const items = (e.portItems ?? []).slice();
        node = reuse(e, () => new ReservoirNode(e.id, st!, BAL.dockCap * 1000, items, mpt(240), false, b.kw ?? 0), (o) => o.kind === 'reservoir');
        (node as ReservoirNode).portItems = items;
        break;
      }
      case 'pump': {
        // Its water a minute while it stands by water.
        const rate = touchesWater(grid, e) ? (b.drill?.perMin ?? 60) * 1000 : 0;
        node = reuse(e, () => new DrillNode(e.id, WATER_IDX(), rate, b.kw ?? 0, b.idleKw ?? 0), (o) => o.kind === 'drill');
        (node as DrillNode).rateEp = rate;
        break;
      }
      case 'server': {
        // A server (D68) only draws its power: the tokens it makes are counted at the sim level
        // (systems/research.ts), from its grid's satisfaction. Like a lab, it belongs to no group.
        node = reuse(e, () => new ReservoirNode(e.id, NO_STOCK, 0, [], 0, false, b.kw ?? 0), (o) => o.kind === 'reservoir');
        const r = node as ReservoirNode;
        r.accepts = NOTHING;
        r.kw = b.kw ?? 0;
        r.idleKw = r.kw;
        break;
      }
      case 'trade': {
        // A store between the ribbons and the Crier: its entrance takes its export streams (sold
        // at each epoch boundary), its exit hands out the delivered imports in turn (D62,
        // systems/trade.ts).
        let st = inp.stores.get(e.id);
        if (!st) inp.stores.set(e.id, (st = new Float64Array(N_ITEMS)));
        const items = (e.portItems ?? []).slice();
        const cap = inp.tradeCap ?? 240_000;
        node = reuse(e, () => new ReservoirNode(e.id, st!, cap, items, mpt(BAL.hearthPortPerMin), false, b.kw ?? 0), (o) => o.kind === 'reservoir');
        const r = node as ReservoirNode;
        r.cap = cap;
        r.portItems = items;
        r.accepts = inp.tradeAccepts?.get(e.id) ?? NOTHING;
        const buys = inp.tradeBuys?.get(e.id);
        r.cycle = buys && buys.length ? buys : null;
        break;
      }
      case 'sink': {
        // The incinerator (D51): whatever its feeds offer goes in and is destroyed.
        node = reuse(e, () => new SinkNode(e.id), (o) => o.kind === 'sink');
        break;
      }
      default:
        break;
    }
    if (!node) continue;
    node.idx = nodes.length;
    nodes.push(node);
    nodeByEnt.set(e.id, node);
    if (node.kind === 'reservoir') reservoirs.push(node as ReservoirNode);

    // Ports: routing blocks get theirs from the ribbons around them; others from their definition.
    const ports: WorldPort[] = kind === 'fork' ? routingPorts(e, b.logic ?? 'router', beltAt, across, lvAt, isLift) : worldPorts(e);
    for (const p of ports) {
      const ref: PortRef = { node, port: p.idx, dir: p.dir };
      if (p.io === 'in') inPortAt.set(tileIndex(p.x, p.y) * 4 + p.dir, ref);
      else {
        // An outlet faces what is past any junctions in front of it, on its own level only.
        const ft = across(p.fx, p.fy, p.dir);
        const ok = ft >= 0 && lvAt(ft) === grid.level(p.x, p.y);
        outPorts.push({ ref, fx: ok ? ft % WORLD : -1, fy: ok ? Math.floor(ft / WORLD) : -1 });
      }
    }
  }

  // ── 2b. routing blocks: direct links with the buildings around them ──────
  const outPortFacing = new Map<number, PortRef>(); // facing tile · 4 + port dir → port
  for (const op of outPorts) if (op.fx >= 0 && op.fy >= 0 && op.fx < WORLD && op.fy < WORLD) outPortFacing.set(tileIndex(op.fx, op.fy) * 4 + op.ref.dir, op.ref);
  const links: Array<{ s: FNode; sp: number; d: FNode; dp: number }> = [];
  const nextVirtual = new Map<ReservoirNode, number>();
  for (const e of sorted) {
    if (BUILDING_KIND[e.def] !== 'fork' || e.builtAt !== 0) continue;
    const f = nodeByEnt.get(e.id);
    if (!(f instanceof ForkNode)) continue; // dormant
    const pulls = new Set<FNode>();
    const lvE = grid.level(e.x, e.y);
    for (const r of rim(e)) {
      const nt = across(r.nx, r.ny, r.d); // what this side faces, past any junctions
      if (nt < 0 || lvAt(nt) !== lvE) continue; // another level: a cliff between them
      if (beltAt.has(nt)) continue; // ribbons: the ports above
      const oid = grid.occ[nt]!;
      if (!oid || oid === e.id) continue;
      const o = ents.get(oid), on = nodeByEnt.get(oid);
      if (!o || !on) continue;
      const back = opposite(r.d);
      if (on instanceof ForkNode) {
        // Block to block: hand on where this one may give and that one may take.
        if (canOut(f.mode, e.rot, r.d) && canIn(on.mode, o.rot, back)) links.push({ s: f, sp: r.idx, d: on, dp: rimIndex(o, nt % WORLD, Math.floor(nt / WORLD), back) });
        continue;
      }
      if (f.mode === 'unloader' && on instanceof ReservoirNode && on !== hearth) {
        // Pull the chosen item out of the store, through a port of the store's own (never the
        // Heart's: it takes, it never gives — the owner, 2026-10-12).
        if (f.sortItem < 0) continue;
        const k = nextVirtual.get(on) ?? Math.max(on.portItems.length, buildingDef(o.def).ports.length);
        while (on.portItems.length < k) on.portItems.push(-1);
        on.portItems[k] = f.sortItem;
        nextVirtual.set(on, k + 1);
        links.push({ s: on, sp: k, d: f, dp: r.idx });
        pulls.add(on);
        continue;
      }
      if (canOut(f.mode, e.rot, r.d)) {
        const ip = inPortAt.get(nt * 4 + back);
        if (ip && !pulls.has(ip.node)) links.push({ s: f, sp: r.idx, d: ip.node, dp: ip.port });
      }
      if (canIn(f.mode, e.rot, r.d)) {
        const op = outPortFacing.get(tileIndex(r.x, r.y) * 4 + back);
        if (op) links.push({ s: op.node, sp: op.port, d: f, dp: r.idx });
      }
    }
  }

  // ── 3. ribbon targets and feeders ───────────────────────────────────────
  type Target = { belt: number } | { port: PortRef } | null;
  const target = new Map<number, Target>();
  const feeders = new Map<number, number>(); // belt tile → feeder count
  const beltFeederOf = new Map<number, number[]>(); // belt tile → feeding belt tiles
  const span = 4 + mods.bridgeSpan;
  const jumps = new Map<number, number>();
  for (const [t, e] of beltAt) {
    const d = e.rot;
    let gx = e.x + DX[d]!, gy = e.y + DY[d]!;
    // A skybridge leaps to the next skybridge ahead in its direction, within its span.
    if (BUILDING_KIND[e.def] === 'bridge') {
      for (let k = 1; k <= span; k++) {
        const bx = e.x + DX[d]! * k, by = e.y + DY[d]! * k;
        if (bx < 0 || by < 0 || bx >= WORLD || by >= WORLD) break;
        const o = beltAt.get(tileIndex(bx, by));
        if (o && BUILDING_KIND[o.def] === 'bridge' && o.rot === d && grid.level(bx, by) === grid.level(e.x, e.y)) { gx = bx; gy = by; break; }
      }
    }
    // Crossings let both lines pass straight through.
    while (gx >= 0 && gy >= 0 && gx < WORLD && gy < WORLD && crossingAt.has(tileIndex(gx, gy))) { gx += DX[d]!; gy += DY[d]!; }
    if (gx < 0 || gy < 0 || gx >= WORLD || gy >= WORLD) { target.set(t, null); continue; }
    const g = tileIndex(gx, gy);
    // The next level up or down only by a traction ribbon (D45); a cliff otherwise ends the line.
    const dl = Math.abs(lvAt(g) - lvAt(t));
    if (dl > (isLift(e) ? 1 : 0)) { target.set(t, null); continue; }
    const gb = beltAt.get(g);
    const fluid = BUILDING_KIND[e.def] === 'conduit';
    const leaps = gx !== e.x + DX[d]! || gy !== e.y + DY[d]!;
    // A bridge is entered from straight behind only (owner, 2026-10-13: "you should not be able
    // to enter a bridge from the side"): a ribbon at its side ends there.
    const sideOfBridge = !!gb && BUILDING_KIND[gb.def] === 'bridge' && gb.rot !== d;
    if (gb && gb.rot !== opposite(d) && !sideOfBridge && (BUILDING_KIND[gb.def] === 'conduit') === fluid) {
      if (leaps) jumps.set(t, g);
      target.set(t, { belt: g });
      feeders.set(g, (feeders.get(g) ?? 0) + 1);
      let arr = beltFeederOf.get(g);
      if (!arr) beltFeederOf.set(g, (arr = []));
      arr.push(t);
    } else {
      const ref = inPortAt.get(g * 4 + opposite(d));
      if (ref && leaps) jumps.set(t, g);
      target.set(t, ref ? { port: ref } : null);
    }
  }
  // Output ports feeding ribbons also count as feeders.
  const portFeeds: Array<{ ref: PortRef; tile: number }> = [];
  for (const op of outPorts) {
    if (op.fx < 0 || op.fy < 0 || op.fx >= WORLD || op.fy >= WORLD) continue;
    const t = tileIndex(op.fx, op.fy);
    const b = beltAt.get(t);
    if (!b || b.rot === opposite(op.ref.dir)) continue;
    if (BUILDING_KIND[b.def] === 'bridge' && b.rot !== op.ref.dir) continue; // into a bridge from behind only
    feeders.set(t, (feeders.get(t) ?? 0) + 1);
    portFeeds.push({ ref: op.ref, tile: t });
  }
  // What feeds each ribbon tile, as a mask of the sides it comes in from (the views' bends).
  const feedDirs = new Map<number, number>();
  for (const [t, fs] of beltFeederOf) for (const f of fs) feedDirs.set(t, (feedDirs.get(t) ?? 0) | (1 << sideTowards(t, f)));
  for (const pf of portFeeds) feedDirs.set(pf.tile, (feedDirs.get(pf.tile) ?? 0) | (1 << opposite(pf.ref.dir)));

  // A bridge goes at the pace of its line (owner, 2026-10-13: "the speed at which routers,
  // bridges etc convey the items should be the same as the input ribbon"): the ribbon feeding it
  // sets its tier, else the ribbon it hands on to; a bridge with neither keeps its own. Its tier
  // is the ribbon's, so a line through bridges stays one chain at the line's speed. (Routing
  // blocks hand on a whole item per way out every tick, and junctions let lines run straight
  // through: neither slows a line.)
  const isBridge = (t: number): boolean => BUILDING_KIND[beltAt.get(t)!.def] === 'bridge';
  const paceMemo = new Map<number, number>();
  const ahead = (t: number): number => {
    let at = t;
    for (let k = 0; k < 64 && isBridge(at); k++) {
      const tg = target.get(at);
      if (!tg || !('belt' in tg)) return beltAt.get(t)!.def;
      at = tg.belt;
    }
    return beltAt.get(at)!.def;
  };
  const paceAt = (t: number): number => {
    if (!isBridge(t)) return beltAt.get(t)!.def;
    const known = paceMemo.get(t);
    if (known !== undefined) return known;
    let at = t, fs = beltFeederOf.get(at) ?? [];
    for (let k = 0; k < 64 && fs.length === 1 && isBridge(at); k++) { at = fs[0]!; fs = beltFeederOf.get(at) ?? []; }
    const def = !isBridge(at) ? beltAt.get(at)!.def : ahead(t);
    paceMemo.set(t, def);
    return def;
  };

  // continues(F → G): G is F's ribbon target, same tier, and F is G's only feeder.
  const next = new Map<number, number>();
  const prev = new Map<number, number>();
  for (const [t, tg] of target) {
    if (!tg || !('belt' in tg)) continue;
    const g = tg.belt;
    if ((feeders.get(g) ?? 0) === 1 && paceAt(g) === paceAt(t)) {
      next.set(t, g);
      prev.set(g, t);
    }
  }

  // ── 4. trace chains ─────────────────────────────────────────────────────
  const chainTiles: number[][] = [];
  const visited = new Set<number>();
  const tilesSorted = [...beltAt.keys()].sort((a, b) => a - b);
  const traceFrom = (start: number): void => {
    const list: number[] = [];
    let t: number | undefined = start;
    while (t !== undefined && !visited.has(t)) {
      visited.add(t);
      list.push(t);
      t = next.get(t);
    }
    chainTiles.push(list);
  };
  for (const t of tilesSorted) if (!prev.has(t)) traceFrom(t);
  for (const t of tilesSorted) if (!visited.has(t)) traceFrom(t); // pure loops: break at the smallest tile

  // ── 5. chain nodes, contents preserved ──────────────────────────────────
  // A conduit's parcels by tile; a ribbon's items by tile (each on its own cell: nothing to spread).
  const oldParcels = inp.old ? collectParcels(inp.old, inp.now) : new Map<number, Parcel[]>();
  const oldCells = inp.old ? collectCells(inp.old) : new Map<number, OldCell>();
  const oldByKey = new Map<string, Chain>();
  if (inp.old) for (const c of inp.old.chains) oldByKey.set(chainKey(c.tier, c.tiles), c);
  const chains: Chain[] = [];
  const chainByTile = new Map<number, Chain>();
  const usedTiles = new Set<number>();
  // Head-first canonical order: by head tile index.
  chainTiles.sort((a, b) => a[a.length - 1]! - b[b.length - 1]!);
  for (const list of chainTiles) {
    const e0 = beltAt.get(list[0]!)!;
    const tier = paceAt(list[0]!); // a bridge's: its line's (above)
    const bdef = buildingDef(tier);
    const tiles = Int32Array.from(list);
    const key = chainKey(tier, tiles);
    const fluid = BUILDING_KIND[e0.def] === 'conduit';
    // Reuse the old chain's state only for the very same path (the key is a fingerprint: a
    // re-laid chain can share it while its other tiles' items get refunded — duplicates).
    const cand = oldByKey.get(key);
    const same = cand && sameTiles(cand.tiles, tiles) && cand.fluid === fluid ? cand : undefined;
    const c = new Chain(tiles, tier, bdef.belt!.perMin, bdef.belt!.ticksPerTile, fluid);
    if (same) {
      c.restore(same.snapshot(), 0);
      // Keep the stream's running total: the views read flows from it.
      c.pushedTotal = same.pushedTotal;
      // Its cells' entries came by the old graph's edges: those numbers mean nothing now.
      for (let i = 0; i < c.via.length; i++) if (c.via[i]! >= 0) c.via[i] = VIA_NONE;
      c.stageVia = VIA_NONE;
      for (const t of list) usedTiles.add(t);
    } else if (!fluid) {
      // Each item stays on its tile (owner's bug, 2026-10-13: a router set on a jammed line moved all its items ahead).
      list.forEach((t, i) => {
        usedTiles.add(t);
        const o = oldCells.get(t);
        if (!o) return;
        if (o.item >= 0) { c.place(i, o.item); c.moved[i] = o.moved; }
        if (o.stageMu > 0) {
          if (i === 0) { c.stageItem = o.stageItem; c.stageMu = o.stageMu; c.content += o.stageMu; }
          else inp.refund(o.stageItem, o.stageMu);
        }
      });
    } else {
      // A conduit: rebuild from per-tile parcels, head first.
      const ps: Parcel[] = [];
      for (let j = list.length - 1; j >= 0; j--) {
        const t = list[j]!;
        const fromHead = list.length - 1 - j;
        for (const p of oldParcels.get(t) ?? []) ps.push({ ...p, pos: fromHead + p.frac });
        usedTiles.add(t);
      }
      ps.sort((a, b) => a.pos - b.pos);
      for (const p of ps) c.push(p.item, p.mu, inp.now + Math.round(p.pos * c.ticksPerTile));
    }
    c.idx = nodes.length;
    nodes.push(c);
    chains.push(c);
    for (const t of list) chainByTile.set(t, c);
  }
  // Items on removed ribbons go back to the Hearth (and a conduit's parcels on what is now a ribbon, a ribbon's on a conduit).
  for (const [t, ps] of oldParcels) {
    if (usedTiles.has(t) && chainByTile.get(t)?.fluid) continue;
    for (const p of ps) inp.refund(p.item, p.mu);
  }
  for (const [t, o] of oldCells) {
    const c = chainByTile.get(t);
    if (usedTiles.has(t) && c && !c.fluid) continue;
    if (o.item >= 0) inp.refund(o.item, MU);
    if (o.stageMu > 0) inp.refund(o.stageItem, o.stageMu);
  }

  // ── 6. edges ────────────────────────────────────────────────────────────
  const src: number[] = [], dst: number[] = [], sp: number[] = [], dp: number[] = [], prio: number[] = [];
  const addEdge = (s: FNode, sPort: number, d: FNode, dPort: number, pr: number): void => {
    const e = src.length;
    src.push(s.idx); dst.push(d.idx); sp.push(sPort); dp.push(dPort); prio.push(pr);
    s.outE.push(e);
    d.inE.push(e);
  };
  for (const c of chains) {
    const headTile = c.tiles[c.tiles.length - 1]!;
    const tg = target.get(headTile);
    if (!tg) continue;
    if ('belt' in tg) {
      const dc = chainByTile.get(tg.belt)!;
      if (dc === c && c.tiles.length > 0 && next.get(headTile) === c.tiles[0]) {
        // A closed loop feeding itself.
        addEdge(c, 0, c, 0, 0);
        continue;
      }
      const gb = beltAt.get(tg.belt)!;
      const hx = headTile % WORLD, hy = (headTile - hx) / WORLD;
      const straight = hx === gb.x - DX[gb.rot]! && hy === gb.y - DY[gb.rot]!;
      addEdge(c, 0, dc, 0, straight ? 0 : 1);
    } else {
      addEdge(c, 0, tg.port.node, tg.port.port, 0);
    }
  }
  for (const pf of portFeeds) {
    const dc = chainByTile.get(pf.tile)!;
    const b = beltAt.get(pf.tile)!;
    addEdge(pf.ref.node, pf.ref.port, dc, 0, b.rot === pf.ref.dir ? 0 : 1);
  }
  // Routing blocks' direct links (machines, stores, other blocks).
  for (const l of links) addEdge(l.s, l.sp, l.d, l.dp, 0);
  // Direct insertion: an output port set against a neighbour's input port hands its items
  // straight on, no ribbon needed — machines, drills, stores, the Heart (owner, 2026-10-12;
  // it was the Hive City keystone's).
  for (const op of outPorts) {
    if (op.fx < 0 || op.fy < 0 || op.fx >= WORLD || op.fy >= WORLD) continue;
    const ref = inPortAt.get(tileIndex(op.fx, op.fy) * 4 + opposite(op.ref.dir));
    if (ref && ref.node !== op.ref.node && op.ref.node.outE.length === 0) addEdge(op.ref.node, op.ref.port, ref.node, ref.port, 0);
  }
  // Priority order of incoming edges: straight (0) before side (1), then creation order.
  for (const n of nodes) if (n.inE.length > 1) n.inE.sort((a, b) => prio[a]! - prio[b]! || a - b);
  // Routing blocks: which outputs go straight on (the block's front) or to the sides, and
  // routers' per-side filters (Long Bridges), aligned with their out-edges.
  for (const n of nodes) {
    if (!(n instanceof ForkNode)) continue;
    const e = ents.get(n.ent)!;
    n.fronts = []; n.sides = []; n.filters = [];
    n.outE.forEach((edge, k) => {
      const d = sp[edge]! % 4;
      (d === e.rot ? n.fronts : n.sides).push(k);
      n.filters.push(n.filtersOn ? filterOf(e.cfg, d) : -1);
    });
    // Its turn among the outputs cycles over every set it deals to (all, front, sides).
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const lcm = (a: number, b: number): number => (a && b ? (a / gcd(a, b)) * b : a || b || 1);
    n.turnMod = lcm(lcm(n.outE.length, n.fronts.length), n.sides.length) || 1;
    n.turn %= n.turnMod;
  }
  // The accept order: every node but the ribbons, then the ribbons by depth — the chains feeding a
  // building (or nothing) first, then those feeding them, and so on up the lines (a loop is cut
  // where the walk meets itself).
  const depth = new Map<Chain, number>();
  const depthOf = (c: Chain, seen: Set<Chain>): number => {
    const known = depth.get(c);
    if (known !== undefined) return known;
    const e = c.outE[0];
    const d = e === undefined ? undefined : nodes[dst[e]!];
    let v = 0;
    if (d instanceof Chain && d !== c && !seen.has(d)) { seen.add(c); v = depthOf(d, seen) + 1; }
    depth.set(c, v);
    return v;
  };
  for (const c of chains) depthOf(c, new Set());
  const accOrder: FNode[] = nodes.filter((n) => !(n instanceof Chain));
  accOrder.push(...[...chains].sort((a, b) => depth.get(a)! - depth.get(b)! || a.idx - b.idx));

  // ── 7. power grids: the connected components of the wires (D25) ──────────
  // Members: built, awake buildings that take part in power. A wire to a construction site or
  // a dormant building carries nothing until it stands; nothing joins a grid by proximity.
  const members: Ent[] = [];
  for (const e of sorted) if (e.builtAt === 0 && !inp.dormant?.(e) && linkable(e.def)) members.push(e);
  const { gridOf, poles } = buildGrids(members, (e) => isLinkPoint(e.def), inp.links ?? NO_WIRES);
  const nets: Net[] = poles.map((p, id) => ({ id, poles: p, producers: [], accs: [] }));
  const netOfEnt = new Map<number, number>();
  for (const e of members) {
    const g = gridOf.get(e.id);
    if (g === undefined) continue; // an unwired building: no grid, no power
    netOfEnt.set(e.id, g);
    const node = nodeByEnt.get(e.id);
    if (node) node.net = g;
    const b = buildingDef(e.def);
    const net = nets[g]!;
    // The Hearth's built-in solar panel: a solar panel's rules (solar research, all-generator bonus).
    if (b.kind === 'hearth') net.producers.push({ ent: e.id, kind: 'hearth', kw: Math.floor((BAL.hearthSolarKw * mods.solarOut * mods.genOut) / 1e6), local: 1000, base: Math.floor((BAL.hearthCoreKw * mods.genOut) / 1000) });
    else if (b.kind === 'wind') net.producers.push({ ent: e.id, kind: 'wind', kw: Math.floor((b.gen!.kw * mods.windOut * mods.genOut) / 1e6), local: windLocal(grid, e) });
    else if (b.kind === 'solar') net.producers.push({ ent: e.id, kind: 'solar', kw: Math.floor((b.gen!.kw * mods.solarOut * mods.genOut) / 1e6), local: b.gen!.night ?? 0 });
    else if (b.kind === 'geothermal') net.producers.push({ ent: e.id, kind: 'geo', kw: Math.floor((b.gen!.kw * mods.geoOut * mods.genOut) / 1e6), local: 1000 });
    else if (b.kind === 'accumulator') {
      const a = b.accumulator!;
      net.accs.push({ ent: e.id, cap: Math.floor((a.kwMin * 600 * mods.accCap) / 1000), rate: Math.floor((a.kw * mods.accRate) / 1000) } satisfies Acc);
    }
  }
  for (const n of nets) n.producers.sort((a: Producer, b: Producer) => a.ent - b.ent);
  const servers: Graph['servers'] = [];
  for (const e of sorted) {
    if (BUILDING_KIND[e.def] !== 'server' || !nodeByEnt.has(e.id)) continue;
    const net = netOfEnt.get(e.id);
    if (net !== undefined) servers.push({ ent: e.id, net, tpm: buildingDef(e.def).server!.tokensPerMin });
  }

  const nE = src.length;
  return {
    version: (inp.old?.version ?? 0) + 1,
    nodes, chains, nE,
    eSrc: Int32Array.from(src), eDst: Int32Array.from(dst), eSrcPort: Int32Array.from(sp), eDstPort: Int32Array.from(dp),
    nodeByEnt, chainByTile, nets, netOfEnt, reservoirs, hearth, servers, feedDirs, jumps, accOrder,
  };
}

/** Milli-items per tick for a per-minute rate (60/min → 100). */
export const mpt = (perMin: number): number => Math.round((perMin * 1000) / 600);

/** Does a pump stand by water (on or next to a water tile) on its own level (a tarn up on the Crown, D63, is not the floor's)? */
function touchesWater(grid: Grid, e: Ent): boolean {
  const lv = grid.level(e.x, e.y);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const t = grid.terrain(e.x + dx, e.y + dy);
    if ((t === T.Shallow || t === T.Deep) && grid.level(e.x + dx, e.y + dy) === lv) return true;
  }
  return false;
}

function onDugFloor(grid: Grid, e: Ent): boolean {
  let all = true;
  forTiles(e, (x, y) => { if (grid.terrain(x, y) !== T.Dug) all = false; });
  return all;
}

/** Majority ore under a drill and its rate cap (mu per epoch). */
export function drillRate(grid: Grid, e: Ent, mods: Mods): { item: number; rateEp: number } {
  const b = buildingDef(e.def);
  // A ground collector: a steady rate off the bare ground (its placement checked the sand).
  if (b.drill?.ground) return { item: itemIdx(b.drill.ground), rateEp: b.drill.perMin * 1000 };
  // A data collector (D68): its item out of power alone, anywhere.
  if (b.drill?.anywhere) return { item: itemIdx(b.drill.anywhere), rateEp: b.drill.perMin * 1000 };
  const counts = new Map<number, number>();
  const caps = new Map<number, number>();
  forTiles(e, (x, y) => {
    const o = grid.ore(x, y);
    if (o < 0) return;
    counts.set(o, (counts.get(o) ?? 0) + 1);
    caps.set(o, (caps.get(o) ?? 0) + grid.capMuPerEpoch(x, y));
  });
  let item = -1, best = 0;
  for (const [o, n] of [...counts].sort((a, c) => a[0] - c[0])) if (n > best) { best = n; item = o; }
  if (item < 0) return { item: -1, rateEp: 0 };
  const capMult = b.drill!.capMult ?? 1000;
  const [w, h] = footprint(e.def, e.rot);
  const cx = e.x + w / 2 - 512, cy = e.y + h / 2 - 512;
  const ring3 = cx * cx + cy * cy > 320 * 320 ? mods.ring3Caps : 1000;
  const cap = Math.floor((Math.floor((caps.get(item)! * capMult) / 1000) * ring3) / 1000);
  return { item, rateEp: Math.min(b.drill!.perMin * 1000, cap) };
}

/** Local wind factor ‰ at a building: on the mountains the Sough blows (D44), the cirque's floor is sheltered, plateaus are windy. */
function windLocal(grid: Grid, e: Ent): number {
  const t = grid.terrain(e.x, e.y);
  if (isRock(t)) return BAL.windRock[t - T.Rock1] ?? BAL.windRock[0]!;
  const [w, h] = footprint(e.def, e.rot);
  const dx = e.x + w / 2 - CENTER, dy = e.y + h / 2 - CENTER;
  const r2 = dx * dx + dy * dy;
  // Sheltered inside the Crown: its foot on this land's map (D63: map 1 keeps its own, 34).
  const outer = grid.source.crownOuter ?? CIRQUE.crownOuter;
  if (r2 < outer * outer) return BAL.windCirque;
  // Mesas (hardpan plateaus) are windy; the rest of the outside is plain.
  return grid.terrain(e.x, e.y) === T.Hardpan ? BAL.windMesa[0] : BAL.windPlain;
}

/** May a routing block take items in from / hand them out towards outward side d? */
function canIn(logic: RouterLogic, rot: Rot, d: Rot): boolean {
  if (logic === 'distributor') return true;
  if (logic === 'unloader') return false; // fed by the stores it touches
  return d === opposite(rot); // directional, the router too (owner, 2026-10-12): from the back only
}

function canOut(logic: RouterLogic, rot: Rot, d: Rot): boolean {
  if (logic === 'distributor' || logic === 'unloader') return true;
  return d !== opposite(rot); // straight on, and both sides
}

/** A footprint's rim: every (tile, outward side) facing out, with a stable port index. */
function rim(e: Ent): Array<{ idx: number; x: number; y: number; d: Rot; nx: number; ny: number }> {
  const [w, h] = footprint(e.def, e.rot);
  const out: Array<{ idx: number; x: number; y: number; d: Rot; nx: number; ny: number }> = [];
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      for (let d = 0 as Rot; d < 4; d = (d + 1) as Rot) {
        const lx = tx + DX[d]!, ly = ty + DY[d]!;
        if (lx >= 0 && ly >= 0 && lx < w && ly < h) continue; // inside the footprint
        out.push({ idx: (ty * w + tx) * 4 + d, x: e.x + tx, y: e.y + ty, d, nx: e.x + lx, ny: e.y + ly });
      }
    }
  }
  return out;
}

/** The rim port index of a routing block for its tile (x, y) and outward side d. */
function rimIndex(e: Ent, x: number, y: number, d: Rot): number {
  const [w] = footprint(e.def, e.rot);
  return ((y - e.y) * w + (x - e.x)) * 4 + d;
}

/** The side of tile `from` (0 N … 3 W) on which tile `to` lies (same row or column). */
function sideTowards(from: number, to: number): number {
  const fx = from % WORLD, fy = (from - fx) / WORLD, tx = to % WORLD, ty = (to - tx) / WORLD;
  return ty < fy ? 0 : tx > fx ? 1 : ty > fy ? 2 : 3;
}

/**
 * A routing block's ports with the ribbons around it (conduits carry fluids: never), seen past
 * any junctions in line with a side (`across`): a ribbon running into the junction feeds the
 * block, one running away from it is fed through it.
 */
function routingPorts(e: Ent, logic: RouterLogic, beltAt: Map<number, Ent>, across: (x: number, y: number, d: Rot) => number, lvAt: (t: number) => number, isLift: (e: Ent | undefined) => boolean): WorldPort[] {
  const ports: WorldPort[] = [];
  const lv = lvAt(tileIndex(e.x, e.y));
  for (const r of rim(e)) {
    const nt = across(r.nx, r.ny, r.d);
    const b = nt < 0 ? undefined : beltAt.get(nt);
    if (!b || BUILDING_KIND[b.def] === 'conduit') continue;
    const into = b.rot === opposite(r.d);
    // Its own level only — but a traction ribbon may climb into it from one level away (D45).
    const dl = Math.abs(lvAt(nt) - lv);
    if (dl > (into && isLift(b) ? 1 : 0)) continue;
    if (into ? !canIn(logic, e.rot, r.d) : !canOut(logic, e.rot, r.d)) continue;
    // Into a bridge only from straight behind it (its way is away from the block).
    if (!into && BUILDING_KIND[b.def] === 'bridge' && b.rot !== r.d) continue;
    ports.push({ idx: r.idx, io: into ? 'in' : 'out', x: r.x, y: r.y, dir: r.d, fx: b.x, fy: b.y });
  }
  return ports;
}

interface Parcel { item: number; mu: number; frac: number; pos: number }

/**
 * Spread every chain's runs onto its tiles, item by item (distance from head, packing respected).
 * A run can hold many items — a jammed ribbon's due items coalesce into one run at its head — so
 * each item gets its own place: its arrival in the run's window, and never closer to the head than
 * the items ahead of it allow. Cut by a new building, each part of a ribbon keeps the items that
 * stand on it (owner's bug, 2026-10-13: a router set on a jammed line moved all its items ahead).
 */
function collectParcels(g: Graph, now: number): Map<number, Parcel[]> {
  const out = new Map<number, Parcel[]>();
  for (const c of g.chains) {
    if (!c.fluid) continue;
    const L = c.tiles.length;
    const perTile = (c.fluid ? BAL.conduitDensity : BAL.beltDensity) * 1000;
    let packed = 0; // mu already ahead
    for (const r of c.live()) {
      // Whole items first, the part of one still being formed last.
      for (let done = 0; done < r.mu;) {
        const mu = Math.min(MU, r.mu - done);
        done += mu;
        const at = r.from + Math.floor(((r.to - r.from) * done) / r.mu); // when this item is due at the head
        const free = at > now ? (at - now) / c.ticksPerTile : 0;
        const pos = Math.min(L - 0.001, Math.max(free, packed / perTile));
        packed += mu;
        const fromHead = Math.floor(pos);
        const tile = c.tiles[L - 1 - fromHead]!;
        let arr = out.get(tile);
        if (!arr) out.set(tile, (arr = []));
        arr.push({ item: r.item, mu, frac: pos - fromHead, pos });
      }
    }
  }
  return out;
}

/** What a ribbon tile held: its cell's item (−1: none) and when it got there, and the stage's part at a chain's tail. */
interface OldCell { item: number; moved: number; stageItem: number; stageMu: number }

/** Every ribbon tile's item, by tile (a recompile lays each on the same tile again). */
function collectCells(g: Graph): Map<number, OldCell> {
  const out = new Map<number, OldCell>();
  for (const c of g.chains) {
    if (c.fluid) continue;
    c.tiles.forEach((t, i) => {
      const it = c.itemAt(i), tail = i === 0 && c.stageMu > 0;
      if (it < 0 && !tail) return;
      out.set(t, { item: it, moved: c.moved[i]!, stageItem: tail ? c.stageItem : -1, stageMu: tail ? c.stageMu : 0 });
    });
  }
  return out;
}

const sameTiles = (a: Int32Array, b: Int32Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

function chainKey(tier: number, tiles: Int32Array): string {
  return `${tier}:${tiles.length}:${tiles[0]}:${tiles[tiles.length - 1]}:${tiles[tiles.length >> 1]}`;
}

/** Refund a discarded node's buffered items to the Hearth. */
export function refundNode(n: FNode, refund: (item: number, mu: number) => void): void {
  if (n instanceof MachineNode && n.recipe) {
    n.recipe.ins.forEach((s, j) => { if (n.inBuf[j]! > 0) refund(s.item, n.inBuf[j]!); });
    n.recipe.outs.forEach((s, j) => { if (n.outBuf[j]! > 0) refund(s.item, n.outBuf[j]!); });
    if (n.crafting) for (const s of n.recipe.ins) refund(s.item, s.mu);
  } else if (n instanceof DrillNode) {
    if (n.outBuf > 0 && n.item >= 0) refund(n.item, n.outBuf);
  } else if (n instanceof ForkNode) {
    if (n.mu > 0 && n.item >= 0) refund(n.item, n.mu);
  } else if (n instanceof GeneratorNode) {
    if (n.fuel > 0) refund(n.fuelItem, n.fuel);
  }
}
