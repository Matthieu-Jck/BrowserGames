// cargo-view.ts — the Crier made visible from the ground: at each epoch boundary where a trade
// post sold or bought, a CrierBelt cargo drone works its deck. The drone is the intro's sky-crane
// at 0.9 scale, the very same drawing (recipes/cargo.ts, `drawCrane`): the two read as one
// company's machines. A sale: the deck's lift (an iris) brings a freight container up, the drone
// comes down over it, pays out its four cables, hooks it, strains and hauls it up towards the
// Ring, the load swinging a little. A purchase: the drone sets a container down on the deck,
// unhooks and climbs away, and the lift takes the container in. The choreography is pure maths
// (cargo-flight.ts); this file bakes the textures and places the sprites.
//
// Pure decoration: it never reads or writes the sim (the shell hands it each post's footprint at
// launch). Billboards in view world px placed with P: high over the land in iso, smaller and
// flatter in plan. On `fxTop` (graded with the world): the iris, the shadows,
// dust, the container, its cables. On `fxGlow` (outside the grade, bright at night): the plumes'
// light on the ground, the halos and flames, the drone and, at night, the drone's own lights.
// The drone sits on `fxGlow`, over its exhaust, so it hides it as the real thing would: each
// plume leaves its nozzle under a pod, and the hub and beams stand in front of the back
// engine's whole plume (drawn over the drone, that plume burned across the hub). It copies
// `fxTop`'s tint every frame, so it is graded like the rest of the cargo.
// Times are game seconds: the shell passes dt = 0 while paused, and drones hang still.
//
// Costs: every texture is baked once, at construction; sprites are pooled (at most MAX_DRONES
// drones, MAX_PUFFS dust puffs on each side of the load); update() allocates nothing.
import { CanvasSource, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { C, mix, num } from '../art/tokens';
import { ellipsePts, flat, type Pt } from '../art/ink';
import { ILH, IsoFrame } from '../art/iso-shapes';
import {
  CARGO_DRONE, CONTAINER, DRONE_BAY, containerEyes, containerFrame, craneCableZ, craneCorners, craneFrame,
  drawContainer, drawCrane, drawFlame, drawHalo, drawHatch, drawPuff, hatchFrame,
} from '../art/recipes/cargo';
import { artOf, type GlowClass } from '../art/recipes/fx';
import { LH } from '../iso';
import type { Lin } from '../projection';
import {
  DECK_Z, HANG, LIFTOFF, SLAB_Z, TOUCHDOWN, deckCentre, endOf, followAfter, newPose, poseAt,
  type CargoPad, type CargoSide, type Pose,
} from './cargo-flight';

export type { CargoPad, CargoSide } from './cargo-flight';

/** Live drones at most, waiting ones included (launches past it are dropped); drones waiting their turn per post. */
const MAX_DRONES = 4;
const MAX_WAITING = 1;
/** Dust puffs at most, behind the load and in front of it. */
const MAX_PUFFS = 40;
/** How much of any altitude, and of the sprites' size, the plan view keeps. */
const PLAN_ALT = 0.18;
const PLAN_SCALE = 0.45;
/** The Sough (tiles per second), as the landing's dust leans. */
const WIND_X = 0.32, WIND_Y = -0.12;
/** Steps baked for the lift: the container drawn 1/PHASES, 2/PHASES … all the way out of the hatch. */
const PHASES = 12;
/** Textures are drawn at 2× world px. */
const K = 0.5;
/** The deck's top and the post's slab over the ground (iso px). */
const DECK_PX = DECK_Z * LH, SLAB_PX = SLAB_Z * LH;
/** Under this altitude (iso px) the plumes stir dust and light the slab. */
const NEAR = 8 * LH;
/** The cable texture's height (px): one stretched sprite per cable. */
const CABLE_H = 4;
const DRONE_SEED = 91, LOAD_SEED = 61, HATCH_SEED = 71;
const FLAME_W = 0.5 * 64 + 12, FLAME_H = 0.75 * 64 + 12;
/** The drone's shadow: the width of its frame (iso px at scale 1), as an ellipse 128 px wide. */
const SHADOW_W = (DRONE_BAY - 2 * CARGO_DRONE.eng) * 64 * 0.82;
const TINT: Record<GlowClass, number> = { cold: num(C.led), warm: num(C.ledWarm), red: num(C.ledRed), green: num(C.ledGreen) };

/** A canvas drawn once. */
function paint(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w);
  cv.height = Math.ceil(h);
  const g = cv.getContext('2d')!;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  return cv;
}

/**
 * A texture owning its canvas (not Texture.from, which would park it in Pixi's global cache),
 * with the anchor its sprites take (canvas px).
 */
function bake(w: number, h: number, ax: number, ay: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const cv = paint(w, h, draw);
  return new Texture({ source: new CanvasSource({ resource: cv, scaleMode: 'linear', autoGenerateMipmaps: true }), defaultAnchor: { x: ax / cv.width, y: ay / cv.height } });
}

interface Textures {
  drone: Texture;
  /** The container out of the hatch by (i + 1) / PHASES; the last one whole. One sheet, trimmed frames sharing one anchor. */
  load: Texture[];
  hatch: Texture;
  shadow: Texture;
  loadShadow: Texture;
  flame: Texture;
  halo: Texture;
  spark: Texture;
  cable: Texture;
  dust: Texture[];
}

/** One of the drone's lights, from its sprite's anchor (texture px), for the night glows. */
interface Nav { x: number; y: number; r: number; tint: number; blink: boolean }

interface Drone {
  live: boolean;
  /** The deck's centre (tile coords). */
  x: number;
  y: number;
  side: CargoSide;
  /** Seconds since its start; negative while it waits for the drone before it at the same deck. */
  age: number;
  /** Jitter state for its dust, seconds' worth of dust owed, its touchdown / lift-off burst done. */
  rng: number;
  emit: number;
  burst: boolean;
  /** The container texture shown (−1: none yet). */
  phase: number;
  hatch: Sprite;
  shadow: Sprite;
  loadShadow: Sprite;
  load: Sprite;
  body: Sprite;
  cables: Sprite[];
  flames: Sprite[];
  halos: Sprite[];
  pools: Sprite[];
  navs: Sprite[];
}

interface Puff {
  /** Tile coords and altitude over the ground (iso px): projected every frame, so puffs follow the morph. */
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

/** A fixed pool of puffs: the first `n` are alive. */
interface PuffPool { items: Puff[]; n: number }

const smooth = (a: number, b: number, v: number): number => {
  const k = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return k * k * (3 - 2 * k);
};

export class CargoView {
  // fxTop, back to front.
  private readonly hatches = new Container({ label: 'cargo-hatches' });
  private readonly shadows = new Container({ label: 'cargo-shadows' });
  private readonly dustBack = new Container({ label: 'cargo-dust-back' });
  private readonly loads = new Container({ label: 'cargo-loads' });
  private readonly cableLayer = new Container({ label: 'cargo-cables' });
  private readonly dustFront = new Container({ label: 'cargo-dust-front' });
  // fxGlow, back to front: the exhaust, the drone over it (graded by hand), its lights.
  private readonly poolLayer = new Container({ label: 'cargo-plume-light' });
  private readonly flameLayer = new Container({ label: 'cargo-flames' });
  private readonly bodies = new Container({ label: 'cargo-drones' });
  private readonly navLayer = new Container({ label: 'cargo-lights' });
  /** `fxTop`, whose day / night tint the drones copy. */
  private readonly graded: Container;
  private readonly tex: Textures;
  /** From the drone sprite's anchor (texture px): its nozzles and its cable winches; its engines from the deck's centre (tiles). */
  private readonly nozzle = new Float64Array(8);
  private readonly winch = new Float64Array(8);
  private readonly engTile = new Float64Array(8);
  private readonly navs: Nav[] = [];
  /** From the container sprite's anchor (texture px): its lifting eyes; its height. */
  private readonly eyes = new Float64Array(8);
  private readonly loadH = CONTAINER.h * ILH;
  private readonly drones: Drone[] = [];
  private readonly back: PuffPool = { items: [], n: 0 };
  private readonly front: PuffPool = { items: [], n: 0 };
  private readonly pose: Pose = newPose();
  private launches = 0;
  /** The last frame's view (for `seek`). */
  private lastP: Lin | null = null;
  private lastT = 0;
  private lastNight = 0;
  /** Milliseconds the textures took to bake (perf review). */
  readonly bakeMs: number;

  constructor(layer: Container, glowLayer: Container) {
    const t0 = performance.now();
    this.graded = layer;
    layer.addChild(this.hatches, this.shadows, this.dustBack, this.loads, this.cableLayer, this.dustFront);
    glowLayer.addChild(this.poolLayer, this.flameLayer, this.bodies, this.navLayer);
    this.tex = this.bakeTextures();
    for (let i = 0; i < MAX_DRONES; i++) this.drones.push(this.makeDrone());
    for (const [pool, parent] of [[this.back, this.dustBack], [this.front, this.dustFront]] as const) {
      for (let i = 0; i < MAX_PUFFS; i++) {
        const s = new Sprite(this.tex.dust[i % this.tex.dust.length]!);
        s.anchor.set(0.5);
        s.visible = false;
        parent.addChild(s);
        pool.items.push({ x: 0, y: 0, alt: 0, vx: 0, vy: 0, va: 0, age: 0, life: 1, size: 1, s });
      }
    }
    this.bakeMs = performance.now() - t0;
  }

  /**
   * A drone works a trade post's deck: a sale hauls a container up, a purchase brings one down.
   * It waits its turn behind the drones already at that deck; past the caps the launch is dropped
   * (a burst of boundaries — a catch-up, FL.tick — shows its first drones, never a long queue).
   */
  launch(pad: CargoPad, side: CargoSide): void {
    const [x, y] = deckCentre(pad);
    let start = 0, waiting = 0;
    let free: Drone | null = null;
    for (const d of this.drones) {
      if (!d.live) { free ??= d; continue; }
      if (Math.abs(d.x - x) >= 0.01 || Math.abs(d.y - y) >= 0.01) continue;
      start = Math.min(start, d.age - followAfter(d.side));
      if (d.age < 0) waiting++;
    }
    if (!free || waiting >= MAX_WAITING) return;
    free.live = true;
    free.x = x;
    free.y = y;
    free.side = side;
    free.age = start;
    free.rng = Math.imul(++this.launches, 2654435761) | 1;
    free.emit = 1;
    free.burst = false;
    free.phase = -1;
  }

  /** Per frame: P the view projection, t the plan-ness, dt seconds (game time: 0 when paused), night 0–1 (the drone's lights). */
  update(P: Lin, t: number, dt: number, night = 0): void {
    this.lastP = P;
    this.lastT = t;
    this.lastNight = night;
    const lift = 1 - t + PLAN_ALT * t;
    const view = 1 + (PLAN_SCALE - 1) * t;
    const grade = this.graded.tint;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i]!;
      if (!d.live) continue;
      d.age += dt;
      if (d.age >= endOf(d.side)) { this.free(d); continue; }
      if (d.age < 0) { this.hide(d); continue; }
      d.body.tint = grade;
      this.place(d, P, t, lift, view, dt, night);
    }
    this.updatePuffs(this.back, P, lift, view, dt);
    this.updatePuffs(this.front, P, lift, view, dt);
  }

  /**
   * Review (dev): put every live drone `age` seconds into its sequence, with the dust as if the
   * frames before had run. Pause the game (dt = 0) to hold the pose.
   */
  seek(age: number): void {
    const P = this.lastP;
    if (!P) return;
    for (const pool of [this.back, this.front]) while (pool.n > 0) pool.items[--pool.n]!.s.visible = false;
    for (const d of this.drones) {
      if (!d.live) continue;
      d.age = Math.max(0, Math.min(endOf(d.side) - 0.01, age) - 0.8);
      d.burst = d.age >= (d.side === 'buy' ? TOUCHDOWN : LIFTOFF);
      d.emit = 1;
    }
    for (let i = 0; i < 24; i++) this.update(P, this.lastT, 0.8 / 24, this.lastNight);
  }

  /** Ground every drone and settle the dust at once (the app swaps the base: nothing flies over from the old one). */
  clear(): void {
    for (const d of this.drones) if (d.live) this.free(d);
    for (const pool of [this.back, this.front]) {
      for (let i = 0; i < pool.n; i++) pool.items[i]!.s.visible = false;
      pool.n = 0;
    }
  }

  /** For review and tests: drones alive (waiting ones included) and dust puffs in the air. */
  stats(): { drones: number; puffs: number } {
    let n = 0;
    for (const d of this.drones) if (d.live) n++;
    return { drones: n, puffs: this.back.n + this.front.n };
  }

  /** Free the textures and sprites (the view lives as long as the app; for completeness). */
  destroy(): void {
    for (const c of [this.hatches, this.shadows, this.dustBack, this.loads, this.cableLayer, this.dustFront, this.poolLayer, this.flameLayer, this.bodies, this.navLayer]) c.destroy({ children: true });
    const t = this.tex;
    const sheet = t.load[0]?.source;
    for (const tx of t.load) tx.destroy(false);
    sheet?.destroy();
    for (const tx of [t.drone, t.hatch, t.shadow, t.loadShadow, t.flame, t.halo, t.spark, t.cable, ...t.dust]) tx.destroy(true);
    this.drones.length = 0;
  }

  // ── textures ─────────────────────────────────────────────────────────────

  private bakeTextures(): Textures {
    // The drone, and from its anchor (the bay's centre at its nozzles' level) its nozzles, winches and lights.
    const B = DRONE_BAY, g = CARGO_DRONE, df = craneFrame(B, B, g);
    const [ax, ay] = df.p(g.margin + B / 2, g.margin + B / 2, g.zNozzle);
    const drone = bake(df.W, df.H, ax, ay, (c) => drawCrane(c, df, B, B, DRONE_SEED, g));
    const engines = craneCorners(B, B, g.eng), hooks = craneCorners(B, B, g.hook);
    for (let i = 0; i < 4; i++) {
      const [ex, ey] = engines[i]!, [hx, hy] = hooks[i]!;
      const [nx, ny] = df.p(ex + g.margin, ey + g.margin, g.zNozzle + 0.03);
      const [wx, wy] = df.p(hx + g.margin, hy + g.margin, craneCableZ(g));
      this.nozzle[2 * i] = nx - ax;
      this.nozzle[2 * i + 1] = ny - ay;
      this.winch[2 * i] = wx - ax;
      this.winch[2 * i + 1] = wy - ay;
      this.engTile[2 * i] = ex - B / 2;
      this.engTile[2 * i + 1] = ey - B / 2;
    }
    // Its lights, wherever the drawing puts them (the light spy, as the buildings' night lights).
    for (const e of artOf((c) => drawCrane(c, df, B, B, DRONE_SEED, g), ax, ay).emitters) {
      this.navs.push({ x: e.x, y: e.y, r: Math.max(e.w, e.h), tint: TINT[e.glow], blink: e.glow === 'warm' || e.glow === 'cold' });
    }

    // The container, out of the hatch by steps: one sheet, each step cropped to what it paints.
    const cf = containerFrame();
    const [cx, cy] = cf.p(CONTAINER.w / 2, CONTAINER.d / 2, 0);
    for (const [i, [x, y]] of containerEyes().entries()) {
      const [px, py] = cf.p(x, y, CONTAINER.h);
      this.eyes[2 * i] = px - cx;
      this.eyes[2 * i + 1] = py - cy;
    }
    // Two rows of cells (8 px apart against mipmap bleed), so the sheet stays within 2048 px.
    const cols = Math.ceil(PHASES / 2);
    const bottom = Math.min(cf.H, Math.ceil(cf.p(CONTAINER.w, CONTAINER.d, 0)[1] + 4));
    const tops: number[] = [];
    for (let i = 0; i < PHASES; i++) tops.push(Math.max(0, Math.floor(cf.oy - ((i + 1) / PHASES) * CONTAINER.h * ILH - 5)));
    const cellW = cf.W + 8, cellH = bottom - Math.min(...tops) + 8;
    const sheet = paint(cellW * cols, cellH * 2, (c) => {
      for (let i = 0; i < PHASES; i++) {
        c.save();
        c.translate((i % cols) * cellW, Math.floor(i / cols) * cellH - tops[i]!);
        c.beginPath();
        c.rect(0, tops[i]!, cf.W, bottom - tops[i]!);
        c.clip();
        drawContainer(c, cf, (1 - (i + 1) / PHASES) * CONTAINER.h, LOAD_SEED);
        c.restore();
      }
    });
    const src = new CanvasSource({ resource: sheet, scaleMode: 'linear', autoGenerateMipmaps: true });
    const load = tops.map((top, i) => {
      const h = bottom - top;
      return new Texture({
        source: src, frame: new Rectangle((i % cols) * cellW, Math.floor(i / cols) * cellH, cf.W, h),
        orig: new Rectangle(0, 0, cf.W, cf.H), trim: new Rectangle(0, top, cf.W, h),
        defaultAnchor: { x: cx / cf.W, y: cy / cf.H },
      });
    });

    // The hatch on the deck, the container's contact shadow, the drone's shadow.
    const hf = hatchFrame();
    const [hx, hy] = hf.p(hf.w / 2, hf.h / 2, 0);
    const hatch = bake(hf.W, hf.H, hx, hy, (c) => drawHatch(c, hf, HATCH_SEED));
    const sf = new IsoFrame(CONTAINER.w + 0.4, CONTAINER.d + 0.4, 0, 0);
    const [sx, sy] = sf.p(sf.w / 2, sf.h / 2, 0);
    const foot = (d: number): Pt[] => [sf.p(d, d), sf.p(sf.w - d, d), sf.p(sf.w - d, sf.h - d), sf.p(d, sf.h - d)];
    const loadShadow = bake(sf.W, sf.H, sx, sy, (c) => { flat(c, foot(0.08), C.ink, 0.16); flat(c, foot(0.2), C.ink, 0.24); });
    const shadow = bake(128, 64, 64, 32, (c) => {
      flat(c, ellipsePts(64, 32, 62, 30, 3, 0.02, 40), C.ink, 0.35);
      flat(c, ellipsePts(64, 32, 50, 24, 4, 0.02, 40), C.ink, 0.45);
    });

    // The exhaust (the intro crane's), a light's glow, a cable, the dust the plumes raise.
    const flame = bake(FLAME_W, FLAME_H, FLAME_W / 2, 6, (c) => drawFlame(c, 0.25 * 64 + 6, 6, 64, 1));
    const halo = bake(64, 64, 32, 32, (c) => drawHalo(c, 32, 32));
    const spark = bake(32, 32, 16, 16, (c) => { for (const r of [15, 11, 7, 4, 2]) flat(c, ellipsePts(16, 16, r, r, 2, 0, 20), '#ffffff', 0.2); });
    const cable = bake(8, CABLE_H, 4, 0, (c) => {
      c.fillStyle = C.ink;
      c.fillRect(1.4, 0, 5.2, CABLE_H);
      c.fillStyle = C.ice;
      c.globalAlpha = 0.85;
      c.fillRect(2.4, 0, 1.6, CABLE_H);
    });
    const dustFill = [mix(C.sand, C.salt, 0.45), mix(C.dune, C.sand, 0.55), mix(C.sand, C.paper, 0.35)];
    const dust = [1, 2, 3].map((s, i) => bake(52, 52, 26, 26, (c) => drawPuff(c, 26, 26, 19, s + 4, dustFill[i])));
    return { drone, load, hatch, shadow, loadShadow, flame, halo, spark, cable, dust };
  }

  private makeDrone(): Drone {
    const sp = (tex: Texture, parent: Container, add = false): Sprite => {
      const s = new Sprite(tex);
      if (add) s.blendMode = 'add';
      s.visible = false;
      parent.addChild(s);
      return s;
    };
    const four = (tex: Texture, parent: Container, add = false): Sprite[] => [0, 1, 2, 3].map(() => sp(tex, parent, add));
    const t = this.tex;
    return {
      live: false, x: 0, y: 0, side: 'sell', age: 0, rng: 1, emit: 1, burst: false, phase: -1,
      hatch: sp(t.hatch, this.hatches),
      shadow: sp(t.shadow, this.shadows),
      loadShadow: sp(t.loadShadow, this.shadows),
      load: sp(t.load[PHASES - 1]!, this.loads),
      cables: four(t.cable, this.cableLayer),
      pools: four(t.halo, this.poolLayer, true),
      halos: four(t.halo, this.flameLayer, true),
      flames: four(t.flame, this.flameLayer),
      body: sp(t.drone, this.bodies),
      navs: this.navs.map((n) => { const s = sp(t.spark, this.navLayer, true); s.tint = n.tint; return s; }),
    };
  }

  // ── drones ───────────────────────────────────────────────────────────────

  private hide(d: Drone): void {
    d.hatch.visible = d.shadow.visible = d.loadShadow.visible = d.load.visible = d.body.visible = false;
    for (let i = 0; i < 4; i++) d.cables[i]!.visible = d.flames[i]!.visible = d.halos[i]!.visible = d.pools[i]!.visible = false;
    for (let i = 0; i < d.navs.length; i++) d.navs[i]!.visible = false;
  }

  private free(d: Drone): void {
    this.hide(d);
    d.live = false;
  }

  /** A cheap deterministic jitter per drone (views need no determinism; this keeps a replay stable). */
  private rand(d: Drone): number {
    d.rng = (Math.imul(d.rng, 1103515245) + 12345) | 0;
    return ((d.rng >>> 8) & 0xffff) / 0x10000;
  }

  private place(d: Drone, P: Lin, t: number, lift: number, view: number, dt: number, night: number): void {
    const p = poseAt(d.side, d.age, this.pose);
    const s = K * view;
    // The deck's centre, on its top; the drift downwind (tiles → view px).
    const gx = P.a * d.x + P.c * d.y, gy = P.b * d.x + P.d * d.y;
    const deckY = gy - DECK_PX * (1 - t);
    const wx = WIND_X * p.drift, wy = WIND_Y * p.drift;
    const ox = P.a * wx + P.c * wy, oy = P.b * wx + P.d * wy;

    // The lift's iris in the deck, dilating open and shut.
    d.hatch.visible = p.hatch > 0.01;
    d.hatch.position.set(gx, deckY);
    d.hatch.scale.set(s * (0.1 + 0.9 * p.hatch));
    d.hatch.alpha = Math.min(1, 4 * p.hatch);

    // The container: its base over the deck; while it hangs it drifts with the drone and swings
    // under it — a pendulum from the winches, tilting a little about its eyes.
    const hx = p.hung ? ox : 0, hy = p.hung ? oy : 0;
    const Hs = this.loadH * s, L = HANG * view;
    const th = p.swing, tilt = 0.35 * th;
    const cs = Math.cos(tilt), sn = Math.sin(tilt);
    const topX = gx + hx - L * Math.sin(th), topY = deckY + hy - p.load * lift - Hs - L * (1 - Math.cos(th));
    const lx = topX - Hs * sn, ly = topY + Hs * cs;
    const ph = p.emerge <= 0 || p.loadA <= 0.01 ? -1 : Math.min(PHASES - 1, Math.ceil(p.emerge * PHASES - 1e-6) - 1);
    const load = d.load;
    load.visible = ph >= 0;
    if (ph >= 0) {
      if (d.phase !== ph) { load.texture = this.tex.load[ph]!; d.phase = ph; }
      load.position.set(lx, ly);
      load.rotation = tilt;
      load.scale.set(s);
      load.alpha = p.loadA;
    }
    // Its contact shadow on the deck, while it stands on it or hangs just above.
    const ls = d.loadShadow;
    ls.alpha = 0.9 * Math.max(0, 1 - p.load / (2.5 * LH)) * p.loadA * Math.min(1, Math.max(0, 2 * p.emerge - 1));
    ls.visible = ls.alpha > 0.01;
    ls.position.set(gx + hx, deckY + hy);
    ls.scale.set(s);

    // The drone over the deck, and its shadow: faint and wide high up, dark and tight low.
    const bx = gx + ox, by = deckY + oy - p.drone * lift;
    const shown = p.droneA > 0.01;
    d.body.visible = shown;
    d.body.position.set(bx, by);
    d.body.scale.set(s);
    d.body.alpha = p.droneA;
    const hk = 1 - Math.min(1, p.drone / (14 * LH));
    d.shadow.visible = shown;
    d.shadow.position.set(bx, deckY + oy);
    d.shadow.scale.set((SHADOW_W / 128) * (0.55 + 0.45 * hk) * view);
    d.shadow.alpha = (0.03 + 0.3 * hk * hk) * p.droneA;

    // The cables, winch to eye: paid out, taut under the load, reeled in.
    for (let i = 0; i < 4; i++) {
      const cb = d.cables[i]!;
      if (!shown || p.cable <= 0.001) { cb.visible = false; continue; }
      const ex0 = this.eyes[2 * i]! * s, ey0 = this.eyes[2 * i + 1]! * s;
      const qx = bx + this.winch[2 * i]! * s, qy = by + this.winch[2 * i + 1]! * s;
      const vx = (lx + ex0 * cs - ey0 * sn - qx) * p.cable, vy = (ly + ex0 * sn + ey0 * cs - qy) * p.cable;
      const len = Math.sqrt(vx * vx + vy * vy);
      cb.visible = len > 0.5;
      cb.position.set(qx, qy);
      cb.rotation = Math.atan2(-vx, vy);
      cb.scale.set(s, len / CABLE_H);
      cb.alpha = p.droneA;
    }

    // Flames and halos at the nozzles; low over the post, the plumes light the slab under them.
    const burning = shown && p.burn > 0.02;
    const near = Math.max(0, 1 - p.drone / NEAR);
    const kf = 1.05 * CARGO_DRONE.k * view;
    for (let i = 0; i < 4; i++) {
      const nx = bx + this.nozzle[2 * i]! * s, ny = by + this.nozzle[2 * i + 1]! * s;
      const flick = 0.84 + 0.16 * Math.sin(d.age * 43 + i * 1.7) * Math.sin(d.age * 27 + i);
      const fl = d.flames[i]!;
      fl.visible = burning;
      fl.position.set(nx, ny);
      fl.scale.set(kf * (0.88 + 0.12 * p.burn), kf * p.burn * flick * 1.15);
      fl.alpha = p.droneA;
      const ha = d.halos[i]!;
      ha.visible = burning;
      ha.position.set(nx, ny + 8 * view);
      ha.scale.set((0.55 + 0.22 * p.burn * flick) * CARGO_DRONE.k * view);
      ha.alpha = 0.5 * Math.min(1, p.burn) * p.droneA;
      const po = d.pools[i]!;
      const tx = d.x + this.engTile[2 * i]! + wx, ty = d.y + this.engTile[2 * i + 1]! + wy;
      po.position.set(P.a * tx + P.c * ty, P.b * tx + P.d * ty - SLAB_PX * (1 - t));
      po.scale.set((0.8 + 0.6 * near) * view, (0.4 + 0.3 * near) * view);
      po.alpha = 0.32 * near * Math.min(1.2, p.burn) * p.droneA;
      po.visible = burning && po.alpha > 0.01;
    }

    // At night, the drone's own lights: nav lights steady, beacons flashing.
    const flash = (d.age * 0.9) % 1 < 0.14 ? 1 : 0.2;
    for (let i = 0; i < this.navs.length; i++) {
      const n = this.navs[i]!, sp = d.navs[i]!;
      sp.visible = shown && night > 0.02;
      if (!sp.visible) continue;
      sp.position.set(bx + n.x * s, by + n.y * s);
      sp.scale.set(((n.r * K * 3.5) / 32) * view);
      sp.alpha = night * p.droneA * (n.blink ? flash : 0.85);
    }

    // Dust stirred from the slab while it is low; a ring of it as the container lands or leaves the deck.
    if (dt > 0 && shown && near > 0) {
      d.emit -= dt * (4 + 24 * near * near) * Math.min(1.4, p.burn);
      while (d.emit <= 0) {
        d.emit += 1;
        this.stir(d, near, wx, wy);
      }
    }
    if (!d.burst && d.age >= (d.side === 'buy' ? TOUCHDOWN : LIFTOFF)) {
      d.burst = true;
      if (dt > 0) this.ring(d, d.side === 'buy' ? 12 : 8);
    }
  }

  // ── dust ─────────────────────────────────────────────────────────────────

  /** A puff under one of the engines, blown outwards from the deck. */
  private stir(d: Drone, near: number, wx: number, wy: number): void {
    const k = Math.floor(this.rand(d) * 4) & 3;
    const ex = this.engTile[2 * k]!, ey = this.engTile[2 * k + 1]!;
    const len = Math.sqrt(ex * ex + ey * ey) || 1;
    const a = Math.atan2(ey, ex) + (this.rand(d) - 0.5) * 1.3;
    const r = len * (0.85 + this.rand(d) * 0.3), sp = 0.9 + this.rand(d) * 1.6;
    this.spawn(d, d.x + wx + Math.cos(a) * r, d.y + wy + Math.sin(a) * r, SLAB_PX + 1, Math.cos(a) * sp, Math.sin(a) * sp, 5 + this.rand(d) * 6, 0.9 + this.rand(d) * 0.7, 0.32 + 0.3 * near);
  }

  /** A ring of dust thrown off the deck round the container. */
  private ring(d: Drone, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand(d) * 0.3;
      const r = 0.75 + this.rand(d) * 0.15, sp = 1.2 + this.rand(d) * 1.2;
      this.spawn(d, d.x + Math.cos(a) * r, d.y + Math.sin(a) * r, DECK_PX + 1, Math.cos(a) * sp, Math.sin(a) * sp, 6 + this.rand(d) * 6, 1.1 + this.rand(d) * 0.6, 0.42 + this.rand(d) * 0.16);
    }
  }

  private spawn(d: Drone, x: number, y: number, alt: number, vx: number, vy: number, va: number, life: number, size: number): void {
    // Dust nearer the viewer than the deck's centre goes in front of the container.
    const pool = x + y > d.x + d.y - 0.2 ? this.front : this.back;
    if (pool.n >= pool.items.length) return;
    const q = pool.items[pool.n++]!;
    q.x = x; q.y = y; q.alt = alt;
    q.vx = vx; q.vy = vy; q.va = va;
    q.age = 0; q.life = life; q.size = size;
    q.s.rotation = (x * 13.7 + y * 7.1) % (Math.PI * 2);
    q.s.visible = true;
  }

  private updatePuffs(pool: PuffPool, P: Lin, lift: number, view: number, dt: number): void {
    const drag = Math.exp(-2.4 * dt);
    for (let i = pool.n - 1; i >= 0; i--) {
      const q = pool.items[i]!;
      q.age += dt;
      if (q.age >= q.life) {
        // Swap with the last live one (already moved this frame: the loop runs downwards).
        q.s.visible = false;
        pool.n--;
        pool.items[i] = pool.items[pool.n]!;
        pool.items[pool.n] = q;
        continue;
      }
      // The blast slows down, the Sough takes over, the dust lifts a little.
      q.vx = q.vx * drag + WIND_X * (1 - drag);
      q.vy = q.vy * drag + WIND_Y * (1 - drag);
      q.va = q.va * drag + 4 * (1 - drag);
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.alt = Math.max(0, q.alt + q.va * dt);
      const k = q.age / q.life;
      q.s.position.set(P.a * q.x + P.c * q.y, P.b * q.x + P.d * q.y - q.alt * lift);
      q.s.scale.set(q.size * (0.45 + 0.75 * Math.sqrt(k)) * view);
      q.s.alpha = 0.82 * (1 - smooth(0.3, 1, k));
    }
  }
}
