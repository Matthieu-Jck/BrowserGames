// readouts/power.ts — what the Électricité view shows (D88), read from the sim and never changing
// it: each grid's supply by source against its demand, how well it is served, its accumulators'
// charge, the next 24 hours forecast from the weather (a pure function of the world clock, so the
// forecast is exact for the renewables; the demand and the fuel held as they are now, the
// accumulators simulated epoch by epoch through the same solver the tick uses), its biggest
// consumers; and each building's part in power (a source and what it gives, an accumulator and its
// charge, a pillar, a consumer and what it draws) with the flag a view raises over it (no wire,
// asleep, no power, short of power, still being built), and its group (owner, 2026-10-16: « the grid
// view of electricity should differentiate in color between what produces electricity, what
// consumes it, what isn't linked, and what doesn't need electricity »: producers, accumulators,
// consumers, the not linked; what needs no power is every other building, `needsNoPower`). The renderer draws the marks from it, the
// view's side panel the charts: they live here, below both (ui may not reach render/world).
// Integers only (kW, ‰), like the engine.
import { BUILDING_IDS, BUILDING_KIND, buildingDef, isBeltDef } from '@/content/registry';
import { DAY_EPOCHS, EPOCH } from '../constants';
import { GeneratorNode } from '../flow/nodes';
import { isLinkPoint, linkable } from '../power/links';
import { producerKw, solarKw, weatherAt, type Producer, type Weather } from '../power/network';
import { solvePower } from '../power/solve';
import type { Sim } from '../state';
import { St, type Ent } from '../types';

/** Where power comes from: the sun, the wind, the ground's heat, the Core's isotope core, fuel burnt, accumulators giving back. */
export type Source = 'solar' | 'wind' | 'geo' | 'core' | 'fuel' | 'acc';
/** In the order the stacked bars pile them (the steady ones at the bottom, the reserves on top). */
export const SOURCES: readonly Source[] = ['core', 'geo', 'wind', 'solar', 'fuel', 'acc'];

export type BySource = Record<Source, number>;
const none = (): BySource => ({ core: 0, geo: 0, wind: 0, solar: 0, fuel: 0, acc: 0 });

/** One hour-ish of the forecast (a world epoch): what each source gives, the demand, the service, the accumulators' charge after it. */
export interface ForecastStep {
  /** The absolute world epoch. */
  ep: number;
  /** kW by source: the renewables' whole output (a surplus above the demand included), fuel and accumulators as far as they are called on. */
  kw: BySource;
  demand: number;
  /** ‰ served. */
  sat: number;
  /** The accumulators' charge at the end of the step, ‰ of their capacity (0 without any). */
  charge: number;
}

export interface GridReport {
  /** The grid's index (its colour: GRID_COLORS[net % n]). */
  net: number;
  /** Its first link point (it names the grid), and how many link points and buildings it holds. */
  head: number;
  pillars: number;
  members: number;
  /** kW now by source (as the forecast's steps count them) and the demand. */
  kw: BySource;
  /** What the fuel generators could burn now (the fuelled ones), and the accumulators could give back now. */
  fuelCap: number;
  accCap: number;
  demand: number;
  /** ‰ served this tick (0 with nothing to draw from). */
  sat: number;
  /** Anything to draw from at all: a producer giving, fuel, a charged accumulator. */
  live: boolean;
  /** The accumulators' energy and capacity (kW·tick). */
  accE: number;
  accMax: number;
  /** The next 24 hours, a step an epoch from now. */
  forecast: ForecastStep[];
  /** Its biggest consumers now: entity, kW drawn, kW at full rate. */
  top: Array<{ ent: number; kw: number; full: number }>;
}

/** What a building is to power, for the view's marks. */
export type Role =
  | { k: 'source'; src: Exclude<Source, 'acc'>; kw: number; full: number }
  | { k: 'acc'; charge: number }
  | { k: 'pillar' }
  | { k: 'consumer'; kw: number; full: number };

/** The flag raised over a building in the view: no wire, asleep (its land or its research), no power, short of power, still being built. */
export type PowerFlag = 'unwired' | 'asleep' | 'dark' | 'low' | 'site' | null;

/**
 * How the Électricité view washes a building (D95's note on D88): what makes power (the turbines,
 * the panels, the fuel generators, the ground's heat, the Core), what stores it (the accumulators,
 * their own tone: they give and take), what draws it on a grid, and what needs it but reaches no
 * grid — no wire, or asleep (the trouble's coral). A pillar is none of them (its grid's ring).
 */
export type PowerGroup = 'producer' | 'storage' | 'consumer' | 'unlinked';
export const POWER_GROUPS: readonly PowerGroup[] = ['producer', 'storage', 'consumer', 'unlinked'];

export interface PowerMark { ent: number; net: number; role: Role; flag: PowerFlag; group: PowerGroup | null }

/** A building that takes no part in power (ribbons, routing blocks, stores…): the view greys it out. */
export const needsNoPower = (def: number): boolean => !linkable(def);

/** How many buildings need no power, the ribbons left out (one a tile, they would drown the count). */
export function idleCount(sim: Sim): number {
  let n = 0;
  for (const e of sim.ents.sorted()) if (needsNoPower(e.def) && !isBeltDef(BUILDING_IDS[e.def]!)) n++;
  return n;
}

/** A producer's output now split by source (the Core's panel follows the sun, its isotope core is steady). */
function addProducer(out: BySource, p: Producer, w: Weather): void {
  if (p.kind === 'hearth') { out.solar += solarKw(p.kw, w); out.core += p.base ?? 0; return; }
  out[p.kind === 'geo' ? 'geo' : p.kind] += producerKw(p, w);
}

/** The fuel generators' capacity on a grid now (the fuelled ones) and the accumulators' (energy, capacity, rate). */
function reserves(sim: Sim, net: number): { F: number; E: number; cap: number; rate: number } {
  let F = 0, E = 0, cap = 0, rate = 0;
  for (const n of sim.nodesByNet[net] ?? []) if (n instanceof GeneratorNode && n.fueled()) F += n.outKw;
  for (const a of sim.graph.nets[net]?.accs ?? []) { E += sim.accEnergy.get(a.ent) ?? 0; cap += a.cap; rate += a.rate; }
  return { F, E, cap, rate };
}

/** The step's split: renewables whole, then fuel, then the accumulators, as `solvePower` calls on them. */
function step(R: BySource, D: number, F: number, E: number, cap: number, rate: number): { kw: BySource; sat: number; dE: number } {
  const ren = R.core + R.geo + R.wind + R.solar;
  const res = solvePower(D, ren, F, E, cap, rate);
  const fuel = ren >= D ? 0 : Math.min(F, D - ren);
  return { kw: { ...R, fuel, acc: res.accDelta < 0 ? -res.accDelta : 0 }, sat: res.sat, dE: res.accDelta };
}

/** The next `n` epochs of a grid: the weather is the world's, the demand and the fuel held as now. */
export function forecast(sim: Sim, net: number, n = DAY_EPOCHS): ForecastStep[] {
  const g = sim.graph?.nets[net];
  if (!g) return [];
  const D = sim.netPower[net]?.demand ?? 0;
  const r = reserves(sim, net), { F, cap, rate } = r;
  let E = r.E;
  const out: ForecastStep[] = [];
  const now = sim.absEpoch();
  for (let k = 0; k < n; k++) {
    const ep = now + k;
    const w = weatherAt(ep, sim.worldSeed, sim.mods);
    const R = none();
    for (const p of g.producers) addProducer(R, p, w);
    const s = step(R, D, F, E, cap, rate);
    E = Math.max(0, Math.min(cap, E + s.dE * EPOCH));
    out.push({ ep, kw: s.kw, demand: D, sat: s.sat, charge: cap > 0 ? Math.floor((E * 1000) / cap) : 0 });
  }
  return out;
}

/** Every grid of the colony, by index. `topN` biggest consumers each. */
export function gridReports(sim: Sim, topN = 5): GridReport[] {
  const g = sim.graph;
  if (!g) return [];
  const w = weatherAt(sim.absEpoch(), sim.worldSeed, sim.mods);
  const members = new Int32Array(g.nets.length);
  for (const net of g.netOfEnt.values()) members[net]!++;
  return g.nets.map((n) => {
    const R = none();
    for (const p of n.producers) addProducer(R, p, w);
    const np = sim.netPower[n.id];
    const D = np?.demand ?? 0;
    const { F, E, cap, rate } = reserves(sim, n.id);
    const s = step(R, D, F, E, cap, rate);
    const live = R.core + R.geo + R.wind + R.solar + F > 0 || E > 0;
    const top = (sim.nodesByNet[n.id] ?? [])
      .map((x) => ({ ent: x.ent, kw: Math.round(x.demand()), full: x.kw }))
      .filter((x) => x.ent > 0 && x.kw > 0)
      .sort((a, b) => b.kw - a.kw || a.ent - b.ent)
      .slice(0, topN);
    return {
      net: n.id, head: n.poles[0] ?? 0, pillars: n.poles.length, members: members[n.id]!,
      kw: s.kw, fuelCap: F, accCap: Math.min(rate, E), demand: D,
      sat: live ? np?.sat ?? s.sat : 0, live, accE: E, accMax: cap,
      forecast: forecast(sim, n.id), top,
    };
  });
}

/** Each building that takes part in power: its grid (−1: none), its role, its flag. */
export function powerMarks(sim: Sim): PowerMark[] {
  const g = sim.graph;
  if (!g) return [];
  const w = weatherAt(sim.absEpoch(), sim.worldSeed, sim.mods);
  const prodOf = new Map<number, Producer>();
  for (const n of g.nets) for (const p of n.producers) prodOf.set(p.ent, p);
  const out: PowerMark[] = [];
  for (const e of sim.ents.sorted()) {
    if (!linkable(e.def)) continue;
    const net = g.netOfEnt.get(e.id) ?? -1;
    const role = roleOf(sim, e, net, prodOf.get(e.id), w), flag = flagOf(sim, e, net);
    out.push({ ent: e.id, net, role, flag, group: groupOf(e, role, flag) });
  }
  return out;
}

function roleOf(sim: Sim, e: Ent, net: number, p: Producer | undefined, w: Weather): Role {
  if (isLinkPoint(e.def) && BUILDING_KIND[e.def] !== 'hearth') return { k: 'pillar' };
  const node = sim.graph.nodeByEnt.get(e.id);
  if (p) {
    const by = none();
    addProducer(by, p, w);
    const kw = net >= 0 ? by.core + by.geo + by.wind + by.solar : 0;
    const full = p.kw + (p.base ?? 0);
    return { k: 'source', src: p.kind === 'hearth' ? 'core' : p.kind === 'geo' ? 'geo' : p.kind, kw, full };
  }
  if (node instanceof GeneratorNode) {
    const d = net >= 0 && node.status === St.Ok ? sim.ctx.dispatch[net] ?? 0 : 0;
    return { k: 'source', src: 'fuel', kw: Math.floor((node.outKw * d) / 1000), full: node.outKw };
  }
  if (BUILDING_KIND[e.def] === 'accumulator') {
    const acc = net >= 0 ? sim.graph.nets[net]?.accs.find((a) => a.ent === e.id) : undefined;
    return { k: 'acc', charge: acc && acc.cap > 0 ? Math.floor(((sim.accEnergy.get(e.id) ?? 0) * 1000) / acc.cap) : 0 };
  }
  return { k: 'consumer', kw: node ? Math.round(node.demand()) : 0, full: node?.kw ?? 0 };
}

/** Its group: no wire or asleep first; else by what the building is (a site by what it will be). */
function groupOf(e: Ent, role: Role, flag: PowerFlag): PowerGroup | null {
  if (role.k === 'pillar') return null;
  if (flag === 'unwired' || flag === 'asleep') return 'unlinked';
  const b = buildingDef(e.def);
  if (b.accumulator) return 'storage';
  if (b.gen || BUILDING_KIND[e.def] === 'hearth') return 'producer';
  return 'consumer';
}

function flagOf(sim: Sim, e: Ent, net: number): PowerFlag {
  if (e.builtAt !== 0) return 'site';
  if (sim.isDormant(e)) return 'asleep';
  if (net < 0) return isLinkPoint(e.def) ? null : 'unwired';
  const np = sim.netPower[net];
  let live = !!np && np.renew + np.fuel > 0;
  if (!live) for (const a of sim.graph.nets[net]?.accs ?? []) if ((sim.accEnergy.get(a.ent) ?? 0) > 0) { live = true; break; }
  if (!live || (np?.sat ?? 0) <= 0) return 'dark';
  return np!.sat < 1000 ? 'low' : null;
}
