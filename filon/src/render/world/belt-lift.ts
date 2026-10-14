// belt-lift.ts — how high an item rides, from where it is, and where each traction elevator's car
// is (owner, 2026-10-13: ribbons and their items on the mountains were drawn at the floor, under
// the rock; then "an actual elevator style and animation: the item arrives, gets lifted, advances
// again, and then the elevator goes down again"). Pure: no Pixi. The items view asks it once per
// item per frame (`place`), then lets the idle cars move (`settle`); the buildings view reads the
// cars' heights (`carAt`).
//
// An item rides at its tile's top (relief.ts `tileTop`, the height the ribbon pieces are laid at)
// — except on the low tile of a traction ribbon's step (traction-lifts.ts `liftOfBelt`), where the
// elevator's shaft stands. Climbing, the item crosses that tile to the car at the foot of the wall,
// stands on it while it rises a terrace, then rolls off over the edge onto the high tile; coming
// down, it rolls from the edge onto the car waiting at the top, sinks with it, then rolls on. Its
// way across the tile is remapped (its progress `a` there, as the motion model has it, to where
// it is drawn): it waits on the car while the car moves, and makes up the distance before and
// after, so it keeps the line's pace overall and meets the next tile exactly where the model hands
// it over. The car follows the item it carries; once that item is clear it goes back (down when
// climbing, up when coming down) to wait for the next (`RETURN_TICKS` for the whole step). A step
// down onto a building (no room for a shaft) is a slide down the ribbon's last stretch instead.
//
// An item above the floor, or in an elevator's shaft, must be drawn over the volumes (the items'
// layer lies under them: the rock it rides on, the shaft it rides in would cover it), but not over
// higher rock in front of it: `over` says whether it may be — yes, unless rock in front stands high
// enough to cover its tile's centre on screen (then it stays under the volumes and is hidden, as the
// rock hides that tile's ribbon), or it passes under a junction's bridge there. A column d
// diagonals ahead (d = Δx + Δy, across |Δx − Δy| ≤ 1 screen columns) covers a point L levels up at
// a tile's centre when its top H reaches H − L ≥ d − 1 + |Δx − Δy| (iso: half a tile's height =
// one level). Buildings do not count: most are far from solid blocks (a pole in front hid every
// item on an elevator behind it), and an item drawn over a building's corner is the lesser harm.
import { BUILDING_KIND } from '@/content/registry';
import { WORLD } from '@/sim/constants';
import { DX, DY, type Ent } from '@/sim/types';
import { LIFT } from '../art/recipes/lifts';
import { MAX_LEVEL, STEP_LEVELS, tileTop, type ReliefLand } from '../relief';
import { liftOfBelt, type Lift } from './traction-lifts';

/** What the lift reads of a colony (a Sim): its land and occupancy, its buildings. */
export interface LiftWorld {
  readonly grid: ReliefLand & { readonly occ: Int32Array };
  readonly ents: { readonly map: ReadonlyMap<number, Ent>; get(id: number): Ent | undefined };
}

/** Where an item is drawn: tile coords (on the plane), its height (relief levels), and whether it is in an elevator's shaft. */
export interface Placed { x: number; y: number; lv: number; shaft: boolean }

/**
 * The elevator's timing across its low tile, by the item's progress `a` there (the engine moves it
 * tile centre to tile centre, one step at a time, D57: a = 0.5 is where it stops): climbing, it
 * comes onto the car at its foot by `a1` — the centre, so an item waiting there waits on the car —,
 * rides it up until `a2`, then rolls off over the edge; coming down (onto the low tile from the
 * edge), it is on the car at the top by `a1`, rides it down until `a2`, then rolls off it to the
 * tile's centre (`free`: the car waits until then).
 */
export const UP = { a1: 0.5, a2: 0.85 } as const;
export const DOWN = { a1: 0.12, a2: 0.4, free: 0.5 } as const;
/** Ticks for an empty car to cross the whole step back. */
export const RETURN_TICKS = 5;
/** The last stretch of a traction ribbon over which an item slides down onto a building (no shaft). */
export const SLIDE = 0.2;
/** How far ahead the cover test looks (diagonals): past the highest rock. */
const AHEAD = MAX_LEVEL + 2;

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** An elevator: its step, its car's height above the low top (levels), held by an item this frame. */
interface Car { lift: Lift; z: number; held: boolean }

export class BeltLift {
  private world: LiftWorld | null = null;
  /** Elevators by their low tile; slides (a step down onto a building) by the ribbon's tile. */
  private cars = new Map<number, Car>();
  private slides = new Map<number, Lift>();
  /** Per tile: drawn over the volumes (1) or under them (0), worked out on first ask. */
  private overAt = new Map<number, number>();
  private last = NaN;

  /** Re-read the traction steps (after structural changes, or another colony); cars keep their height; cover answers start afresh. */
  rebuild(world: LiftWorld): void {
    const old = world === this.world ? this.cars : new Map<number, Car>();
    this.world = world;
    this.cars = new Map();
    this.slides.clear();
    this.overAt.clear();
    const occupant = (x: number, y: number): number => world.ents.get(world.grid.occ[y * WORLD + x]!)?.def ?? -1;
    for (const e of world.ents.map.values()) {
      const l = liftOfBelt(world.grid, occupant, e);
      if (!l) continue;
      if (!l.shaft) { this.slides.set(e.y * WORLD + e.x, l); continue; }
      const k = l.lowY * WORLD + l.lowX;
      this.cars.set(k, { lift: l, z: old.get(k)?.z ?? (l.up ? 0 : STEP_LEVELS), held: false });
    }
  }

  /** Where an item at (x, y) (tile coords, as the motion model has it) is drawn, and how high; into `out`. */
  place(x: number, y: number, out: Placed): Placed {
    out.x = x; out.y = y; out.lv = 0; out.shaft = false;
    const w = this.world;
    if (!w) return out;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= WORLD || ty >= WORLD) return out;
    const k = ty * WORLD + tx;
    const top = tileTop(w.grid, tx, ty);
    out.lv = top;
    const car = this.cars.get(k), sl = car ? undefined : this.slides.get(k);
    if (!car && !sl) return out;
    const l = (car?.lift ?? sl)!;
    const dx = DX[l.rot]!, dy = DY[l.rot]!;
    // Its progress across the tile along the step's way: 0 where items come in.
    const a = dx * (x - tx - 0.5) + dy * (y - ty - 0.5) + 0.5;
    if (sl) {
      const next = tileTop(w.grid, tx + dx, ty + dy);
      out.lv = top + (next - top) * smooth((a - (1 - SLIDE)) / SLIDE);
      return out;
    }
    const H = STEP_LEVELS, D = LIFT.depth;
    let f: number, z: number, held: boolean;
    if (l.up) {
      const c = 1 - D / 2, { a1, a2 } = UP;
      if (a < a1) { f = (a * c) / a1; z = 0; held = false; }
      else if (a < a2) { f = c; z = H * smooth((a - a1) / (a2 - a1)); held = true; }
      else { f = c + ((1 - c) * (a - a2)) / (1 - a2); z = H; held = true; }
    } else {
      const c = D / 2, { a1, a2, free } = DOWN;
      if (a < a1) { f = (c * Math.max(0, a)) / a1; z = H; held = true; }
      else if (a < a2) { f = c; z = H * (1 - smooth((a - a1) / (a2 - a1))); held = true; }
      else if (a < free) { f = c + ((free - c) * (a - a2)) / (free - a2); z = 0; held = true; }
      else { f = a; z = 0; held = false; }
    }
    out.x = x + (f - a) * dx;
    out.y = y + (f - a) * dy;
    out.lv = l.low + z;
    out.shaft = true; // on the shaft's tile, even at the foot: drawn over the elevator, never behind it (owner, 2026-10-13)
    if (held) { car!.z = z; car!.held = true; }
    return out;
  }

  /** After a frame's items (`now`: the fractional tick): the cars no item held go back to wait for the next one. */
  settle(now: number): void {
    const dt = Number.isFinite(this.last) ? Math.max(0, Math.min(10, now - this.last)) : 0;
    this.last = now;
    const step = (STEP_LEVELS * dt) / RETURN_TICKS;
    for (const car of this.cars.values()) {
      if (!car.held) {
        const home = car.lift.up ? 0 : STEP_LEVELS;
        car.z = car.z < home ? Math.min(home, car.z + step) : Math.max(home, car.z - step);
      }
      car.held = false;
    }
  }

  /** The height of the car on low tile (x, y) above that tile's top (levels); 0 when there is none. */
  carAt(x: number, y: number): number {
    return this.cars.get(y * WORLD + x)?.z ?? 0;
  }

  /** Is an item on tile (tx, ty), above the floor, drawn over the volumes (see the header)? */
  over(tx: number, ty: number): boolean {
    const w = this.world;
    if (!w || tx < 0 || ty < 0 || tx >= WORLD || ty >= WORLD) return false;
    const k = ty * WORLD + tx;
    let o = this.overAt.get(k);
    if (o === undefined) this.overAt.set(k, (o = this.cover(w, tx, ty) ? 0 : 1));
    return o === 1;
  }

  /** Something in front covers the tile's centre (or it is a junction's tunnel)? */
  private cover(w: LiftWorld, tx: number, ty: number): boolean {
    const own = w.ents.get(w.grid.occ[ty * WORLD + tx]!);
    if (own && BUILDING_KIND[own.def] === 'crossing') return true; // the passage under its bridge
    const L = tileTop(w.grid, tx, ty);
    for (let d = 1; d <= AHEAD; d++) {
      // The tiles d diagonals ahead in this screen column (d even) or the two beside it (d odd).
      for (let du = -(d & 1); du <= (d & 1); du += 2) {
        const x = tx + (d + du) / 2, y = ty + (d - du) / 2;
        if (x < WORLD && y < WORLD && tileTop(w.grid, x, y) - L >= d - 1 + Math.abs(du)) return true;
      }
    }
    return false;
  }
}
