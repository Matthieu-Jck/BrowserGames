// wind-hints-view.ts — the wind's rare hints on the land (D95; owner, 2026-10-16: « le joueur ne
// saura pas où il y a du vent hormis quelques indices visuels rares (bourrasque, sable...) », then
// on the first draft: « l'animation du sable… ne devrait pas être sur les montagnes, c'est pour le
// désert. Et il y en a trop », « les traits sont trop gros »). Before the Anémométrie plan this is
// all the player sees of the wind besides a turbine's output. Two kinds, both pen work, no sprite:
//   · **a gust** — two or three hairline ink flicks, short and uneven, a soft start and a tapered
//     end, gently bent, drifting the way the wind blows; on the floor or high up alike;
//   · **sand** — on open desert floor only (sand, dunes, hardpan, worked ground: never on rock,
//     water, a chasm or under a building): low thin streaks of the dune's brown skimming the ground
//     downwind, with two or three small ripple marks across the wind behind them.
// Rare, and only where the wind is clearly strong, so that their being there says « windy here »: a
// few random visible tiles are tried a second, and one is taken with a chance growing with the
// square of its local wind above a high threshold (the weather's wind now × the tile's exposure,
// sim/world/wind.ts); high ground is tried at a third of that, and gets gusts only. At most four
// up at once. Render only: the field is read, nothing is changed; the draws come from a small LCG
// of its own (the sim's determinism is not involved, and a session's hints repeat for the shots).
//
// Space: one Graphics on its own P plane inside the graded world (`shade` layer, like the cloud
// shadows: darker at night), redrawn each frame while a hint is up, in tile units lying on the
// ground, lifted onto its rock in iso (level × SHIFT × (1 − te)). Line widths are set in screen
// pixels (`HAIR`, divided by the zoom and the projection's scale), so a flick stays a hairline when
// zoomed in instead of swelling into a band.
import { Container, Graphics, Matrix } from 'pixi.js';
import { COS64, SIN64 } from '@/content/world';
import { DAY_EPOCHS } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { T } from '@/sim/types';
import { bearingOf, localWind, veerOf, windAt, windField } from '@/sim/world/wind';
import { C, num } from '../art/tokens';
import type { Lin } from '../projection';
import { SHIFT } from '../relief';

/** Tries a second per 1 000 visible tiles (at least 0.5, at most 4). */
const TRIES_PER_KTILE = 1;
/** A hint is taken above this local wind (‰), surely at `SURE`: clearly strong wind only. */
const FROM = 1500, SURE = 2700;
/** High ground is tried at this share of the floor's chance (gusts only there). */
const HIGH_SHARE = 0.33;
/** At most this many up at once. */
const POOL = 4;
/** Seconds a hint lives. */
const LIFE = 1.9;
/** The flicks' width in screen pixels, whatever the zoom; the sand's streaks a little wider. */
const HAIR = 1.1, SAND_HAIR = 1.4;
/** Ground the sand blows over (open desert floor). */
const SANDY: ReadonlySet<number> = new Set([T.Sand, T.DuneSea, T.Hardpan, T.Dug, T.Filled]);

/** One stroke of a hint, in the hint's own frame (along the wind: u, across it: v; tiles). */
interface Stroke { u0: number; v: number; len: number; bend: number; delay: number }

interface Hint {
  kind: 'gust' | 'sand';
  /** Tile point it started from, its level, the wind's way (unit, tile space), its speed (tiles/s). */
  x: number;
  y: number;
  lv: number;
  ux: number;
  uy: number;
  speed: number;
  age: number;
  strokes: Stroke[];
  /** The sand's ripple marks: across the wind, behind the streaks (u, v, half-length). */
  ripples: Array<[number, number, number]>;
  peak: number;
}

export class WindHints {
  private readonly plane = new Container({ label: 'windHints' });
  private readonly g = new Graphics();
  private readonly hints: Hint[] = [];
  private rng = 0x9e3779b9;
  private te = -1;
  private owed = 0;
  /** Debug (the shots): more tries a second, never more up at once. */
  boost = 1;

  constructor(layer: Container) {
    layer.addChild(this.plane);
    this.plane.addChild(this.g);
  }

  /** How many are up (tests, the shots). */
  get count(): number { return this.hints.length; }

  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  /**
   * Per frame. `dt`: real seconds (0 while paused: nothing new comes, the ones up keep fading);
   * `zoom`: the camera's, for the hairlines' width; `tiles`: the visible tile rect (a loose box
   * round the view); `onScreen`: is a tile's centre in view (the tries outside it are dropped);
   * `levelAt`: the land's level (the relief's).
   */
  update(sim: Sim, P: Lin, te: number, dt: number, zoom: number, tiles: readonly [number, number, number, number], onScreen: (x: number, y: number) => boolean, levelAt: (x: number, y: number) => number): void {
    if (te !== this.te) {
      this.te = te;
      this.plane.setFromMatrix(new Matrix(P.a, P.b, P.c, P.d, 0, 0));
    }
    const step = Math.min(dt, 0.1);
    for (let i = this.hints.length - 1; i >= 0; i--) {
      const h = this.hints[i]!;
      h.age += step;
      if (h.age >= LIFE) this.hints.splice(i, 1);
    }
    if (step > 0) this.spawn(sim, step, tiles, onScreen, levelAt);
    this.draw(P, te, zoom);
  }

  /** A few tries a second over the visible tiles; one taken where the wind is clearly strong. */
  private spawn(sim: Sim, step: number, tiles: readonly [number, number, number, number], onScreen: (x: number, y: number) => boolean, levelAt: (x: number, y: number) => number): void {
    const [x0, y0, x1, y1] = tiles;
    const area = Math.max(1, (x1 - x0) * (y1 - y0));
    this.owed += step * this.boost * Math.min(4, Math.max(0.5, (area / 1000) * TRIES_PER_KTILE));
    if (this.owed < 1) return;
    const ep = sim.absEpoch();
    const wind = windAt(ep, sim.worldSeed, sim.mods.gustVariance);
    if (wind * 2600 < FROM * 1000) { this.owed = 0; return; } // a calm hour: nowhere is it clearly windy
    const b = bearingOf(sim.worldSeed, veerOf(Math.floor(ep / DAY_EPOCHS), sim.worldSeed));
    const field = windField(sim.grid.source);
    const ux = -COS64[b]! / 1024, uy = -SIN64[b]! / 1024; // the way it blows
    while (this.owed >= 1) {
      this.owed -= 1;
      if (this.hints.length >= POOL) continue;
      const x = Math.floor(x0 + this.rand() * (x1 - x0)), y = Math.floor(y0 + this.rand() * (y1 - y0));
      if (x < 0 || y < 0 || x >= 1024 || y >= 1024 || !onScreen(x, y)) continue;
      const lv = levelAt(x, y), t = sim.grid.terrain(x, y);
      const floor = lv === 0 && SANDY.has(t) && sim.grid.occupant(x, y) === 0;
      if (lv === 0 && !floor) continue; // water, a chasm, a building: nothing blows there
      const u = Math.max(0, Math.min(1, (localWind(wind, field.at(x, y, b)) - FROM) / (SURE - FROM)));
      if (this.rand() >= u * u * (floor ? 1 : HIGH_SHARE)) continue;
      this.hints.push(floor && this.rand() < 0.6 ? this.sand(x, y, ux, uy, u) : this.gust(x, y, lv, ux, uy, u));
    }
  }

  /** Debug (the shots): a hint at tile (x, y) now, the way today's wind blows, as if the wind there were strong. */
  spawnAt(sim: Sim, x: number, y: number, kind: 'gust' | 'sand', level = 0): void {
    const ep = sim.absEpoch();
    const b = bearingOf(sim.worldSeed, veerOf(Math.floor(ep / DAY_EPOCHS), sim.worldSeed));
    const ux = -COS64[b]! / 1024, uy = -SIN64[b]! / 1024;
    this.hints.push(kind === 'sand' ? this.sand(x, y, ux, uy, 0.8) : this.gust(x, y, level, ux, uy, 0.8));
  }

  /** Two or three hairline flicks, uneven, staggered along the wind, a little apart across it. */
  private gust(x: number, y: number, lv: number, ux: number, uy: number, u: number): Hint {
    const n = 2 + (this.rand() < 0.5 ? 1 : 0), strokes: Stroke[] = [];
    for (let i = 0; i < n; i++) {
      strokes.push({
        u0: (this.rand() - 0.5) * 0.9, v: (i - (n - 1) / 2) * (0.28 + this.rand() * 0.18),
        len: 0.9 + this.rand() * 1.4, bend: (this.rand() - 0.5) * 0.22, delay: this.rand() * 0.25,
      });
    }
    return { kind: 'gust', x: x + 0.5, y: y + 0.5, lv, ux, uy, speed: 2.2 + 2.2 * u, age: 0, strokes, ripples: [], peak: 0.5 + 0.3 * u };
  }

  /** Low streaks of sand skimming the floor, and small ripples across the wind behind them. */
  private sand(x: number, y: number, ux: number, uy: number, u: number): Hint {
    const strokes: Stroke[] = [], ripples: Array<[number, number, number]> = [];
    const n = 2 + Math.floor(this.rand() * 2);
    for (let i = 0; i < n; i++) {
      strokes.push({ u0: (this.rand() - 0.5) * 0.6, v: (i - (n - 1) / 2) * (0.18 + this.rand() * 0.1), len: 1.3 + this.rand() * 1.2, bend: (this.rand() - 0.5) * 0.08, delay: this.rand() * 0.2 });
    }
    for (let i = 0; i < 3; i++) ripples.push([-0.6 - i * (0.32 + this.rand() * 0.1), (this.rand() - 0.5) * 0.4, 0.22 + this.rand() * 0.12]);
    return { kind: 'sand', x: x + 0.5, y: y + 0.5, lv: 0, ux, uy, speed: 1.4 + 1.4 * u, age: 0, strokes, ripples, peak: 0.55 + 0.25 * u };
  }

  /** Every hint at its age, as hairlines in screen pixels; nothing drawn when none is up. */
  private draw(P: Lin, te: number, zoom: number): void {
    const g = this.g;
    g.clear();
    if (!this.hints.length) return;
    // Tile units → screen px: the projection's mean scale × the camera's zoom.
    const pxPerTile = ((Math.hypot(P.a, P.b) + Math.hypot(P.c, P.d)) / 2) * Math.max(0.05, zoom);
    for (const h of this.hints) {
      const o = h.lv * SHIFT * (1 - te);
      const vx = -h.uy, vy = h.ux; // across the wind
      const drift = h.speed * h.age;
      const col = num(h.kind === 'sand' ? C.peachD : C.ink);
      const w = (h.kind === 'sand' ? SAND_HAIR : HAIR) / pxPerTile;
      for (const s of h.strokes) {
        // Its own life inside the hint's: in softly, out more softly; it draws itself out, then thins away from its start.
        const a = Math.max(0, h.age - s.delay) / (LIFE - s.delay);
        if (a <= 0) continue;
        const fade = Math.min(1, a / 0.25) * Math.min(1, (1 - a) / 0.45) * h.peak;
        const head = Math.min(1, a / 0.35), tail = Math.max(0, (a - 0.45) / 0.55);
        const N = 10;
        for (let k = 0; k < N; k++) {
          const t0 = k / N, t1 = (k + 1) / N;
          if (t1 <= tail || t0 >= head) continue;
          const mid = (t0 + t1) / 2;
          // A pen flick: soft start, the most ink a third along, tapered to nothing at its end.
          const taper = mid < 0.3 ? 0.35 + (0.65 * mid) / 0.3 : 1 - ((mid - 0.3) / 0.7) * 0.85;
          const at = (t: number): [number, number] => {
            const along = s.u0 + drift + t * s.len, across = s.v + s.bend * Math.sin(Math.PI * t);
            return [h.x + h.ux * along + vx * across - o, h.y + h.uy * along + vy * across - o];
          };
          const [ax, ay] = at(Math.max(t0, tail)), [bx, by] = at(Math.min(t1, head));
          g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: w * (0.55 + 0.45 * taper), color: col, alpha: fade * taper, cap: 'round' });
        }
      }
      // The sand's ripples: small arcs across the wind behind the streaks, fading with them.
      if (h.ripples.length) {
        const fade = Math.min(1, h.age / 0.4) * Math.min(1, (LIFE - h.age) / 0.6) * h.peak * 0.8;
        for (const [ru, rv, half] of h.ripples) {
          const cu = ru + drift * 0.25;
          const p = (t: number): [number, number] => {
            const across = rv + t * half, along = cu + 0.06 * (1 - t * t);
            return [h.x + h.ux * along + vx * across - o, h.y + h.uy * along + vy * across - o];
          };
          const pts = [-1, -0.5, 0, 0.5, 1].map(p);
          g.moveTo(pts[0]![0], pts[0]![1]);
          for (let k = 1; k < pts.length; k++) g.lineTo(pts[k]![0], pts[k]![1]);
          g.stroke({ width: w * 0.8, color: num(C.peachD), alpha: fade, cap: 'round', join: 'round' });
        }
      }
    }
  }
}
