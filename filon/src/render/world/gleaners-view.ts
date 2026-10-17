// gleaners-view.ts — the Gleaners as the base sees them (D103, D112; owner, 2026-10-17: « ils
// doivent venir en groupe, aller vers un tapis où il y a des objets en mouvement, et réellement les
// récupérer »; then « les glaneurs apparaissent derrière la machine qui est derrière eux, et l'un
// d'eux semble ne pas réussir à réellement prendre l'objet du tapis. Et ils sont partis vers ma base,
// alors qu'ils devraient partir dans le désert vers là où il n'y a rien »). Render only: the sim holds
// what they take (sim/flow/chain.ts `raidStep`, sim/systems/gleaners.ts); this view shows each raid
// where and when the sim runs it, and the glass over the glazed ribbons.
//
// - **The glass hoods** (`glass` layer: a plane under P, over the items, under the volumes): each
//   glazed ribbon on the floor wears its hood (recipes/gleaners.ts `drawGlassCover`), straight or
//   bent as its belt piece is (`beltPiece`, `beltMatrix`), so what it carries shows through glass.
//   Laid at each new graph. A glazed ribbon up on the rock has none (yet).
// - **Where they come from and go** (`desertBearing`): for each raid, the most open way into the
//   desert from the line — of 24 bearings, the one whose first 14 tiles cross the fewest buildings,
//   ribbons, rock and the claim's land, nearer tiles weighing more, leaning away from the Core. The
//   band comes in along it and goes back out along it, fading into empty sand; it waits on the
//   line's side that faces it. The visits to the glass and the fences come and go the same way.
// - **The raids** — the real thing. Every exposed chain's raid is known at compile (`raidPosts`,
//   `raidAt`). Before it the band glides in, each to its post a tile off the line (1.8 on its near
//   side, so no Gleaner hides its neighbour's cell), and waits, bobbing and swaying. A Gleaner reaches only for the token the sim will take: each frame it asks
//   its chain (`Chain.raidWillTake`, the very rule `raidStep` runs) what its post takes on the line's
//   next step; when that is a token, its long arm goes out over the last `REACH` ticks and its hand
//   follows the token gliding onto the post's tile (`ItemsView.seen`: where that token is drawn this
//   frame), meeting it at the tile's centre as the step comes. On that step the sim takes it — the
//   token is gone from the belt that frame — and here it appears in the hand at the very place it
//   was last drawn, and rides the arm back up. Nothing to take, no reach. When every post has taken
//   (or the raid is over) the band drifts back out into the desert with what it took. Each take is
//   checked as it first shows (`paired`, `onBelt`, `unforeseen`, `unseen`, `late`; FL and the shots
//   read them): foreseen, and its token no longer on the belt.
// - **Depth**: a figure stands among the buildings. In iso its body, arm and what it holds are
//   sprites in the depth-sorted `objects` layer (iso px), keyed on the world/stand.ts scale by the
//   tile it floats over (`figZ`: kind 1 as a building on the floor, a little after one): a building
//   in front of it draws over it, one behind under it; its arm (seen side on, from its near side)
//   and what it holds over its own body, and over a line nearer the viewer it reaches across. The key changes only when it crosses a tile,
//   so the layer re-sorts rarely. Its shadow lies on the floor (`items`, under every volume); in plan
//   a flat copy on `items` (view px). Its glows (`lights`, additive) dim when a building or a cliff
//   stands just in front of it (`hiddenAt`), and a tap's glint on hidden glass is not drawn.
// - **The glass** (`Graph.glean.glass`, every `TAP_EVERY`-th): two or three come to the hood, tap it
//   with their long fingers (a glint on the glass) and leave. **The fences** (`Graph.glean.prowl`,
//   every `PROWL_EVERY`-th): two pace along outside, and leave. A buried ribbon (D109) is floor to them.
// Readable in the dark: the figures are graded with the world, float over a soft shadow, and on the
// additive `lights` layer each carries a halo, its lantern eyes and the glow of what it holds, sized
// so that from afar they still read as small moving lights (`zoom`). Only at night (and a raid's tail
// at dawn); culled to the visible tiles; pooled sprites; nothing by day.
import { CanvasSource, Container, Matrix, Sprite, Texture } from 'pixi.js';
import { BUILDING_KIND, ITEM_IDS, buildingDef } from '@/content/registry';
import { hash32 } from '@/core/hash';
import { CENTER } from '@/sim/constants';
import { GLEAN_WINDOW, RAID_TICKS, stepAt, type Chain } from '@/sim/flow/chain';
import type { Sim } from '@/sim/state';
import { isFloor } from '@/sim/types';
import { tileIndex } from '@/sim/world/grid';
import { ibKey, type Atlas } from '../art/atlas';
import { BELT_PX } from '../art/recipes/belts';
import {
  ARM_H, ARM_ROOT, ARM_TIP, ARM_W, GLEANER_EYE, GLEANER_EYE_REACH, GLEANER_FRAMES, GLEANER_GROUND, GLEANER_H,
  GLEANER_HAND, GLEANER_HEART, GLEANER_SHOULDER_REACH, GLEANER_W,
  drawEyeGlow, drawGlassCover, drawGleaner, drawGleanerArm, drawGleanerShadow, type GleanerPose,
} from '../art/recipes/gleaners';
import { ISO_LIN, invert, isoToView, type Lin } from '../projection';
import { beltMatrix, beltPiece } from './buildings-view';
import { itemPx, type ItemsView, type SeenItem } from './items-view';

/** A raid's arrival (ticks before it starts; each glides in for `GLIDE_IN`, `ARR_STAGGER` after the one before). */
const ARRIVE = 170, GLIDE_IN = 130, ARR_STAGGER = 10;
/** After the last take, how long they stay before leaving; the way back (each `DEP_STAGGER` apart). */
const LINGER = 40, DEPART = 170, DEP_STAGGER = 9;
/** The grab: ticks for the item to ride the arm from where its token was into the hand. */
const GRAB = 12;
/** The arm goes out over the last `REACH` ticks before the token it takes reaches the post's centre. */
const REACH = 8;
/** A raid's whole tail after its start, at most (for culling it in time). */
const TAIL = RAID_TICKS + LINGER + DEPART + 5 * DEP_STAGGER;
/** Where they come from (tiles out along their bearing, at most), how far they go before they are gone, where they stand (from the post's centre), how far apart. */
const OUT = 7.5, AWAY = 11, EDGE = 1, SPREAD = 0.95;
/**
 * On the line's near side (south or east: down the screen in iso) they stand further out: one tile
 * off, each would stand right in front of its neighbour's cell and hide the token it takes; at 1.8
 * the cells show between them, and the long arm reaches across.
 */
const NEAR_EDGE = 1.8;
/** The bearings tried for the way into the desert, and how far each is looked down (tiles). */
const BEARINGS = 24, PROBE = 14;
/** Every TAP_EVERY-th glazed tile gets a visit every TAP_PERIOD ticks; every PROWL_EVERY-th fence-side tile, every PROWL_PERIOD. */
const TAP_EVERY = 5, TAP_PERIOD = 2400, PROWL_EVERY = 6, PROWL_PERIOD = 2400;
/** At most this many figures on screen. */
const MAX_SHOWN = 48;
/** A figure's canvas height on screen (world px) in iso, and in plan. */
const ISO_H = 56, PLAN_H = 30;
/** The textures are drawn at twice their size, for a sharp edge. */
const RES = 2;
/** An item's height over the floor ribbon it rides (iso px: items-view.ts `h` on the floor). */
const ITEM_LIFT = 3;
/** Kinds that stand no higher than a Gleaner's knees: they hide nothing of it. */
const LOW: ReadonlySet<string> = new Set(['belt', 'conduit', 'fence']);

/** One post of a raid: its cell and tile, the tile's centre, where it stands, the side it stands on, where it comes from and goes. */
interface Post { cell: number; tile: number; cx: number; cy: number; sx: number; sy: number; ox: number; oy: number; ax: number; ay: number; fx: number; fy: number }
/** A chain's raid: the chain, its tick in the window, its posts, the tiles it covers (for culling), its way into the desert. */
interface Raid { chain: Chain; at: number; posts: Post[]; box: [number, number, number, number]; bx: number; by: number }
/** A visit to the glass or along a fence: where, the side it stands on, along the line, its way into the desert and how far out, how many, its own phase. */
interface Visit { x: number; y: number; ox: number; oy: number; lx: number; ly: number; bx: number; by: number; out: number; n: number; h: number }
/** A figure's sprites: in iso (in `objects`), in plan (on `items`), its shadow, its glows. */
interface Figure { body: Sprite; arm: Sprite; item: Sprite; pBody: Sprite; pArm: Sprite; pItem: Sprite; shadow: Sprite; halo: Sprite; eyes: Sprite; glow: Sprite }
/** What a post knows across frames: the token it will take (`T`: on that tick's step; −1 none), the last of that token drawn on its tile, the take it showed last. */
interface PostState { T: number; item: number; seen: SeenItem | null; seenT: number; shown: number }

/** One figure to place this frame (the same object, refilled for each). */
interface Pose {
  /** Where it floats over (tiles), the way it faces (tiles), its pose and frame, its alpha. */
  x: number; y: number; fx: number; fy: number; pose: GleanerPose; frame: number; alpha: number;
  /** Its bob (world px up) and sway (radians). */
  bob: number; sway: number;
  /** What it holds (item index, or -1). */
  item: number;
  /** Its long arm (pose 'reach'): out by `ext` (0…1) over tile point (tx, ty), to the view px (vx, vy) of the token there if drawn (else NaN); `grab` ≥ 0: the item riding it back, 0 where the token was … 1 in the hand. */
  tx: number; ty: number; vx: number; vy: number; ext: number; grab: number;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = w * RES; cv.height = h * RES;
  const g = cv.getContext('2d')!;
  g.scale(RES, RES);
  g.lineJoin = 'round'; g.lineCap = 'round';
  draw(g);
  return new Texture({ source: new CanvasSource({ resource: cv, scaleMode: 'linear' }) });
}

const D4: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** Free floor at level 0 (a Gleaner may float there). */
const free = (sim: Sim, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < 1024 && y < 1024 && !sim.grid.occ[tileIndex(x, y)] && sim.grid.level(x, y) === 0 && isFloor(sim.grid.terrain(x, y));
const smooth = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const mod = (a: number, n: number): number => ((a % n) + n) % n;
/**
 * Something tall just in front of tile point (x, y) in iso — a building (not a ribbon, a conduit or a
 * fence) or rock above the floor — hides what floats there: its glows, which the additive lights
 * layer would otherwise lay over that building or cliff, are dimmed to a trace.
 */
function hiddenAt(sim: Sim, x: number, y: number): boolean {
  const i = Math.floor(x), j = Math.floor(y), lv = sim.grid.level(i, j);
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 2]] as const) {
    const tx = i + dx, ty = j + dy;
    if (tx >= 1024 || ty >= 1024) continue;
    if (sim.grid.level(tx, ty) > lv) return true;
    const e = sim.entityAt(tx, ty);
    if (e && !LOW.has(BUILDING_KIND[e.def]!)) return true;
  }
  return false;
}

/** A figure's depth key among the volumes (world/stand.ts scale): by the tile it floats over, kind 1 as a building on the floor, a little after one. */
const figZ = (x: number, y: number): number => 8 * (Math.floor(x) + Math.floor(y)) + 1.25;

/**
 * The most open way into the desert from tile point (x, y): of `BEARINGS` bearings, the one whose
 * first `PROBE` tiles cross the fewest buildings, ribbons and fences (3 each), rock, water or gaps
 * (4) and tiles of the claim's land (1), the nearer weighing more, leaning away from the Core.
 * Returns the bearing (a unit vector, tiles) and how far it runs clear of anything.
 */
export function desertBearing(sim: Sim, x: number, y: number): { bx: number; by: number; clear: number } {
  const cx = x - CENTER - 0.5, cy = y - CENTER - 0.5, cl = Math.hypot(cx, cy) || 1;
  let best = -Infinity, bx = 0, by = -1, clear = 0;
  for (let i = 0; i < BEARINGS; i++) {
    const a = (i / BEARINGS) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let score = 3 * ((dx * cx + dy * cy) / cl), run = 0, open = true;
    for (let d = 1.5; d <= PROBE; d += 1) {
      const tx = Math.floor(x + dx * d), ty = Math.floor(y + dy * d);
      const ok = free(sim, tx, ty);
      let pen = ok ? 0 : tx >= 0 && ty >= 0 && tx < 1024 && ty < 1024 && sim.grid.occ[tileIndex(tx, ty)] ? 3 : 4;
      if (sim.land.covers(tx, ty)) pen += 1;
      score -= pen * (2 - d / PROBE);
      if (open && ok) run = d; else open = false;
    }
    if (score > best) { best = score; bx = dx; by = dy; clear = run; }
  }
  return { bx, by, clear };
}

/** Of the four sides of tile (x, y) that open onto free floor, the one most along (bx, by); null if none. */
function sideToward(sim: Sim, x: number, y: number, bx: number, by: number): readonly [number, number] | null {
  let best: readonly [number, number] | null = null, bd = -Infinity;
  for (const d of D4) {
    if (!free(sim, x + d[0], y + d[1])) continue;
    const dot = d[0] * bx + d[1] * by;
    if (dot > bd) { bd = dot; best = d; }
  }
  return best;
}

export class GleanersView {
  private readonly covers = new Container({ label: 'glass-hoods' });
  /** On `items` (view px): the shadows on the floor, then the plan figures. */
  private readonly floor = new Container({ label: 'gleaner-shadows' });
  private readonly planFigs = new Container({ label: 'gleaners-plan' });
  private readonly glows = new Container({ label: 'gleaner-glows' });
  private readonly coverTex: [Texture, Texture];
  private readonly tex = new Map<GleanerPose, Texture[]>();
  private readonly armTex: Texture;
  private readonly shadowTex: Texture;
  private readonly glowTex: Texture;
  private readonly pool: Figure[] = [];
  /** The glints on the glass being tapped (pooled). */
  private readonly flashes: Sprite[] = [];
  private raids: Raid[] = [];
  private taps: Visit[] = [];
  private prowls: Visit[] = [];
  private version = -1;
  /** Per post (by its tile): the token it will take, the last of it drawn, the take shown. */
  private readonly posts = new Map<number, PostState>();
  /** The post tiles the items view reports on (`ItemsView.watch`). */
  private readonly watched = new Set<number>();
  private readonly F: Pose = { x: 0, y: 0, fx: 0, fy: 0, pose: 'glide', frame: 0, alpha: 1, bob: 0, sway: 0, item: -1, tx: 0, ty: 0, vx: NaN, vy: NaN, ext: 0, grab: -1 };
  /** Last frame's figures: all, on their way in, waiting at a post, reaching, grabbing, carrying something, at the glass, along a fence (FL, the shots). */
  shown = 0;
  arriving = 0;
  waiting = 0;
  reaching = 0;
  grabbing = 0;
  carrying = 0;
  tapping = 0;
  prowling = 0;
  /** Glints on the glass this frame (a tap). */
  flashing = 0;
  /**
   * The takes shown so far, as each first shows: `paired` (foreseen, and its token gone from the
   * belt), `onBelt` (a token of that item still drawn at the post's centre: a grab without its
   * token), `unforeseen` (a frame had foreseen another item for that step), `unseen` (shown on its
   * step, yet no frame foresaw it), `late` (first shown more than two ticks after it was made: off
   * screen then, or the game jumped many ticks at once — nothing to check).
   */
  paired = 0;
  onBelt = 0;
  unforeseen = 0;
  unseen = 0;
  late = 0;
  /** The last raid placed this frame: its middle post (tiles), its start tick, how many out, its way into the desert (the shots aim at it). */
  raidAt_: { x: number; y: number; at: number; out: number; bx: number; by: number } | null = null;
  /** While `debugOn` (the shots): every figure placed last frame — where, its pose, its arm's reach and grab. */
  debugOn = false;
  poses_: Array<{ x: number; y: number; pose: GleanerPose; ext: number; grab: number; item: number }> = [];
  /** Where the last tapper and prowler placed this frame stand (tiles) and their visit's phase. */
  tapAt_: [number, number, number] | null = null;
  prowlAt_: [number, number, number] | null = null;

  constructor(glassLayer: Container, itemsLayer: Container, lightsLayer: Container, private readonly objects: Container, private readonly atlas: Atlas, private readonly items: ItemsView) {
    glassLayer.addChild(this.covers);
    itemsLayer.addChild(this.floor, this.planFigs);
    lightsLayer.addChild(this.glows);
    this.glows.blendMode = 'add'; // glows add light: their black edges add nothing
    this.coverTex = [canvasTexture(BELT_PX, BELT_PX, (g) => drawGlassCover(g, false)), canvasTexture(BELT_PX, BELT_PX, (g) => drawGlassCover(g, true))];
    for (const pose of ['glide', 'carry', 'reach'] as const) {
      this.tex.set(pose, Array.from({ length: GLEANER_FRAMES }, (_, f) => canvasTexture(GLEANER_W, GLEANER_H, (g) => drawGleaner(g, f, pose))));
    }
    this.armTex = canvasTexture(ARM_W, ARM_H, (g) => drawGleanerArm(g));
    this.shadowTex = canvasTexture(32, 16, (g) => drawGleanerShadow(g));
    this.glowTex = canvasTexture(32, 32, (g) => drawEyeGlow(g, '#ffffff'));
  }

  /** At each new graph: the hoods over the glazed ribbons; the raids, the glass and the fences to visit, each with its way into the desert. */
  rebuild(sim: Sim): void {
    sim.ensureCompiled();
    const g = sim.graph;
    if (g.version === this.version) return;
    this.version = g.version;
    for (const c of this.covers.removeChildren()) c.destroy();
    for (const e of sim.ents.sorted()) {
      if (!buildingDef(e.def).glazed || e.builtAt !== 0 || sim.grid.level(e.x, e.y) > 0) continue;
      const p = beltPiece(sim, e);
      const s = new Sprite(this.coverTex[p.corner ? 1 : 0]);
      s.setFromMatrix(beltMatrix(e.x, e.y, p.rot, p.mirror).append(new Matrix(1 / RES, 0, 0, 1 / RES, 0, 0))); // its texture px (×RES) first
      this.covers.addChild(s);
    }
    // Every raid: its way into the desert from its middle post; the band waits on the line's side
    // facing it, each post there if it can (else on its own side most along it).
    this.raids = [];
    this.watched.clear();
    for (const c of g.chains) {
      const n = c.raidPosts.length;
      if (!n) continue;
      const midTile = c.tiles[c.raidPosts[n >> 1]!]!, mx = midTile & 1023, my = midTile >> 10;
      const { bx, by, clear } = desertBearing(sim, mx + 0.5, my + 0.5);
      const side = sideToward(sim, mx, my, bx, by) ?? D4[0]!;
      const px = -by, py = bx; // across the way out
      const out = Math.max(2.5, Math.min(OUT, clear)), away = Math.max(out, Math.min(AWAY, clear + 1.5));
      const gx = mx + 0.5 + side[0] * EDGE + bx * out, gy = my + 0.5 + side[1] * EDGE + by * out;
      const posts: Post[] = [];
      let x0 = gx, y0 = gy, x1 = gx, y1 = gy;
      for (let p = 0; p < n; p++) {
        const cell = c.raidPosts[p]!, tile = c.tiles[cell]!, tx = tile & 1023, ty = tile >> 10, cx = tx + 0.5, cy = ty + 0.5;
        const own = free(sim, tx + side[0], ty + side[1]) ? side : sideToward(sim, tx, ty, bx, by) ?? side;
        const off = p - (n - 1) / 2, wob = ((hash32(tile, 0x51) % 7) - 3) * 0.12;
        const edge = own[0] + own[1] > 0 && free(sim, tx + 2 * own[0], ty + 2 * own[1]) ? NEAR_EDGE : EDGE;
        const sx = cx + own[0] * edge, sy = cy + own[1] * edge;
        const post: Post = {
          cell, tile, cx, cy, sx, sy, ox: own[0], oy: own[1],
          ax: gx + px * (off * SPREAD + wob), ay: gy + py * (off * SPREAD + wob),
          fx: sx + bx * away + px * off * SPREAD * 0.6, fy: sy + by * away + py * off * SPREAD * 0.6,
        };
        posts.push(post);
        this.watched.add(tile);
        for (const [x, y] of [[sx, sy], [post.ax, post.ay], [post.fx, post.fy]] as const) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      this.raids.push({ chain: c, at: c.raidAt, posts, box: [x0, y0, x1, y1], bx, by });
    }
    for (const t of [...this.posts.keys()]) if (!this.watched.has(t)) this.posts.delete(t);
    this.items.watch = this.watched;
    this.taps = [];
    // Every TAP_EVERY-th glazed tile beside open floor (and every PROWL_EVERY-th by a fence), in the
    // lists' order: spread along each line, and never none on a short one, as a draw could leave it.
    for (const [k, tile] of g.glean.glass.entries()) {
      if (k % TAP_EVERY !== TAP_EVERY >> 1) continue;
      const x = tile & 1023, y = tile >> 10, b = desertBearing(sim, x + 0.5, y + 0.5);
      const side = sideToward(sim, x, y, b.bx, b.by);
      if (side) this.taps.push({ x: x + 0.5, y: y + 0.5, ox: side[0], oy: side[1], lx: -side[1], ly: side[0], bx: b.bx, by: b.by, out: Math.max(2.5, Math.min(OUT, b.clear)), n: 2 + (hash32(tile, 0x7aa) % 2), h: hash32(tile, 0x7a8) });
    }
    this.prowls = [];
    for (const [k, tile] of g.glean.prowl.entries()) {
      if (k % PROWL_EVERY !== PROWL_EVERY >> 1) continue;
      const x = tile & 1023, y = tile >> 10;
      // It floats by the fence, its back to it; it comes and goes along the open way.
      const f = D4.find(([dx, dy]) => { const e = sim.entityAt(x + dx, y + dy); return !!e && BUILDING_KIND[e.def] === 'fence'; });
      if (!f) continue;
      const b = desertBearing(sim, x + 0.5, y + 0.5);
      this.prowls.push({ x: x + 0.5, y: y + 0.5, ox: -f[0], oy: -f[1], lx: f[1], ly: -f[0], bx: b.bx, by: b.by, out: Math.max(2.5, Math.min(OUT, b.clear)), n: 2, h: hash32(tile, 0x9f1) });
    }
  }

  /** Per frame, after the items view (its `seen`): the night's figures where they are now (`simTicks`: interpolated game ticks; `zoom`: the camera's). */
  update(sim: Sim, P: Lin, te: number, simTicks: number, tiles: readonly [number, number, number, number], zoom: number): void {
    if (sim.graph && sim.graph.version !== this.version) this.rebuild(sim);
    const now = simTicks, tick = Math.floor(now);
    let n = 0, flashes = 0;
    this.arriving = this.waiting = this.reaching = this.grabbing = this.carrying = this.tapping = this.prowling = 0;
    this.raidAt_ = this.tapAt_ = this.prowlAt_ = null;
    if (this.debugOn) this.poses_ = [];
    // Nothing by day: not out now, no raid's arrival begun, no raid's tail left.
    if (sim.gleanNight(tick) || sim.gleanNight(tick + ARRIVE) || sim.gleanNight(tick - TAIL)) {
      const [x0, y0, x1, y1] = tiles;
      const fig = this.placer(sim, P, te, zoom);
      const place = (): void => {
        if (n >= MAX_SHOWN || !fig(n, this.F)) return;
        n++;
        if (this.debugOn) { const F = this.F; this.poses_.push({ x: F.x, y: F.y, pose: F.pose, ext: F.ext, grab: F.grab, item: F.item }); }
      };
      // The sim's last takes, by tile: [tick, item, …].
      const took = new Map<number, number[]>();
      const rec = sim.gleaners.recent;
      for (let i = 0; i + 2 < rec.length; i += 3) {
        let l = took.get(rec[i]!);
        if (!l) took.set(rec[i]!, (l = []));
        l.push(rec[i + 2]!, rec[i + 1]!);
      }
      const base = tick - mod(tick, GLEAN_WINDOW);
      for (const r of this.raids) {
        if (n >= MAX_SHOWN) break;
        const [bx0, by0, bx1, by1] = r.box;
        if (bx1 < x0 - 2 || bx0 > x1 + 2 || by1 < y0 - 2 || by0 > y1 + 2) continue;
        for (const b of [base - GLEAN_WINDOW, base, base + GLEAN_WINDOW]) {
          const t0 = b + r.at;
          if (now < t0 - ARRIVE || now > t0 + TAIL) continue;
          if (!sim.gleanNight(t0) && !sim.gleanNight(t0 + RAID_TICKS)) continue;
          const before = n;
          this.raid(sim, r, t0, now, took, place);
          const mid = r.posts[r.posts.length >> 1]!;
          if (n > before) this.raidAt_ = { x: mid.cx, y: mid.cy, at: t0, out: n - before, bx: r.bx, by: r.by };
        }
      }
      if (sim.gleanNight(tick)) {
        const inView = (x: number, y: number): boolean => x >= x0 - 9 && y >= y0 - 9 && x <= x1 + 9 && y <= y1 + 9;
        for (const v of this.taps) {
          if (n >= MAX_SHOWN) break;
          if (!inView(v.x, v.y)) continue;
          const before = n;
          flashes = this.tapAt(sim, place, v, now, P, zoom, flashes);
          if (n > before) { this.tapping += n - before; this.tapAt_ = [v.x, v.y, mod(now + v.h, TAP_PERIOD)]; }
        }
        for (const v of this.prowls) {
          if (n >= MAX_SHOWN) break;
          if (!inView(v.x, v.y)) continue;
          const before = n;
          this.prowlAt(place, v, now);
          if (n > before) { this.prowling += n - before; this.prowlAt_ = [v.x, v.y, mod(now + v.h, PROWL_PERIOD)]; }
        }
      }
    }
    for (let i = n; i < this.pool.length; i++) this.hide(this.pool[i]!);
    for (let i = flashes; i < this.flashes.length; i++) this.flashes[i]!.visible = false;
    this.shown = n;
    this.flashing = flashes;
  }

  /**
   * One raid started at `t0`, at render time `now` (`took`: the sim's last takes by tile): the band
   * gliding in, waiting at its posts (an arm out only for the token its post will take), each take as
   * the sim made it (the token from the belt into the hand), and the band gliding away with it.
   */
  private raid(sim: Sim, r: Raid, t0: number, now: number, took: ReadonlyMap<number, readonly number[]>, place: () => void): void {
    const posts = r.posts, size = posts.length, end = t0 + RAID_TICKS, simTick = sim.tick;
    // Each post's take this raid (its tick and item), once the sim has made it.
    const takes: Array<[number, number] | null> = posts.map((p) => {
      const l = took.get(p.tile);
      if (l) for (let i = 0; i < l.length; i += 2) if (l[i]! >= t0 && l[i]! < end && l[i]! < simTick) return [l[i]!, l[i + 1]!];
      return null;
    });
    // They leave together once each has taken (a moment after the last take), or when the raid is over.
    let all = true, last = t0;
    for (const t of takes) if (t) last = Math.max(last, t[0]); else all = false;
    const leave = all ? last + LINGER : end;
    const F = this.F, c = r.chain;
    // The line's next step from the sim's tick on: the one each post's coming take is made on.
    let T = -1;
    for (let d = 0; d <= 64 && T < 0; d++) if (stepAt(c.perMin, simTick + d)) T = simTick + d;
    const night = T >= 0 && sim.gleanNight(T);
    for (let p = 0; p < size; p++) {
      const post = posts[p]!, take = takes[p] ?? null, st = this.postState(post.tile);
      // What is drawn on its tile this frame (the items view ran first).
      const seen = this.items.seen.get(post.tile);
      if (take && st.shown !== take[0]) this.check(st, post, take, seen, now);
      if (!take) {
        // Foresee its take on the line's next step (the sim's own rule), and keep where its token is drawn.
        const item = T >= 0 ? c.raidWillTake(p, T, night) : -1;
        st.T = item >= 0 ? T : -1;
        st.item = item;
        const mine = item >= 0 ? seen?.find((s) => s.item === item) : undefined;
        if (mine) { st.seen = mine; st.seenT = T; }
      }
      const a0 = t0 - ARRIVE + p * ARR_STAGGER, a1 = a0 + GLIDE_IN;
      const l0 = leave + ((p * 3) % size) * DEP_STAGGER;
      if (now < a0 || now > l0 + DEPART) continue;
      F.frame = Math.floor(now * 0.22 + p * 1.3);
      F.bob = 2.2 + Math.sin(now * 0.11 + p * 1.7) * 1.8;
      F.sway = Math.sin(now * 0.07 + p * 2.3) * 0.05;
      F.item = -1; F.ext = 0; F.grab = -1; F.alpha = 1; F.tx = post.cx; F.ty = post.cy; F.vx = F.vy = NaN;
      if (now < a1) {
        // Out of the desert to its post, fading in.
        const k = (now - a0) / GLIDE_IN, m = smooth(k);
        F.x = post.ax + (post.sx - post.ax) * m; F.y = post.ay + (post.sy - post.ay) * m;
        F.fx = post.sx - post.ax; F.fy = post.sy - post.ay;
        F.pose = 'glide'; F.alpha = Math.min(1, k / 0.2);
        F.sway += (1 - m) * 0.08;
        place();
        this.arriving++;
        continue;
      }
      if (now < l0) {
        // At its post, facing the line.
        F.x = post.sx; F.y = post.sy; F.fx = -post.ox; F.fy = -post.oy;
        if (take) {
          // Taken: in its hand from the very place its token was last drawn, riding the arm back up.
          const g = Math.max(0, now - (take[0] + 1));
          F.item = take[1];
          if (st.seen && st.seen.item === take[1] && st.seenT === take[0]) { F.vx = st.seen.x; F.vy = st.seen.y; }
          if (g < GRAB) { F.pose = 'reach'; F.ext = 1; F.grab = smooth(g / GRAB); this.grabbing++; }
          else { F.pose = 'carry'; this.carrying++; }
          place();
          continue;
        }
        // Its token coming: the arm out over the last ticks, the hand on the token as it glides in.
        F.pose = 'glide';
        if (st.T >= 0) {
          const ext = smooth((now - (st.T + 1 - REACH)) / REACH);
          const mine = seen?.find((s) => s.item === st.item);
          if (mine) { F.vx = mine.x; F.vy = mine.y; }
          if (ext > 0.04) { F.pose = 'reach'; F.ext = ext; this.reaching++; }
        }
        place();
        this.waiting++;
        continue;
      }
      // Away into the desert, slowly then faster, fading out at the end; what it took held up, glowing.
      const k = (now - l0) / DEPART, m = k * k * (3 - 2 * k) * 0.6 + k * 0.4;
      F.x = post.sx + (post.fx - post.sx) * m; F.y = post.sy + (post.fy - post.sy) * m;
      F.fx = post.fx - post.sx; F.fy = post.fy - post.sy;
      F.alpha = Math.min(1, (1 - k) / 0.35);
      if (take) { F.pose = 'carry'; F.item = take[1]; this.carrying++; } else F.pose = 'glide';
      place();
    }
  }

  /** For FL and the shots: each raid's middle post, its posts' stands (tiles), the side they wait on and its way into the desert. */
  describe_(): Array<{ x: number; y: number; at: number; stands: Array<[number, number]>; side: [number, number]; bearing: [number, number] }> {
    return this.raids.map((r) => {
      const mid = r.posts[r.posts.length >> 1]!;
      return { x: mid.cx - 0.5, y: mid.cy - 0.5, at: r.at, stands: r.posts.map((p) => [p.sx, p.sy] as [number, number]), side: [mid.ox, mid.oy], bearing: [r.bx, r.by] };
    });
  }

  /** For the shots: the takes foreseen now (post tile, the tick of the step, the item). */
  foreseen_(): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    for (const [tile, st] of this.posts) if (st.T >= 0) out.push([tile, st.T, st.item]);
    return out;
  }

  private postState(tile: number): PostState {
    let st = this.posts.get(tile);
    if (!st) this.posts.set(tile, (st = { T: -1, item: -1, seen: null, seenT: -1, shown: -1 }));
    return st;
  }

  /** A take showing for the first time: was it foreseen, and is its token off the belt this frame? */
  private check(st: PostState, post: Post, take: readonly [number, number], seen: readonly SeenItem[] | undefined, now: number): void {
    st.shown = take[0];
    if (now - (take[0] + 1) > 2) { this.late++; return; }
    const foreseen = st.T === take[0];
    if (!foreseen) this.unseen++;
    else if (st.item !== take[1]) this.unforeseen++;
    const still = !!seen?.some((s) => s.item === take[1] && Math.abs(s.tx - post.cx) < 0.35 && Math.abs(s.ty - post.cy) < 0.35);
    if (still) this.onBelt++;
    else if (foreseen && st.item === take[1]) this.paired++;
  }

  /** A visit to the glass by two or three: in from the desert to the hood, two taps each (a glint each), back out. Returns the glints used. */
  private tapAt(sim: Sim, place: () => void, v: Visit, now: number, P: Lin, zoom: number, flashes: number): number {
    const F = this.F;
    for (let m = 0; m < v.n; m++) {
      const ph = mod(now + v.h, TAP_PERIOD) - m * 14;
      if (ph < 0 || ph >= 170) continue;
      const a = (m - (v.n - 1) / 2) * 0.95;
      const tx = v.x + v.lx * a, ty = v.y + v.ly * a;
      const ex = tx + v.ox * EDGE, ey = ty + v.oy * EDGE, ox = ex + v.bx * v.out + v.lx * a * 0.5, oy = ey + v.by * v.out + v.ly * a * 0.5;
      F.frame = Math.floor(now * 0.22 + m); F.bob = 2.2 + Math.sin(now * 0.11 + m * 1.9) * 1.8; F.sway = Math.sin(now * 0.07 + m) * 0.05;
      F.item = -1; F.grab = -1; F.ext = 0; F.tx = tx; F.ty = ty; F.vx = F.vy = NaN; F.alpha = 1; F.pose = 'glide';
      if (ph < 70) {
        const k = smooth(ph / 70);
        F.x = ox + (ex - ox) * k; F.y = oy + (ey - oy) * k; F.fx = ex - ox; F.fy = ey - oy; F.alpha = Math.min(1, ph / 12);
      } else if (ph < 110) {
        // Two taps: the long arm out onto the glass, a glint where the fingers touch it.
        const q = (ph - 70) % 20;
        F.x = ex; F.y = ey; F.fx = -v.ox; F.fy = -v.oy;
        F.pose = 'reach'; F.ext = q < 10 ? 0.55 + 0.45 * smooth(q / 6) : 0.55;
        if (q >= 5 && q < 10 && !hiddenAt(sim, tx, ty)) flashes = this.flash(flashes, P, tx + v.ox * 0.15, ty + v.oy * 0.15, zoom);
      } else {
        const k = smooth((ph - 110) / 60);
        F.x = ex + (ox - ex) * k; F.y = ey + (oy - ey) * k; F.fx = ox - ex; F.fy = oy - ey; F.alpha = Math.min(1, (1 - (ph - 110) / 60) / 0.3);
      }
      place();
    }
    return flashes;
  }

  /** Two pacing outside a fence: in from the desert, a few turns along it (a reach at the mesh now and then), and back out. */
  private prowlAt(place: () => void, v: Visit, now: number): void {
    const F = this.F;
    for (let m = 0; m < v.n; m++) {
      const ph = mod(now + v.h, PROWL_PERIOD) - m * 25;
      if (ph < 0 || ph >= 260) continue;
      const off = (m - (v.n - 1) / 2) * 1.1;
      const sx = v.x + v.lx * off + v.ox * 0.2, sy = v.y + v.ly * off + v.oy * 0.2;
      const ox = sx + v.bx * v.out, oy = sy + v.by * v.out;
      F.frame = Math.floor(now * 0.22 + m); F.bob = 2.2 + Math.sin(now * 0.11 + m * 2.1) * 1.8; F.sway = Math.sin(now * 0.07 + m) * 0.05;
      F.item = -1; F.grab = -1; F.ext = 0; F.vx = F.vy = NaN; F.alpha = 1; F.pose = 'glide';
      if (ph < 70) {
        const k = smooth(ph / 70);
        F.x = ox + (sx - ox) * k; F.y = oy + (sy - oy) * k; F.fx = sx - ox; F.fy = sy - oy; F.alpha = Math.min(1, ph / 12);
      } else if (ph < 200) {
        const w = ((ph - 70) / 130) * Math.PI * 2, a = Math.sin(w + m * 2) * 1.4, way = Math.cos(w + m * 2) < 0 ? -1 : 1;
        F.x = sx + v.lx * a; F.y = sy + v.ly * a; F.fx = v.lx * way; F.fy = v.ly * way;
        if (ph % 50 < 10) { F.pose = 'reach'; F.ext = 0.45; F.fx = -v.ox; F.fy = -v.oy; F.tx = F.x - v.ox * 0.6; F.ty = F.y - v.oy * 0.6; }
      } else {
        const k = smooth((ph - 200) / 60);
        F.x = sx + (ox - sx) * k; F.y = sy + (oy - sy) * k; F.fx = ox - sx; F.fy = oy - sy; F.alpha = Math.min(1, (1 - (ph - 200) / 60) / 0.3);
      }
      place();
    }
  }

  /**
   * This frame's figure placer (the projection, the morph, the zoom fixed): places figure `i` as `F`
   * says — in iso among the volumes (iso px, its depth key), in plan flat on `items` (view px), its
   * shadow on the floor and its glows (view px) — and returns false if it is not shown.
   */
  private placer(sim: Sim, P: Lin, te: number, zoom: number): (i: number, F: Pose) => boolean {
    const isoOn = te < 0.6, planOn = te > 0.3;
    const planA = te >= 1 ? 1 : te <= 0.3 ? 0 : (te - 0.3) / 0.7;
    const V = isoToView(P), Vi = invert(V);
    const kIso = ISO_H / GLEANER_H, kPlan = (ISO_H * (1 - te) + PLAN_H * te) / GLEANER_H; // world px a canvas px
    // Glows keep a size on screen from afar (world px ÷ zoom): small moving lights.
    const z = Math.max(0.05, zoom);
    const haloW = Math.max(80, 30 / z), eyesW = Math.max(18, 9 / z), itemW = Math.max(26, 11 / z);
    const px = itemPx(te, zoom);
    const [gx0, gy0] = GLEANER_GROUND;
    const toIso = (x: number, y: number): [number, number] => [Vi.a * x + Vi.c * y, Vi.b * x + Vi.d * y];
    const toView = (p: readonly [number, number]): [number, number] => [V.a * p[0] + V.c * p[1], V.b * p[0] + V.d * p[1]];
    /** Lays one set of sprites (iso or plan) in projection L at k world px a canvas px; returns its eyes, heart and what it holds (L px). */
    const lay = (L: Lin, k: number, body: Sprite, arm: Sprite, item: Sprite, F: Pose, iso: boolean, key: number): { eye: [number, number]; heart: [number, number]; held: [number, number] | null } => {
      const gx = L.a * F.x + L.c * F.y, gy = L.b * F.x + L.d * F.y;
      const flip = L.a * F.fx + L.c * F.fy < 0 ? -1 : 1; // facing the way it goes, on screen
      const cs = Math.cos(F.sway), sn = Math.sin(F.sway), py = gy - F.bob;
      const at = (p: readonly [number, number]): [number, number] => {
        const dx = (p[0] - gx0) * k * flip, dy = (p[1] - gy0) * k;
        return [gx + dx * cs - dy * sn, py + dx * sn + dy * cs];
      };
      const s = k / RES;
      body.texture = this.tex.get(F.pose)![((F.frame % GLEANER_FRAMES) + GLEANER_FRAMES) % GLEANER_FRAMES]!;
      body.position.set(gx, py);
      body.scale.set(s * flip, s);
      body.rotation = F.sway;
      body.alpha = F.alpha;
      body.visible = true;
      if (iso) body.zIndex = key;
      // The line it reaches over sorts in front of it when nearer the viewer: so do the arm and the item there.
      const line = figZ(F.tx, F.ty);
      // The token's place (L px): where it is drawn (view px) when known, else over the cell's centre.
      const cell = (): [number, number] => {
        if (!Number.isNaN(F.vx)) return iso ? toIso(F.vx, F.vy) : [F.vx, F.vy];
        return [L.a * F.tx + L.c * F.ty, L.b * F.tx + L.d * F.ty - ITEM_LIFT * (iso ? 1 : 1 - te)];
      };
      let tip: [number, number] | null = null;
      if (F.pose === 'reach' && F.ext > 0) {
        const [sx, sy] = at(GLEANER_SHOULDER_REACH);
        const [cx, cy] = cell();
        tip = [sx + (cx - sx) * F.ext, sy + (cy - sy) * F.ext];
        if (F.grab >= 0) {
          const [hx, hy] = at(GLEANER_HAND);
          tip = [cx + (hx - cx) * F.grab, cy + (hy - cy) * F.grab - Math.sin(F.grab * Math.PI) * 5];
        }
        const dx = tip[0] - sx, dy = tip[1] - sy, len = Math.hypot(dx, dy);
        arm.visible = len > 3;
        arm.position.set(sx, sy);
        arm.rotation = Math.atan2(dy, dx);
        arm.scale.set(len / ((ARM_TIP[0] - ARM_ROOT[0]) * RES), dx < 0 ? -s : s);
        arm.alpha = F.alpha;
        // Seen side on, the arm comes out of its near side: over its own body, and out over a line nearer the viewer.
        if (iso) arm.zIndex = Math.max(line, key) + 0.05;
      } else arm.visible = false;
      let held: [number, number] | null = null;
      if (F.item >= 0) {
        const tex = this.atlas.textures.get(ibKey(ITEM_IDS[F.item]!));
        if (tex) item.texture = tex;
        held = tip && F.grab >= 0 ? tip : at(GLEANER_HAND);
        item.position.set(held[0], held[1]);
        item.width = item.height = px;
        item.alpha = F.alpha;
        item.visible = !!tex;
        if (iso) item.zIndex = (F.grab >= 0 && F.grab < 0.5 ? Math.max(line, key) : key) + 0.1;
      } else item.visible = false;
      return { eye: at(F.pose === 'reach' ? GLEANER_EYE_REACH : GLEANER_EYE), heart: at(GLEANER_HEART), held };
    };
    return (i, F) => {
      if (F.alpha <= 0.01) return false;
      const f = this.figure(i);
      const key = figZ(F.x, F.y);
      let eye: [number, number] = [0, 0], heart: [number, number] = [0, 0], held: [number, number] | null = null;
      if (isoOn) {
        const r = lay(ISO_LIN, kIso, f.body, f.arm, f.item, F, true, key);
        // The glows are in view px: the iso points through M.
        eye = toView(r.eye); heart = toView(r.heart); held = r.held ? toView(r.held) : null;
      } else f.body.visible = f.arm.visible = f.item.visible = false;
      if (planOn) {
        const r = lay(P, kPlan, f.pBody, f.pArm, f.pItem, F, false, key);
        for (const sp of [f.pBody, f.pArm, f.pItem]) sp.alpha *= planA;
        if (!isoOn || te > 0.45) { eye = r.eye; heart = r.heart; held = r.held; }
      } else f.pBody.visible = f.pArm.visible = f.pItem.visible = false;
      f.shadow.position.set(P.a * F.x + P.c * F.y, P.b * F.x + P.d * F.y);
      f.shadow.width = 26 * kPlan * (1 - F.bob * 0.03);
      f.shadow.height = f.shadow.width * (0.5 + 0.35 * te);
      f.shadow.alpha = F.alpha * 0.85;
      f.shadow.visible = true;
      // Behind a building, its lantern eyes barely show through.
      const dim = isoOn && te < 0.45 && hiddenAt(sim, F.x, F.y) ? 0.15 : 1;
      f.halo.position.set(heart[0], heart[1]);
      f.halo.width = f.halo.height = haloW;
      f.halo.alpha = 0.28 * F.alpha * dim;
      f.halo.visible = true;
      f.eyes.position.set(eye[0], eye[1]);
      f.eyes.width = f.eyes.height = eyesW;
      f.eyes.alpha = F.alpha * dim;
      f.eyes.visible = true;
      if (held) {
        f.glow.position.set(held[0], held[1]);
        f.glow.width = f.glow.height = itemW;
        f.glow.alpha = 0.6 * F.alpha * dim * (F.grab >= 0 ? 0.5 + 0.5 * F.grab : 1);
        f.glow.visible = true;
      } else f.glow.visible = false;
      return true;
    };
  }

  private figure(i: number): Figure {
    let f = this.pool[i];
    if (f) return f;
    const mkBody = (): Sprite => { const s = new Sprite(this.tex.get('glide')![0]!); s.anchor.set(GLEANER_GROUND[0] / GLEANER_W, GLEANER_GROUND[1] / GLEANER_H); return s; };
    const mkArm = (): Sprite => { const s = new Sprite(this.armTex); s.anchor.set(ARM_ROOT[0] / ARM_W, ARM_ROOT[1] / ARM_H); return s; };
    const mkItem = (): Sprite => { const s = new Sprite(Texture.WHITE); s.anchor.set(0.5); return s; };
    const shadow = new Sprite(this.shadowTex);
    shadow.anchor.set(0.5);
    const mk = (tint: number): Sprite => { const s = new Sprite(this.glowTex); s.anchor.set(0.5); s.tint = tint; return s; };
    f = {
      body: mkBody(), arm: mkArm(), item: mkItem(), pBody: mkBody(), pArm: mkArm(), pItem: mkItem(), shadow,
      halo: mk(0x9fd8e8), eyes: mk(0xbff9ff), glow: mk(0xffe0a8),
    };
    this.hide(f);
    this.objects.addChild(f.body, f.arm, f.item);
    this.floor.addChild(f.shadow);
    this.planFigs.addChild(f.pBody, f.pArm, f.pItem);
    this.glows.addChild(f.halo, f.eyes, f.glow);
    this.pool.push(f);
    return f;
  }

  private hide(f: Figure): void {
    f.body.visible = f.arm.visible = f.item.visible = f.pBody.visible = f.pArm.visible = f.pItem.visible = false;
    f.shadow.visible = f.halo.visible = f.eyes.visible = f.glow.visible = false;
  }

  /** A glint on the glass where a Gleaner taps it; the glints used. */
  private flash(i: number, P: Lin, x: number, y: number, zoom: number): number {
    let s = this.flashes[i];
    if (!s) { s = new Sprite(this.glowTex); s.anchor.set(0.5); s.tint = 0xe8fbff; this.glows.addChild(s); this.flashes.push(s); }
    s.position.set(P.a * x + P.c * y, P.b * x + P.d * y);
    s.width = s.height = Math.max(28, 11 / Math.max(0.05, zoom));
    s.alpha = 0.9;
    s.visible = true;
    return i + 1;
  }
}
