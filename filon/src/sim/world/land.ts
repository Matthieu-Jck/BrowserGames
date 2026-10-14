// land.ts — the claim's land, cut in square parcels (docs/land.md, D60; owner, 2026-10-14:
// "instead of the way station, let's make it so that you have to either buy or rent square
// parcels. By default you have a square that includes the Cirque, but then you need to pay"): the
// grid, and which parcels the claim holds — the starting square round the cirque, those it bought
// and those it leases. A building that needs the claim's land stands wholly on held parcels. What a
// parcel costs, buying and leasing are systems/land.ts. The starting square and the sister claims'
// parcels follow from the land and the seeds, so only what was bought and leased is saved.
import { BAL } from '@/content/balance';
import { COLONY_PROFILES } from '@/content/colonies';
import { hash32 } from '@/core/hash';
import { CENTER, WORLD } from '../constants';
import { footprint } from '../entities';

/** Tiles a side. */
export const PARCEL = BAL.land.parcel;
const HALF = PARCEL >> 1;
/** Parcels a side across the world (the first and last cut short by its edge). */
export const PARCEL_COLS = Math.floor((WORLD - 1 + HALF) / PARCEL) + 1;
/** The Heart's parcel's column and row: parcels are centred on its tile. */
const HOME = Math.floor((CENTER + HALF) / PARCEL);
/** The sister claims of the Crier Ring (market/colonies.ts draws as many). */
const SISTERS = Object.values(COLONY_PROFILES).reduce((n, p) => n + p.count, 0);

/** The parcel holding tile (x, y). */
export const parcelAt = (x: number, y: number): number => Math.floor((y + HALF) / PARCEL) * PARCEL_COLS + Math.floor((x + HALF) / PARCEL);

/** A parcel's tiles, [x0, x1) × [y0, y1), cut to the world. */
export function parcelRect(p: number): { x0: number; y0: number; x1: number; y1: number } {
  const col = p % PARCEL_COLS, row = (p - col) / PARCEL_COLS;
  const x0 = col * PARCEL - HALF, y0 = row * PARCEL - HALF;
  return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(WORLD, x0 + PARCEL), y1: Math.min(WORLD, y0 + PARCEL) };
}

/** A parcel's middle tile. */
export function parcelCentre(p: number): [number, number] {
  const col = p % PARCEL_COLS, row = (p - col) / PARCEL_COLS;
  return [col * PARCEL, row * PARCEL];
}

/** Parcels between a parcel and the Heart's, the longer way (0: the Heart's; its square rings). */
export function ringOf(p: number): number {
  const col = p % PARCEL_COLS, row = (p - col) / PARCEL_COLS;
  return Math.max(Math.abs(col - HOME), Math.abs(row - HOME));
}

/** A lease: the tick its next hour falls due and the rent it takes then (centi-ocelles, fixed for its life). */
export interface Lease { next: number; cents: number }

export class Land {
  /** The starting square's reach in rings round the Heart's parcel: the Crown out to its farthest terrace. */
  readonly reach: number;
  /** Parcels bought (beyond the starting square): each one raises the next one's price. Saved. */
  readonly bought = new Set<number>();
  /** Parcels held without a purchase: what an older base stood on when land became parcels (save v3). Saved. */
  readonly granted = new Set<number>();
  /** Parcels leased, by parcel. Saved. */
  readonly leases = new Map<number, Lease>();

  constructor(crownReach: number, private readonly seed: number) {
    this.reach = Math.ceil(Math.max(0, crownReach - HALF) / PARCEL);
  }

  /** Is the parcel the claim's grant (the starting square)? */
  inStart(p: number): boolean { return ringOf(p) <= this.reach; }

  /** Does the claim hold the parcel (its grant, bought or leased)? */
  holds(p: number): boolean { return this.inStart(p) || this.bought.has(p) || this.granted.has(p) || this.leases.has(p); }

  /** Is the tile on the claim's land? */
  covers(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < WORLD && y < WORLD && this.holds(parcelAt(x, y));
  }

  /** Every footprint tile on the claim's land. */
  coversFootprint(def: number, x: number, y: number, rot: 0 | 1 | 2 | 3): boolean {
    const [w, h] = footprint(def, rot);
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (!this.covers(tx, ty)) return false;
    return true;
  }

  /**
   * The sister claim that owns a parcel (its colony index), or −1: about one in `sisterShare` beyond
   * the ring round the starting square, the claim drawn from the seeds. A parcel the claim holds is
   * its own, whoever it was bought from.
   */
  sister(p: number): number {
    if (ringOf(p) <= this.reach + 1 || this.bought.has(p) || this.granted.has(p)) return -1;
    const h = hash32(this.seed, p, 0x1a4d);
    return h % 1000 < BAL.land.sisterShare ? (h >>> 10) % SISTERS : -1;
  }

  /** The parcels held beyond the starting square, sorted. */
  heldBeyond(): number[] {
    return [...new Set([...this.bought, ...this.granted, ...this.leases.keys()])].filter((p) => !this.inStart(p)).sort((a, b) => a - b);
  }
}
