// serialize.ts — colony ⇄ plain JSON-able data. Saved: entities, stocks, research, power
// stores, terrain diffs, the parcels held, every node's internal state and every ribbon's
// parcels (absolute ticks). Not saved: generated terrain, occupancy, the compiled graph —
// rebuilt on load. Round-trip invariant: load(save(sim)).hash() === sim.hash().
// Indices are content indices: a save carries the table it was written against (`content`)
// and `deserialize` re-points it to today's content first (save-remap.ts, D47).
import { N_ITEMS } from '@/content/registry';
import { isEmblem, type Emblem } from '@/content/emblem';
import { LocalMarketService } from '@/market/service';
import type { MarketSave } from '@/market/types';
import { Sim, newTokenStats, type TokenStats } from './state';
import { effectiveCost, projectPermille, tokensDue } from './research/runtime';
import { BUILDING_KIND, hasResearch, itemDef, itemIdx } from '@/content/registry';
import { modulesOf, withModules } from './cfg';
import type { ImportOrder, PostActivity, Shipment, TradeLine } from './trade';
import { loadQuests, saveQuests, type QuestSave } from './systems/quests';
import { loadValue, saveValue, type ValueState } from './systems/value';
import type { TerrainSource } from './world/grid';
import type { Rot } from './types';
import { forTiles } from './entities';
import { contentTable, remapSave, type ContentTable } from './save-remap';
import { tileIndex } from './world/grid';
import { packRuns } from './flow/chain';

/**
 * 2: ribbons save their cells, one item per tile (the tile-by-tile ribbons, D57); conduits their
 * runs. 3: land in parcels (D60). 4: the 5 × 5 trade post (D62). 5: a post's cargo instead of its
 * export streams (D64). 6: the 2×2 pylon (D75: the 1×1 ones retired). 7: research on data
 * files and AI tokens, the tiered tree (D68–D70): research ids renamed (`RESEARCH_RENAMED`),
 * projects with their tokens. 8: research at its table's cost, without the spread penalty (D72):
 * the running projects rebased on it at load. 9: parcels of 23 tiles, a starting square of 3 × 3
 * (D74): the land's parcel ids on the new grid. 10: the 3×3 research lab (D84: the 2×2 ones retired).
 */
export const SAVE_VERSION = 10;

export interface SaveData {
  v: number;
  worldSeed: number;
  playerSeed: number;
  /** The map version the base's land was made by (D63, content `MAPS`; persist/colony.ts opens it on that land). Absent: 1, the land of every base founded before map versions. */
  mapV?: number;
  foundingEpoch: number;
  colonyName: string;
  /** The claim's emblem (content/emblem.ts, by ids; absent: none yet). */
  emblem?: Emblem;
  tick: number;
  credits: number;
  hearthLevel: number;
  hearthId: number;
  nextId: number;
  /** The content table the indices below refer to (D47; absent: written by this very content). */
  content?: ContentTable;
  /** Packed: id, def, x, y, rot, cfg, builtAt per entity. */
  ents: number[];
  portItems: Array<[number, number[]]>;
  stock: number[];
  stores: Array<[number, number[]]>;
  acc: Array<[number, number]>;
  /** Power wires (D25), flat: [a, b, a, b…] with a < b, ascending. Absent: no wires. */
  links?: number[];
  done: string[];
  terrainDiff: Array<[number, number]>;
  /** Levels changed by play (D45; absent in older saves). */
  levelDiff?: Array<[number, number]>;
  oreDiff: Array<[number, number]>;
  /** The parcels held beyond the starting square (docs/land.md): bought, granted (save v3), leased [parcel, next tick due, rent]. Absent: none. */
  land?: { bought: number[]; granted?: number[]; leases: Array<[number, number, number]>; paid?: Array<[number, number]> };
  explored: Array<[number, number, number]>;
  nodes: Array<[number, unknown]>;
  /**
   * Every chain, keyed by tier, head tile and length. A ribbon: `cells`, item + 1 per tile from
   * tail to head (0: empty), and `stage`, the part of an item being loaded at its tail. A conduit:
   * `runs` (item, milli-items, from, to — head first).
   */
  chains: Array<{ tier: number; head: number; len: number; runs?: number[]; cells?: number[]; stage?: [number, number] }>;
  produced: number[];
  consumed: number[];
  /** Research in progress (start order), archive notes, reconversion state. */
  projects?: Array<{ id: string; lab: number; cost: number[]; paid: number[]; dur: number; el: number; notes?: number; tokens?: number; tokUsed?: number }>;
  /** AI tokens (D68): used and not yet billed, the servers' output since the boundary, research held, the Compute Plan, the bill's statistics. */
  tokens?: { use: number; serverAcc: number; held: boolean; plan: boolean; stats?: TokenStats };
  /** The data makers' carried fractions, by entity (the Heart, autonomous labs). */
  dataAcc?: Array<[number, number]>;
  /** The Research Queue: each lab's next node. */
  labQueue?: Array<[number, string]>;
  notes?: number;
  respecs?: number;
  lastRespec?: number;
  /** Space: marked tiles ([tile, 1 dig | 2 fill]), running jobs, drifters, routes. */
  designated?: Array<[number, number]>;
  jobs?: Array<{ ent: number; kind: 'dig' | 'fill'; tile: number; dur: number; el: number; mu: number; moved: number; quarry?: true }>;
  fleet?: Array<[number, number]>;
  routes?: Array<{ id: number; from: number; to: number; item: number; ships: number; carry?: number }>;
  nextRouteId?: number;
  /** The Crier: the market's own (flow-dependent) state, and the colony's trade. */
  market?: MarketSave;
  trade?: {
    /** Per post, its cargo (D64): the items it bought and holds or awaits, sorted. */
    cargo: Array<[number, number[]]>;
    orders: ImportOrder[];
    nextOrderId: number;
    inflight: Shipment[];
    sold: number[];
    bought: number[];
    ledger: TradeLine[];
    activity: Array<[number, PostActivity]>;
    earned: number;
    spent: number;
    soldTotal?: number[];
    boughtTotal?: number[];
    /** Floor Prices: [item, centi-◉ an item]. */
    floors?: Array<[number, number]>;
  };
  /** The tutorial: quests done (ids), the current one's baselines, rewards in force (systems/quests.ts). */
  quests?: QuestSave;
  /** The claim's value history (systems/value.ts, D50; absent: none yet). */
  value?: ValueState;
}

export function serialize(sim: Sim): SaveData {
  sim.ensureCompiled();
  const ents: number[] = [];
  const portItems: Array<[number, number[]]> = [];
  for (const e of sim.ents.sorted()) {
    ents.push(e.id, e.def, e.x, e.y, e.rot, e.cfg, e.builtAt);
    if (e.portItems) portItems.push([e.id, [...e.portItems]]);
  }
  const nodes: Array<[number, unknown]> = [];
  for (const n of sim.graph.nodes) if (n.ent && n.kind !== 'reservoir') nodes.push([n.ent, n.snapshot()]);
  const chains: SaveData['chains'] = sim.graph.chains.map((c) => {
    const key = { tier: c.tier, head: c.tiles[c.tiles.length - 1]!, len: c.tiles.length };
    if (c.fluid) {
      const runs: number[] = [];
      for (const r of c.live()) runs.push(r.item, r.mu, r.from, r.to);
      return { ...key, runs };
    }
    return c.stageMu > 0 ? { ...key, cells: Array.from(c.cells), stage: [c.stageItem, c.stageMu] as [number, number] } : { ...key, cells: Array.from(c.cells) };
  });
  return {
    v: SAVE_VERSION,
    worldSeed: sim.worldSeed, playerSeed: sim.playerSeed, foundingEpoch: sim.foundingEpoch, colonyName: sim.colonyName,
    ...(sim.grid.source.mapV !== undefined ? { mapV: sim.grid.source.mapV } : {}),
    ...(sim.emblem ? { emblem: { ...sim.emblem } } : {}),
    tick: sim.tick, credits: sim.credits, hearthLevel: sim.hearthLevel, hearthId: sim.hearthId, nextId: sim.ents.nextId,
    content: contentTable(),
    ents, portItems,
    stock: Array.from(sim.stock),
    stores: [...sim.stores].sort((a, b) => a[0] - b[0]).map(([id, st]) => [id, Array.from(st)]),
    acc: [...sim.accEnergy].sort((a, b) => a[0] - b[0]),
    links: sim.links.pairs().flat(),
    done: [...sim.done].sort(),
    terrainDiff: [...sim.grid.terrainDiff],
    levelDiff: [...sim.grid.levelDiff],
    oreDiff: [...sim.grid.oreDiff],
    land: {
      bought: [...sim.land.bought].sort((a, b) => a - b),
      granted: [...sim.land.granted].sort((a, b) => a - b),
      leases: [...sim.land.leases].sort((a, b) => a[0] - b[0]).map(([p, l]) => [p, l.next, l.cents] as [number, number, number]),
      paid: [...sim.land.paid].sort((a, b) => a[0] - b[0]),
    },
    explored: sim.explored.map((d) => [...d] as [number, number, number]),
    nodes, chains,
    produced: Array.from(sim.produced),
    consumed: Array.from(sim.consumed),
    projects: sim.projects.map((p) => ({
      id: p.id, lab: p.lab, cost: p.cost.flatMap((c) => [c.item, c.mu]), paid: [...p.paid], dur: p.dur, el: p.el,
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
      ...(p.tokens !== undefined ? { tokens: p.tokens, tokUsed: p.tokUsed ?? 0 } : {}),
    })),
    tokens: { use: sim.tokenUse, serverAcc: sim.serverAcc, held: sim.researchHeld, plan: sim.tokenPlan, stats: { ...sim.tokenStats } },
    dataAcc: [...sim.dataAcc].sort((a, b) => a[0] - b[0]),
    labQueue: [...sim.labQueue].sort((a, b) => a[0] - b[0]),
    notes: sim.notes,
    respecs: sim.respecs,
    lastRespec: sim.lastRespec,
    designated: [...sim.designated].map(([t, k]) => [t, k === 'dig' ? 1 : 2] as [number, number]),
    jobs: sim.jobs.map((j) => ({ ...j })),
    fleet: [...sim.fleet].sort((a, b) => a[0] - b[0]),
    routes: sim.routes.map((r) => ({ id: r.id, from: r.from, to: r.to, item: r.item, ships: r.ships, carry: r.carry })),
    nextRouteId: sim.nextRouteId,
    market: sim.market.save(),
    trade: {
      cargo: [...sim.trade.cargo].sort((a, b) => a[0] - b[0]).map(([id, items]) => [id, [...items]]),
      orders: sim.trade.orders.map((o) => ({ ...o })),
      nextOrderId: sim.trade.nextOrderId,
      inflight: sim.trade.inflight.map((x) => ({ ...x })),
      sold: Array.from(sim.trade.sold),
      bought: Array.from(sim.trade.bought),
      ledger: sim.trade.ledger.map((l) => ({ ...l })),
      activity: [...sim.trade.activity].map(([id, a]) => [id, { ...a }]),
      earned: sim.trade.earned,
      spent: sim.trade.spent,
      soldTotal: Array.from(sim.trade.soldTotal),
      boughtTotal: Array.from(sim.trade.boughtTotal),
      floors: [...sim.trade.floors].sort((a, b) => a[0] - b[0]),
    },
    quests: saveQuests(sim.quests),
    value: saveValue(sim.value),
  };
}

export function deserialize(saved: SaveData, source: TerrainSource): Sim {
  if (saved.v !== SAVE_VERSION) throw new Error(`save version ${saved.v} needs migration to ${SAVE_VERSION}`);
  // Today's content indices (a no-op for a save written by this content; the persist layer
  // remaps first itself to show the player its note).
  const d = remapSave(saved).data;
  const sim = new Sim({ worldSeed: d.worldSeed, playerSeed: d.playerSeed, source, foundingEpoch: d.foundingEpoch, colonyName: d.colonyName }, false);
  if (isEmblem(d.emblem)) sim.emblem = { ...d.emblem };
  sim.tick = d.tick;
  sim.credits = d.credits;
  sim.hearthLevel = d.hearthLevel;
  sim.hearthId = d.hearthId;
  const ports = new Map(d.portItems);
  for (let i = 0; i < d.ents.length; i += 7) {
    const e = sim.ents.add({
      id: d.ents[i]!, def: d.ents[i + 1]!, x: d.ents[i + 2]!, y: d.ents[i + 3]!, rot: d.ents[i + 4]! as Rot,
      cfg: d.ents[i + 5]!, builtAt: d.ents[i + 6]!, portItems: ports.get(d.ents[i]!),
    });
    forTiles(e, (x, y) => { sim.grid.occ[tileIndex(x, y)] = e.id; });
  }
  sim.ents.nextId = Math.max(sim.ents.nextId, d.nextId);
  sim.stock.set(d.stock.slice(0, N_ITEMS));
  for (const [id, st] of d.stores) sim.stores.set(id, Float64Array.from(st));
  for (const [id, v] of d.acc) sim.accEnergy.set(id, v);
  const wires = d.links ?? [];
  for (let i = 0; i + 1 < wires.length; i += 2) sim.links.add(wires[i]!, wires[i + 1]!);
  for (const id of d.done) sim.done.add(id);
  for (const [t, v] of d.terrainDiff) sim.grid.terrainDiff.set(t, v);
  for (const [t, v] of d.levelDiff ?? []) sim.grid.levelDiff.set(t, v);
  for (const [t, v] of d.oreDiff) sim.grid.oreDiff.set(t, v);
  for (const p of d.land?.bought ?? []) sim.land.bought.add(p);
  for (const p of d.land?.granted ?? []) sim.land.granted.add(p);
  for (const [p, next, cents] of d.land?.leases ?? []) sim.land.leases.set(p, { next, cents });
  for (const [p, cents] of d.land?.paid ?? []) sim.land.paid.set(p, cents);
  for (const e of d.explored ?? []) sim.explored.push([e[0], e[1], e[2]]);
  sim.produced.set(d.produced);
  sim.consumed.set(d.consumed);
  sim.notes = d.notes ?? 0;
  sim.respecs = d.respecs ?? 0;
  sim.lastRespec = d.lastRespec ?? -1;
  for (const p of d.projects ?? []) {
    const cost: Array<{ item: number; mu: number }> = [];
    for (let i = 0; i < p.cost.length; i += 2) cost.push({ item: p.cost[i]!, mu: p.cost[i + 1]! });
    const proj = { id: p.id, lab: p.lab, cost, paid: [...p.paid], dur: p.dur, el: p.el, ...(p.notes !== undefined ? { notes: p.notes } : {}), ...(p.tokens !== undefined ? { tokens: p.tokens, tokUsed: p.tokUsed ?? 0 } : {}) };
    if (p.id.startsWith('respec:') || p.tokens !== undefined) { sim.projects.push(proj); continue; }
    // A project from before AI tokens (D68), or started under the spread penalty (D72: the
    // v7 → v8 migration strips its tokens to bring it here): rebased on the node's cost today,
    // its progress kept (the data it paid as a share of the new cost, its elapsed time as a share
    // of the new duration) and the tokens of what it already did taken as paid. A node gone: dropped.
    if (!hasResearch(p.id)) continue;
    const share = projectPermille(proj);
    const now = effectiveCost(p.id);
    const el = p.dur > 0 ? Math.floor((Math.min(p.el, p.dur * 1000) * now.ticks) / p.dur) : 0;
    const re = { id: p.id, lab: p.lab, cost: now.cost, paid: now.cost.map((c) => Math.floor((c.mu * share) / 1000)), dur: now.ticks, el, tokens: now.tokens, tokUsed: 0 };
    re.tokUsed = tokensDue(re);
    sim.projects.push(re);
  }
  if (d.tokens) {
    sim.tokenUse = d.tokens.use; sim.serverAcc = d.tokens.serverAcc; sim.researchHeld = d.tokens.held; sim.tokenPlan = d.tokens.plan;
    sim.tokenStats = { ...newTokenStats(), ...(d.tokens.stats ?? {}) };
  }
  for (const [id, v] of d.dataAcc ?? []) sim.dataAcc.set(id, v);
  for (const [lab, id] of d.labQueue ?? []) if (hasResearch(id)) sim.labQueue.set(lab, id);
  // A lab's store holds data only (the science items, D71): anything else an older lab held goes
  // to the Heart — nothing vanishes.
  for (let i = 0; i < d.ents.length; i += 7) {
    if (BUILDING_KIND[d.ents[i + 1]!] !== 'lab') continue;
    const st = sim.stores.get(d.ents[i]!);
    if (!st) continue;
    for (let it = 0; it < st.length; it++) if (itemDef(it).kind !== 'science' && st[it]! > 0) { sim.refund(it, st[it]!); st[it] = 0; }
  }
  // Speed modules are gone (D81): those an older save had fitted in machines go back to the Heart,
  // as the item they were made as (now the servomotor, the same id), and the machine runs at its own pace.
  const servo = itemIdx('pace_bell');
  for (const e of sim.ents.map.values()) {
    const n = modulesOf(e.cfg);
    if (n > 0 && BUILDING_KIND[e.def] === 'machine') { sim.refund(servo, n * 1000); e.cfg = withModules(e.cfg, 0); }
  }
  for (const [t, k] of d.designated ?? []) sim.designated.set(t, k === 1 ? 'dig' : 'fill');
  sim.jobs = (d.jobs ?? []).map((j) => ({ ...j }));
  for (const [id, n] of d.fleet ?? []) sim.fleet.set(id, n);
  sim.routes = (d.routes ?? []).map((r) => ({ ...r, carry: r.carry ?? 0 }));
  sim.nextRouteId = d.nextRouteId ?? 1;
  // The Crier: a colony saved before the market existed starts it at today's equilibrium.
  const cfg = { worldSeed: d.worldSeed, foundingEpoch: d.foundingEpoch };
  sim.market = d.market ? LocalMarketService.load(d.market, cfg) : new LocalMarketService({ ...cfg, startEpoch: sim.absEpoch() });
  sim.prices = sim.market.prices();
  if (d.trade) {
    const t = sim.trade;
    for (const [id, items] of d.trade.cargo ?? []) if (items.length) t.cargo.set(id, [...items]);
    t.orders = d.trade.orders.map((o) => ({ ...o }));
    t.nextOrderId = d.trade.nextOrderId;
    t.inflight = d.trade.inflight.map((x) => ({ ...x }));
    t.sold.set(d.trade.sold.slice(0, N_ITEMS));
    t.bought.set(d.trade.bought.slice(0, N_ITEMS));
    t.ledger = d.trade.ledger.map((l) => ({ ...l }));
    for (const [id, a] of d.trade.activity) t.activity.set(id, { ...a });
    t.earned = d.trade.earned;
    t.spent = d.trade.spent;
    if (d.trade.soldTotal) t.soldTotal.set(d.trade.soldTotal.slice(0, N_ITEMS));
    if (d.trade.boughtTotal) t.boughtTotal.set(d.trade.boughtTotal.slice(0, N_ITEMS));
    for (const [it, cents] of d.trade.floors ?? []) t.floors.set(it, cents);
  }
  // The tutorial (a colony saved before quests existed starts them at quest 0).
  if (d.quests) loadQuests(sim, d.quests);
  loadValue(sim, d.value);
  sim.rebuildDerived();
  sim.ensureCompiled();
  // Node states by entity, ribbon parcels by chain (tier + head + length).
  const states = new Map(d.nodes);
  for (const n of sim.graph.nodes) {
    const s = states.get(n.ent);
    if (n.ent && s !== undefined) n.restore(s, 0);
  }
  const chainKey = (tier: number, head: number, len: number): string => `${tier}:${head}:${len}`;
  const ribbons = new Map(d.chains.map((c) => [chainKey(c.tier, c.head, c.len), c]));
  // What finds no place goes to the Heart rather than vanish (past its cap if need be).
  const toHeart = (it: number, mu: number): void => { if (it >= 0 && it < N_ITEMS) sim.stock[it]! += mu; };
  for (const c of sim.graph.chains) {
    const key = chainKey(c.tier, c.tiles[c.tiles.length - 1]!, c.tiles.length);
    const s = ribbons.get(key);
    if (!s) continue;
    ribbons.delete(key);
    if (c.fluid) {
      c.runs = [];
      c.head = 0;
      c.content = 0;
      const runs = s.runs ?? [];
      for (let i = 0; i < runs.length; i += 4) {
        c.runs.push({ item: runs[i]!, mu: runs[i + 1]!, from: runs[i + 2]!, to: runs[i + 3]! });
        c.content += runs[i + 1]!;
      }
      for (const v of s.cells ?? []) if (v > 0) toHeart(v - 1, 1000);
      continue;
    }
    const cells = s.cells ?? packRuns(s.runs ?? [], c.length, toHeart);
    c.cells.fill(0);
    c.content = 0;
    cells.forEach((v, i) => { if (v > 0 && v - 1 < N_ITEMS) c.place(i, v - 1); });
    if (s.stage && s.stage[1] > 0) { c.stageItem = s.stage[0]; c.stageMu = s.stage[1]; c.content += s.stage[1]; }
  }
  // A saved line that no longer compiles the same (content changed under it): its items go to the Heart.
  for (const c of ribbons.values()) {
    const runs = c.runs ?? [];
    for (let i = 0; i < runs.length; i += 4) toHeart(runs[i]!, runs[i + 1]!);
    for (const v of c.cells ?? []) if (v > 0) toHeart(v - 1, 1000);
    if (c.stage) toHeart(c.stage[0], c.stage[1]);
  }
  return sim;
}
