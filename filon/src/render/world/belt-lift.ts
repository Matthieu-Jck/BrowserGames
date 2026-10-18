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
// climbing, up when coming down) to wait for the next (`RETURN_TICKS` for the whole step at most).
// The lift goes at its line's pace (D141): on a full line the next item reaches the car half a step
// after the last one left it, so the car's way back takes at most `RETURN_SHARE` of a step of the
// faster of its two tiles' lines (`returnTicks`) — it is home before the item at every tier, never
// snapped to it. A step down onto a building (no room for a shaft) is a slide down the ribbon's last
// stretch instead.
//
// Where an item sorts among the volumes (`itemZ`; owner, 2026-10-14: "the copper is above the
// building that is in front… the traction ribbon sometimes makes items disappear"). An item above
// the floor, in an elevator's shaft or on an incinerator's tile is drawn inside the depth-sorted
// `objects` layer (items-view.ts), keyed on the world/stand.ts scale, so the painter's order
// hides it behind whatever stands in front — rock or building — and nothing else. Its key is its
// host tile's: after that tile's ribbon piece (`beltZ` + 0.05), after its elevator's front frame
// (`liftZ` + 0.03: drawn over its elevator, never behind it, owner 2026-10-13), just under a
// building it goes into (`beltZ` − 0.02: over the junction's passage, under its bridge, as on the
// floor a routing block swallows it), between an incinerator's back and its flame on the pit's far
// half and once it has tipped in, over the whole pit on its near half (pits.ts `PIT_Z`). The host is the tile its front-most
// point is on (an item is about a third of a tile across), so it is not clipped by the next
// column's top as it crosses a tile edge on a plateau — when every tile it overhangs is no higher
// than it rides and holds no building (else its centre's tile: a higher column in front still
// hides it). An item over an incinerator's tile, or overhanging one, is the pit's.
//
// In front of a building (D130; owner, 2026-10-18: « quand est-ce qu'il devrait être devant les
// items sur les ribbons, quand est-ce qu'ils devraient être derrière, et quelle partie surtout »):
// an item on the floor within `FACE_REACH` of a building's near face — the tile south or east of
// it, where its walls and port boxes rise over the item's glyph: a line out of a front port, into
// one, along it — sorts among the volumes too, by its host tile, after that building (`fronts`), so
// the wall it has left (or not reached) stays behind it. As a sprite among the volumes it is no
// longer under the buildings' cast shadows (their layer is under the volumes): the items view tints
// it with the shade that layer lays where it stands (buildings-view.ts `shadowAt`). A routing block
// the same, out of the slots in its front and sides — but not on its intake's side: what goes in
// passes under the hopper leaning out over the ribbon (`INTAKE`). A junction's tile is the same: the
// items through its tunnel sort under it (seen through its near mouth), out of the mouth after it.
// An item on the floor elsewhere is drawn with the ribbons, under every volume (NaN).
//
// An item riding a skybridge's span (flagged `OVER.sky` by the motion model, item-flow.ts: up its
// start, over each square of its deck, down its far end, and the ribbons' last and first stretch at
// its ends) sorts just after the back of the span's piece it is over (`spanZ`: stand.ts `rampZ`,
// `deckSquareZ`), under its front (the near girder: D130), by its front-most point when that is on
// the span too — so the deck square in front never clips it, and whatever stands in front of the
// deck hides it with the deck (owner, 2026-10-17: « quand la file est pleine, les objets devraient
// pouvoir patienter sur le pont »: a backed-up line waits there, D121). On a ramp, the gantry's
// beam spans the line: an item behind its plane goes under it, one in front of it over it all; on
// the ribbon by an end, under that end's front when the end is in front of it, over it all when
// the end is behind it. An item riding a junction's deck (`OVER.junction`, D130: it was drawn over
// every building, so over a silo or a skybridge in front of the junction) sorts the same way
// between the junction's back and front (`junctionZ`).
import { BUILDING_IDS, BUILDING_KIND, buildingDef } from '@/content/registry';
import { WORLD } from '@/sim/constants';
import { footprint } from '@/sim/entities';
import { DX, DY, type Ent } from '@/sim/types';
import { LIFT } from '../art/recipes/lifts';
import { STEP_LEVELS, tileTop, type ReliefLand } from '../relief';
import { PIT_Z } from './pits';
import { beltZ, deckSquareZ, depthKey, flat, liftOf, liftZ, rampZ } from './stand';
import { liftOfBelt, type Lift } from './traction-lifts';

/**
 * What the lift reads of a colony (a Sim): its land and occupancy, its buildings, its lines' leaps
 * (`graph.jumps`, for the skybridges' spans) and their paces (`graph.chainByTile`, the ticks of a
 * step: for the cars' way back, D141).
 */
export interface LiftWorld {
  readonly grid: ReliefLand & { readonly occ: Int32Array };
  readonly ents: { readonly map: ReadonlyMap<number, Ent>; get(id: number): Ent | undefined };
  readonly graph?: { readonly jumps: ReadonlyMap<number, number>; readonly chainByTile?: ReadonlyMap<number, { readonly stepTicks: number }> } | null;
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
/** Ticks for an empty car to cross the whole step back, at most. */
export const RETURN_TICKS = 5;
/** …and at most this share of a step of its line (D141): the next item reaches the car half a step after the last left it. */
export const RETURN_SHARE = 0.4;
/** The ticks an empty car takes back across the step, on a line whose steps take `stepTicks` (D141). */
export const returnTicks = (stepTicks: number): number => Math.min(RETURN_TICKS, RETURN_SHARE * stepTicks);
/** The last stretch of a traction ribbon over which an item slides down onto a building (no shaft). */
export const SLIDE = 0.2;
/** How far an item reaches from its centre towards the viewer, along x and along y (tiles): its glyph is about a third of a tile across. */
export const ITEM_REACH = 0.16;
/**
 * An item's key above its host tile's (see the header): on a ribbon, on an elevator, under a
 * building it goes into; above a piece's key (stand.ts `FRONT_DZ`): between its back and front
 * (`span`), over both (`front`).
 */
export const ITEM_DZ = { belt: 0.05, lift: 0.03, under: -0.02, span: 0.02, front: 0.06 } as const;
/**
 * How near a building's near face (tiles) an item on the floor sorts after it (D130): its glyph
 * rises over the face's foot from about half a tile away (a little more zoomed out, where items
 * are drawn bigger), so an item waiting on the tile's centre is among them.
 */
export const FACE_REACH = 0.55;
/** An item in front of a building sorts after all it lays (a moving part ± 0.2, a solar overlay + 0.25, a skybridge end's ramp's front + 0.29, a chosen item + 0.4). */
const AFTER_DZ = 0.45;
/** The routing blocks with an intake hopper at their back (in from behind only): all but the distributor, whose mouths take and give on every side. */
const INTAKE = new Set(BUILDING_IDS.flatMap((id, i) => (BUILDING_KIND[i] === 'fork' && buildingDef(i).logic !== 'distributor' ? [i] : [])));

/** A skybridge span's piece on a tile (`spanZ`): its key, a ramp or a deck square, the way its line runs (N–S or not) and the plane of a ramp's gantry beam across it (its square's middle). */
interface Span { z: number; ramp: boolean; ns: boolean; m: number }
/** A floor tile by a building's near face (`fronts`): which faces (N: a building north of it, W: west; `inside`: a junction's own tile), the key its items sort after. */
interface Front { n: boolean; w: boolean; inside: boolean; after: number }

/** What a tile is to the items that ride over it: its top, its key for them, and whether they may overhang it (no building on it), or it is a pit. */
interface Host { top: number; z: number; open: boolean; pit: boolean }

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** An elevator: its step, its car's height above the low top (levels), held by an item this frame, the ticks its way back takes (`returnTicks`). */
interface Car { lift: Lift; z: number; held: boolean; ret: number }

export class BeltLift {
  private world: LiftWorld | null = null;
  /** Elevators by their low tile; slides (a step down onto a building) by the ribbon's tile. */
  private cars = new Map<number, Car>();
  private slides = new Map<number, Lift>();
  /** Per tile: what it is to the items over it (`Host`), worked out on first ask. */
  private hosts = new Map<number, Host>();
  /** The tiles round each incinerator (an item there may overhang its pit): the only floor tiles whose items sort among the volumes. */
  private nearPit = new Set<number>();
  /** The skybridges' spans: each tile a piece lies on (its ends' ramps, its deck's squares), and that piece. */
  private spans = new Map<number, Span>();
  /** The junctions' tiles and their keys (their back's), for the items riding their decks. */
  private junctions = new Map<number, number>();
  /** The floor tiles by a building's near face (D130). */
  private fronts = new Map<number, Front>();
  private last = NaN;

  /** Re-read the traction steps (after structural changes, or another colony); cars keep their height; the hosts start afresh (after the buildings view's stands). */
  rebuild(world: LiftWorld): void {
    const old = world === this.world ? this.cars : new Map<number, Car>();
    this.world = world;
    this.cars = new Map();
    this.slides.clear();
    this.hosts.clear();
    this.nearPit.clear();
    this.spans.clear();
    this.junctions.clear();
    this.fronts.clear();
    const occupant = (x: number, y: number): number => world.ents.get(world.grid.occ[y * WORLD + x]!)?.def ?? -1;
    const bridgeAt = (t: number): Ent | undefined => { const e = world.ents.get(world.grid.occ[t]!); return e && BUILDING_KIND[e.def] === 'bridge' ? e : undefined; };
    // The spans, as the buildings view lays them (`addDecks`): a pair whose start leaps to the next end ahead, the same way.
    for (const [t, g] of world.graph?.jumps ?? []) {
      const e = bridgeAt(t), far = bridgeAt(g);
      if (!e || !far || far.rot !== e.rot) continue;
      const lv = liftOf(e), d = e.rot, ns = (d & 1) === 0;
      const ramp = (o: Ent): Span => ({ z: rampZ(o), ramp: true, ns, m: (ns ? o.y : o.x) + 0.5 });
      this.spans.set(t, ramp(e));
      this.spans.set(g, ramp(far));
      for (let x = e.x + DX[d]!, y = e.y + DY[d]!, k = 0; k < 64 && y * WORLD + x !== g; k++, x += DX[d]!, y += DY[d]!) this.spans.set(y * WORLD + x, { z: deckSquareZ(x, y, lv), ramp: false, ns, m: 0 });
    }
    for (const e of world.ents.map.values()) {
      const kind = BUILDING_KIND[e.def];
      if (kind === 'sink') for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) this.nearPit.add((e.y + j) * WORLD + e.x + i);
      if (kind === 'crossing') this.junctions.set(e.y * WORLD + e.x, depthKey(e));
      if (!flat(e.def) && kind !== 'sink') this.faceOf(world, e);
      const l = liftOfBelt(world.grid, occupant, e);
      if (!l) continue;
      if (!l.shaft) { this.slides.set(e.y * WORLD + e.x, l); continue; }
      const k = l.lowY * WORLD + l.lowX;
      // Its pace: the faster of its own tile's line and its low tile's (the item rides the car there), else its content's.
      const own = e.y * WORLD + e.x, chains = world.graph?.chainByTile;
      const steps = Math.min(chains?.get(own)?.stepTicks ?? Infinity, chains?.get(k)?.stepTicks ?? Infinity);
      const ret = returnTicks(Number.isFinite(steps) ? steps : 600 / (buildingDef(e.def).belt?.perMin ?? 60));
      this.cars.set(k, { lift: l, z: old.get(k)?.z ?? (l.up ? 0 : STEP_LEVELS), held: false, ret });
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
    for (const car of this.cars.values()) {
      if (!car.held) {
        const step = (STEP_LEVELS * dt) / car.ret;
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

  /**
   * The depth key among the volumes of an item riding a skybridge's span at (x, y) (tile coords;
   * flagged `OVER.sky` by the motion model, item-flow.ts): just after the back of the piece under
   * it — or of its front-most point's, when that is the span's too and in front — under its front
   * (D130); on a ramp in front of the gantry's beam, over its front too. On the ribbon by an end
   * (the last or first stretch drawn over the bridge), across the nearer edge: under that end's
   * front when the end is in front of the item's tile, over it all when it is behind. NaN when no
   * span is there (the items view then draws it as any other item).
   */
  spanZ(x: number, y: number): number {
    if (!this.spans.size) return NaN;
    const tx = Math.floor(x), ty = Math.floor(y);
    const own = this.spans.get(ty * WORLD + tx);
    if (own) {
      const front = this.spans.get(Math.floor(y + ITEM_REACH) * WORLD + Math.floor(x + ITEM_REACH));
      const p = front && front.z > own.z ? front : own;
      return p.z + (p.ramp && (p.ns ? y : x) > p.m ? ITEM_DZ.front : ITEM_DZ.span);
    }
    const n = this.across(this.spans, x, y);
    return n ? n.v.z + (n.ahead ? ITEM_DZ.span : ITEM_DZ.front) : NaN;
  }

  /**
   * The depth key among the volumes of an item riding a junction's deck at (x, y) (flagged
   * `OVER.junction`, item-flow.ts; D130 — it was drawn over every building): between the
   * junction's back and front, or the next junction's of a run when its front-most point is on
   * it; on the ribbon by one, across the nearer edge, between its parts when the junction is in
   * front of the item's tile, over it all (and its own tile's ribbon) when it is behind. NaN when
   * no junction is there.
   */
  junctionZ(x: number, y: number): number {
    if (!this.junctions.size) return NaN;
    const tx = Math.floor(x), ty = Math.floor(y);
    const own = this.junctions.get(ty * WORLD + tx);
    if (own !== undefined) {
      const front = this.junctions.get(Math.floor(y + ITEM_REACH) * WORLD + Math.floor(x + ITEM_REACH));
      return (front !== undefined && front > own ? front : own) + ITEM_DZ.span;
    }
    const n = this.across(this.junctions, x, y);
    if (!n) return NaN;
    return n.ahead ? n.v + ITEM_DZ.span : Math.max(n.v + ITEM_DZ.front, this.host(tx, ty)?.z ?? -Infinity);
  }

  /** What lies across the nearer edges of (x, y)'s tile in `map` (the one with the higher key), and whether its tile is in front of the item's. */
  private across<V extends number | Span>(map: ReadonlyMap<number, V>, x: number, y: number): { v: V; ahead: boolean } | null {
    const tx = Math.floor(x), ty = Math.floor(y);
    const nx = x - tx < 0.5 ? tx - 1 : tx + 1, ny = y - ty < 0.5 ? ty - 1 : ty + 1;
    const a = map.get(ty * WORLD + nx), b = map.get(ny * WORLD + tx);
    const key = (v: V | undefined): number => (v === undefined ? -Infinity : typeof v === 'number' ? v : v.z);
    if (a === undefined && b === undefined) return null;
    return key(a) >= key(b) ? { v: a!, ahead: nx > tx } : { v: b!, ahead: ny > ty };
  }

  /**
   * Register the tiles along a building's near faces at its height — the row south of it, the
   * column east of it — and a junction's own tile (D130): what their items sort after. Not a glazed ribbon's
   * tile: its glass hood (on a layer under the volumes) covers its items. Not a routing block's
   * intake side: its hopper leans out over the incoming ribbon (art/recipes/buildings.ts
   * `intakeIso`), so what comes in passes under it.
   */
  private faceOf(world: LiftWorld, e: Ent): void {
    const [w, h] = footprint(e.def, e.rot);
    const back = INTAKE.has(e.def) ? (e.rot + 2) & 3 : -1; // the side items come in by (S: 2, E: 1 are near faces)
    const after = depthKey(e) + AFTER_DZ;
    const lv = liftOf(e);
    const at = (x: number, y: number): Front | null => {
      if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) return null;
      // Only at the building's own height: a building on rock may sort past the columns ahead of it
      // (stand.ts `reach`), so an item below or above it would be pushed past rock in front of it.
      if (tileTop(world.grid, x, y) !== lv) return null;
      const t = y * WORLD + x;
      const o = world.ents.get(world.grid.occ[t]!);
      if (o && o !== e && buildingDef(o.def).glazed) return null;
      let f = this.fronts.get(t);
      if (!f) this.fronts.set(t, (f = { n: false, w: false, inside: false, after: -Infinity }));
      return f;
    };
    const face = (f: Front | null, side: 'n' | 'w'): void => {
      if (!f) return;
      f[side] = true;
      if (after > f.after) f.after = after;
    };
    if (back !== 2) for (let i = 0; i < w; i++) face(at(e.x + i, e.y + h), 'n');
    if (back !== 1) for (let j = 0; j < h; j++) face(at(e.x + w, e.y + j), 'w');
    if (BUILDING_KIND[e.def] === 'crossing') { const f = at(e.x, e.y); if (f) f.inside = true; }
  }

  /** The tile record of an item at (x, y) by a building's near face, when it is near enough to sort after it (`FACE_REACH`), or on a junction's tile. */
  private faceAt(x: number, y: number): Front | null {
    if (!this.fronts.size) return null;
    const tx = Math.floor(x), ty = Math.floor(y);
    const f = this.fronts.get(ty * WORLD + tx);
    return f && (f.inside || (f.n && y - ty < FACE_REACH) || (f.w && x - tx < FACE_REACH)) ? f : null;
  }

  /** What tile (tx, ty) is to the items over it (see the header). */
  private host(tx: number, ty: number): Host | null {
    const w = this.world;
    if (!w || tx < 0 || ty < 0 || tx >= WORLD || ty >= WORLD) return null;
    const k = ty * WORLD + tx;
    let h = this.hosts.get(k);
    if (h) return h;
    const top = tileTop(w.grid, tx, ty);
    const e = w.ents.get(w.grid.occ[k]!);
    if (this.cars.has(k)) h = { top, z: liftZ(tx, ty) + ITEM_DZ.lift, open: true, pit: false };
    else if (e && BUILDING_KIND[e.def] === 'sink') h = { top, z: depthKey(e), open: false, pit: true };
    else if (!e || flat(e.def)) h = { top, z: beltZ(tx, ty) + ITEM_DZ.belt, open: true, pit: false };
    else h = { top, z: beltZ(tx, ty) + ITEM_DZ.under, open: false, pit: false };
    this.hosts.set(k, h);
    return h;
  }

  /**
   * The depth key among the volumes of an item drawn at (x, y) (tile coords, where `place` put it),
   * `lv` levels up, `lifted` (above the floor or in a shaft), fallen `d` into a pit: its host
   * tile's (see the header), and after the building whose near face it is by (D130); NaN for an
   * item on the floor away from any pit and any near face, drawn with the ribbons.
   */
  itemZ(x: number, y: number, lv: number, lifted: boolean, d: number): number {
    const tx = Math.floor(x), ty = Math.floor(y);
    const face = this.faceAt(x, y);
    if (!lifted && !face && !this.nearPit.has(ty * WORLD + tx)) return NaN; // on the floor, away from any pit or near face: with the ribbons
    const fx = Math.floor(x + ITEM_REACH), fy = Math.floor(y + ITEM_REACH);
    const bx = Math.floor(x - ITEM_REACH), by = Math.floor(y - ITEM_REACH);
    // Over a pit, or overhanging one: the pit's — behind its flame on the far half (the flame
    // rises from the throat in front of it) or once it falls in, over everything on the near half.
    // (Every tile it may overhang is within a tile of its own: none can be a pit off `nearPit`.)
    if (this.nearPit.has(ty * WORLD + tx)) for (const [i, j] of [[tx, ty], [fx, ty], [tx, fy], [fx, fy], [bx, ty], [tx, by]] as const) {
      const h = this.host(i, j);
      if (h?.pit) return h.z + (d > 0 || x + y < i + j + 1 ? PIT_Z.fall : PIT_Z.over);
    }
    if (!lifted && !face) return NaN;
    const own = this.host(tx, ty);
    if (!own) return NaN;
    let z = own.z;
    // Overhanging the tiles in front: keyed by the front-most one, if none is higher or built on.
    const ok = (i: number, j: number): boolean => { const h = this.host(i, j); return !!h && h.open && h.top <= lv + 1e-6; };
    if ((fx !== tx || fy !== ty) && (fx === tx || ok(fx, ty)) && (fy === ty || ok(tx, fy)) && ok(fx, fy)) z = this.host(fx, fy)!.z;
    return face && face.after > z ? face.after : z;
  }
}
