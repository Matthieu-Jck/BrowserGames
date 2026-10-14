// types.ts — shared engine types: directions, terrain classes, entity records, node status.
// Engine state is plain data and integers only (milli-items, kW, kW·tick, permille, cents).

/** Direction / rotation: 0 = N (up), 1 = E, 2 = S, 3 = W — clockwise. */
export type Rot = 0 | 1 | 2 | 3;

export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];
export const opposite = (d: Rot): Rot => ((d + 2) & 3) as Rot;
export const sideIndex = { N: 0, E: 1, S: 2, W: 3 } as const;

/** Terrain classes (Uint8 per tile). */
export const T = {
  Sand: 0, Hardpan: 1, Rock1: 2, Rock2: 3, Rock3: 4, Rock4: 5,
  Shallow: 6, Deep: 7, Salt: 8, Vent: 9, DuneSea: 10, Dug: 11, Filled: 12,
} as const;

export const isRock = (t: number): boolean => t >= T.Rock1 && t <= T.Rock4;
export const isWater = (t: number): boolean => t === T.Shallow || t === T.Deep;
/** Ground a regular building can stand on. */
export const isFloor = (t: number): boolean =>
  t === T.Sand || t === T.Hardpan || t === T.Dug || t === T.Filled || t === T.Salt || t === T.Vent;

/** A placed entity (a building, a ribbon tile, a mast…). */
export interface Ent {
  id: number;
  def: number;   // building index
  x: number;     // top-left tile of the ROTATED footprint
  y: number;
  rot: Rot;
  /** Packed settings — machine: recipe + speed modules; fork: per-side filters (layout in cfg.ts). */
  cfg: number;
  /** Per-port item filters for unloaders (Hearth/silo outputs, docks, trade posts): item index or -1. */
  portItems?: number[];
  /** Tick at which a remote construction completes (0 = built). */
  builtAt: number;
}

/** Node status for render / UI. */
export const St = {
  Ok: 0, Starved: 1, Blocked: 2, Unpowered: 3, NoJob: 4, Idle: 5, LowPower: 6, NoFuel: 7, Building: 8, Dormant: 9,
} as const;
export type Status = (typeof St)[keyof typeof St];
