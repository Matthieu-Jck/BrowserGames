// gleaners-view.ts — the Gleaners as the base sees them (D103, D112; owner, 2026-10-17: « ils
// doivent venir en groupe, aller vers un tapis où il y a des objets en mouvement, et réellement les
// récupérer »). Render only: the sim holds what they take (sim/flow/chain.ts `raidStep`,
// sim/systems/gleaners.ts); this view shows the raid where and when the sim runs it, and the glass
// over the glazed ribbons.
//
// - **The glass hoods** (`glass` layer: a plane under P, over the items, under the volumes): each
//   glazed ribbon on the floor wears its hood (recipes/gleaners.ts `drawGlassCover`), straight or
//   bent as its belt piece is (`beltPiece`, `beltMatrix`), so what it carries shows through glass.
//   Laid at each new graph. A glazed ribbon up on the rock has none (yet).
// - **The raids** — the real thing. Every exposed chain's raid is known at compile (`raidPosts`,
//   `raidAt`: the posts and the tick of the window). Before it the group glides in out of the dunes
//   (`OUT` tiles out on the line's open side, spread across, fading in), each to its post beside
//   the ribbon. There they wait, bobbing and swaying; once a post's turn has come (`RAID_STAGGER`)
//   its Gleaner leans in and reaches its long arm over the line whenever an item rides onto its
//   cell. When the sim takes that item (`Sim.gleaners.recent`: tile, item, tick) the belt's token is
//   gone at that very step, and here the item rides the arm back from the cell into its hand,
//   held up and glowing. When every post has taken (or the raid's time is up) the group drifts back
//   into the desert together, carrying what it took. What the player sees is what the morning
//   report counts: one item a post, at the tick the sim took it.
// - **The glass** (`Graph.glean.glass`: glazed tiles beside open floor, one in `TAP_EVERY`): now and
//   then two or three come to the hood, tap it with their long fingers (a glint on the glass) and
//   leave. **The fences** (`Graph.glean.prowl`, one in `PROWL_EVERY`): two pace along outside, and
//   leave. A buried ribbon (D109) is floor to them: never exposed, never raided.
// Readable in the dark: the figures are graded with the world, float over a soft shadow, and on the
// additive `lights` layer each carries a halo, its lantern eyes and the glow of what it holds,
// sized so that from afar they still read as small moving lights (`zoom`). Only at night (and a
// raid's tail at dawn); culled to the visible tiles; pooled sprites; nothing by day.
import { CanvasSource, Container, Matrix, Sprite, Texture } from 'pixi.js';
import { BUILDING_KIND, ITEM_IDS, buildingDef } from '@/content/registry';
import { hash32 } from '@/core/hash';
import { GLEAN_WINDOW, RAID_STAGGER, RAID_TICKS, type Chain } from '@/sim/flow/chain';
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
import type { Lin } from '../projection';
import { beltMatrix, beltPiece } from './buildings-view';

/** A raid's arrival (ticks before it starts; each glides in for `GLIDE_IN`, `ARR_STAGGER` after the one before). */
const ARRIVE = 170, GLIDE_IN = 130, ARR_STAGGER = 10;
/** After the last take, how long they stay before leaving; the way back (each `DEP_STAGGER` apart). */
const LINGER = 40, DEPART = 170, DEP_STAGGER = 9;
/** The grab: ticks for the item to ride the arm from the cell into the hand. */
const GRAB = 12;
/** A raid's whole tail after its start, at most (for culling it in time). */
const TAIL = RAID_TICKS + LINGER + DEPART + 5 * DEP_STAGGER;
/** Where they come from (tiles out from the line), where they stand to reach (from the tile's centre), how far apart. */
const OUT = 7.5, EDGE = 1, SPREAD = 0.95;
/** One glazed tile in TAP_EVERY gets a visit every TAP_PERIOD ticks; one fence-side tile in PROWL_EVERY, every PROWL_PERIOD. */
const TAP_EVERY = 5, TAP_PERIOD = 2400, PROWL_EVERY = 6, PROWL_PERIOD = 2400;
/** At most this many figures on screen. */
const MAX_SHOWN = 48;
/** A figure's canvas height on screen (world px) in iso, and in plan. */
const ISO_H = 56, PLAN_H = 30;
/** The textures are drawn at twice their size, for a sharp edge. */
const RES = 2;

/** One post of a raid: its cell and tile, the tile's centre, where it stands, its way out, where it comes from and goes. */
interface Post { cell: number; tile: number; cx: number; cy: number; sx: number; sy: number; ox: number; oy: number; ax: number; ay: number; fx: number; fy: number }
/** A chain's raid: the chain, its tick in the window, its posts, the tiles it covers (for culling). */
interface Raid { chain: Chain; at: number; posts: Post[]; box: [number, number, number, number] }
/** A visit to the glass or along a fence: where, the way out, along the line, how many, its own phase. */
interface Visit { x: number; y: number; ox: number; oy: number; lx: number; ly: number; n: number; h: number }
interface Figure { shadow: Sprite; body: Sprite; arm: Sprite; item: Sprite; halo: Sprite; eyes: Sprite; glow: Sprite }

/** One figure to place this frame (the same object, refilled for each). */
interface Pose {
  /** Where it floats over (tiles), the way it faces (tiles), its pose and wisp frame, its alpha. */
  x: number; y: number; fx: number; fy: number; pose: GleanerPose; frame: number; alpha: number;
  /** Its bob (world px up) and sway (radians). */
  bob: number; sway: number;
  /** What it holds (item index, or -1). */
  item: number;
  /** Its long arm (pose 'reach'): out to (tx, ty) (tiles) by `ext` (0…1); `grab` ≥ 0: the item riding it back, 0 at the cell … 1 in the hand. */
  tx: number; ty: number; ext: number; grab: number;
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
/** The sides up the screen in iso (north, west): a band waits there first. */
const FAR: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0]];
/** Free floor at level 0 (a Gleaner may float there). */
const free = (sim: Sim, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < 1024 && y < 1024 && !sim.grid.occ[tileIndex(x, y)] && sim.grid.level(x, y) === 0 && isFloor(sim.grid.terrain(x, y));
/** The side of tile (x, y) that opens onto free floor (unit step; `pick` turns which is tried first), or null. */
function openSide(sim: Sim, x: number, y: number, pick: number): readonly [number, number] | null {
  for (let k = 0; k < 4; k++) {
    const d = D4[(k + pick) & 3]!;
    if (free(sim, x + d[0], y + d[1])) return d;
  }
  return null;
}
const smooth = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const mod = (a: number, n: number): number => ((a % n) + n) % n;

export class GleanersView {
  private readonly covers = new Container({ label: 'glass-hoods' });
  private readonly figures = new Container({ label: 'gleaners', sortableChildren: true });
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
  /** Each waiting Gleaner's arm, eased out and back (by its post's tile), and when it was last eased (ms). */
  private readonly reach = new Map<number, number>();
  private lastMs = 0;
  private readonly F: Pose = { x: 0, y: 0, fx: 0, fy: 0, pose: 'glide', frame: 0, alpha: 1, bob: 0, sway: 0, item: -1, tx: 0, ty: 0, ext: 0, grab: -1 };
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
  /** The last raid placed this frame: its middle post (tiles), its start tick, how many out (the shots aim at it). */
  raidAt_: { x: number; y: number; at: number; out: number } | null = null;
  /** Where the last tapper and prowler placed this frame stand (tiles) and their visit's phase. */
  tapAt_: [number, number, number] | null = null;
  prowlAt_: [number, number, number] | null = null;

  constructor(glassLayer: Container, itemsLayer: Container, lightsLayer: Container, private readonly atlas: Atlas) {
    glassLayer.addChild(this.covers);
    itemsLayer.addChild(this.figures);
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

  /** At each new graph: the hoods over the glazed ribbons; the raids, the glass and the fences to visit. */
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
    const sides = new Map<number, readonly [number, number] | null>();
    const sideOf = (tile: number): readonly [number, number] | null => {
      let s = sides.get(tile);
      if (s === undefined) sides.set(tile, (s = openSide(sim, tile & 1023, tile >> 10, hash32(tile, 0x9e1) & 3)));
      return s;
    };
    // Every raid: the band waits on the line's far side if it can (north, then west: up the screen in
    // iso), so the line and what rides on it stay in front and their arms reach down over it; else
    // on the middle post's open side. Each post stands on the band's side if it can, else its own.
    this.raids = [];
    this.reach.clear();
    for (const c of g.chains) {
      const n = c.raidPosts.length;
      if (!n) continue;
      const midTile = c.tiles[c.raidPosts[n >> 1]!]!, mx = midTile & 1023, my = midTile >> 10;
      const side = FAR.find((d) => free(sim, mx + d[0], my + d[1])) ?? sideOf(midTile) ?? D4[0]!;
      const px = -side[1], py = side[0]; // across the way out
      const gx = (midTile & 1023) + 0.5 + side[0] * OUT, gy = (midTile >> 10) + 0.5 + side[1] * OUT;
      const posts: Post[] = [];
      let x0 = gx, y0 = gy, x1 = gx, y1 = gy;
      for (let p = 0; p < n; p++) {
        const cell = c.raidPosts[p]!, tile = c.tiles[cell]!, cx = (tile & 1023) + 0.5, cy = (tile >> 10) + 0.5;
        const own = free(sim, (tile & 1023) + side[0], (tile >> 10) + side[1]) ? side : sideOf(tile) ?? side;
        const off = p - (n - 1) / 2, wob = ((hash32(tile, 0x51) % 7) - 3) * 0.12;
        const post: Post = {
          cell, tile, cx, cy, sx: cx + own[0] * EDGE, sy: cy + own[1] * EDGE, ox: own[0], oy: own[1],
          ax: gx + px * (off * SPREAD + wob), ay: gy + py * (off * SPREAD + wob),
          fx: gx + side[0] * 2.5 + px * off * SPREAD * 1.7, fy: gy + side[1] * 2.5 + py * off * SPREAD * 1.7,
        };
        posts.push(post);
        for (const [x, y] of [[post.sx, post.sy], [post.ax, post.ay], [post.fx, post.fy]] as const) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      this.raids.push({ chain: c, at: c.raidAt, posts, box: [x0, y0, x1, y1] });
    }
    this.taps = [];
    for (const tile of g.glean.glass) {
      if (hash32(tile, 0x7a9) % TAP_EVERY !== 0) continue;
      const side = sideOf(tile);
      if (side) this.taps.push({ x: (tile & 1023) + 0.5, y: (tile >> 10) + 0.5, ox: side[0], oy: side[1], lx: -side[1], ly: side[0], n: 2 + (hash32(tile, 0x7aa) % 2), h: hash32(tile, 0x7a8) });
    }
    this.prowls = [];
    for (const tile of g.glean.prowl) {
      if (hash32(tile, 0x9f0) % PROWL_EVERY !== 0) continue;
      const x = tile & 1023, y = tile >> 10;
      // Out is away from the fence it floats by.
      const f = D4.find(([dx, dy]) => { const e = sim.entityAt(x + dx, y + dy); return !!e && BUILDING_KIND[e.def] === 'fence'; });
      if (f) this.prowls.push({ x: x + 0.5, y: y + 0.5, ox: -f[0], oy: -f[1], lx: f[1], ly: -f[0], n: 2, h: hash32(tile, 0x9f1) });
    }
  }

  /** Per frame: the night's figures where they are now (`simTicks`: interpolated game ticks; `zoom`: the camera's). */
  update(sim: Sim, P: Lin, te: number, simTicks: number, tiles: readonly [number, number, number, number], zoom: number): void {
    if (sim.graph && sim.graph.version !== this.version) this.rebuild(sim);
    const now = simTicks, tick = Math.floor(now);
    const ms = performance.now(), ease = Math.min(1, Math.max(0, ms - this.lastMs) / 110);
    this.lastMs = ms;
    let n = 0, flashes = 0;
    this.arriving = this.waiting = this.reaching = this.grabbing = this.carrying = this.tapping = this.prowling = 0;
    this.raidAt_ = this.tapAt_ = this.prowlAt_ = null;
    // Nothing by day: not out now, no raid's arrival begun, no raid's tail left.
    if (sim.gleanNight(tick) || sim.gleanNight(tick + ARRIVE) || sim.gleanNight(tick - TAIL)) {
      const [x0, y0, x1, y1] = tiles;
      const fig = this.placer(P, te, zoom);
      const place = (): void => { if (n < MAX_SHOWN && fig(n, this.F)) n++; };
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
          this.raid(r, t0, now, sim.tick, took, ease, place);
          const mid = r.posts[r.posts.length >> 1]!;
          if (n > before) this.raidAt_ = { x: mid.cx, y: mid.cy, at: t0, out: n - before };
        }
      }
      if (sim.gleanNight(tick)) {
        const inView = (x: number, y: number): boolean => x >= x0 - 9 && y >= y0 - 9 && x <= x1 + 9 && y <= y1 + 9;
        for (const v of this.taps) {
          if (n >= MAX_SHOWN) break;
          if (!inView(v.x, v.y)) continue;
          const before = n;
          flashes = this.tapAt(place, v, now, P, zoom, flashes);
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
   * One raid started at `t0`, at render time `now` (`simTick`: the sim's own; `took`: the last takes
   * by tile): the group gliding in, waiting at its posts (an arm out over an item on its cell), the
   * grabs as the sim made them, and the group gliding away with what it took.
   */
  private raid(r: Raid, t0: number, now: number, simTick: number, took: ReadonlyMap<number, readonly number[]>, ease: number, place: () => void): void {
    const posts = r.posts, size = posts.length, end = t0 + RAID_TICKS;
    // Each post's take this raid (its tick and item), if the sim has made it yet.
    const takes: Array<[number, number] | null> = posts.map((p) => {
      const l = took.get(p.tile);
      if (l) for (let i = 0; i < l.length; i += 2) if (l[i]! >= t0 && l[i]! < end && l[i]! < simTick) return [l[i]!, l[i + 1]!];
      return null;
    });
    // They leave together once each has taken (a moment after the last take), or when the raid is over.
    let all = true, last = t0;
    for (const t of takes) if (t) last = Math.max(last, t[0]); else all = false;
    const leave = all ? last + LINGER : end;
    const F = this.F, cells = r.chain.cells;
    for (let p = 0; p < size; p++) {
      const post = posts[p]!, take = takes[p] ?? null;
      const a0 = t0 - ARRIVE + p * ARR_STAGGER, a1 = a0 + GLIDE_IN;
      const l0 = leave + ((p * 3) % size) * DEP_STAGGER;
      if (now < a0 || now > l0 + DEPART) continue;
      F.frame = Math.floor(now * 0.22 + p * 1.3);
      F.bob = 2.2 + Math.sin(now * 0.11 + p * 1.7) * 1.8;
      F.sway = Math.sin(now * 0.07 + p * 2.3) * 0.05;
      F.item = -1; F.ext = 0; F.grab = -1; F.alpha = 1;
      if (now < a1) {
        // Out of the dunes to its post, fading in.
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
        F.tx = post.cx; F.ty = post.cy;
        if (take && now >= take[0]) {
          const g = Math.max(0, now - take[0] - 1);
          F.item = take[1];
          if (g < GRAB) { F.pose = 'reach'; F.ext = 1; F.grab = smooth(g / GRAB); this.grabbing++; }
          else { F.pose = 'carry'; this.carrying++; }
          this.reach.set(post.tile, 0);
          place();
          continue;
        }
        // Its turn come and something on its cell (or just about to be): the arm goes out over it.
        const open = now >= t0 + p * RAID_STAGGER && now < end;
        const v = cells[post.cell]! || (post.cell > 0 ? cells[post.cell - 1]! : 0);
        const was = this.reach.get(post.tile) ?? 0, to = open && v ? 1 : 0;
        const ext = was + (to - was) * ease;
        this.reach.set(post.tile, ext);
        if (ext > 0.06) { F.pose = 'reach'; F.ext = ext; this.reaching++; } else F.pose = 'glide';
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

  /** A visit to the glass by two or three: up to the hood, two taps each (a glint each), away. Returns the glints used. */
  private tapAt(place: () => void, v: Visit, now: number, P: Lin, zoom: number, flashes: number): number {
    const F = this.F;
    for (let m = 0; m < v.n; m++) {
      const ph = mod(now + v.h, TAP_PERIOD) - m * 14;
      if (ph < 0 || ph >= 170) continue;
      const a = (m - (v.n - 1) / 2) * 0.95;
      const tx = v.x + v.lx * a, ty = v.y + v.ly * a;
      const ox = tx + v.ox * OUT, oy = ty + v.oy * OUT, ex = tx + v.ox * EDGE, ey = ty + v.oy * EDGE;
      F.frame = Math.floor(now * 0.22 + m); F.bob = 2.2 + Math.sin(now * 0.11 + m * 1.9) * 1.8; F.sway = Math.sin(now * 0.07 + m) * 0.05;
      F.item = -1; F.grab = -1; F.ext = 0; F.tx = tx; F.ty = ty; F.alpha = 1; F.pose = 'glide';
      if (ph < 70) {
        const k = smooth(ph / 70);
        F.x = ox + (ex - ox) * k; F.y = oy + (ey - oy) * k; F.fx = -v.ox; F.fy = -v.oy; F.alpha = Math.min(1, ph / 12);
      } else if (ph < 110) {
        // Two taps: the long arm out onto the glass, a glint where the fingers touch it.
        const q = (ph - 70) % 20;
        F.x = ex; F.y = ey; F.fx = -v.ox; F.fy = -v.oy;
        F.pose = 'reach'; F.ext = q < 10 ? 0.55 + 0.45 * smooth(q / 6) : 0.55;
        if (q >= 5 && q < 10) flashes = this.flash(flashes, P, tx + v.ox * 0.15, ty + v.oy * 0.15, zoom);
      } else {
        const k = smooth((ph - 110) / 60);
        F.x = ex + (ox - ex) * k; F.y = ey + (oy - ey) * k; F.fx = v.ox; F.fy = v.oy; F.alpha = Math.min(1, (1 - (ph - 110) / 60) / 0.3);
      }
      place();
    }
    return flashes;
  }

  /** Two pacing outside a fence: in, a few turns along it (a reach at the mesh now and then), and away. */
  private prowlAt(place: () => void, v: Visit, now: number): void {
    const F = this.F;
    for (let m = 0; m < v.n; m++) {
      const ph = mod(now + v.h, PROWL_PERIOD) - m * 25;
      if (ph < 0 || ph >= 260) continue;
      const off = (m - (v.n - 1) / 2) * 1.1;
      const bx = v.x + v.lx * off, by = v.y + v.ly * off;
      const ox = bx + v.ox * OUT, oy = by + v.oy * OUT, sx = bx + v.ox * 0.2, sy = by + v.oy * 0.2;
      F.frame = Math.floor(now * 0.22 + m); F.bob = 2.2 + Math.sin(now * 0.11 + m * 2.1) * 1.8; F.sway = Math.sin(now * 0.07 + m) * 0.05;
      F.item = -1; F.grab = -1; F.ext = 0; F.alpha = 1; F.pose = 'glide';
      if (ph < 70) {
        const k = smooth(ph / 70);
        F.x = ox + (sx - ox) * k; F.y = oy + (sy - oy) * k; F.fx = -v.ox; F.fy = -v.oy; F.alpha = Math.min(1, ph / 12);
      } else if (ph < 200) {
        const w = ((ph - 70) / 130) * Math.PI * 2, a = Math.sin(w + m * 2) * 1.4, way = Math.cos(w + m * 2) < 0 ? -1 : 1;
        F.x = sx + v.lx * a; F.y = sy + v.ly * a; F.fx = v.lx * way; F.fy = v.ly * way;
        if (ph % 50 < 10) { F.pose = 'reach'; F.ext = 0.45; F.fx = -v.ox; F.fy = -v.oy; F.tx = F.x - v.ox * 0.6; F.ty = F.y - v.oy * 0.6; }
      } else {
        const k = smooth((ph - 200) / 60);
        F.x = sx + (ox - sx) * k; F.y = sy + (oy - sy) * k; F.fx = v.ox; F.fy = v.oy; F.alpha = Math.min(1, (1 - (ph - 200) / 60) / 0.3);
      }
      place();
    }
  }

  /** This frame's figure placer (the projection, the morph, the zoom fixed): places figure `i` as `F` says; false if not shown. */
  private placer(P: Lin, te: number, zoom: number): (i: number, F: Pose) => boolean {
    const scale = (ISO_H * (1 - te) + PLAN_H * te) / GLEANER_H / RES, k = scale * RES;
    // Glows keep a size on screen from afar (world px ÷ zoom): small moving lights.
    const z = Math.max(0.05, zoom);
    const haloW = Math.max(80, 30 / z), eyesW = Math.max(18, 9 / z), itemW = Math.max(26, 11 / z);
    const lift = 4 * (1 - te); // an item's height over the belt (iso px)
    const [gx0, gy0] = GLEANER_GROUND;
    return (i, F) => {
      if (F.alpha <= 0.01) return false;
      const f = this.figure(i);
      const gx = P.a * F.x + P.c * F.y, gy = P.b * F.x + P.d * F.y;
      const flip = P.a * F.fx + P.c * F.fy < 0 ? -1 : 1; // facing the way it goes, on screen
      const cs = Math.cos(F.sway), sn = Math.sin(F.sway), py = gy - F.bob;
      const at = (p: readonly [number, number]): [number, number] => {
        const dx = (p[0] - gx0) * k * flip, dy = (p[1] - gy0) * k;
        return [gx + dx * cs - dy * sn, py + dx * sn + dy * cs];
      };
      f.shadow.position.set(gx, gy);
      f.shadow.width = 26 * k * (1 - F.bob * 0.03);
      f.shadow.height = f.shadow.width * (0.5 + 0.35 * te);
      f.shadow.alpha = F.alpha * 0.85;
      f.shadow.visible = true;
      f.body.texture = this.tex.get(F.pose)![((F.frame % GLEANER_FRAMES) + GLEANER_FRAMES) % GLEANER_FRAMES]!;
      f.body.position.set(gx, py);
      f.body.scale.set(scale * flip, scale);
      f.body.rotation = F.sway;
      f.body.alpha = F.alpha;
      f.body.zIndex = gy;
      f.body.visible = true;
      const [hx, hy] = at(GLEANER_HEART);
      f.halo.position.set(hx, hy);
      f.halo.width = f.halo.height = haloW;
      f.halo.alpha = 0.28 * F.alpha;
      f.halo.visible = true;
      const [ex, ey] = at(F.pose === 'reach' ? GLEANER_EYE_REACH : GLEANER_EYE);
      f.eyes.position.set(ex, ey);
      f.eyes.width = f.eyes.height = eyesW;
      f.eyes.alpha = F.alpha;
      f.eyes.visible = true;
      // The long arm: from its shoulder out over the cell (the item's place on the belt), as far as `ext`.
      let tip: [number, number] | null = null;
      if (F.pose === 'reach' && F.ext > 0) {
        const [sx, sy] = at(GLEANER_SHOULDER_REACH);
        const cx = P.a * F.tx + P.c * F.ty, cy = P.b * F.tx + P.d * F.ty - lift;
        tip = [sx + (cx - sx) * F.ext, sy + (cy - sy) * F.ext];
        if (F.grab > 0) {
          // The item rides back into its hand: the arm draws in with it.
          const [hx2, hy2] = at(GLEANER_HAND);
          tip = [cx + (hx2 - cx) * F.grab, cy + (hy2 - cy) * F.grab - Math.sin(F.grab * Math.PI) * 5];
        }
        const dx = tip[0] - sx, dy = tip[1] - sy, len = Math.hypot(dx, dy);
        f.arm.visible = len > 3;
        f.arm.position.set(sx, sy);
        f.arm.rotation = Math.atan2(dy, dx);
        f.arm.scale.set(len / ((ARM_TIP[0] - ARM_ROOT[0]) * RES), dx < 0 ? -scale : scale);
        f.arm.alpha = F.alpha;
        f.arm.zIndex = Math.max(gy, P.b * F.tx + P.d * F.ty) + 0.1; // as deep as the line it reaches over
      } else f.arm.visible = false;
      if (F.item < 0) { f.item.visible = false; f.glow.visible = false; return true; }
      const tex = this.atlas.textures.get(ibKey(ITEM_IDS[F.item]!));
      if (tex) f.item.texture = tex;
      f.item.visible = !!tex;
      const [ix, iy] = tip && F.grab >= 0 ? tip : at(GLEANER_HAND);
      f.item.position.set(ix, iy);
      f.item.width = f.item.height = 16 + 3 * (1 - te);
      f.item.alpha = F.alpha;
      f.item.zIndex = (F.grab >= 0 ? Math.max(gy, P.b * F.tx + P.d * F.ty) : gy) + 0.2;
      f.glow.position.set(ix, iy);
      f.glow.width = f.glow.height = itemW;
      f.glow.alpha = 0.6 * F.alpha * (F.grab >= 0 ? 0.5 + 0.5 * F.grab : 1);
      f.glow.visible = true;
      return true;
    };
  }

  private figure(i: number): Figure {
    let f = this.pool[i];
    if (f) return f;
    const shadow = new Sprite(this.shadowTex);
    shadow.anchor.set(0.5);
    shadow.zIndex = -1e7; // under every figure
    const body = new Sprite(this.tex.get('glide')![0]!);
    body.anchor.set(GLEANER_GROUND[0] / GLEANER_W, GLEANER_GROUND[1] / GLEANER_H);
    const arm = new Sprite(this.armTex);
    arm.anchor.set(ARM_ROOT[0] / ARM_W, ARM_ROOT[1] / ARM_H);
    const item = new Sprite(Texture.WHITE);
    item.anchor.set(0.5);
    const mk = (tint: number): Sprite => { const s = new Sprite(this.glowTex); s.anchor.set(0.5); s.tint = tint; return s; };
    const halo = mk(0x9fd8e8), eyes = mk(0xbff9ff), glow = mk(0xffe0a8);
    this.figures.addChild(shadow, body, arm, item);
    this.glows.addChild(halo, eyes, glow);
    f = { shadow, body, arm, item, halo, eyes, glow };
    this.hide(f);
    this.pool.push(f);
    return f;
  }

  private hide(f: Figure): void {
    f.shadow.visible = f.body.visible = f.arm.visible = f.item.visible = f.halo.visible = f.eyes.visible = f.glow.visible = false;
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
