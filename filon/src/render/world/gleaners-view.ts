// gleaners-view.ts — the Gleaners as the base sees them (D103; owner, 2026-10-17: « pour les
// glaneurs, il faut qu'on les voie quand même, la nuit, venir prendre les objets »). Render only: the
// sim holds what they take (sim/flow/chain.ts, sim/systems/gleaners.ts); this view shows the whole
// act where and when it happens, and the glass over the glazed ribbons.
//
// - **The glass hoods** (`glass` layer: a plane under P, over the items, under the volumes): each
//   glazed ribbon on the floor wears its hood (recipes/gleaners.ts `drawGlassCover`), straight or
//   bent as its belt piece is (`beltPiece`, `beltMatrix`), so what it carries shows through glass.
//   Laid at each new graph. A glazed ribbon up on the rock has none (yet).
// - **The tries** — the real thing. Every try the sim will make on an exposed chain is known ahead
//   (`gleanSchedule`: the same rule `gleanStep` runs, a tick of the window and a cell). For each one
//   a Gleaner comes out of the dunes (seven tiles out, on the line's open side, fading in), walks up
//   and leans over the ribbon at that very tick; then the sim's log (`Sim.gleaners.recent`) says
//   whether it took something: if so the item leaves the belt into its hand — the belt's token is
//   gone at that tick, this one rises from the cell — and it runs back into the desert holding it up,
//   glowing; if not (an empty cell, a thing not to its taste) it peers a moment and goes back
//   empty-handed. What the player sees is what the morning report counts.
// - **The glass** (`Graph.glean.glass`: glazed tiles beside open floor, one in `TAP_EVERY`): now and
//   then one comes to the hood, taps it twice (a glint on the glass) and leaves.
// - **The fences** (`Graph.glean.prowl`: open floor beside a fence, one in `PROWL_EVERY`): now and
//   then one paces along outside, and leaves.
// Readable in the dark: the figures are graded with the world, and on the additive `lights` layer
// each carries a soft halo, its lantern eyes and the glow of what it holds, sized so that from afar
// they still read as small moving lights (`zoom`). Only at night (and the last tries' tails at dawn);
// culled to the visible tiles; pooled sprites; nothing by day.
import { CanvasSource, Container, Matrix, Sprite, Texture } from 'pixi.js';
import { BUILDING_KIND, ITEM_IDS, buildingDef } from '@/content/registry';
import { hash32 } from '@/core/hash';
import { GLEAN_WINDOW, gleanSchedule } from '@/sim/flow/chain';
import type { Sim } from '@/sim/state';
import { isFloor } from '@/sim/types';
import { tileIndex } from '@/sim/world/grid';
import { ibKey, type Atlas } from '../art/atlas';
import { BELT_PX } from '../art/recipes/belts';
import {
  GLEANER_EYE, GLEANER_EYE_REACH, GLEANER_FRAMES, GLEANER_H, GLEANER_HAND, GLEANER_REACH, GLEANER_W,
  drawEyeGlow, drawGlassCover, drawGleaner, type GleanerPose,
} from '../art/recipes/gleaners';
import type { Lin } from '../projection';
import { beltMatrix, beltPiece } from './buildings-view';

/** A try's approach (ticks before it), its aftermath (after), the grab and the empty-handed peer within it. */
const APPROACH = 110, AFTER = 90, GRAB = 9, PEER = 14;
/** Where they come from (tiles out from the line) and where they stand to reach (from the tile's centre). */
const OUT = 7.5, EDGE = 0.62;
/** One glazed tile in TAP_EVERY gets a visit every TAP_PERIOD ticks; one fence-side tile in PROWL_EVERY, every PROWL_PERIOD. */
const TAP_EVERY = 5, TAP_PERIOD = 2400, PROWL_EVERY = 6, PROWL_PERIOD = 2400;
/** At most this many figures on screen. */
const MAX_SHOWN = 48;
/** A figure's height on screen (world px) in iso, and in plan. */
const ISO_H = 42, PLAN_H = 24;
/** The textures are drawn at twice their size, for a sharp edge. */
const RES = 2;

/** A try of the window: its tick in it, its tile, the tile's centre and open side, a lateral offset. */
interface Try { t: number; tile: number; x: number; y: number; ox: number; oy: number; lat: number }
/** A visit to the glass or along a fence: where, the way out, its own phase. */
interface Visit { x: number; y: number; ox: number; oy: number; h: number }
interface Figure { body: Sprite; item: Sprite; halo: Sprite; eyes: Sprite; glow: Sprite }
/** Places figure `i` at tile point (x, y), facing (dx, dy), in a pose and walk frame, at an alpha; `item` ≥ 0 held, risen `lift` (0…1) from the belt cell (bx, by). */
type Place = (i: number, x: number, y: number, dx: number, dy: number, pose: GleanerPose, frame: number, alpha: number, item?: number, lift?: number, bx?: number, by?: number) => void;

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
/** Free floor at level 0 (a Gleaner may stand there). */
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

export class GleanersView {
  private readonly covers = new Container({ label: 'glass-hoods' });
  private readonly figures = new Container({ label: 'gleaners' });
  private readonly glows = new Container({ label: 'gleaner-glows' });
  private readonly coverTex: [Texture, Texture];
  private readonly tex = new Map<GleanerPose, Texture[]>();
  private readonly glowTex: Texture;
  private readonly pool: Figure[] = [];
  /** The glints on the glass being tapped (pooled). */
  private readonly flashes: Sprite[] = [];
  private tries: Try[] = [];
  private taps: Visit[] = [];
  private prowls: Visit[] = [];
  private version = -1;
  /** How many figures were out last frame: all, carrying something off, at the glass, along a fence (FL, the shots). */
  shown = 0;
  carrying = 0;
  tapping = 0;
  prowling = 0;
  /** Glints on the glass this frame (a tap). */
  flashing = 0;
  /** Where the last tapper and prowler placed this frame stand (tiles; the shots aim at them). */
  tapAt_: [number, number, number] | null = null;
  prowlAt_: [number, number, number] | null = null;

  constructor(glassLayer: Container, itemsLayer: Container, lightsLayer: Container, private readonly atlas: Atlas) {
    glassLayer.addChild(this.covers);
    itemsLayer.addChild(this.figures);
    lightsLayer.addChild(this.glows);
    this.glows.blendMode = 'add'; // glows add light: their black edges add nothing
    this.coverTex = [canvasTexture(BELT_PX, BELT_PX, (g) => drawGlassCover(g, false)), canvasTexture(BELT_PX, BELT_PX, (g) => drawGlassCover(g, true))];
    for (const pose of ['walk', 'carry', 'reach'] as const) {
      this.tex.set(pose, Array.from({ length: GLEANER_FRAMES }, (_, f) => canvasTexture(GLEANER_W, GLEANER_H, (g) => drawGleaner(g, f, pose))));
    }
    this.glowTex = canvasTexture(32, 32, (g) => drawEyeGlow(g, '#ffffff'));
  }

  /** At each new graph: the hoods over the glazed ribbons; the tries of the window, the glass and the fences to visit. */
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
    // Every try of the window, on each exposed chain, from the line's open side.
    const sides = new Map<number, readonly [number, number] | null>();
    const sideOf = (tile: number): readonly [number, number] | null => {
      let s = sides.get(tile);
      if (s === undefined) sides.set(tile, (s = openSide(sim, tile & 1023, tile >> 10, hash32(tile, 0x9e1) & 3)));
      return s;
    };
    this.tries = [];
    for (const c of g.chains) {
      if (c.gleanRate <= 0) continue;
      for (const { t, cell } of gleanSchedule(c)) {
        const tile = c.tiles[cell]!, side = sideOf(tile);
        if (side) this.tries.push({ t, tile, x: (tile & 1023) + 0.5, y: (tile >> 10) + 0.5, ox: side[0], oy: side[1], lat: ((hash32(tile, t) % 9) - 4) / 2 });
      }
    }
    this.taps = [];
    for (const tile of g.glean.glass) {
      if (hash32(tile, 0x7a9) % TAP_EVERY !== 0) continue;
      const side = sideOf(tile);
      if (side) this.taps.push({ x: (tile & 1023) + 0.5, y: (tile >> 10) + 0.5, ox: side[0], oy: side[1], h: hash32(tile, 0x7a8) });
    }
    this.prowls = [];
    for (const tile of g.glean.prowl) {
      if (hash32(tile, 0x9f0) % PROWL_EVERY !== 0) continue;
      const x = tile & 1023, y = tile >> 10;
      // Out is away from the fence it stands by.
      const f = D4.find(([dx, dy]) => { const e = sim.entityAt(x + dx, y + dy); return !!e && BUILDING_KIND[e.def] === 'fence'; });
      if (f) this.prowls.push({ x: x + 0.5, y: y + 0.5, ox: -f[0], oy: -f[1], h: hash32(tile, 0x9f1) });
    }
  }

  /** Per frame: the night's figures where they are now (`simTicks`: interpolated game ticks; `zoom`: the camera's). */
  update(sim: Sim, P: Lin, te: number, simTicks: number, tiles: readonly [number, number, number, number], zoom: number): void {
    if (sim.graph && sim.graph.version !== this.version) this.rebuild(sim);
    const now = simTicks, tick = Math.floor(now);
    let n = 0, carrying = 0, flashes = 0, tapping = 0, prowling = 0;
    // Nothing by day: not out now, no try's approach begun, no try's tail left.
    if (sim.gleanNight(tick) || sim.gleanNight(tick + APPROACH) || sim.gleanNight(tick - AFTER)) {
      const [x0, y0, x1, y1] = tiles;
      const inView = (x: number, y: number): boolean => x >= x0 - 9 && y >= y0 - 9 && x <= x1 + 9 && y <= y1 + 9;
      const fig = this.placer(P, te, zoom);
      const place: Place = (i, ...rest) => { if (i < MAX_SHOWN) { fig(i, ...rest); n = i + 1; } };
      // The sim's last thefts: tile and tick → item.
      const took = new Map<number, number>();
      const rec = sim.gleaners.recent;
      for (let i = 0; i + 2 < rec.length; i += 3) took.set(rec[i]! * 4096 + (rec[i + 2]! % 4096), rec[i + 1]!);
      const base = tick - (((tick % GLEAN_WINDOW) + GLEAN_WINDOW) % GLEAN_WINDOW);
      for (const tr of this.tries) {
        if (n >= MAX_SHOWN) break;
        let at = base + tr.t;
        if (at - now > GLEAN_WINDOW / 2) at -= GLEAN_WINDOW;
        else if (now - at > GLEAN_WINDOW / 2) at += GLEAN_WINDOW;
        const d = at - now;
        if (d > APPROACH || d < -AFTER || !inView(tr.x, tr.y) || !sim.gleanNight(at)) continue;
        if (this.tryAt(place, n, sim, tr, at, d, now, took)) carrying++;
      }
      if (sim.gleanNight(tick)) {
        let m = n;
        this.tapAt_ = null;
        for (const v of this.taps) {
          if (n >= MAX_SHOWN) break;
          if (!inView(v.x, v.y)) continue;
          const before = n;
          flashes = this.tapAt(place, n, v, now, P, zoom, flashes);
          if (n > before) this.tapAt_ = [v.x, v.y, (now + (v.h % TAP_PERIOD)) % TAP_PERIOD];
        }
        tapping = n - m;
        m = n;
        this.prowlAt_ = null;
        for (const v of this.prowls) {
          if (n >= MAX_SHOWN) break;
          if (!inView(v.x, v.y)) continue;
          const before = n;
          this.prowlAt(place, n, v, now);
          if (n > before) this.prowlAt_ = [v.x, v.y, (now + (v.h % PROWL_PERIOD)) % PROWL_PERIOD];
        }
        prowling = n - m;
      }
    }
    for (let i = n; i < this.pool.length; i++) { const f = this.pool[i]!; f.body.visible = f.item.visible = f.halo.visible = f.eyes.visible = f.glow.visible = false; }
    for (let i = flashes; i < this.flashes.length; i++) this.flashes[i]!.visible = false;
    this.shown = n;
    this.carrying = carrying;
    this.tapping = tapping;
    this.prowling = prowling;
    this.flashing = flashes;
  }

  /** One try, `d` ticks ahead (> 0) or past: the approach, the grab and the carry-away, or an empty-handed peer. Whether it carries something off. */
  private tryAt(place: Place, i: number, sim: Sim, tr: Try, at: number, d: number, now: number, took: ReadonlyMap<number, number>): boolean {
    const px = -tr.oy, py = tr.ox; // across the way out
    const ox = tr.x + tr.ox * OUT + px * tr.lat, oy = tr.y + tr.oy * OUT + py * tr.lat;
    const ex = tr.x + tr.ox * EDGE, ey = tr.y + tr.oy * EDGE;
    if (d > 0) {
      // Out of the dunes and up to the ribbon, leaning in for the last stretch.
      const k = 1 - d / APPROACH, m = smooth(k);
      place(i, ox + (ex - ox) * m, oy + (ey - oy) * m, -tr.ox, -tr.oy, k > 0.9 ? 'reach' : 'walk', Math.floor(now * 0.8 + tr.lat * 3), Math.min(1, k / 0.14));
      return false;
    }
    if (sim.tick <= at) { place(i, ex, ey, -tr.ox, -tr.oy, 'reach', 0, 1); return false; } // the tick itself, not run yet
    const g = -d, item = took.get(tr.tile * 4096 + (at % 4096));
    if (item !== undefined) {
      // The grab: the item rises off the belt into its hand; then away into the desert, held up, glowing.
      if (g < GRAB) { place(i, ex, ey, -tr.ox, -tr.oy, 'reach', 0, 1, item, g / GRAB, tr.x, tr.y); return true; }
      const k = (g - GRAB) / (AFTER - GRAB), m = 1 - (1 - k) * (1 - k);
      const fx = tr.x + tr.ox * OUT - px * tr.lat, fy = tr.y + tr.oy * OUT - py * tr.lat;
      place(i, ex + (fx - ex) * m, ey + (fy - ey) * m, tr.ox, tr.oy, 'carry', Math.floor(now * 1.3 + 1), Math.min(1, (1 - k) / 0.2), item, 1);
      return true;
    }
    // Nothing to take: a moment's peer, then back out empty-handed, slower.
    if (g < PEER) { place(i, ex, ey, -tr.ox, -tr.oy, 'reach', 0, 1); return false; }
    const k = (g - PEER) / (AFTER - PEER), m = smooth(k) * 0.75;
    place(i, ex + (ox - ex) * m, ey + (oy - ey) * m, tr.ox, tr.oy, 'walk', Math.floor(now * 0.6), Math.min(1, (1 - k) / 0.25));
    return false;
  }

  /** A visit to the glass: up to the hood, two taps (a glint each), away. Returns the glints used. */
  private tapAt(place: Place, i: number, v: Visit, now: number, P: Lin, zoom: number, flashes: number): number {
    const ph = (now + (v.h % TAP_PERIOD)) % TAP_PERIOD;
    if (ph >= 170) return flashes;
    const ox = v.x + v.ox * OUT, oy = v.y + v.oy * OUT, ex = v.x + v.ox * EDGE, ey = v.y + v.oy * EDGE;
    if (ph < 70) { const m = smooth(ph / 70); place(i, ox + (ex - ox) * m, oy + (ey - oy) * m, -v.ox, -v.oy, 'walk', Math.floor(now * 0.8), Math.min(1, ph / 10)); return flashes; }
    if (ph < 110) {
      const tap = Math.floor((ph - 70) / 10) % 2 === 0;
      place(i, ex, ey, -v.ox, -v.oy, tap ? 'reach' : 'walk', 0, 1);
      if (tap && (ph - 70) % 10 < 6) this.flash(flashes++, P, v.x + v.ox * 0.2, v.y + v.oy * 0.2, zoom);
      return flashes;
    }
    const k = (ph - 110) / 60, m = smooth(k);
    place(i, ex + (ox - ex) * m, ey + (oy - ey) * m, v.ox, v.oy, 'walk', Math.floor(now * 0.7), Math.min(1, (1 - k) / 0.25));
    return flashes;
  }

  /** A prowl outside a fence: in, a few paces along it, sniffing now and then, and away. */
  private prowlAt(place: Place, i: number, v: Visit, now: number): void {
    const ph = (now + (v.h % PROWL_PERIOD)) % PROWL_PERIOD;
    if (ph >= 260) return;
    const ax = -v.oy, ay = v.ox; // along the fence
    const ox = v.x + v.ox * OUT, oy = v.y + v.oy * OUT, sx = v.x + v.ox * 0.15, sy = v.y + v.oy * 0.15;
    if (ph < 70) { const m = smooth(ph / 70); place(i, ox + (sx - ox) * m, oy + (sy - oy) * m, -v.ox, -v.oy, 'walk', Math.floor(now * 0.8), Math.min(1, ph / 10)); return; }
    if (ph < 200) {
      const a = Math.sin(((ph - 70) / 130) * Math.PI * 2) * 1.6, way = Math.cos(((ph - 70) / 130) * Math.PI * 2) < 0 ? -1 : 1;
      place(i, sx + ax * a, sy + ay * a, ax * way, ay * way, ph % 40 < 8 ? 'reach' : 'walk', Math.floor(now * 0.7), 1);
      return;
    }
    const k = (ph - 200) / 60, m = smooth(k);
    place(i, sx + (ox - sx) * m, sy + (oy - sy) * m, v.ox, v.oy, 'walk', Math.floor(now * 0.8), Math.min(1, (1 - k) / 0.25));
  }

  /** This frame's figure placer (the projection, the morph, the zoom fixed). */
  private placer(P: Lin, te: number, zoom: number): (i: number, x: number, y: number, dx: number, dy: number, pose: GleanerPose, frame: number, alpha: number, item?: number, lift?: number, bx?: number, by?: number) => void {
    const scale = (ISO_H * (1 - te) + PLAN_H * te) / GLEANER_H / RES;
    // Glows keep a size on screen from afar (world px ÷ zoom): small moving lights.
    const z = Math.max(0.05, zoom);
    const haloW = Math.max(90, 34 / z), eyesW = Math.max(18, 9 / z), itemW = Math.max(26, 11 / z);
    return (i, x, y, dx, dy, pose, frame, alpha, item = -1, lift = 1, bx = 0, by = 0) => {
      const f = this.figure(i);
      if (alpha <= 0.01) { f.body.visible = f.item.visible = f.halo.visible = f.eyes.visible = f.glow.visible = false; return; }
      const gx = P.a * x + P.c * y, gy = P.b * x + P.d * y;
      const flip = P.a * dx + P.c * dy < 0 ? -1 : 1; // facing the way it goes, on screen
      f.body.texture = this.tex.get(pose)![((frame % GLEANER_FRAMES) + GLEANER_FRAMES) % GLEANER_FRAMES]!;
      f.body.position.set(gx, gy);
      f.body.scale.set(scale * flip, scale);
      f.body.alpha = alpha;
      f.body.visible = true;
      const k = RES * scale;
      const at = (p: readonly [number, number]): [number, number] => [gx + (p[0] - GLEANER_W / 2) * k * flip, gy + (p[1] - GLEANER_H) * k];
      const [hx, hy] = at([GLEANER_W / 2, GLEANER_H * 0.55]);
      f.halo.position.set(hx, hy);
      f.halo.width = f.halo.height = haloW;
      f.halo.alpha = 0.3 * alpha;
      f.halo.visible = true;
      const [ex, ey] = at(pose === 'reach' ? GLEANER_EYE_REACH : GLEANER_EYE);
      f.eyes.position.set(ex, ey);
      f.eyes.width = f.eyes.height = eyesW;
      f.eyes.alpha = alpha;
      f.eyes.visible = true;
      if (item < 0) { f.item.visible = false; f.glow.visible = false; return; }
      const tex = this.atlas.textures.get(ibKey(ITEM_IDS[item]!));
      if (tex) f.item.texture = tex;
      f.item.visible = !!tex;
      const hand = at(pose === 'reach' ? GLEANER_REACH : [GLEANER_HAND[0], GLEANER_HAND[1] - 5]);
      let ix = hand[0], iy = hand[1];
      if (lift < 1) {
        // Off the belt: from its place on the ribbon, up into the hand.
        const cx = P.a * bx + P.c * by, cy = P.b * bx + P.d * by - 4 * (1 - te);
        ix = cx + (hand[0] - cx) * lift;
        iy = cy + (hand[1] - cy) * lift - Math.sin(lift * Math.PI) * 6;
      }
      f.item.position.set(ix, iy);
      f.item.width = f.item.height = 16 + 3 * (1 - te);
      f.item.alpha = alpha;
      f.glow.position.set(ix, iy);
      f.glow.width = f.glow.height = itemW;
      f.glow.alpha = 0.55 * alpha * Math.min(1, 0.4 + lift);
      f.glow.visible = true;
    };
  }

  private figure(i: number): Figure {
    let f = this.pool[i];
    if (f) return f;
    const body = new Sprite(this.tex.get('walk')![0]!);
    body.anchor.set(0.5, 1);
    const item = new Sprite(Texture.WHITE);
    item.anchor.set(0.5);
    const mk = (tint: number): Sprite => { const s = new Sprite(this.glowTex); s.anchor.set(0.5); s.tint = tint; return s; };
    const halo = mk(0x9fd8e8), eyes = mk(0xbff9ff), glow = mk(0xffe0a8);
    this.figures.addChild(body, item);
    this.glows.addChild(halo, eyes, glow);
    f = { body, item, halo, eyes, glow };
    this.pool.push(f);
    return f;
  }

  /** A glint on the glass where a Gleaner taps it. */
  private flash(i: number, P: Lin, x: number, y: number, zoom: number): void {
    let s = this.flashes[i];
    if (!s) { s = new Sprite(this.glowTex); s.anchor.set(0.5); s.tint = 0xe8fbff; this.glows.addChild(s); this.flashes.push(s); }
    s.position.set(P.a * x + P.c * y, P.b * x + P.d * y);
    s.width = s.height = Math.max(28, 11 / Math.max(0.05, zoom));
    s.alpha = 0.9;
    s.visible = true;
  }
}
