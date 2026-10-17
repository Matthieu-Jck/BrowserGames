// network.ts — power grids and what feeds them. A grid is a connected component of the wire
// graph (D25, links.ts): link points (pillars, the Hearth) and the buildings wired to them,
// joined by union-find in id order — never by proximity. Every link point heads a grid (alone
// until wired); an ordinary building belongs to one only through a wire. The generators'
// output is a pure function of the weather, which is itself a pure function of the world
// clock and WORLD_SEED: the same for every colony, online and offline.
//
// Generator output lives in small named functions (`solarKw`, `windKw`, `producerKw`) over a
// `Weather` value so that a new weather input (temperature, for the climate follow-up) is
// added in one place: `weatherAt`, `weatherKey` and the functions that read it. The wind (D95) is
// world/wind.ts: the weather's wind at a time × a turbine's exposure where it stands, through the
// turbine's curve.
import { BAL } from '@/content/balance';
import type { BuildingDef, WindCurve } from '@/content/types';
import { mulDiv } from '@/core/fixed';
import { DAY_EPOCHS, SOLAR } from '../constants';
import { footprint } from '../entities';
import type { Mods } from '../research/modifiers';
import type { Ent } from '../types';
import type { Grid } from '../world/grid';
import { curveShare, gustPermille, localWind, turbineSite, veerOf, windAt } from '../world/wind';

export { gustPermille } from '../world/wind';

/**
 * A turbine's exposure ‰ where it stands, for each of the day's three bearings (D95, world/wind.ts):
 * the mean over its footprint, its foot at the land's level now. The graph compiler builds each
 * turbine with it; the inspector and the views read the same.
 */
export function windSite(grid: Grid, worldSeed: number, e: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): [number, number, number] {
  const [w, h] = footprint(e.def, e.rot);
  return turbineSite(grid.source, worldSeed, e.x, e.y, w, h, (x, y) => grid.level(x, y));
}

export interface Producer {
  ent: number;
  /** 'hearth': the Hearth's built-in solar panel (D25), which follows the sun like a solar panel, plus its isotope core. */
  kind: 'wind' | 'solar' | 'geo' | 'hearth';
  /** Base output (kW) before weather. */
  kw: number;
  /** Exposure ‰ where it stands for each of the day's three bearings (wind only; else [1000, 1000, 1000]). */
  local: readonly [number, number, number];
  /** Its curve (wind only). */
  curve?: WindCurve;
  /** Steady output on top of the weather-bound part (kW): the Hearth's isotope core. */
  base?: number;
}

/**
 * The producer a building is, wired or not (null when it makes no power): the grids' compile and
 * the inspector's grid module read the same numbers. The Hearth's built-in solar panel follows a
 * solar panel's rules (solar research, the all-generator bonus) and carries its isotope core.
 */
export function producerOf(e: Ent, b: Pick<BuildingDef, 'kind' | 'gen'>, grid: Grid, mods: Pick<Mods, 'windOut' | 'solarOut' | 'geoOut' | 'genOut'>, worldSeed: number, hearthLevel = 1): Producer | null {
  switch (b.kind) {
    case 'hearth': {
      // Its core steady, its panel with the sun; both grow with its level (D101).
      const lv = Math.max(1, Math.min(BAL.hearthCoreKw.length, hearthLevel)) - 1;
      return { ent: e.id, kind: 'hearth', kw: Math.floor((BAL.hearthSolarKw[lv]! * mods.solarOut * mods.genOut) / 1e6), local: FLAT, base: Math.floor((BAL.hearthCoreKw[lv]! * mods.genOut) / 1000) };
    }
    case 'wind': return { ent: e.id, kind: 'wind', kw: Math.floor((b.gen!.kw * mods.windOut * mods.genOut) / 1e6), local: windSite(grid, worldSeed, e), curve: b.gen!.wind ?? DEFAULT_CURVE };
    case 'solar': return { ent: e.id, kind: 'solar', kw: Math.floor((b.gen!.kw * mods.solarOut * mods.genOut) / 1e6), local: FLAT };
    case 'geothermal': return { ent: e.id, kind: 'geo', kw: Math.floor((b.gen!.kw * mods.geoOut * mods.genOut) / 1e6), local: FLAT };
    default: return null;
  }
}

const FLAT = [1000, 1000, 1000] as const;
/** A wind building without its own curve (none in content: validate.ts asks every turbine for one). */
const DEFAULT_CURVE: WindCurve = { cutIn: 400, rated: 1600 };

export interface Acc {
  ent: number;
  cap: number;  // kW·tick
  rate: number; // kW
}

export interface Net {
  id: number;
  /** The grid's link points (pillars, the Hearth), ascending; the first names the grid in reports. */
  poles: number[];
  producers: Producer[];
  accs: Acc[];
}

/** What the grid builder needs of the wires (the Sim's `PowerLinks`). */
export interface WireSource { of(id: number): readonly number[] }

export interface Grids {
  /** Entity id → grid index, for every member of a grid (link points and wired buildings). */
  gridOf: Map<number, number>;
  /** Per grid: its link points, ascending. */
  poles: number[][];
}

/**
 * Grids from the wires. `members` are the entities that take part in power right now (built,
 * awake, linkable), in id order; `isPoint` tells the link points. Wires to anything outside
 * `members` (a construction site, a dormant building, a removed one) carry nothing. Grid ids
 * follow the smallest link-point id of each component.
 */
export function buildGrids(members: readonly Ent[], isPoint: (e: Ent) => boolean, wires: WireSource): Grids {
  const n = members.length;
  const index = new Map<number, number>();
  for (let i = 0; i < n; i++) index.set(members[i]!.id, i);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
    return i;
  };
  for (let i = 0; i < n; i++) {
    for (const o of wires.of(members[i]!.id)) {
      const j = index.get(o);
      if (j === undefined || j <= i) continue; // each wire once; dead ends carry nothing
      const ra = find(i), rb = find(j);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  // Grid ids by the smallest link point of each component (members are in id order).
  const gridOfRoot = new Int32Array(n).fill(-1);
  const poles: number[][] = [];
  for (let i = 0; i < n; i++) {
    const e = members[i]!;
    if (!isPoint(e)) continue;
    const r = find(i);
    if (gridOfRoot[r]! < 0) { gridOfRoot[r] = poles.length; poles.push([]); }
    poles[gridOfRoot[r]!]!.push(e.id);
  }
  const gridOf = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const g = gridOfRoot[find(i)]!;
    if (g >= 0) gridOf.set(members[i]!.id, g);
  }
  return { gridOf, poles };
}

// ── the weather and the generators ─────────────────────────────────────────

/** Sun output ‰ for an absolute world epoch: nothing at night, for every panel (owner, 2026-10-14: « la nuit les panneaux sont à 0 »). */
export function sunPermille(absEpoch: number): number {
  return SOLAR[((absEpoch % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS]!;
}

/** Day phase in [0, 36) epochs — exposed to the renderer. */
export const dayEpoch = (absEpoch: number): number => ((absEpoch % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS;

/** The weather as the generators see it during one epoch (‰). New inputs (temperature) join here. */
export interface Weather {
  /** Sun ‰ (the SOLAR table). */
  sun: number;
  /** Gust ‰ of the 10-epoch window (with the gust variance research): the look and the sound. */
  gust: number;
  /** The wind over open flat ground ‰ (D95: the day's curve × its mood × the gust, rounded). */
  wind: number;
  /** Today's bearing: 0, 1 (the prevailing one) or 2 — which of a turbine's three exposures applies. */
  veer: number;
}

/** A colony's weather at an absolute world epoch. */
export function weatherAt(absEpoch: number, worldSeed: number, mods: Pick<Mods, 'gustVariance'>): Weather {
  return {
    sun: sunPermille(absEpoch),
    gust: gustPermille(absEpoch, worldSeed, mods.gustVariance),
    wind: windAt(absEpoch, worldSeed, mods.gustVariance),
    veer: veerOf(Math.floor(absEpoch / DAY_EPOCHS), worldSeed),
  };
}

/** Changes exactly when the generators' output may change (the catch-up re-solves its grids then). */
export const weatherKey = (w: Weather): string => `${w.sun}:${w.wind}:${w.veer}`;

/** A solar panel of `peak` kW under this sun (solar panels, the Hearth's own panel). */
export const solarKw = (peak: number, w: Weather): number => mulDiv(peak, w.sun, 1000);

/** The local wind ‰ a turbine with these exposures catches in this weather. */
export const turbineWind = (local: readonly [number, number, number], w: Weather): number => localWind(w.wind, local[w.veer]!);

/** A wind turbine of rating `kw` and curve `c`, with these exposures, in this weather (kW). */
export const windKw = (kw: number, c: WindCurve, local: readonly [number, number, number], w: Weather): number => mulDiv(kw, curveShare(c, turbineWind(local, w)), 1000);

/** Renewable output of one producer (kW) under this weather. */
export function producerKw(p: Producer, w: Weather): number {
  switch (p.kind) {
    case 'geo':
      return p.kw;
    case 'hearth':
      return solarKw(p.kw, w) + (p.base ?? 0);
    case 'solar':
      return solarKw(p.kw, w);
    case 'wind':
      return windKw(p.kw, p.curve ?? DEFAULT_CURVE, p.local, w);
  }
}

/** A grid's renewable supply (kW) under this weather. */
export function renewableKw(net: Net, w: Weather): number {
  let R = 0;
  for (const p of net.producers) R += producerKw(p, w);
  return R;
}
