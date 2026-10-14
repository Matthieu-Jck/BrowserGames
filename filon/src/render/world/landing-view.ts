// landing-view.ts — the intro's last beat (D31): the Heart comes down from the Ring into the
// empty cirque. A CrierBelt sky-crane — a square frame with four retro engines and the
// CrierBelt mark on its hub, drawn in the buildings' ink (IsoFrame, at 2×) by the drawing the
// trade post's cargo drone shares (recipes/cargo.ts, `drawCrane` with `SKY_CRANE`) — lowers it
// on four cables: the load drops in fast, the engines brake harder as the ground nears, the shadow
// grows and darkens under it, the plumes raise the desert's dust; touchdown throws a ring of
// dust; the cables reel in and the crane climbs back towards the Ring, drifting downwind as it
// fades. The Heart is its own atlas sprite (`bKey('hearth', rot)`), so it lands pixel for
// pixel where the real one stands.
//
// Pure decoration, like CargoView: it never reads or writes the sim. Everything is placed in
// iso world px under M = isoToView(P) (the volumes' transform, and their fade), on `fxTop`
// (graded by day / night like the world); the flames sit on `fxGlow`, outside the grade, so
// they burn bright at night. The shell (app/intro.ts) hides the real Heart until this one is
// down (BuildingsView.hide), follows `altitude` with the camera and acts on the hooks:
// `touchdown` once, then `done`. Times are real seconds: a cinematic, not game time. Textures
// are baked at `start` and freed when it ends.
import { CanvasSource, Container, Graphics, Matrix, Sprite, Texture } from 'pixi.js';
import type { BuildingId } from '@/content/buildings';
import type { Rot } from '@/sim/types';
import { bKey, type Atlas } from '../art/atlas';
import { ellipsePts, flat } from '../art/ink';
import { SKY_CRANE, craneCableZ, craneCorners as corners, craneFrame, drawCrane, drawFlame, drawHalo, drawPuff } from '../art/recipes/cargo';
import { C, mix, num } from '../art/tokens';
import { LH, tileToIso } from '../iso';
import { isoToView, type Lin } from '../projection';

/** The sequence, in seconds from `start`: the empty cirque, the descent, touchdown, the crane's exit. */
const PRE = 0.8;
const FALL = 4.4;
export const LAND_TOUCHDOWN = PRE + FALL;
/** After touchdown: the cables reel in, then the crane climbs away; the sequence ends. */
const REEL_AT = 0.35, REEL_S = 0.45;
const CLIMB_AT = 0.75;
export const LAND_END = LAND_TOUCHDOWN + 3.4;
/** The load's altitude at the start (iso world px, well above the screen); the climb: pull and first speed (px/s², px/s). */
const A0 = 46 * LH;
const CLIMB_G = 320, CLIMB_V = 40;
/** Below this altitude the plumes raise dust. */
const DUST_ALT = 10 * LH;
/**
 * The crane (footprint-local tiles / levels, `SKY_CRANE`): its frame's margin, the engines' inset
 * (negative: outside the footprint, so the plumes miss the Heart), the winches' inset, heights.
 */
const { margin: M, eng: ENG, hook: HOOK, zNozzle: Z_NOZZLE } = SKY_CRANE;
/** Where the cables take the Heart: its slab's corners, just above the slab. */
const ANCHOR = 0.42, Z_ANCHOR = 0.36;
/** The Sough (tiles per second), as the trade posts' cargo drones' dust drifts. */
const WIND_X = 0.32, WIND_Y = -0.12;
const MAX_PUFFS = 140;

const smooth = (a: number, b: number, v: number): number => {
  const k = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return k * k * (3 - 2 * k);
};

/** A texture owning its canvas (not Texture.from, which would park it in Pixi's global cache). */
function bake(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w);
  cv.height = Math.ceil(h);
  const g = cv.getContext('2d')!;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  return new Texture({ source: new CanvasSource({ resource: cv, scaleMode: 'linear', autoGenerateMipmaps: true }) });
}

interface Puff {
  /** Tile coords and height above the ground (iso px). */
  x: number;
  y: number;
  alt: number;
  vx: number;
  vy: number;
  va: number;
  age: number;
  life: number;
  size: number;
  s: Sprite;
}

export interface LandingSpot {
  /** The building that comes down (its iso art) and its footprint (tiles). */
  readonly id: BuildingId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rot: Rot;
}

export interface LandingHooks {
  /** The load is down (once; also on `skip`). */
  touchdown(): void;
  /** The crane is gone: the sequence is over (once). */
  done(): void;
}

export class LandingView {
  /** Everything under the iso transform, on `fxTop`; the flames under the same transform on `fxGlow`. */
  private readonly root = new Container({ label: 'landing' });
  private readonly glow = new Container({ label: 'landing-glow' });
  private readonly shadow = new Sprite();
  private readonly dustBack = new Container({ label: 'landing-dust-back' });
  private readonly load = new Container({ label: 'landing-load' });
  private readonly cablesBack = new Graphics();
  private readonly heart = new Sprite();
  private readonly cablesFront = new Graphics();
  private readonly craft = new Container({ label: 'landing-crane' });
  private readonly crane = new Sprite();
  private readonly flames = new Container({ label: 'landing-flames' });
  private readonly dustFront = new Container({ label: 'landing-dust-front' });
  private tex: { crane: Texture; flame: Texture; glow: Texture; shadow: Texture; dust: Texture[] } | null = null;
  private readonly flameSprites: Sprite[] = [];
  /** Per engine: a warm halo at the nozzle (with the crane) and the light its plume throws on the ground. */
  private readonly halos: Sprite[] = [];
  private readonly pools: Sprite[] = [];
  private readonly ground = new Container({ label: 'landing-ground-glow' });
  private puffs: Puff[] = [];
  private spare: Sprite[] = [];
  private spot: LandingSpot | null = null;
  private hooks: LandingHooks | null = null;
  private t = 0;
  /** The clock stands still (dev: `seek(t, true)`, frames for review). */
  private held = false;
  private touched = false;
  private emit = 0;
  private rng = 1;
  /** Ground centre of the footprint (iso px) and its depth (tiles), for the dust's side. */
  private gx = 0;
  private gy = 0;
  private depth = 0;
  private te = -1;

  constructor(layer: Container, glowLayer: Container, private readonly atlas: Atlas) {
    this.load.addChild(this.cablesBack, this.heart, this.cablesFront);
    this.craft.addChild(this.crane);
    this.root.addChild(this.shadow, this.dustBack, this.load, this.craft, this.dustFront);
    this.glow.addChild(this.ground, this.flames);
    this.root.visible = this.glow.visible = false;
    layer.addChild(this.root);
    glowLayer.addChild(this.glow);
  }

  /** Is a landing running? */
  get active(): boolean { return this.spot !== null; }

  /** Seconds since the start. */
  get time(): number { return this.t; }

  /** Is the load down? */
  get landed(): boolean { return this.touched; }

  /** The load's height above its spot (iso world px): the camera follows it. */
  get altitude(): number { return this.loadAlt(this.t); }

  /** Bring a building down on its footprint (tile coords); the hooks fire on touchdown and at the end. */
  start(spot: LandingSpot, hooks: LandingHooks): void {
    this.stop();
    this.bakeTextures(spot);
    this.spot = spot;
    this.hooks = hooks;
    this.t = 0;
    this.held = false;
    this.touched = false;
    this.emit = 0;
    this.rng = 0x2545f491;
    const fr = this.atlas.frames.get(bKey(spot.id, spot.rot)) ? bKey(spot.id, spot.rot) : bKey(spot.id, 0);
    const info = this.atlas.frames.get(fr), tex = this.atlas.textures.get(fr);
    [this.gx, this.gy] = tileToIso(spot.x + spot.w / 2, spot.y + spot.h / 2);
    this.depth = spot.x + spot.y + (spot.w + spot.h) / 2;
    // The Heart: anchored as BuildingsView anchors it, relative to the ground centre.
    if (tex && info) {
      const [ax, ay] = tileToIso(spot.x, spot.y);
      this.heart.texture = tex;
      this.heart.scale.set(info.k);
      this.heart.position.set(ax - info.ox * info.k - this.gx, ay - info.oy * info.k - this.gy);
      this.heart.visible = true;
    } else this.heart.visible = false;
    // The crane: its frame's (0, 0) is the footprint's corner minus the margin.
    const [cx, cy] = tileToIso(spot.x - M, spot.y - M);
    const f = craneFrame(spot.w, spot.h, SKY_CRANE);
    this.crane.scale.set(0.5);
    this.crane.position.set(cx - f.ox * 0.5 - this.gx, cy - f.oy * 0.5 - this.gy);
    // Flames hang from the nozzles.
    this.freeFlames();
    for (const [x, y] of corners(spot.w, spot.h, ENG)) {
      const [px, py] = tileToIso(spot.x + x, spot.y + y, Z_NOZZLE + 0.03);
      const halo = new Sprite(this.tex!.glow);
      halo.anchor.set(0.5);
      halo.blendMode = 'add';
      halo.position.set(px - this.gx, py - this.gy + 10);
      const s = new Sprite(this.tex!.flame);
      s.anchor.set(0.5, 6 / (0.75 * 64 + 12));
      s.position.set(px - this.gx, py - this.gy);
      this.flames.addChild(halo, s);
      this.halos.push(halo);
      this.flameSprites.push(s);
      const [qx, qy] = tileToIso(spot.x + x, spot.y + y);
      const pool = new Sprite(this.tex!.glow);
      pool.anchor.set(0.5);
      pool.blendMode = 'add';
      pool.position.set(qx, qy);
      this.ground.addChild(pool);
      this.pools.push(pool);
    }
    this.shadow.texture = this.tex!.shadow;
    this.shadow.anchor.set(0.5);
    this.shadow.position.set(this.gx, this.gy);
    this.load.alpha = this.craft.alpha = this.flames.alpha = 1;
    this.root.visible = this.glow.visible = true;
    this.te = -1;
    this.pose();
  }

  /** Jump to t seconds (dev: frames for review), and hold the clock there if asked. Crossing touchdown fires it. */
  seek(t: number, hold = false): void {
    if (!this.spot) return;
    this.held = hold;
    for (const p of this.puffs) this.freePuff(p);
    this.puffs = [];
    this.t = Math.max(0, Math.min(LAND_END - 0.01, t));
    if (this.t >= LAND_TOUCHDOWN && !this.touched) this.touch(false);
    if (this.t >= LAND_TOUCHDOWN - 0.6) {
      // Some dust already up, as if the frames before had run.
      for (let i = 0; i < 24; i++) this.update(null, -1, 1 / 30, true);
    }
    this.pose();
  }

  /** End now: touchdown (if it has not happened), then done. */
  skip(): void {
    if (!this.spot) return;
    if (!this.touched) this.touch(false);
    this.finish();
  }

  /** Per frame: the view projection and plan-ness (the volumes' fade), dt in real seconds. */
  update(P: Lin | null, te: number, dt: number, replay = false): void {
    if (!this.spot) return;
    if (P && te !== this.te) {
      this.te = te;
      const V = isoToView(P);
      const m = new Matrix(V.a, V.b, V.c, V.d, 0, 0);
      this.root.setFromMatrix(m);
      this.glow.setFromMatrix(m);
      const isoA = te <= 0 ? 1 : te >= 0.6 ? 0 : 1 - te / 0.6;
      this.root.alpha = this.glow.alpha = isoA;
      this.root.visible = this.glow.visible = isoA > 0;
    }
    if (!replay && !this.held) this.t += dt;
    const t = this.t;
    if (!this.touched && t >= LAND_TOUCHDOWN) this.touch(true);
    this.dust(t, dt);
    this.updatePuffs(dt);
    if (!replay) this.pose();
    if (!replay && t >= LAND_END) this.finish();
  }

  /** Free the textures and sprites (the view lives as long as the app; for completeness). */
  destroy(): void {
    this.stop();
    this.root.destroy({ children: true });
    this.glow.destroy({ children: true });
  }

  // ── the sequence ─────────────────────────────────────────────────────────

  /** The load's altitude (iso px) at t: off screen, then a braking fall to the ground. */
  private loadAlt(t: number): number {
    if (!this.spot || t >= LAND_TOUCHDOWN) return 0;
    if (t <= PRE) return A0;
    const u = (t - PRE) / FALL;
    return A0 * (1 - u) ** 2.15;
  }

  /** How hard the engines burn (0–1.5) and the crane's own climb (iso px) after release. */
  private burn(t: number): { k: number; climb: number; fade: number } {
    if (t < LAND_TOUCHDOWN) {
      const u = Math.max(0, (t - PRE) / FALL);
      return { k: 0.55 + 0.75 * smooth(0.3, 0.95, u), climb: 0, fade: 1 };
    }
    const s = t - LAND_TOUCHDOWN;
    if (s < CLIMB_AT) return { k: 0.85 + 0.15 * smooth(0, 0.25, CLIMB_AT - s), climb: 0, fade: 1 };
    const c = s - CLIMB_AT;
    const climb = CLIMB_G * c * c + CLIMB_V * c;
    return { k: 1.35, climb, fade: 1 - smooth(LH * 14, LH * 34, climb) };
  }

  private pose(): void {
    const spot = this.spot;
    if (!spot) return;
    const t = this.t;
    const alt = this.loadAlt(t);
    const { k, climb, fade } = this.burn(t);
    // The load, and the crane with it until it climbs away (downwind, in tiles).
    this.load.position.set(this.gx, this.gy - alt);
    const c = climb / LH;
    const dx = WIND_X * c * 0.12, dy = WIND_Y * c * 0.12;
    const [wx, wy] = tileToIso(dx, dy);
    this.craft.position.set(this.gx + wx, this.gy + wy - alt - climb);
    this.flames.position.copyFrom(this.craft.position);
    this.craft.alpha = this.flames.alpha = fade;
    // The shadow: wide and faint high up, dark and sharp on the ground.
    const hk = 1 - Math.min(1, alt / (A0 * 0.6));
    const sw = (spot.w + spot.h) * 32 * 0.86;
    this.shadow.scale.set((sw / 128) * (0.5 + 0.5 * hk), (sw / 2 / 64) * (0.5 + 0.5 * hk));
    this.shadow.alpha = (0.04 + 0.34 * hk * hk) * (this.touched ? Math.max(0, 1 - (t - LAND_TOUCHDOWN) / 0.5) : 1);
    // The flames flicker, a halo round each nozzle; low over the ground, the plumes light it.
    const near = this.touched ? Math.max(0, 1 - climb / (LH * 8)) : Math.max(0, 1 - alt / (LH * 7));
    for (const [i, s] of this.flameSprites.entries()) {
      const flick = 0.84 + 0.16 * Math.sin(t * 43 + i * 1.7) * Math.sin(t * 27 + i);
      s.scale.set(1.05 * (0.88 + 0.12 * k), 1.05 * k * flick * 1.15);
      s.visible = k > 0.02 && fade > 0.01;
      const halo = this.halos[i]!;
      halo.scale.set(0.55 + 0.22 * k * flick);
      halo.alpha = 0.5 * Math.min(1, k);
      const pool = this.pools[i]!;
      pool.scale.set(1.1 + 0.9 * near, 0.55 + 0.45 * near);
      pool.alpha = 0.32 * near * k;
      pool.visible = pool.alpha > 0.01;
    }
    this.cables(t);
  }

  private freeFlames(): void {
    for (const s of [...this.flameSprites, ...this.halos, ...this.pools]) s.destroy();
    this.flameSprites.length = 0;
    this.halos.length = 0;
    this.pools.length = 0;
  }

  /** The cables: winch to slab corner (the far one behind the Heart); after touchdown they reel in. */
  private cables(t: number): void {
    const spot = this.spot!;
    const g = [this.cablesBack, this.cablesFront];
    for (const x of g) x.clear();
    const reel = this.touched ? smooth(0, 1, (t - LAND_TOUCHDOWN - REEL_AT) / REEL_S) : 0;
    if (reel >= 1) return;
    const up = corners(spot.w, spot.h, HOOK).map(([x, y]) => tileToIso(spot.x + x, spot.y + y, craneCableZ(SKY_CRANE)));
    const lo = corners(spot.w, spot.h, ANCHOR).map(([x, y]) => tileToIso(spot.x + x, spot.y + y, Z_ANCHOR));
    for (let i = 0; i < 4; i++) {
      const gr = i === 0 ? this.cablesBack : this.cablesFront;
      const [ax, ay] = up[i]!, [bx0, by0] = lo[i]!;
      const bx = bx0 + (ax - bx0) * reel, by = by0 + (ay - by0) * reel;
      gr.moveTo(ax - this.gx, ay - this.gy).lineTo(bx - this.gx, by - this.gy);
    }
    for (const x of g) x.stroke({ width: 2.6, color: num(C.ink), cap: 'round' });
    for (let i = 0; i < 4; i++) {
      const gr = i === 0 ? this.cablesBack : this.cablesFront;
      const [ax, ay] = up[i]!, [bx0, by0] = lo[i]!;
      const bx = bx0 + (ax - bx0) * reel, by = by0 + (ay - by0) * reel;
      gr.moveTo(ax - this.gx - 0.7, ay - this.gy).lineTo(bx - this.gx - 0.7, by - this.gy);
    }
    for (const x of g) x.stroke({ width: 0.9, color: num(C.ice), alpha: 0.85, cap: 'round' });
  }

  private touch(live: boolean): void {
    this.touched = true;
    if (live) this.burst();
    this.hooks?.touchdown();
  }

  private finish(): void {
    const hooks = this.hooks;
    this.stop();
    hooks?.done();
  }

  private stop(): void {
    this.spot = null;
    this.hooks = null;
    for (const p of this.puffs) this.freePuff(p);
    this.puffs = [];
    for (const s of this.spare) s.destroy();
    this.spare = [];
    this.freeFlames();
    this.cablesBack.clear();
    this.cablesFront.clear();
    this.root.visible = this.glow.visible = false;
    this.heart.texture = Texture.EMPTY;
    this.crane.texture = Texture.EMPTY;
    this.shadow.texture = Texture.EMPTY;
    if (this.tex) {
      for (const tx of [this.tex.crane, this.tex.flame, this.tex.glow, this.tex.shadow, ...this.tex.dust]) tx.destroy(true);
      this.tex = null;
    }
  }

  private bakeTextures(spot: LandingSpot): void {
    const f = craneFrame(spot.w, spot.h, SKY_CRANE);
    const crane = bake(f.W, f.H, (g) => drawCrane(g, f, spot.w, spot.h, 77, SKY_CRANE));
    const flame = bake(0.5 * 64 + 12, 0.75 * 64 + 12, (g) => drawFlame(g, 0.25 * 64 + 6, 6, 64, 1));
    // A warm halo: flat discs, wide and faint to small and bright (added to what is under it).
    const glow = bake(64, 64, (g) => drawHalo(g, 32, 32));
    const shadow = bake(128, 64, (g) => {
      flat(g, ellipsePts(64, 32, 62, 30, 3, 0.02, 40), C.ink, 0.35);
      flat(g, ellipsePts(64, 32, 50, 24, 4, 0.02, 40), C.ink, 0.45);
    });
    const dustFill = [mix(C.sand, C.salt, 0.45), mix(C.dune, C.sand, 0.55), mix(C.sand, C.paper, 0.35)];
    const dust = [1, 2, 3].map((s, i) => bake(52, 52, (g) => drawPuff(g, 26, 26, 19, s + 4, dustFill[i])));
    this.tex = { crane, flame, glow, shadow, dust };
    this.crane.texture = crane;
  }

  // ── dust ─────────────────────────────────────────────────────────────────

  /** A cheap deterministic jitter (views need no determinism; this keeps a replay stable). */
  private rand(): number {
    this.rng = (Math.imul(this.rng, 1103515245) + 12345) | 0;
    return ((this.rng >>> 8) & 0xffff) / 0x10000;
  }

  /** The plumes raise dust from the ground once the load is low (more the lower it gets). */
  private dust(t: number, dt: number): void {
    const spot = this.spot!;
    const alt = this.loadAlt(t);
    const { climb } = this.burn(t);
    const low = this.touched ? Math.max(0, 1 - climb / (LH * 9)) * 0.6 : Math.max(0, 1 - alt / DUST_ALT);
    if (low <= 0 || dt <= 0) return;
    this.emit -= dt * (8 + 46 * low * low);
    const cx = spot.x + spot.w / 2, cy = spot.y + spot.h / 2;
    while (this.emit <= 0) {
      this.emit += 1;
      // Under one of the engines, blown outwards.
      const k = Math.floor(this.rand() * 4);
      const [ex, ey] = corners(spot.w, spot.h, ENG)[k]!;
      const ox = spot.x + ex - cx, oy = spot.y + ey - cy;
      const len = Math.hypot(ox, oy) || 1;
      const a = Math.atan2(oy, ox) + (this.rand() - 0.5) * 1.3;
      const sp = 1.4 + this.rand() * 2.2;
      const r = len * (0.9 + this.rand() * 0.35);
      this.spawn(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, Math.cos(a) * sp, Math.sin(a) * sp, 6 + this.rand() * 8, 1.1 + this.rand() * 0.9, 0.5 + 0.5 * low);
    }
  }

  /** Touchdown: a ring of dust thrown out from under the slab. */
  private burst(): void {
    const spot = this.spot!;
    const cx = spot.x + spot.w / 2, cy = spot.y + spot.h / 2;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.2;
      const r = (Math.max(spot.w, spot.h) / 2) * (0.95 + this.rand() * 0.2);
      const sp = 2.4 + this.rand() * 2.2;
      this.spawn(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1, Math.cos(a) * sp, Math.sin(a) * sp, 10 + this.rand() * 10, 1.6 + this.rand() * 0.9, 0.95 + this.rand() * 0.3);
    }
  }

  private spawn(x: number, y: number, alt: number, vx: number, vy: number, va: number, life: number, size: number): void {
    if (this.puffs.length >= MAX_PUFFS || !this.tex) return;
    let s = this.spare.pop();
    if (!s) { s = new Sprite(); s.anchor.set(0.5); }
    s.texture = this.tex.dust[this.puffs.length % this.tex.dust.length]!;
    s.visible = true;
    s.rotation = (x * 13.7 + y * 7.1) % (Math.PI * 2);
    // Dust nearer the viewer than the footprint's centre goes in front of the load.
    (x + y > this.depth - 0.25 ? this.dustFront : this.dustBack).addChild(s);
    this.puffs.push({ x, y, alt, vx, vy, va, age: 0, life, size, s });
  }

  private freePuff(p: Puff): void {
    p.s.visible = false;
    p.s.removeFromParent();
    this.spare.push(p.s);
  }

  private updatePuffs(dt: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      p.age += dt;
      if (p.age >= p.life) { this.freePuff(p); this.puffs.splice(i, 1); continue; }
      // The blast slows down, the Sough takes over, the dust lifts a little.
      const drag = Math.exp(-2.4 * dt);
      p.vx = p.vx * drag + WIND_X * (1 - drag);
      p.vy = p.vy * drag + WIND_Y * (1 - drag);
      p.va = p.va * drag + 4 * (1 - drag);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alt = Math.max(0, p.alt + p.va * dt);
      const k = p.age / p.life;
      const [ix, iy] = tileToIso(p.x, p.y);
      p.s.position.set(ix, iy - p.alt);
      p.s.scale.set(p.size * (0.45 + 0.75 * Math.sqrt(k)));
      p.s.alpha = 0.82 * (1 - smooth(0.3, 1, k));
    }
  }
}
