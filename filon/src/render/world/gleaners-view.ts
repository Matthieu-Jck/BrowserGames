// gleaners-view.ts — the Gleaners as the base sees them (D103, D112). Render only: the sim holds
// what they take (sim/flow/chain.ts `raidStep`, sim/systems/gleaners.ts); this view shows each raid
// where and when the sim runs it, and the glass over the glazed ribbons. The owner, 2026-10-17: « ils
// doivent venir en groupe, aller vers un tapis où il y a des objets en mouvement, et réellement les
// récupérer »; « l'un d'eux semble ne pas réussir à réellement prendre l'objet du tapis. Et ils sont
// partis vers ma base »; then « actuellement, les glaneurs volent au-dessus du sable, mais j'aimerais
// qu'ils rampent dedans plutôt ».
//
// - **The glass hoods** (`glass` layer: a plane under P, over the items, under the volumes): each
//   glazed ribbon on the floor wears its hood (recipes/gleaners.ts `drawGlassCover`), straight or
//   bent as its belt piece is (`beltPiece`, `beltMatrix`). Laid at each new graph; none on rock yet.
// - **Under the sand**: a Gleaner travels below the surface. What shows is laid flat on the ground
//   (`ground`, on the glass plane, tile units): the bulge it pushes along (`drawBulge`) and the
//   furrow behind it, closing — `TRAIL` marks at its own past places (`drawFurrow`), each fainter and
//   narrower with age; grains thrown up ahead of it (iso, among the volumes); and at night, now and
//   then, its hood and lantern eyes breaking the surface (`GLEANER_PEEK`). Its way is a line with a
//   slight weave (`Path`), clipped to free floor (`clipTo`): sand and floor only, never rock, a cliff,
//   water, a gap or anything built.
// - **Where they come from and go** (`desertBearing`): for each raid, the most open way into the
//   desert from the line — of 24 bearings, the one whose first 14 tiles cross the fewest buildings,
//   ribbons, rock and the claim's land, the nearer weighing more, leaning away from the Core. The band
//   comes in under the sand along it and goes back out along it; it waits on the line's side facing it.
// - **The raids** — the real thing. Every exposed chain's raid is known at compile (`raidPosts`,
//   `raidAt`). Before it each of the band travels in under the sand to its post a tile off the line
//   (1.8 on its near side, so no Gleaner hides its neighbour's cell), and rises out of it — the body
//   cut at the sand line (`cropTex`), a heap of sand pushed up round it (`drawSandCollar`) hiding the
//   cut, grains sliding off its shoulders — to wait half-buried (`GLEANER_CUT`: hood, shoulders, sack
//   and arm), swaying. It reaches only for the token the sim will take: each frame it asks its chain
//   (`Chain.raidWillTake`, the very rule `raidStep` runs) what its post takes on the line's next step;
//   for a token, its long arm goes out over the last `REACH` ticks, the hand following that token where
//   the items view draws it (`ItemsView.seen`), meeting it as the step comes. On that step the sim takes
//   it — the token is gone from the belt that frame — and here it appears in the hand where it was last
//   drawn, and rides the arm up. When every post has taken (or the raid is over) each sinks back into
//   the sand with what it took, its glow dimming as the hand goes under, and its furrow heads away into
//   the empty desert. Each take is checked as it first shows (`paired`, `onBelt`, `unforeseen`,
//   `unseen`, `late`; FL and the shots read them).
// - **The glass** (`Graph.glean.glass`, every `TAP_EVERY`-th): two or three come under the sand, pop up
//   beside the hood, tap it with their long fingers (a glint on the glass), sink and go. **The fences**
//   (`Graph.glean.prowl`, every `PROWL_EVERY`-th): two furrows circle outside, and go.
// - **Depth**: in iso a risen Gleaner's body, heap, long arm and what it holds are sprites in the
//   depth-sorted `objects` layer (iso px), keyed on the world/stand.ts scale by the tile it is in
//   (`figZ`), so a building in front of it draws over it and one behind under it; the furrows and
//   bulges lie on the ground under every volume. In plan, a flat copy on `items` (view px). Its glows
//   (`lights`, additive) dim when a building or a cliff stands just in front of it (`hiddenAt`).
// Only at night (and a raid's tail at dawn); culled to the visible tiles; pooled sprites; nothing by day.
import { CanvasSource, Container, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
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
  ARM_H, ARM_ROOT, ARM_TIP, ARM_W, BULGE_H, BULGE_W, COLLAR_H, COLLAR_W, COLLAR_Y, FURROW_H, FURROW_W,
  GLEANER_CUT, GLEANER_EYE, GLEANER_EYE_REACH, GLEANER_FRAMES, GLEANER_GROUND, GLEANER_H, GLEANER_HAND,
  GLEANER_HEART, GLEANER_PEEK, GLEANER_SHOULDER_REACH, GLEANER_W,
  drawBulge, drawEyeGlow, drawFurrow, drawGlassCover, drawGleaner, drawGleanerArm, drawGrain, drawSandCollar, type GleanerPose,
} from '../art/recipes/gleaners';
import { ISO_LIN, invert, isoToView, type Lin } from '../projection';
import { beltMatrix, beltPiece } from './buildings-view';
import { itemPx, type ItemsView, type SeenItem } from './items-view';

/** A raid's arrival: each sets out under the sand `ARRIVE` ticks before it starts (`ARR_STAGGER` after the one before), travels `TRAVEL`, rises over `RISE`. */
const ARRIVE = 190, TRAVEL = 120, RISE = 26, ARR_STAGGER = 10;
/** After the last take, how long they stay; sinking back; the way out under the sand (each `DEP_STAGGER` apart). */
const LINGER = 40, SINK = 30, DEPART = 150, DEP_STAGGER = 9;
/** The grab: ticks for the item to ride the arm from where its token was into the hand. */
const GRAB = 12;
/** The arm goes out over the last `REACH` ticks before the token it takes reaches the post's centre. */
const REACH = 8;
/** A raid's whole tail after its start, at most (for culling it in time). */
const TAIL = RAID_TICKS + LINGER + SINK + DEPART + 5 * DEP_STAGGER;
/** Where they come from (tiles out along their bearing, at most), how far they go before they are gone, where they rise (from the post's centre), how far apart. */
const OUT = 7.5, AWAY = 11, EDGE = 1, SPREAD = 0.95;
/**
 * On the line's near side (south or east: down the screen in iso) they rise further out: one tile
 * off, each would stand right in front of its neighbour's cell and hide the token it takes; at 1.8
 * the cells show between them, and the long arm reaches across.
 */
const NEAR_EDGE = 1.8;
/** The bearings tried for the way into the desert, and how far each is looked down (tiles). */
const BEARINGS = 24, PROBE = 14;
/** The furrow behind one: how many marks, how many ticks apart (each at its own past place, fainter and narrower with age: about three tiles). */
const TRAIL = 12, TRAIL_DT = 4;
/** The bulge's length, a furrow mark's length and its width where it leaves the bulge (tiles; narrowing to under half as it settles), and the weave of its way (tiles). */
const BULGE_T = 0.82, FURROW_T = 0.6, FURROW_WIDE = 0.56, WEAVE = 0.14;
/** Travelling at night, its hood and eyes break the surface for `PEEK` ticks every `PEEK_EVERY`. */
const PEEK_EVERY = 46, PEEK = 12;
/** Every TAP_EVERY-th glazed tile gets a visit every TAP_PERIOD ticks; every PROWL_EVERY-th fence-side tile, every PROWL_PERIOD. */
const TAP_EVERY = 5, TAP_PERIOD = 2400, PROWL_EVERY = 6, PROWL_PERIOD = 2400;
/** At most this many Gleaners on screen. */
const MAX_SHOWN = 48;
/** A Gleaner's canvas height on screen (world px) in iso, and in plan. */
const ISO_H = 56, PLAN_H = 30;
/** The textures are drawn at twice their size, for a sharp edge. */
const RES = 2;
/** An item's height over the floor ribbon it rides (iso px: items-view.ts `h` on the floor). */
const ITEM_LIFT = 3;
/** Kinds that stand no higher than a Gleaner's shoulders: they hide nothing of it. */
const LOW: ReadonlySet<string> = new Set(['belt', 'conduit', 'fence']);
/** Grains thrown up per Gleaner. */
const GRAINS = 4;

/** A way under the sand: from (x0, y0) to (x1, y1), or round a loop; `at(s)` (s 0…1) its point and heading. */
interface Path { at(s: number, o: Vec): void; readonly len: number }
interface Vec { x: number; y: number; dx: number; dy: number }

/** A straight way with a slight weave (none at its ends), from (x0, y0) to (x1, y1). */
function line(x0: number, y0: number, x1: number, y1: number): Path {
  const lx = x1 - x0, ly = y1 - y0, len = Math.hypot(lx, ly) || 1e-6, nx = -ly / len, ny = lx / len;
  const off = (s: number): number => {
    const d = s * len, env = Math.min(1, d / 0.8, (len - d) / 0.8);
    return Math.sin(d * 2.6) * WEAVE * Math.max(0, env);
  };
  return {
    len,
    at(s, o) {
      const w = off(s), e = 0.01, w1 = off(Math.min(1, s + e)), w0 = off(Math.max(0, s - e));
      o.x = x0 + lx * s + nx * w; o.y = y0 + ly * s + ny * w;
      o.dx = lx * 2 * e + nx * (w1 - w0); o.dy = ly * 2 * e + ny * (w1 - w0);
    },
  };
}

/** A loop round (cx, cy) of radius r, from angle a0, `turns` times round, one way or the other (`dir` ±1). */
function loop(cx: number, cy: number, r: number, a0: number, dir: number, turns: number): Path {
  return {
    len: Math.PI * 2 * r * turns,
    at(s, o) {
      const a = a0 + dir * s * turns * Math.PI * 2;
      o.x = cx + Math.cos(a) * r; o.y = cy + Math.sin(a) * r;
      o.dx = -Math.sin(a) * dir; o.dy = Math.cos(a) * dir;
    },
  };
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
/** Free floor at level 0: sand or floor with nothing on it (a Gleaner may travel under it, or rise out of it). */
const free = (sim: Sim, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < 1024 && y < 1024 && !sim.grid.occ[tileIndex(x, y)] && sim.grid.level(x, y) === 0 && isFloor(sim.grid.terrain(x, y));
const smooth = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const clamp01 = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k);
const mod = (a: number, n: number): number => ((a % n) + n) % n;
/** A figure's depth key among the volumes (world/stand.ts scale): by the tile it is in, kind 1 as a building on the floor, a little after one. */
const figZ = (x: number, y: number): number => 8 * (Math.floor(x) + Math.floor(y)) + 1.25;

/**
 * Something tall in front of tile point (x, y) in iso hides what is there: a building (not a ribbon,
 * a conduit or a fence) on a tile just in front, or a cliff tall enough for its distance — a column
 * `a + b` tiles down the screen and no more than two across hides it when it stands at least half that
 * far over its floor (a step down the screen is 16 px; the relief draws a level about twice that, as
 * the shots of a band behind a plateau showed). Its glows, which the additive lights layer would
 * otherwise lay over that building or cliff, are then dimmed to a trace.
 */
function hiddenAt(sim: Sim, x: number, y: number): boolean {
  const i = Math.floor(x), j = Math.floor(y), lv = sim.grid.level(i, j);
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 2]] as const) {
    const e = i + dx < 1024 && j + dy < 1024 ? sim.entityAt(i + dx, j + dy) : null;
    if (e && !LOW.has(BUILDING_KIND[e.def]!)) return true;
  }
  for (let a = 0; a <= 8; a++) {
    for (let b = 0; b <= 8; b++) {
      if (a + b === 0 || Math.abs(a - b) > 2 || i + a >= 1024 || j + b >= 1024) continue;
      if (sim.grid.level(i + a, j + b) - lv >= Math.max(1, (a + b - 1) / 2)) return true;
    }
  }
  return false;
}

/**
 * The most open way into the desert from tile point (x, y): of `BEARINGS` bearings, the one whose
 * first `PROBE` tiles cross the fewest buildings, ribbons and fences (3 each), rock, water or gaps
 * (4) and tiles of the claim's land (1), the nearer weighing more, leaning away from the Core.
 * Returns the bearing (a unit vector, tiles) and how far it runs clear of anything.
 */
export function desertBearing(sim: Sim, x: number, y: number): { bx: number; by: number; clear: number; score: number } {
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
  return { bx, by, clear, score: best };
}

/**
 * Where a band waits by tile (x, y) of its line and which way it goes: of the sides of the tile that
 * open onto free floor, the one whose own way into the desert (`desertBearing` from a step out on
 * it) is the most open and leads away from the line rather than back across it.
 */
function bandSide(sim: Sim, x: number, y: number): { side: readonly [number, number]; bx: number; by: number } {
  let best: { side: readonly [number, number]; bx: number; by: number } | null = null, bs = -Infinity;
  for (const d of D4) {
    if (!free(sim, x + d[0], y + d[1])) continue;
    const b = desertBearing(sim, x + 0.5 + d[0] * 1.5, y + 0.5 + d[1] * 1.5);
    const sc = b.score + 6 * (b.bx * d[0] + b.by * d[1]);
    if (sc > bs) { bs = sc; best = { side: d, bx: b.bx, by: b.by }; }
  }
  if (best) return best;
  const b = desertBearing(sim, x + 0.5, y + 0.5);
  return { side: D4[0]!, bx: b.bx, by: b.by };
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

/** From (sx, sy) (on free floor) toward (ex, ey): the farthest point it reaches over free floor only (sand and floor: never rock, water, a gap or anything built). */
function clipTo(sim: Sim, sx: number, sy: number, ex: number, ey: number): [number, number] {
  const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy), n = Math.max(1, Math.ceil(len / 0.25));
  let lx = sx, ly = sy;
  for (let i = 1; i <= n; i++) {
    const x = sx + (dx * i) / n, y = sy + (dy * i) / n;
    if (!free(sim, Math.floor(x), Math.floor(y))) break;
    lx = x; ly = y;
  }
  return [lx, ly];
}

/** One post of a raid: its cell and tile, the tile's centre, where it rises, the side it stands on, its ways in and out under the sand. */
interface Post { cell: number; tile: number; cx: number; cy: number; sx: number; sy: number; ox: number; oy: number; inP: Path; outP: Path }
/** A chain's raid: the chain, its tick in the window, its posts, the tiles it covers (for culling), its way into the desert. */
interface Raid { chain: Chain; at: number; posts: Post[]; box: [number, number, number, number]; bx: number; by: number }
/** A visit to the glass: the tile; for each who comes, the glazed tile it taps, where it rises (on that tile's side `ox, oy`), its ways in and out; its own phase. */
interface Tap { x: number; y: number; stands: Array<{ sx: number; sy: number; tx: number; ty: number; ox: number; oy: number; inP: Path; outP: Path }>; h: number }
/** A visit outside a fence: two furrows in, round a loop outside it, and out. */
interface Prowl { x: number; y: number; laps: Path[]; ins: Path[]; outs: Path[]; h: number }
/** A Gleaner's sprites: risen in iso (in `objects`), in plan (on `items`), its glows, its grains (iso), its bulge and furrow on the ground. */
interface Figure {
  body: Sprite; arm: Sprite; item: Sprite; heap: Sprite; pBody: Sprite; pArm: Sprite; pItem: Sprite; pHeap: Sprite;
  halo: Sprite; eyes: Sprite; glow: Sprite; grains: Sprite[]; bulge: Sprite; trail: Sprite[];
}
/** What a post knows across frames: the line's next step it last looked at (`next`), the token it takes on it (`T` that step, −1 none), the last of that token drawn, the take it showed last. */
interface PostState { next: number; T: number; item: number; seen: SeenItem | null; seenT: number; shown: number }

/** One Gleaner to place this frame (the same object, refilled for each). */
interface Pose {
  /** Where it is (tiles), the way it faces (tiles), its pose and frame, its alpha. */
  x: number; y: number; fx: number; fy: number; pose: GleanerPose; frame: number; alpha: number;
  /** The sand line on its body (canvas y): 0 all under, `GLEANER_PEEK` its eyes out, `GLEANER_CUT` waiting; its sway (radians). */
  cut: number; sway: number;
  /** What it holds (item index, or -1). */
  item: number;
  /** Its long arm (pose 'reach'): out by `ext` (0…1) over tile point (tx, ty), to the view px (vx, vy) of the token there if drawn (else NaN); `grab` ≥ 0: the item riding it back, 0 where the token was … 1 in the hand. */
  tx: number; ty: number; vx: number; vy: number; ext: number; grab: number;
  /** Travelling under the sand: the bulge's alpha (0: none), the furrow behind (`nTrail` marks: x, y, dx, dy a mark), grains (0…1 how hard). */
  bulge: number; trail: Float64Array; nTrail: number; dig: number;
  /** Rising or sinking: the sand sliding off it (0…1). */
  slide: number;
}

export class GleanersView {
  private readonly covers = new Container({ label: 'glass-hoods' });
  /** On the glass plane (tile units): the furrows and bulges on the ground. */
  private readonly ground = new Container({ label: 'gleaner-furrows' });
  /** On `items` (view px): the plan figures. */
  private readonly planFigs = new Container({ label: 'gleaners-plan' });
  private readonly glows = new Container({ label: 'gleaner-glows' });
  private readonly coverTex: [Texture, Texture];
  private readonly tex = new Map<GleanerPose, Texture[]>();
  /** The bodies cut at the sand line, by pose, frame and cut (canvas px): views of the same canvases. */
  private readonly crops = new Map<string, Texture>();
  private readonly armTex: Texture;
  private readonly heapTex: Texture;
  private readonly furrowTex: Texture;
  private readonly bulgeTex: Texture;
  private readonly grainTex: Texture;
  private readonly glowTex: Texture;
  private readonly pool: Figure[] = [];
  /** The glints on the glass being tapped (pooled). */
  private readonly flashes: Sprite[] = [];
  private raids: Raid[] = [];
  private taps: Tap[] = [];
  private prowls: Prowl[] = [];
  private version = -1;
  /** Per post (by its tile): the token it will take, the last of it drawn, the take shown. */
  private readonly posts = new Map<number, PostState>();
  /** The post tiles the items view reports on (`ItemsView.watch`). */
  private readonly watched = new Set<number>();
  private readonly V: Vec = { x: 0, y: 0, dx: 0, dy: 0 };
  private readonly F: Pose = {
    x: 0, y: 0, fx: 0, fy: 0, pose: 'glide', frame: 0, alpha: 1, cut: 0, sway: 0, item: -1, tx: 0, ty: 0, vx: NaN, vy: NaN, ext: 0, grab: -1,
    bulge: 0, trail: new Float64Array(TRAIL * 4), nTrail: 0, dig: 0, slide: 0,
  };
  /** Last frame's Gleaners: all, travelling in, waiting at a post, reaching, grabbing, carrying something, at the glass, by a fence (FL, the shots). */
  shown = 0;
  arriving = 0;
  waiting = 0;
  reaching = 0;
  grabbing = 0;
  carrying = 0;
  tapping = 0;
  prowling = 0;
  /** Of those, how many were under the sand (a bulge and its furrow) and how many risen out of it. */
  under = 0;
  risen = 0;
  /** Glints on the glass this frame (a tap). */
  flashing = 0;
  /**
   * The takes shown so far, as each first shows: `paired` (foreseen, and its token gone from the
   * belt), `onBelt` (a token of that item still drawn at the post's centre: a grab without its
   * token), `unforeseen` (a frame had foreseen another item for that step), `unseen` (a frame looked
   * at that step and foresaw no take), `late` (no frame looked at its step before it ran — off screen
   * then, or the game jumped many ticks at once — or first shown more than two ticks after: nothing to
   * check).
   */
  paired = 0;
  onBelt = 0;
  unforeseen = 0;
  unseen = 0;
  late = 0;
  /** The last raid placed this frame: its middle post (tiles), its start tick, how many out, its way into the desert (the shots aim at it). */
  raidAt_: { x: number; y: number; at: number; out: number; bx: number; by: number } | null = null;
  /** While `debugOn` (the shots): every Gleaner placed last frame — where, its sand line, its pose, its arm's reach and grab. */
  debugOn = false;
  poses_: Array<{ x: number; y: number; cut: number; pose: GleanerPose; ext: number; grab: number; item: number; under: boolean }> = [];
  /** Where the last tapper and prowler placed this frame are (tiles) and their visit's phase. */
  tapAt_: [number, number, number] | null = null;
  prowlAt_: [number, number, number] | null = null;

  constructor(glassLayer: Container, itemsLayer: Container, lightsLayer: Container, private readonly objects: Container, private readonly atlas: Atlas, private readonly items: ItemsView) {
    glassLayer.addChild(this.covers, this.ground);
    itemsLayer.addChild(this.planFigs);
    lightsLayer.addChild(this.glows);
    this.glows.blendMode = 'add'; // glows add light: their black edges add nothing
    this.coverTex = [canvasTexture(BELT_PX, BELT_PX, (g) => drawGlassCover(g, false)), canvasTexture(BELT_PX, BELT_PX, (g) => drawGlassCover(g, true))];
    for (const pose of ['glide', 'carry', 'reach'] as const) {
      this.tex.set(pose, Array.from({ length: GLEANER_FRAMES }, (_, f) => canvasTexture(GLEANER_W, GLEANER_H, (g) => drawGleaner(g, f, pose))));
    }
    this.armTex = canvasTexture(ARM_W, ARM_H, (g) => drawGleanerArm(g));
    this.heapTex = canvasTexture(COLLAR_W, COLLAR_H, (g) => drawSandCollar(g));
    this.furrowTex = canvasTexture(FURROW_W, FURROW_H, (g) => drawFurrow(g));
    this.bulgeTex = canvasTexture(BULGE_W, BULGE_H, (g) => drawBulge(g));
    this.grainTex = canvasTexture(8, 8, (g) => drawGrain(g));
    this.glowTex = canvasTexture(32, 32, (g) => drawEyeGlow(g, '#ffffff'));
  }

  /** A body cut at the sand line `cut` (canvas px, whole): the top of its canvas, as a view of it. */
  private cropTex(pose: GleanerPose, frame: number, cut: number): Texture {
    const key = `${pose}:${frame}:${cut}`;
    let t = this.crops.get(key);
    if (!t) {
      const base = this.tex.get(pose)![frame]!;
      t = new Texture({ source: base.source, frame: new Rectangle(0, 0, GLEANER_W * RES, cut * RES) });
      this.crops.set(key, t);
    }
    return t;
  }

  /** At each new graph: the hoods over the glazed ribbons; the raids, the glass and the fences to visit, each with its ways in and out under the sand. */
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
    // Every raid: the side its band rises on and its way into the desert, chosen together from its
    // middle post (`bandSide`); each post on that side if it can (else on its own side most along the
    // way); each one's ways in and out under the sand, spread across, clipped to free floor.
    this.raids = [];
    this.watched.clear();
    for (const c of g.chains) {
      const n = c.raidPosts.length;
      if (!n) continue;
      const midTile = c.tiles[c.raidPosts[n >> 1]!]!, mx = midTile & 1023, my = midTile >> 10;
      const { side, bx, by } = bandSide(sim, mx, my);
      const px = -by, py = bx; // across the way out
      const posts: Post[] = [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let p = 0; p < n; p++) {
        const cell = c.raidPosts[p]!, tile = c.tiles[cell]!, tx = tile & 1023, ty = tile >> 10, cx = tx + 0.5, cy = ty + 0.5;
        const own = free(sim, tx + side[0], ty + side[1]) ? side : sideToward(sim, tx, ty, bx, by) ?? side;
        const off = p - (n - 1) / 2, wob = ((hash32(tile, 0x51) % 7) - 3) * 0.12;
        const edge = own[0] + own[1] > 0 && free(sim, tx + 2 * own[0], ty + 2 * own[1]) ? NEAR_EDGE : EDGE;
        const sx = cx + own[0] * edge, sy = cy + own[1] * edge;
        const [ax, ay] = clipTo(sim, sx, sy, sx + bx * OUT + px * (off * SPREAD + wob), sy + by * OUT + py * (off * SPREAD + wob));
        const [fx, fy] = clipTo(sim, sx, sy, sx + bx * AWAY + px * off * SPREAD * 0.6, sy + by * AWAY + py * off * SPREAD * 0.6);
        posts.push({ cell, tile, cx, cy, sx, sy, ox: own[0], oy: own[1], inP: line(ax, ay, sx, sy), outP: line(sx, sy, fx, fy) });
        this.watched.add(tile);
        for (const [x, y] of [[sx, sy], [ax, ay], [fx, fy]] as const) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      this.raids.push({ chain: c, at: c.raidAt, posts, box: [x0, y0, x1, y1], bx, by });
    }
    for (const t of [...this.posts.keys()]) if (!this.watched.has(t)) this.posts.delete(t);
    this.items.watch = this.watched;
    // Every TAP_EVERY-th glazed tile beside open floor (and every PROWL_EVERY-th by a fence), in the
    // lists' order: spread along each line, and never none on a short one, as a draw could leave it.
    // A visit to the glass: two or three, each at a glazed tile of its own — the visited one and its
    // glazed neighbours along the line (however it winds) — rising on that tile's open side.
    this.taps = [];
    const glassSet = new Set(g.glean.glass);
    for (const [k, tile] of g.glean.glass.entries()) {
      if (k % TAP_EVERY !== TAP_EVERY >> 1) continue;
      const x = tile & 1023, y = tile >> 10;
      if (!D4.some((d) => free(sim, x + d[0], y + d[1]))) continue;
      const { bx, by } = bandSide(sim, x, y), n = 2 + (hash32(tile, 0x7aa) % 2), picks = [tile];
      for (let q = 0; q < picks.length && picks.length < n; q++) {
        for (const d of D4) {
          const t2 = picks[q]! + d[0] + d[1] * 1024;
          if (picks.length < n && glassSet.has(t2) && !picks.includes(t2)) picks.push(t2);
        }
      }
      const stands: Tap['stands'] = [];
      for (const [m, pick] of picks.entries()) {
        const px = pick & 1023, py = pick >> 10, side = sideToward(sim, px, py, bx, by);
        if (!side) continue;
        const tx = px + 0.5, ty = py + 0.5, sx = tx + side[0] * EDGE, sy = ty + side[1] * EDGE;
        const off = (m - (picks.length - 1) / 2) * 0.6;
        const [ax, ay] = clipTo(sim, sx, sy, sx + bx * OUT - by * off, sy + by * OUT + bx * off);
        stands.push({ sx, sy, tx, ty, ox: side[0], oy: side[1], inP: line(ax, ay, sx, sy), outP: line(sx, sy, ax, ay) });
      }
      if (stands.length) this.taps.push({ x: x + 0.5, y: y + 0.5, stands, h: hash32(tile, 0x7a8) });
    }
    this.prowls = [];
    for (const [k, tile] of g.glean.prowl.entries()) {
      if (k % PROWL_EVERY !== PROWL_EVERY >> 1) continue;
      const x = tile & 1023, y = tile >> 10;
      // Out is away from the fence it circles by: a loop clear of it on free floor, a little out.
      const f = D4.find(([dx, dy]) => { const e = sim.entityAt(x + dx, y + dy); return !!e && BUILDING_KIND[e.def] === 'fence'; });
      if (!f) continue;
      const ox = -f[0], oy = -f[1], r = 0.85;
      let lap: { cx: number; cy: number } | null = null;
      for (const d of [1.3, 1.9, 2.5]) {
        const cx = x + 0.5 + ox * d, cy = y + 0.5 + oy * d;
        let ok = true;
        for (let i = 0; i < 16 && ok; i++) { const a = (i / 16) * Math.PI * 2; ok = free(sim, Math.floor(cx + Math.cos(a) * r), Math.floor(cy + Math.sin(a) * r)); }
        if (ok) { lap = { cx, cy }; break; }
      }
      if (!lap) continue;
      const b = desertBearing(sim, lap.cx, lap.cy), laps: Path[] = [], ins: Path[] = [], outs: Path[] = [];
      for (let m = 0; m < 2; m++) {
        const a0 = Math.atan2(b.by, b.bx) + m * Math.PI, dir = m ? -1 : 1;
        const sx = lap.cx + Math.cos(a0) * r, sy = lap.cy + Math.sin(a0) * r;
        const [ax, ay] = clipTo(sim, sx, sy, sx + b.bx * OUT, sy + b.by * OUT);
        laps.push(loop(lap.cx, lap.cy, r, a0, dir, 2));
        ins.push(line(ax, ay, sx, sy));
        outs.push(line(sx, sy, ax, ay));
      }
      this.prowls.push({ x: x + 0.5, y: y + 0.5, laps, ins, outs, h: hash32(tile, 0x9f1) });
    }
  }

  /** Per frame, after the items view (its `seen`): the night's Gleaners where they are now (`simTicks`: interpolated game ticks; `zoom`: the camera's). */
  update(sim: Sim, P: Lin, te: number, simTicks: number, tiles: readonly [number, number, number, number], zoom: number): void {
    if (sim.graph && sim.graph.version !== this.version) this.rebuild(sim);
    const now = simTicks, tick = Math.floor(now);
    let n = 0, flashes = 0;
    this.arriving = this.waiting = this.reaching = this.grabbing = this.carrying = this.tapping = this.prowling = this.under = this.risen = 0;
    this.raidAt_ = this.tapAt_ = this.prowlAt_ = null;
    if (this.debugOn) this.poses_ = [];
    // Nothing by day: not out now, no raid's arrival begun, no raid's tail left.
    if (sim.gleanNight(tick) || sim.gleanNight(tick + ARRIVE) || sim.gleanNight(tick - TAIL)) {
      const [x0, y0, x1, y1] = tiles;
      const fig = this.placer(sim, P, te, zoom, now);
      const place = (): void => {
        if (n >= MAX_SHOWN || !fig(n, this.F)) return;
        n++;
        const F = this.F;
        if (F.bulge > 0) this.under++;
        if (F.cut > 0) this.risen++;
        if (this.debugOn) this.poses_.push({ x: F.x, y: F.y, cut: F.cut, pose: F.pose, ext: F.ext, grab: F.grab, item: F.item, under: F.bulge > 0 });
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

  /** Under the sand along `path` at s(t) for t = `now` and back along its furrow (`from`: when it set out; `s`: its progress at a tick). */
  private travel(path: Path, now: number, from: number, s: (t: number) => number, alpha: number, seed: number): void {
    const F = this.F, V = this.V;
    path.at(s(now), V);
    F.x = V.x; F.y = V.y; F.fx = V.dx; F.fy = V.dy;
    F.bulge = alpha; F.dig = 1; F.cut = 0; F.slide = 0;
    F.nTrail = 0;
    for (let j = 1; j <= TRAIL; j++) {
      const t = now - j * TRAIL_DT;
      if (t < from) break;
      path.at(s(t), V);
      const o = F.nTrail * 4;
      F.trail[o] = V.x; F.trail[o + 1] = V.y; F.trail[o + 2] = V.dx; F.trail[o + 3] = V.dy;
      F.nTrail++;
    }
    // At night, now and then, its hood and eyes break the surface.
    const ph = mod(now + seed * 17, PEEK_EVERY);
    if (ph < PEEK) { F.cut = GLEANER_PEEK * Math.sin((ph / PEEK) * Math.PI); F.pose = 'glide'; }
  }

  /** Clears what a travelling one leaves for one that is up. */
  private up(cut: number, slide: number): void {
    const F = this.F;
    F.bulge = 0; F.nTrail = 0; F.dig = 0; F.cut = cut; F.slide = slide;
  }

  /**
   * One raid started at `t0`, at render time `now` (`took`: the sim's last takes by tile): the band
   * coming in under the sand, rising at its posts, waiting half-buried (an arm out only for the token
   * its post will take), each take as the sim made it (the token from the belt into the hand), sinking
   * back with it and going out under the sand.
   */
  private raid(sim: Sim, r: Raid, t0: number, now: number, took: ReadonlyMap<number, readonly number[]>, place: () => void): void {
    const posts = r.posts, size = posts.length, end = t0 + RAID_TICKS, simTick = sim.tick;
    // Each post's take this raid (its tick and item), once the sim has made it.
    const takes: Array<[number, number] | null> = posts.map((p) => {
      const l = took.get(p.tile);
      if (l) for (let i = 0; i < l.length; i += 2) if (l[i]! >= t0 && l[i]! < end && l[i]! < simTick) return [l[i]!, l[i + 1]!];
      return null;
    });
    // They go together once each has taken (a moment after the last take), or when the raid is over.
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
        st.next = T;
        st.T = item >= 0 ? T : -1;
        st.item = item;
        const mine = item >= 0 ? seen?.find((s) => s.item === item) : undefined;
        if (mine) { st.seen = mine; st.seenT = T; }
      }
      const a0 = t0 - ARRIVE + p * ARR_STAGGER, a1 = a0 + TRAVEL, a2 = a1 + RISE;
      const l0 = leave + ((p * 3) % size) * DEP_STAGGER, l1 = l0 + SINK, l2 = l1 + DEPART;
      if (now < a0 || now > l2) continue;
      F.frame = Math.floor(now * 0.22 + p * 1.3);
      F.sway = Math.sin(now * 0.07 + p * 2.3) * 0.04;
      F.item = -1; F.ext = 0; F.grab = -1; F.alpha = 1; F.tx = post.cx; F.ty = post.cy; F.vx = F.vy = NaN; F.pose = 'glide';
      if (now < a1) {
        // Under the sand, in from the desert.
        this.travel(post.inP, now, a0, (t) => smooth((t - a0) / TRAVEL), Math.min(1, (now - a0) / 20), p);
        place();
        this.arriving++;
        continue;
      }
      // Risen at its post, facing the line.
      F.x = post.sx; F.y = post.sy; F.fx = -post.ox; F.fy = -post.oy;
      if (now >= l1) {
        // Out under the sand into the desert, what it took with it; the furrow fading at the end.
        this.travel(post.outP, now, l1, (t) => { const k = clamp01((t - l1) / DEPART); return k * k * (3 - 2 * k) * 0.5 + k * 0.5; }, Math.min(1, (l2 - now) / 45), p + 3);
        F.cut = 0; // no peeking with what it carries: straight home
        place();
        continue;
      }
      if (now < a2) {
        // Rising out of the sand, the sand sliding off it.
        const k = (now - a1) / RISE;
        this.up(GLEANER_CUT * (1 - (1 - k) * (1 - k)), 1 - k);
        place();
        this.arriving++;
        continue;
      }
      if (now >= l0) {
        // Sinking back with what it took, its glow going under.
        const k = (now - l0) / SINK;
        this.up(GLEANER_CUT * (1 - k * k), k);
        if (take) { F.pose = 'carry'; F.item = take[1]; }
        place();
        continue;
      }
      this.up(GLEANER_CUT + Math.sin(now * 0.09 + p * 1.9) * 0.9, 0);
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
      if (st.T >= 0) {
        const ext = smooth((now - (st.T + 1 - REACH)) / REACH);
        const mine = seen?.find((s) => s.item === st.item);
        if (mine) { F.vx = mine.x; F.vy = mine.y; }
        if (ext > 0.04) { F.pose = 'reach'; F.ext = ext; this.reaching++; }
      }
      place();
      this.waiting++;
    }
  }

  private postState(tile: number): PostState {
    let st = this.posts.get(tile);
    if (!st) this.posts.set(tile, (st = { next: -1, T: -1, item: -1, seen: null, seenT: -1, shown: -1 }));
    return st;
  }

  /**
   * A take showing for the first time: was it foreseen, and is its token off the belt this frame? Not
   * checked (`late`) when no frame looked at its step before it ran (the game jumped over it, or the
   * line was off screen) or it shows more than two ticks after.
   */
  private check(st: PostState, post: Post, take: readonly [number, number], seen: readonly SeenItem[] | undefined, now: number): void {
    st.shown = take[0];
    if (st.next !== take[0] || now - (take[0] + 1) > 2) { this.late++; return; }
    const foreseen = st.T === take[0];
    if (!foreseen) this.unseen++;
    else if (st.item !== take[1]) this.unforeseen++;
    const still = !!seen?.some((s) => s.item === take[1] && Math.abs(s.tx - post.cx) < 0.35 && Math.abs(s.ty - post.cy) < 0.35);
    if (still) this.onBelt++;
    else if (foreseen && st.item === take[1]) this.paired++;
  }

  /** For FL and the shots: each raid's middle post, its posts' stands (tiles), the side they wait on, its way into the desert, and how many of its stands a building or cliff in front hides. */
  describe_(sim: Sim): Array<{ x: number; y: number; at: number; stands: Array<[number, number]>; side: [number, number]; bearing: [number, number]; hidden: number }> {
    return this.raids.map((r) => {
      const mid = r.posts[r.posts.length >> 1]!;
      const hidden = r.posts.filter((p) => hiddenAt(sim, p.sx, p.sy)).length;
      return { x: mid.cx - 0.5, y: mid.cy - 0.5, at: r.at, stands: r.posts.map((p) => [p.sx, p.sy] as [number, number]), side: [mid.ox, mid.oy], bearing: [r.bx, r.by], hidden };
    });
  }

  /** For the shots: the takes foreseen now (post tile, the tick of the step, the item). */
  foreseen_(): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    for (const [tile, st] of this.posts) if (st.T >= 0) out.push([tile, st.T, st.item]);
    return out;
  }

  /** A visit to the glass by two or three: in under the sand, up beside the hood, two taps each (a glint each), down and out. Returns the glints used. */
  private tapAt(sim: Sim, place: () => void, v: Tap, now: number, P: Lin, zoom: number, flashes: number): number {
    const F = this.F;
    for (let m = 0; m < v.stands.length; m++) {
      const st = v.stands[m]!, ph = mod(now + v.h, TAP_PERIOD) - m * 14;
      if (ph < 0 || ph >= 230) continue;
      F.frame = Math.floor(now * 0.22 + m); F.sway = Math.sin(now * 0.07 + m) * 0.04;
      F.item = -1; F.grab = -1; F.ext = 0; F.tx = st.tx; F.ty = st.ty; F.vx = F.vy = NaN; F.alpha = 1; F.pose = 'glide';
      if (ph < 80) { this.travel(st.inP, now, now - ph, (t) => smooth((t - (now - ph)) / 80), Math.min(1, ph / 15), m); place(); continue; }
      if (ph >= 170) { const t0 = now - ph + 170; this.travel(st.outP, now, t0, (t) => clamp01((t - t0) / 60), Math.min(1, (230 - ph) / 20), m + 3); F.cut = 0; place(); continue; }
      F.x = st.sx; F.y = st.sy; F.fx = -st.ox; F.fy = -st.oy;
      if (ph < 100) this.up(GLEANER_CUT * (1 - (1 - (ph - 80) / 20) ** 2), 1 - (ph - 80) / 20);
      else if (ph >= 150) this.up(GLEANER_CUT * (1 - ((ph - 150) / 20) ** 2), (ph - 150) / 20);
      else {
        // Two taps: the long arm out onto the glass, a glint where the fingers touch it.
        this.up(GLEANER_CUT, 0);
        const q = (ph - 100) % 25;
        F.pose = 'reach'; F.ext = q < 12 ? 0.55 + 0.45 * smooth(q / 7) : 0.55;
        if (q >= 6 && q < 12 && !hiddenAt(sim, st.tx, st.ty)) flashes = this.flash(flashes, P, st.tx + st.ox * 0.15, st.ty + st.oy * 0.15, zoom);
      }
      place();
    }
    return flashes;
  }

  /** Two furrows outside a fence: in under the sand, twice round a loop clear of it (an eye out now and then), and out. */
  private prowlAt(place: () => void, v: Prowl, now: number): void {
    const F = this.F;
    for (let m = 0; m < v.laps.length; m++) {
      const ph = mod(now + v.h, PROWL_PERIOD) - m * 25;
      if (ph < 0 || ph >= 280) continue;
      F.frame = Math.floor(now * 0.22 + m); F.sway = 0;
      F.item = -1; F.grab = -1; F.ext = 0; F.vx = F.vy = NaN; F.alpha = 1; F.pose = 'glide';
      const at = now - ph;
      if (ph < 70) this.travel(v.ins[m]!, now, at, (t) => smooth((t - at) / 70), Math.min(1, ph / 15), m);
      else if (ph < 220) this.travel(v.laps[m]!, now, at + 70, (t) => clamp01((t - at - 70) / 150), 1, m + 5);
      else this.travel(v.outs[m]!, now, at + 220, (t) => clamp01((t - at - 220) / 60), Math.min(1, (280 - ph) / 20), m + 7);
      place();
    }
  }

  /**
   * This frame's placer (the projection, the morph, the zoom fixed): lays Gleaner `i` as `F` says —
   * its bulge and furrow on the ground (tile units), its grains, and risen, its body cut at the sand
   * line with its heap, arm and what it holds, in iso among the volumes (iso px, its depth key) and in
   * plan flat on `items` (view px), and its glows (view px) — and returns false if nothing shows.
   */
  private placer(sim: Sim, P: Lin, te: number, zoom: number, now: number): (i: number, F: Pose) => boolean {
    const isoOn = te < 0.6, planOn = te > 0.3;
    const planA = te >= 1 ? 1 : te <= 0.3 ? 0 : (te - 0.3) / 0.7;
    const V = isoToView(P), Vi = invert(V);
    const kIso = ISO_H / GLEANER_H, kPlan = (ISO_H * (1 - te) + PLAN_H * te) / GLEANER_H; // world px a canvas px
    // Glows keep a size on screen from afar (world px ÷ zoom): small moving lights.
    const z = Math.max(0.05, zoom);
    const haloW = Math.max(64, 26 / z), eyesW = Math.max(18, 9 / z), itemW = Math.max(26, 11 / z);
    const px = itemPx(te, zoom);
    const bx0 = GLEANER_GROUND[0];
    const toIso = (x: number, y: number): [number, number] => [Vi.a * x + Vi.c * y, Vi.b * x + Vi.d * y];
    const toView = (p: readonly [number, number]): [number, number] => [V.a * p[0] + V.c * p[1], V.b * p[0] + V.d * p[1]];
    /** Lays one set of risen sprites (iso or plan) in projection L at k world px a canvas px; returns its eyes, heart and what it holds (L px). */
    const lay = (L: Lin, k: number, body: Sprite, heap: Sprite, arm: Sprite, item: Sprite, F: Pose, iso: boolean, key: number): { eye: [number, number] | null; heart: [number, number]; held: [number, number] | null } => {
      const gx = L.a * F.x + L.c * F.y, gy = L.b * F.x + L.d * F.y;
      const flip = L.a * F.fx + L.c * F.fy < 0 ? -1 : 1; // facing the way it goes, on screen
      const cut = Math.max(1, Math.round(F.cut));
      const cs = Math.cos(F.sway), sn = Math.sin(F.sway);
      const at = (p: readonly [number, number]): [number, number] => {
        const dx = (p[0] - bx0) * k * flip, dy = (p[1] - cut) * k;
        return [gx + dx * cs - dy * sn, gy + dx * sn + dy * cs];
      };
      const s = k / RES;
      const frame = ((F.frame % GLEANER_FRAMES) + GLEANER_FRAMES) % GLEANER_FRAMES;
      body.texture = this.cropTex(F.pose, frame, cut);
      body.position.set(gx, gy);
      body.scale.set(s * flip, s);
      body.rotation = F.sway;
      body.alpha = F.alpha;
      body.visible = true;
      // The heap it pushed up, over the cut: grown with how far it has risen.
      const grow = 0.45 + 0.55 * clamp01(cut / GLEANER_CUT);
      heap.position.set(gx, gy);
      heap.scale.set(s * grow * flip, s * grow);
      heap.alpha = F.alpha;
      heap.visible = true;
      if (iso) { body.zIndex = key; heap.zIndex = key + 0.02; }
      // The line it reaches over sorts in front of it when nearer the viewer: so do the arm and the item there.
      const line = figZ(F.tx, F.ty);
      const cell = (): [number, number] => {
        if (!Number.isNaN(F.vx)) return iso ? toIso(F.vx, F.vy) : [F.vx, F.vy];
        return [L.a * F.tx + L.c * F.ty, L.b * F.tx + L.d * F.ty - ITEM_LIFT * (iso ? 1 : 1 - te)];
      };
      let tip: [number, number] | null = null;
      if (F.pose === 'reach' && F.ext > 0 && GLEANER_SHOULDER_REACH[1] < cut - 2) {
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
        // Seen side on, the arm comes out of its near side: over its own body and heap, and out over a line nearer the viewer.
        if (iso) arm.zIndex = Math.max(line, key) + 0.05;
      } else arm.visible = false;
      let held: [number, number] | null = null;
      // What it holds shows while its hand is above the sand (sinking, it goes under with it).
      const out = tip && F.grab >= 0 ? 1 : clamp01((cut - GLEANER_HAND[1] - 1) / 6);
      if (F.item >= 0 && out > 0) {
        const tex = this.atlas.textures.get(ibKey(ITEM_IDS[F.item]!));
        if (tex) item.texture = tex;
        held = tip && F.grab >= 0 ? tip : at(GLEANER_HAND);
        item.position.set(held[0], held[1]);
        item.width = item.height = px;
        item.alpha = F.alpha * out;
        item.visible = !!tex;
        if (iso) item.zIndex = (F.grab >= 0 && F.grab < 0.5 ? Math.max(line, key) : key) + 0.1;
      } else item.visible = false;
      const eyeP = F.pose === 'reach' ? GLEANER_EYE_REACH : GLEANER_EYE;
      return { eye: eyeP[1] < cut - 1 ? at(eyeP) : null, heart: at([GLEANER_HEART[0], Math.min(GLEANER_HEART[1], cut - 6)]), held };
    };
    return (i, F) => {
      if (F.alpha <= 0.01 || (F.bulge <= 0.01 && F.cut <= 0.5)) return false;
      const f = this.figure(i);
      const key = figZ(F.x, F.y);
      let eye: [number, number] | null = null, heart: [number, number] | null = null, held: [number, number] | null = null;
      const risen = F.cut > 0.5;
      // Risen (or peeking): the body cut at the sand line, its heap, its arm and what it holds.
      if (risen && isoOn) {
        const r = lay(ISO_LIN, kIso, f.body, f.heap, f.arm, f.item, F, true, key);
        eye = r.eye ? toView(r.eye) : null; heart = toView(r.heart); held = r.held ? toView(r.held) : null;
      } else f.body.visible = f.heap.visible = f.arm.visible = f.item.visible = false;
      if (risen && planOn) {
        const r = lay(P, kPlan, f.pBody, f.pHeap, f.pArm, f.pItem, F, false, key);
        for (const sp of [f.pBody, f.pHeap, f.pArm, f.pItem]) sp.alpha *= planA;
        if (!isoOn || te > 0.45) { eye = r.eye; heart = r.heart; held = r.held; }
      } else f.pBody.visible = f.pHeap.visible = f.pArm.visible = f.pItem.visible = false;
      // Under the sand: the bulge it pushes along, the furrow closing behind it.
      if (F.bulge > 0.01) {
        f.bulge.position.set(F.x, F.y);
        f.bulge.rotation = Math.atan2(F.fy, F.fx);
        f.bulge.scale.set(BULGE_T / (BULGE_W * RES) * (1 + Math.sin(now * 0.5) * 0.05), (BULGE_T * BULGE_H / BULGE_W) / (BULGE_H * RES));
        f.bulge.alpha = F.bulge;
        f.bulge.visible = true;
      } else f.bulge.visible = false;
      for (let j = 0; j < TRAIL; j++) {
        const m = f.trail[j]!;
        if (j >= F.nTrail || F.bulge <= 0.01) { m.visible = false; continue; }
        const o = j * 4, age = (j + 1) / (TRAIL + 1);
        m.position.set(F.trail[o]!, F.trail[o + 1]!);
        m.rotation = Math.atan2(F.trail[o + 3]!, F.trail[o + 2]!);
        m.scale.set(FURROW_T / (FURROW_W * RES), FURROW_WIDE * (1 - 0.55 * age) / (FURROW_H * RES));
        m.alpha = F.bulge * (1 - age * age);
        m.visible = true;
      }
      // Grains (iso, among the volumes): thrown up ahead of the bulge, or sliding off a rising or sinking body.
      const [gx, gy] = [ISO_LIN.a * F.x + ISO_LIN.c * F.y, ISO_LIN.b * F.x + ISO_LIN.d * F.y];
      for (let j = 0; j < GRAINS; j++) {
        const gr = f.grains[j]!;
        if (!isoOn || (F.dig <= 0 && F.slide <= 0.05)) { gr.visible = false; continue; }
        const ph = mod(now * 0.07 + j / GRAINS + i * 0.37, 1), side = j % 2 ? 1 : -1;
        if (F.dig > 0) {
          // A spurt ahead: up and out to one side, then down.
          const hx = ISO_LIN.a * F.fx + ISO_LIN.c * F.fy, hy = ISO_LIN.b * F.fx + ISO_LIN.d * F.fy, hl = Math.hypot(hx, hy) || 1;
          gr.position.set(gx + (hx / hl) * 10 + side * ph * 9, gy + (hy / hl) * 5 - Math.sin(ph * Math.PI) * 14);
          gr.alpha = F.bulge * (1 - ph);
        } else {
          // Sliding off its shoulders down to the heap.
          gr.position.set(gx + side * (8 + j * 2.5), gy - (1 - ph) * F.cut * kIso * 0.8);
          gr.alpha = F.slide * (1 - ph * 0.6);
        }
        gr.scale.set(0.42 + (j % 3) * 0.12);
        gr.zIndex = key + 0.03;
        gr.visible = gr.alpha > 0.02;
      }
      // Its glows: a halo while it is up — under the sand, a faint one through it at the bulge; its eyes
      // when above the sand (peeking or risen); what it holds.
      const dim = isoOn && te < 0.45 && hiddenAt(sim, F.x, F.y) ? 0.15 : 1;
      if (!heart && F.bulge > 0.01) {
        f.halo.position.set(P.a * F.x + P.c * F.y, P.b * F.x + P.d * F.y);
        f.halo.width = f.halo.height = haloW * 0.75;
        f.halo.alpha = 0.16 * F.bulge * dim;
        f.halo.visible = true;
      } else if (heart) {
        f.halo.position.set(heart[0], heart[1]);
        f.halo.width = f.halo.height = haloW * (0.6 + 0.4 * clamp01(F.cut / GLEANER_CUT));
        f.halo.alpha = 0.22 * F.alpha * dim * clamp01(F.cut / GLEANER_PEEK);
        f.halo.visible = true;
      } else f.halo.visible = false;
      if (eye) {
        f.eyes.position.set(eye[0], eye[1]);
        f.eyes.width = f.eyes.height = eyesW;
        f.eyes.alpha = F.alpha * dim;
        f.eyes.visible = true;
      } else f.eyes.visible = false;
      if (held) {
        f.glow.position.set(held[0], held[1]);
        f.glow.width = f.glow.height = itemW;
        f.glow.alpha = 0.6 * F.alpha * dim * (F.grab >= 0 ? 0.5 + 0.5 * F.grab : 1) * clamp01((F.cut - GLEANER_HAND[1] - 1) / 6 + (F.grab >= 0 ? 1 : 0));
        f.glow.visible = true;
      } else f.glow.visible = false;
      return true;
    };
  }

  private figure(i: number): Figure {
    let f = this.pool[i];
    if (f) return f;
    const mkBody = (): Sprite => { const s = new Sprite(this.tex.get('glide')![0]!); s.anchor.set(GLEANER_GROUND[0] / GLEANER_W, 1); return s; };
    const mkHeap = (): Sprite => { const s = new Sprite(this.heapTex); s.anchor.set(0.5, COLLAR_Y / COLLAR_H); return s; };
    const mkArm = (): Sprite => { const s = new Sprite(this.armTex); s.anchor.set(ARM_ROOT[0] / ARM_W, ARM_ROOT[1] / ARM_H); return s; };
    const mkItem = (): Sprite => { const s = new Sprite(Texture.WHITE); s.anchor.set(0.5); return s; };
    const mkGround = (t: Texture): Sprite => { const s = new Sprite(t); s.anchor.set(0.5); return s; };
    const mk = (tint: number): Sprite => { const s = new Sprite(this.glowTex); s.anchor.set(0.5); s.tint = tint; return s; };
    f = {
      body: mkBody(), heap: mkHeap(), arm: mkArm(), item: mkItem(), pBody: mkBody(), pHeap: mkHeap(), pArm: mkArm(), pItem: mkItem(),
      halo: mk(0x9fd8e8), eyes: mk(0xbff9ff), glow: mk(0xffe0a8),
      grains: Array.from({ length: GRAINS }, () => { const s = new Sprite(this.grainTex); s.anchor.set(0.5); return s; }),
      bulge: mkGround(this.bulgeTex), trail: Array.from({ length: TRAIL }, () => mkGround(this.furrowTex)),
    };
    this.hide(f);
    this.objects.addChild(f.body, f.heap, f.arm, f.item, ...f.grains);
    this.planFigs.addChild(f.pBody, f.pHeap, f.pArm, f.pItem);
    this.ground.addChild(...f.trail.slice().reverse(), f.bulge);
    this.glows.addChild(f.halo, f.eyes, f.glow);
    this.pool.push(f);
    return f;
  }

  private hide(f: Figure): void {
    f.body.visible = f.heap.visible = f.arm.visible = f.item.visible = false;
    f.pBody.visible = f.pHeap.visible = f.pArm.visible = f.pItem.visible = false;
    f.halo.visible = f.eyes.visible = f.glow.visible = f.bulge.visible = false;
    for (const s of f.grains) s.visible = false;
    for (const s of f.trail) s.visible = false;
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
