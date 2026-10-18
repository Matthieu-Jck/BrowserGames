// items-view.ts — items riding the ribbons, in both views. Where each item is comes from the
// engine's own cells, one item per tile (D57, cell-flow.ts), each eased in from where it was over
// one step along the ribbons' paths (item-flow.ts). This file only draws them: each item is placed
// in view px by the current view (P), lifted onto skybridge decks and junction bridges in iso,
// glyphs upright. Items are the belt variant of their glyph (a paper halo keeps them readable on the
// teal belt), about half a tile across.
//
// Where each is drawn:
// - **On the floor**, on `items`, under every volume, as particles (one ParticleContainer per atlas
//   page; the particle lists rebuilt only when the count changes) — but by a building's near face
//   and on a junction's tile (D130, below). The junctions' passages — the under line's ribbon
//   through each tunnel — are laid by `JunctionsView` (junctions-view.ts), which this view owns and
//   rebuilds with its pieces.
// - **On a bridge** — a skybridge's span (`OVER.sky`: its ramps, its deck, the ribbons' stretch at
//   its ends) or a junction's deck (`OVER.junction`; owner, 2026-10-13: "a little bridge, with items
//   going under it in one direction, and over it in another") —: in iso among the volumes, between
//   the back and the front of the piece it rides (belt-lift.ts `spanZ`, `junctionZ`; D130: the
//   junction's were drawn over every building, so over a silo or a skybridge in front of it), so
//   what stands in front of the bridge hides what rides or waits on it as it hides the bridge (D121;
//   owner, 2026-10-17: « quand la file est pleine, les objets devraient pouvoir patienter sur le
//   pont »); in plan in a box on the plan layer over every plan sprite, the deck's among them
//   (`PLAN_Z.spans`).
// - **By a building's near face** (D130; owner, 2026-10-18: « quand est-ce qu'il devrait être devant
//   les items sur les ribbons, quand est-ce qu'ils devraient être derrière, et quelle partie
//   surtout »): an item on the floor within `FACE_REACH` of a building's south or east face (out of
//   a front port, into one, along it) is drawn among the volumes after that building, so the wall
//   and port boxes it is in front of no longer cut into it — tinted with the cast shadows' shade
//   where it stands (their layer is under the volumes: buildings-view.ts `shadowAt`, read across
//   its glyph so it darkens as a shadow's edge crosses it, as the layer did); on a junction's
//   tile the items through its tunnel sort under it, seen through its near mouth, and over it once
//   out of the mouth. By a routing block, not on its intake side: what goes in passes under its hopper.
// - **Above the floor, in an elevator's shaft, or on an incinerator's tile** (owner, 2026-10-14:
//   "the copper is above the building that is in front… the traction ribbon sometimes makes items
//   disappear when they're oriented opposite to the camera"), in iso: as pooled Sprites inside the
//   depth-sorted `objects` layer, keyed on the world/stand.ts scale by the tile they ride over
//   (belt-lift.ts `itemZ`), so the painter's order puts every rock column and building in front of
//   them over them, and nothing else. `objects` lies under the iso map M (iso px): a sprite there is
//   placed at its iso px, as every volume is (so mid-morph it stays glued to the ribbon it rides,
//   which M carries away from a straight lift), and drawn through M⁻¹ (one decomposition a frame):
//   upright and the size of a particle. In plan, those above the floor are particles in a container
//   on the plan layer (`plan`, sorted: over the plan copies of the ribbons on rock and the
//   elevators' marks, under the plan buildings), drawn through P⁻¹ so they are in view px, flat as
//   those copies are; those on the floor stay on `items`, under the plan buildings. Through the
//   morph they cross-fade as their ribbons do (the iso copy with the volumes until te 0.6, the plan
//   copy with the plan sprites from te 0.3, layers.ts).
//
// On the mountains (owner, 2026-10-13: "on the traction ribbons, the items still go straight, not
// up"): an item rides at the height of the land where it is (belt-lift.ts) — its tile's top, or on
// a traction ribbon's elevator car, waiting on it while it rises or sinks. Into an incinerator, it
// rides up a chute and tips into the pit (pits.ts): drawn behind the near rim as it falls, shrinking
// and fading. After the items, the idle cars go back to wait (`settle`).
//
// A camouflaged ribbon (D109) is buried: what rides it is not drawn; an item comes out of the sand
// where the line meets an open piece (its vents give the odd glint: art/recipes/belts.ts).
//
// The Gleaners' posts (D112, world/gleaners-view.ts): the tiles in `watch` get what was drawn on them
// this frame in `seen` (item, tile coords, view px, size), so a Gleaner's hand meets the very token
// on the belt and takes it from where it was last drawn.
import { Container, Matrix, Particle, ParticleContainer, Rectangle, Sprite, type Texture } from 'pixi.js';
import { ITEM_IDS, buildingDef } from '@/content/registry';
import type { Sim } from '@/sim/state';
import { IB_PX, ibKey, type Atlas } from '../art/atlas';
import { DECK_Z, beltPiece } from './buildings-view';
import { BeltLift, type Placed } from './belt-lift';
import { LH, isoToTile } from '../iso';
import { OVER, buildPieces } from './item-flow';
import { CellFlow, type FlowItem } from './cell-flow';
import { JunctionsView } from './junctions-view';
import { PLAN_Z } from './stand';
import { shadeTint } from './cast-shadows';
import { ISO_LIN, TOP, invert, isoToView, type Lin } from '../projection';

/** Item frame size (world px): iso and plan (0.5 of a 32 px plan tile; the owner found 0.7, then 0.6 a bit big). Iso 21 → 18 (owner, 2026-10-18: « réduis un tout petit peu la taille des items sur les ribbons en vue isométrique »). */
const ISO_PX = 18;
const PLAN_PX = 0.5 * TOP;
/** An item's size on screen (world px) at plan-ness `t` and `zoom`: a little bigger zoomed out, to stay legible (the Gleaners hold theirs at the same size). */
export const itemPx = (t: number, zoom: number): number => (ISO_PX + (PLAN_PX - ISO_PX) * t) / Math.max(0.75, Math.min(1, zoom));
/** The morph's cross-fade (layers.ts `setView`): the volumes are gone from te 0.6 on, the plan sprites show from te 0.3. */
const ISO_UNTIL = 0.6, PLAN_FROM = 0.3;
/** An item falling into a pit: how much it shrinks and fades by the time it is gone. */
const FALL_SHRINK = 0.5;

/** Scratch for where an item is drawn (belt-lift.ts `place`). */
const AT: Placed = { x: 0, y: 0, lv: 0, shaft: false };

/** One drawn item, for the trace rigs (FL): its rank this frame, tile coords, height, item, and whether it is drawn over the buildings (a deck) or among them (`sorted`: its depth key). */
export interface DrawnItem { id: number; x: number; y: number; z: number; item: number; over: boolean; sorted: number }

/** One layer of items: a ParticleContainer per atlas page, their pooled particles, how many are in use this frame. */
class Group {
  readonly pcs = new Map<number, ParticleContainer>();
  readonly pool = new Map<number, Particle[]>();
  readonly used = new Map<number, number>();
  constructor(readonly layer: Container) {}

  container(page: number): ParticleContainer {
    let pc = this.pcs.get(page);
    if (!pc) {
      pc = new ParticleContainer({
        dynamicProperties: { position: true, uvs: true, vertex: true, rotation: false, color: false },
        boundsArea: new Rectangle(-1e7, -1e7, 2e7, 2e7),
      });
      this.layer.addChild(pc);
      this.pcs.set(page, pc);
      this.pool.set(page, []);
    }
    return pc;
  }

  begin(): void { for (const page of this.pcs.keys()) this.used.set(page, 0); }

  /** One item at view px (x, y), scale k. */
  add(page: number, tex: Texture, x: number, y: number, k: number): void {
    this.container(page);
    const pool = this.pool.get(page)!;
    const u = this.used.get(page) ?? 0;
    let p = pool[u];
    if (!p) { p = new Particle({ texture: tex, anchorX: 0.5, anchorY: 0.5 }); pool.push(p); }
    p.texture = tex;
    p.x = x;
    p.y = y;
    p.scaleX = p.scaleY = k;
    this.used.set(page, u + 1);
  }

  /** Hand the particles in use to their containers (lists rebuilt only when the count changes). */
  flush(): void {
    for (const [page, pc] of this.pcs) {
      const u = this.used.get(page) ?? 0;
      const pool = this.pool.get(page)!;
      if (pc.particleChildren.length !== u || pc.particleChildren[0] !== pool[0]) {
        pc.particleChildren.length = 0;
        for (let i = 0; i < u; i++) pc.particleChildren.push(pool[i]!);
        pc.update();
      }
    }
  }
}

/**
 * The items drawn among the volumes (iso px, under M): pooled Sprites in `objects`, each with its
 * depth key, at its iso px; through M⁻¹ (worked out once a frame), so they show upright.
 * Only what changed is set (Pixi re-sorts and re-batches the layer when a key or a visibility
 * changes, which an item crossing a tile does).
 */
class Sorted {
  private readonly pool: Sprite[] = [];
  private used = 0;
  private shown = 0;
  /** The sprites' shape through M⁻¹: scale, skew (no rotation: the skew carries it). */
  private sx = 1; private sy = 1; private kx = 0; private ky = 0;
  constructor(private readonly layer: Container) {}

  /** The frame's view: M = P·P(0)⁻¹; items of `k` view px per texture px. */
  begin(P: Lin, k: number): void {
    this.used = 0;
    const I = invert(isoToView(P));
    // Decompose k·M⁻¹ as Pixi composes a sprite's matrix (rotation 0): a = sx·cos ky, b = sx·sin ky, c = −sy·sin(−kx), d = sy·cos kx.
    const a = I.a * k, b = I.b * k, c = I.c * k, d = I.d * k;
    this.sx = Math.hypot(a, b); this.sy = Math.hypot(c, d);
    this.ky = Math.atan2(b, a); this.kx = -Math.atan2(-c, d);
  }

  /** One item at iso px (x, y), its depth key, its scale (× the frame's), alpha and tint (the cast shadows' shade, D130). */
  add(tex: Texture, x: number, y: number, z: number, scale: number, alpha: number, tint = 0xffffff): void {
    let s = this.pool[this.used];
    if (!s) {
      s = new Sprite(tex);
      s.anchor.set(0.5);
      s.visible = false;
      this.layer.addChild(s);
      this.pool.push(s);
    }
    this.used++;
    if (s.texture !== tex) s.texture = tex;
    s.position.set(x, y);
    s.scale.set(this.sx * scale, this.sy * scale);
    s.skew.set(this.kx, this.ky);
    s.zIndex = z; // change-only in Pixi
    if (s.alpha !== alpha) s.alpha = alpha;
    if (s.tint !== tint) s.tint = tint;
    if (!s.visible) s.visible = true;
  }

  /** Hide the sprites left over from the frame before. */
  end(): void {
    for (let i = this.used; i < this.shown; i++) this.pool[i]!.visible = false;
    this.shown = this.used;
  }
}

/** An item drawn on a watched tile this frame: its item, where (tile coords), at view px, its size (world px). */
export interface SeenItem { item: number; tx: number; ty: number; x: number; y: number; px: number }

export class ItemsView {
  private readonly under: Group;
  private readonly over: Group;
  /** Items above the floor (iso: among the volumes; plan: over the ribbons on rock), when the layers are given. */
  private readonly sorted: Sorted | null;
  private readonly planned: Group | null;
  private readonly planBox: Container | null;
  /** Plan: the items riding a skybridge's span, over the plan buildings and the deck (iso: among the volumes, `sorted`). */
  private readonly spanPlan: Group | null;
  private readonly spanBox: Container | null;
  private planP: Lin | null = null;
  readonly flow = new CellFlow();
  /** The height of the land under the items (rock tops, traction lifts), and their depth keys. */
  readonly lift = new BeltLift();
  /** The ribbons laid through the junctions' tunnels (null without a ground layer). */
  readonly junctions: JunctionsView | null;
  /** The buried ribbons' tiles (D109): nothing drawn on them. */
  private buried = new Set<number>();
  count = 0;
  /** Debug (FL): record every drawn item of the last frame (tile coords) for the trace rigs. */
  debugOn = false;
  private dbg: DrawnItem[] = [];
  /** Tiles whose items another view reads this frame (the Gleaners' posts, D112), and what was drawn on each. */
  watch: ReadonlySet<number> | null = null;
  readonly seen = new Map<number, SeenItem[]>();
  /** The items drawn last frame (recorded while `debugOn`). */
  debugSnapshot(): DrawnItem[] { return this.dbg; }

  /**
   * `layer`: items on the floor, under the buildings; `overLayer`: items on a bridge, over them,
   * when there are no `lifted` layers to sort them among the volumes (the same layer when omitted);
   * `ground`: where the junctions' passages are laid (the ribbons' layer); `lifted`: where those
   * above the floor, on a bridge or by a building's near face go (the volumes, the plan sprites).
   */
  constructor(layer: Container, private readonly atlas: Atlas, overLayer: Container = layer, ground?: Container, lifted?: { volumes: Container; plan: Container }) {
    this.under = new Group(layer);
    this.over = new Group(overLayer);
    this.junctions = ground ? new JunctionsView(ground, atlas, lifted) : null;
    this.sorted = lifted ? new Sorted(lifted.volumes) : null;
    if (lifted) {
      lifted.volumes.sortableChildren = true;
      lifted.plan.sortableChildren = true;
      this.planBox = new Container({ label: 'items:plan' });
      this.planBox.zIndex = PLAN_Z.items;
      lifted.plan.addChild(this.planBox);
      this.planned = new Group(this.planBox);
      this.spanBox = new Container({ label: 'items:span' });
      this.spanBox.zIndex = PLAN_Z.spans;
      lifted.plan.addChild(this.spanBox);
      this.spanPlan = new Group(this.spanBox);
    } else {
      this.planBox = null;
      this.planned = null;
      this.spanBox = null;
      this.spanPlan = null;
    }
  }

  /** Re-read the ribbon pieces and the junctions' passages (after structural changes; after the buildings view's: the depth keys read its stands); another colony starts afresh. */
  rebuild(sim: Sim): void {
    this.flow.setPieces(buildPieces(sim, beltPiece, DECK_Z));
    this.buried.clear();
    for (const e of sim.ents.map.values()) if (buildingDef(e.def).camo) this.buried.add(e.y * 1024 + e.x);
    this.lift.rebuild(sim);
    this.junctions?.rebuild(sim);
  }

  /**
   * Per frame: `now` is the fractional tick (interpolation), P the view, t its plan-ness,
   * `view` the visible tile rect (items outside are skipped); the shade on the floor (D130: an item
   * sorted among the volumes there takes it) — `shadowAt` the buildings' cast shadows' at an iso
   * world point (buildings-view.ts), `rockAt` the rock's sun shadows' at a ground point (tiles,
   * relief-view.ts `floorShadeAt`).
   */
  update(sim: Sim, now: number, P: Lin, t: number, zoom: number, view: [number, number, number, number], shadowAt?: (wx: number, wy: number) => number, rockAt?: (x: number, y: number) => number): void {
    this.under.begin();
    this.over.begin();
    this.planned?.begin();
    this.spanPlan?.begin();
    const [vx0, vy0, vx1, vy1] = view;
    const iso = 1 - t;
    // Items grow a little when zoomed out so they stay legible; hidden when tiny.
    const px = itemPx(t, zoom);
    const scale = px / IB_PX;
    const show = zoom >= 0.28;
    const sorted = t < ISO_UNTIL ? this.sorted : null, planned = t > PLAN_FROM ? this.planned : null;
    sorted?.begin(P, scale);
    // The shade on the floor over a glyph at iso px (gx, gy) — the buildings' cast shadows over the
    // rock's, as their layers lie — read at its middle and a third of its width either side, so it
    // darkens by steps as a shadow's edge crosses it (D130).
    const half = px * 0.3;
    const floorAt = (gx: number, gy: number): number => {
      const b = shadowAt ? shadowAt(gx, gy) : 0;
      if (!rockAt) return b;
      const [x, y] = isoToTile(gx, gy);
      return 1 - (1 - b) * (1 - rockAt(x, y));
    };
    const shade = (gx: number, gy: number): number => (shadowAt || rockAt ? shadeTint((floorAt(gx - half, gy) + floorAt(gx, gy) + floorAt(gx + half, gy)) / 3) : 0xffffff);
    // The plan copies' box: in view px under the plan's P (its matrix P⁻¹, set when P changes).
    if (this.planBox && planned && this.planP !== P) {
      this.planP = P;
      const I = invert(P);
      this.planBox.setFromMatrix(new Matrix(I.a, I.b, I.c, I.d, 0, 0));
      this.spanBox?.setFromMatrix(new Matrix(I.a, I.b, I.c, I.d, 0, 0));
    }
    if (this.debugOn) this.dbg = [];
    this.seen.clear();
    const watch = this.watch?.size ? this.watch : null;
    let n = 0;
    const draw = (k: FlowItem): void => {
      if (k.x < vx0 - 1 || k.x > vx1 + 2 || k.y < vy0 - 1 || k.y > vy1 + 2) return;
      if (this.buried.size && this.buried.has(Math.floor(k.y) * 1024 + Math.floor(k.x))) return; // under the sand (D109)
      const key = ibKey(ITEM_IDS[k.item]!);
      const fr = this.atlas.frames.get(key);
      const tex = this.atlas.textures.get(key);
      if (!fr || !tex) return;
      const at = this.lift.place(k.x, k.y, AT), lv = at.lv;
      const lifted = lv > 0 || at.shaft;
      const x = P.a * at.x + P.c * at.y, y = P.b * at.x + P.d * at.y;
      // In iso the sticker stands a little proud of the belt, and rides decks, bridges and the land at their height.
      const h = 3 + k.z + lv * LH;
      // Over a skybridge's span (D121: a backed-up line waits on its deck; owner, 2026-10-17: « les
      // objets devraient pouvoir patienter sur le pont ») or a junction's deck (D130: it was drawn over
      // every building): among the volumes between the back and the front of the piece it rides, so
      // what stands in front of the bridge hides it with the bridge; in plan over the plan sprites,
      // the deck's among them.
      const span = !this.sorted ? NaN : k.o === OVER.sky ? this.lift.spanZ(at.x, at.y) : k.o === OVER.junction ? this.lift.junctionZ(at.x, at.y) : NaN;
      const onSpan = !Number.isNaN(span);
      const z = onSpan || !this.sorted ? NaN : this.lift.itemZ(at.x, at.y, lv, lifted, k.d);
      if (onSpan) {
        sorted?.add(tex, ISO_LIN.a * at.x + ISO_LIN.c * at.y, ISO_LIN.b * at.x + ISO_LIN.d * at.y - h, span, 1, 1);
        if (planned) this.spanPlan!.add(fr.page, tex, x, y - (3 + k.z) * iso, scale);
      } else if (k.o && !this.sorted) this.over.add(fr.page, tex, x, y - h * iso, scale);
      else if (Number.isNaN(z)) this.under.add(fr.page, tex, x, y - h * iso, scale);
      else {
        // Among the volumes at its iso px (M carries it with its ribbon); in plan flat, as the plan copies of the ribbons on rock.
        // On the floor in front of a building it takes the cast shadows' shade itself (their layer is under the volumes).
        if (sorted) {
          const gx = ISO_LIN.a * at.x + ISO_LIN.c * at.y, gy = ISO_LIN.b * at.x + ISO_LIN.d * at.y - h;
          sorted.add(tex, gx, gy, z, 1 - FALL_SHRINK * k.d, 1 - k.d * k.d, lifted ? 0xffffff : shade(gx, gy));
        }
        if (planned) (lifted ? planned : this.under).add(fr.page, tex, x, y - (lifted ? 3 + k.z : h) * iso, scale);
      }
      n++;
      if (this.debugOn) this.dbg.push({ id: n, x: k.x, y: k.y, z: k.z + lv * LH, item: k.item, over: !!k.o && !onSpan, sorted: z });
      if (watch) {
        const tile = Math.floor(k.y) * 1024 + Math.floor(k.x);
        if (watch.has(tile)) {
          let l = this.seen.get(tile);
          if (!l) this.seen.set(tile, (l = []));
          l.push({ item: k.item, tx: k.x, ty: k.y, x, y: y - h * iso, px });
        }
      }
    };
    if (show && sim.graph) this.flow.each(sim, now, view, draw);
    this.lift.settle(now);
    this.under.flush();
    this.over.flush();
    this.planned?.flush();
    this.spanPlan?.flush();
    if (this.sorted) {
      if (!sorted) this.sorted.begin(P, scale); // the volumes are gone: nothing among them
      this.sorted.end();
    }
    this.count = n;
  }
}
