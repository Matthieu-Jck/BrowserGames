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
  /**
   * Map 4's obstacles (D94), at level 0: a chasm (« précipice », a ravine nothing stands in nor
   * fills) and a river (flowing water: nothing stands in it nor fills it, a pump beside it draws
   * from it). A skybridge pair leaps both; a wire passes over both (the land's level is the floor's).
   */
  Chasm: 13, River: 14,
} as const;

export const isRock = (t: number): boolean => t >= T.Rock1 && t <= T.Rock4;
/** Water a pump draws: still (lakes, the tarn) or flowing (a river, D94). Only still water is filled (`isStillWater`). */
export const isWater = (t: number): boolean => t === T.Shallow || t === T.Deep || t === T.River;
export const isStillWater = (t: number): boolean => t === T.Shallow || t === T.Deep;
/** The land's gaps (D94): a chasm or a river — nothing builds there, nothing fills them, a skybridge pair leaps them. */
export const isGap = (t: number): boolean => t === T.Chasm || t === T.River;
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
  /** Per-port items its outlets hand out (the Heart's data outlet, a trade post's exit): item index or -1. */
  portItems?: number[];
  /** Tick at which a remote construction completes (0 = built). */
  builtAt: number;
}

/** Node status for render / UI. */
export const St = {
  Ok: 0, Starved: 1, Blocked: 2, Unpowered: 3, NoJob: 4, Idle: 5, LowPower: 6, NoFuel: 7, Building: 8, Dormant: 9,
} as const;
export type Status = (typeof St)[keyof typeof St];
