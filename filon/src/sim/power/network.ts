// network.ts — power grids and what feeds them. A grid is a connected component of the wire
// graph (D25, links.ts): link points (pillars, the Hearth) and the buildings wired to them,
// joined by union-find in id order — never by proximity. Every link point heads a grid (alone
// until wired); an ordinary building belongs to one only through a wire. The generators'
// output is a pure function of the weather, which is itself a pure function of the world
// clock and WORLD_SEED: the same for every colony, online and offline.
//
// Generator output lives in small named functions (`solarKw`, `windKw`, `producerKw`) over a
// `Weather` value so that a new weather input (temperature, for the climate follow-up) is
// added in one place: `weatherAt`, `weatherKey` and the functions that read it.
import { hash32 } from '@/core/hash';
import { mulDiv } from '@/core/fixed';
import { DAY_EPOCHS, GUST_EPOCHS, GUST_LEVELS, SOLAR } from '../constants';
import type { Mods } from '../research/modifiers';
import type { Ent } from '../types';

export interface Producer {
  ent: number;
  /** 'hearth': the Hearth's built-in solar panel (D25), which follows the sun like a solar panel, plus its isotope core. */
  kind: 'wind' | 'solar' | 'geo' | 'hearth';
  /** Base output (kW) before weather. */
  kw: number;
  /** Local wind factor ‰ (wind only). */
  local: number;
  /** Steady output on top of the weather-bound part (kW): the Hearth's isotope core. */
  base?: number;
}

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

/** Sun output ‰ for an absolute world epoch (night floor from research, e.g. en6). */
export function sunPermille(absEpoch: number, nightFloor = 0): number {
  const s = SOLAR[((absEpoch % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS]!;
  return s < nightFloor ? nightFloor : s;
}

/** Day phase in [0, 36) epochs — exposed to the renderer. */
export const dayEpoch = (absEpoch: number): number => ((absEpoch % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS;

/** Gust level ‰ for the 10-epoch window containing absEpoch (variance ‰ scales the swing). */
export function gustPermille(absEpoch: number, worldSeed: number, variance = 1000): number {
  const w = Math.floor(absEpoch / GUST_EPOCHS);
  const lvl = GUST_LEVELS[hash32(worldSeed, w, 0x6a5) % GUST_LEVELS.length]!;
  return 1000 + mulDiv(lvl - 1000, variance, 1000);
}

/** The weather as the generators see it during one epoch (‰). New inputs (temperature) join here. */
export interface Weather {
  /** Sun ‰ (SOLAR table, with the Lens Arrays night floor). */
  sun: number;
  /** Gust ‰ of the 10-epoch window (with the gust variance research). */
  gust: number;
}

/** A colony's weather at an absolute world epoch. */
export function weatherAt(absEpoch: number, worldSeed: number, mods: Pick<Mods, 'solarNight' | 'gustVariance'>): Weather {
  return { sun: sunPermille(absEpoch, mods.solarNight), gust: gustPermille(absEpoch, worldSeed, mods.gustVariance) };
}

/** Changes exactly when the generators' output may change (the catch-up re-solves its grids then). */
export const weatherKey = (w: Weather): string => `${w.sun}:${w.gust}`;

/** A solar panel of `peak` kW under this sun (solar panels, the Hearth's own panel). */
export const solarKw = (peak: number, w: Weather): number => mulDiv(peak, w.sun, 1000);

/** A wind turbine: base kW × local wind ‰ × gust ‰. */
export const windKw = (base: number, local: number, w: Weather): number => mulDiv(mulDiv(base, local, 1000), w.gust, 1000);

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
      return windKw(p.kw, p.local, w);
  }
}

/** A grid's renewable supply (kW) under this weather. */
export function renewableKw(net: Net, w: Weather): number {
  let R = 0;
  for (const p of net.producers) R += producerKw(p, w);
  return R;
}
