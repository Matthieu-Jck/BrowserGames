// readouts/pressure.ts — the water's pressure (D155; owner, 2026-10-19: « we also need a special thing
// to attach to a conduit that will tell the player the pressure in it (if it's too low, need a better
// pump or more pumps) »): what the pumps feeding a water network give against what its drinkers ask,
// read off the compiled flow graph. The pressure gauge (content `gauge`, a fitting set into a conduit
// line) shows its network's reading in the world (render/world/buildings-view.ts), its inspector the
// figures and what to do (ui/inspector/logistics.ts `gaugePanel`); the Logistique view colours each
// water line by it (render/world/views-view.ts).
//
// A **water network** is a connected set of conduit lines: chains of fluid joined by edges (a line
// running into another, a tee's branches, D152). Its **pumps** are the pumps whose outlets hand into
// one of its lines; its **drinkers** the buildings one of its lines hands into — a steam boiler (its
// water at full output, `GeneratorNode.waterEp`), a machine whose recipe takes water (its water a
// minute at its speed: a brickworks 30, D123), an incinerator burning it (D51: it takes all its line
// carries, the line's throughput). **Supply**: each pump's water a minute as its grid powers it now
// (`rateEp` × the grid's satisfaction; a pump off the water or unwired gives none) — and at full power
// (`nominal`), so a reading can say the pumps lack power. **Demand**: what the drinkers would drink all
// working at once — a plan of the base, steady, not the moment's (a boiler on standby still counts): the
// gauge says whether the water is enough for the drinkers it serves. **Pressure** ‰ = supply ×
// 1 000 / demand; its state by `BAL.pressure`: `ok` from `ok` ‰ (a margin), `tight` from `tight` ‰ (just
// enough), `low` under it (the drinkers are short), `dry` (no water at all), `idle` (nothing drinks).
// Read from the sim, never changing it (a compile at most, which looking at the sim may do): online and
// offline alike, nothing of it is state. Integers only.
import { BAL } from '@/content/balance';
import { buildingDef, buildingIdx } from '@/content/registry';
import { Chain, isFluidItem } from '../flow/chain';
import type { FNode } from '../flow/node';
import { DrillNode, GeneratorNode, MachineNode } from '../flow/nodes';
import type { Sim } from '../state';
import { tileIndex } from '../world/grid';

export type PressureState = 'ok' | 'tight' | 'low' | 'dry' | 'idle';

/** The dial's top (‰): a pressure at or over it shows at its end (twice what the drinkers ask). */
export const PRESSURE_MAX = 2000;

export interface WaterNet {
  /** Its index among the reading's networks. */
  id: number;
  /** Its conduit lines (the graph's chains). */
  chains: Chain[];
  /** Its pumps: entity, water a minute at full power and now (milli-items). */
  pumps: Array<{ ent: number; full: number; now: number }>;
  /** Its drinkers: entity, water a minute all working (milli-items). */
  drinkers: Array<{ ent: number; ask: number }>;
  /** Water a minute (milli-items): the pumps' now and at full power, the drinkers' ask. */
  supply: number;
  nominal: number;
  demand: number;
  /** Supply against demand (‰, up to `PRESSURE_MAX`; `PRESSURE_MAX` with nothing drinking and water). */
  pressure: number;
  state: PressureState;
}

export interface PressureReading {
  /** The graph it was read from (a new graph, a new reading). */
  version: number;
  nets: WaterNet[];
  /** Each conduit line's network. */
  byChain: Map<Chain, WaterNet>;
}

/** The state for a pressure, its supply and its demand. */
export function pressureState(supply: number, demand: number, pressure: number): PressureState {
  if (demand <= 0) return 'idle';
  if (supply <= 0) return 'dry';
  return pressure >= BAL.pressure.ok ? 'ok' : pressure >= BAL.pressure.tight ? 'tight' : 'low';
}

/** What a node drinks a minute all working (milli-items), 0 for one that takes no water; `line` the throughput of the line feeding it (an incinerator takes all of it). */
function askOf(n: FNode, line: number): number {
  if (n instanceof GeneratorNode) return n.waterItem >= 0 ? n.waterEp : 0;
  if (n instanceof MachineNode) {
    const r = n.recipe;
    if (!r) return 0;
    let mu = 0;
    for (const s of r.ins) if (isFluidItem(s.item)) mu += s.mu;
    // A craft takes `ticks` × 1 000 / speed ticks at full power: crafts a minute × water a craft.
    return mu ? Math.floor((mu * 600 * n.speed) / (r.ticks * 1000)) : 0;
  }
  if (n.kind === 'sink') return line;
  return 0;
}

/** Every water network of the base, read now (the graph compiled first if it must be). */
export function readPressure(sim: Sim): PressureReading {
  sim.ensureCompiled();
  const g = sim.graph;
  const fluid = g.chains.filter((c) => c.fluid);
  // Union-find over the lines, joined by the edges between them.
  const parent = new Map<Chain, Chain>();
  for (const c of fluid) parent.set(c, c);
  const find = (c: Chain): Chain => { let r = c; while (parent.get(r) !== r) r = parent.get(r)!; let x = c; while (x !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; } return r; };
  for (const c of fluid) {
    for (const e of c.outE) {
      const d = g.nodes[g.eDst[e]!]!;
      if (d instanceof Chain && d.fluid) {
        const a = find(c), b = find(d);
        if (a !== b) parent.set(a.idx < b.idx ? b : a, a.idx < b.idx ? a : b); // the lower index stays the root: a total order
      }
    }
  }
  const byRoot = new Map<Chain, WaterNet>();
  const nets: WaterNet[] = [];
  const byChain = new Map<Chain, WaterNet>();
  for (const c of [...fluid].sort((a, b) => a.idx - b.idx)) {
    const r = find(c);
    let net = byRoot.get(r);
    if (!net) {
      net = { id: nets.length, chains: [], pumps: [], drinkers: [], supply: 0, nominal: 0, demand: 0, pressure: 0, state: 'idle' };
      byRoot.set(r, net);
      nets.push(net);
    }
    net.chains.push(c);
    byChain.set(c, net);
  }
  // Pumps into its lines; drinkers its lines hand into (each counted once per network).
  for (const net of nets) {
    const seenP = new Set<number>(), seenD = new Set<number>();
    for (const c of net.chains) {
      for (const e of c.inE) {
        const s = g.nodes[g.eSrc[e]!]!;
        if (!(s instanceof DrillNode) || s.item < 0 || !isFluidItem(s.item) || seenP.has(s.ent)) continue;
        seenP.add(s.ent);
        const sat = s.net >= 0 ? sim.netPower[s.net]?.sat ?? 0 : 0;
        const full = Math.max(0, s.rateEp);
        net.pumps.push({ ent: s.ent, full, now: Math.floor((full * Math.max(0, Math.min(1000, sat))) / 1000) });
      }
      for (const e of c.outE) {
        const d = g.nodes[g.eDst[e]!]!;
        if (d instanceof Chain || seenD.has(d.ent)) continue;
        const ask = askOf(d, c.thrMu * 600);
        if (ask <= 0) continue;
        seenD.add(d.ent);
        net.drinkers.push({ ent: d.ent, ask });
      }
    }
    net.pumps.sort((a, b) => a.ent - b.ent);
    net.drinkers.sort((a, b) => a.ent - b.ent);
    for (const p of net.pumps) { net.supply += p.now; net.nominal += p.full; }
    for (const d of net.drinkers) net.demand += d.ask;
    net.pressure = net.demand > 0 ? Math.min(PRESSURE_MAX, Math.floor((net.supply * 1000) / net.demand)) : net.supply > 0 ? PRESSURE_MAX : 0;
    net.state = pressureState(net.supply, net.demand, net.pressure);
  }
  return { version: g.version, nets, byChain };
}

/** The network of the conduit on tile (x, y), or null (no conduit there). */
export function pressureAt(sim: Sim, x: number, y: number, reading: PressureReading = readPressure(sim)): WaterNet | null {
  const c = sim.graph.chainByTile.get(tileIndex(x, y));
  return c ? reading.byChain.get(c) ?? null : null;
}

/**
 * What would bring a network to `ok` (D155: « a better pump or more pumps »): how many more pumps of
 * each kind at full power — a pump's water a minute from its content (`drill.perMin`) — and whether the
 * pumps it has lack power (then power first). Nothing for a network already `ok` or `idle`.
 */
export function pressureFix(net: WaterNet, pumpIds: readonly string[]): { short: number; more: Array<{ id: string; n: number }>; unpowered: boolean } {
  const want = Math.ceil((net.demand * BAL.pressure.ok) / 1000);
  const short = Math.max(0, want - net.nominal);
  const more = net.state === 'ok' || net.state === 'idle' || short <= 0 ? [] : pumpIds.map((id) => {
    const per = (buildingDef(buildingIdx(id)).drill?.perMin ?? 0) * 1000;
    return { id, n: per > 0 ? Math.ceil(short / per) : 0 };
  }).filter((m) => m.n > 0);
  return { short, more, unpowered: net.supply < net.nominal };
}
