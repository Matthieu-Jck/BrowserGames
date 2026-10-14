// buildings-view.ts — sprites for placed entities, in both views. Each building has an iso
// volume (iso world px, in the shared depth-sorted layer with the cliffs) and a plan sprite
// (tile units, on the plan plane); the layers fade one into the other as the view morphs.
// Ribbons are straight or corner pieces chosen from what actually feeds them in the compiled
// graph (a single feeder on a side makes a bend — a ribbon, a router, a machine's outlet, a
// bridge), drawn top-down in tile units, flat on the ground in either view; a straight piece
// fed from a side opens its rail there (an inlet). A piece on rock lies on its column's top in
// iso, among the volumes (`layBelt`; world/stand.ts `beltZ`), and flat in plan; a traction ribbon
// that hands on a terrace up or down gets its lift against the wall between (traction-lifts.ts). A skybridge's deck spans the gap to its far
// end, lifted above the ground in iso. Sorters and unloaders show their chosen item. Rebuilt
// on structural changes.
//
// Moving parts (art/recipes/moving.ts: the wind turbine's crown, the sand collector's wheel):
// such a building shows its body alone and, as a second sprite, its part, whose texture steps
// through phases baked at boot (`animate`, per frame: a few texture swaps on the same atlas
// page — no repaint, no upload, no re-batch). In iso the part is stacked just over or under the
// body as its rotation brings it nearer or farther; in plan it lies over it.
//
// Cast shadows (iso): each building lays a shadow on the ground (`shadows` layer, under every
// volume): its own recipe drawn along the light into a silhouette, baked the first time that
// building and rotation show up (a DynAtlas), then only stretched, swung and faded with the time
// of day (world/cast-shadows.ts) — one matrix per sprite when the sun has moved enough, one alpha.
//
// Standing on the mountains (D44; world/stand.ts, worked out once per rebuild): a building on rock
// is lifted to the top of the column under it — its sprite, its moving part, its shadow, its chosen
// item — and sorts with the cliffs by its stand's key, so the column under it never covers it and
// higher rock in front still hides it. Its shadow then lies on the rock top among the volumes (just
// under it, over the rock it falls on) instead of on the ground layer far below. In plan it lies
// flat like everything else, with a short ink shadow on the map for a hint of its height.
//
// The incinerator (D51) is a pit (world/pits.ts): in iso its back and its near rim as two sprites
// with its flame between them (an item tipping in sinks between them too: the items view), the
// flame stepped per frame from the pit's fire (`animate`); in plan its sprite and, over it, the
// flame seen from above, faded in with the fire.
//
// The plan layer is sorted like the volumes (world/stand.ts `PLAN_Z`): the plan copies of the
// ribbons on rock and the elevators' marks under the items riding them, the buildings over all.
import { Container, Matrix, Sprite, type Texture } from 'pixi.js';
import { BUILDING_IDS, BUILDING_KIND, ITEM_IDS, buildingDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import { filterOf } from '@/sim/cfg';
import type { Sim } from '@/sim/state';
import { DX, DY, opposite, type Ent, type Rot } from '@/sim/types';
import { footprint } from '@/sim/entities';
import { tileIndex } from '@/sim/world/grid';
import { TPS, WORLD } from '@/sim/constants';
import { gustPermille } from '@/sim/power/network';
import { bKey, bodyKey, btKey, beltKey, iKey, inletKey, partKey, type Atlas } from '../art/atlas';
import { DynAtlas, type DynFrame } from '../art/dyn-atlas';
import { BELT_PX, BELT_TIERS, type BeltTier } from '../art/recipes/belts';
import { SKY, drawBuildingShadow, isoHead, shadowFrameOf, type SkyPiece } from '../art/recipes/buildings';
import { MOVING } from '../art/recipes/moving';
import { silhouette } from '../art/silhouette';
import { C, mix, num } from '../art/tokens';
import type { Grade } from '../daynight';
import { LH, TH, TW, tileToIso } from '../iso';
import { tileTop } from '../relief';
import { SHADOW_DX, SHADOW_DY, seamClip, shadowLook, shadowMap } from './cast-shadows';
import { IDLE_TURNS, spinSeed, windTurns, workTurns } from './moving-parts';
import { ISO_K, PLAN_K, skyFrames } from './sky-decks';
import { PLAN_Z, beltZ, buildingZ, computeStands, liftOf, liftZ, riseOffset, standOf, standZ, type Stand } from './stand';
import { PIT_ISO_K, PIT_PLAN_K, PIT_Z, flameFrames, flameLevel, flicker, pitFire, pitFrames, planFlameFrame } from './pits';
import { LIFT_ISO_K, LIFT_PLAN_K, liftFrames, liftOfBelt } from './traction-lifts';
import { FLAG, FLAG_K, flagFrames, type FlagFrames } from './heart-flag';
import { defaultEmblem, emblemKey } from '@/content/emblem';

/** The shadows' colour: ink with a little lilac (Moebius shadows are cool on the warm sand); also the plan's hint of height. */
export const SHADOW_TINT = num(mix(C.ink, C.lilacD, 0.3));

/** A skybridge deck's height above its ends' ground (iso world px): the art's running surface (`SKY.deck`), which items ride. */
export const DECK_Z = SKY.deck * LH;

const tierOf = (def: number): BeltTier | null => {
  const id = BUILDING_IDS[def]!;
  return id in BELT_TIERS ? (id as BeltTier) : null;
};

/** Sorting key shared with the relief (a building on the floor; one above it sorts by its stand: world/stand.ts). */
export { buildingZ } from './stand';

/** Plan: how dark the hint of height is under a building standing above the floor (its offset: `riseOffset`). */
const RISE_ALPHA = 0.3;

/**
 * Which belt piece a ribbon tile shows: straight, or a bend when its only feeder sits on one
 * side (none behind) — read from the compiled graph, so what is drawn is what is connected.
 */
export function beltPiece(sim: Sim, e: Ent): { corner: boolean; rot: Rot; mirror: boolean } {
  const r = e.rot;
  const fed = sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0;
  const straight = { corner: false, rot: r, mirror: false };
  if (!fed || fed & (1 << opposite(r))) return straight;
  const sides = ([((r + 1) & 3), ((r + 3) & 3)] as Rot[]).filter((s) => fed & (1 << s));
  if (sides.length !== 1) return straight;
  const enter = opposite(sides[0]!);
  return { corner: true, rot: enter, mirror: r === ((enter + 3) & 3) };
}

/** Texture px → tile units for a belt piece at (x, y): centred, turned, mirrored. */
export function beltMatrix(x: number, y: number, rot: Rot, mirror: boolean): Matrix {
  return new Matrix()
    .translate(-BELT_PX / 2, -BELT_PX / 2)
    .scale((mirror ? -1 : 1) / BELT_PX, 1 / BELT_PX)
    .rotate((rot * Math.PI) / 2)
    .translate(x + 0.5, y + 0.5);
}

/** Layers a ribbon piece goes on: the ground (on the floor), the volumes (iso px) and the plan (tile units) on rock. */
export interface BeltLayers { ground: Container; volumes: Container; plan: Container }

/**
 * Lay a ribbon piece (a belt texture) on tile (x, y), whose top is `lv` relief levels up: on the
 * floor, one sprite on the ground plane (both views); on rock, one on the column's top in iso,
 * sorted among the volumes (`beltZ`, minus `dz`: a junction's passage goes under its bridge), and
 * one flat in plan (owner, 2026-10-13: ribbons on the mountains were drawn at the floor, under the rock).
 */
export function layBelt(tex: Texture, x: number, y: number, rot: Rot, mirror: boolean, lv: number, to: BeltLayers, dz = 0): Sprite[] {
  const m = beltMatrix(x, y, rot, mirror);
  const s = new Sprite(tex);
  s.setFromMatrix(m);
  if (lv <= 0) { to.ground.addChild(s); return [s]; }
  s.zIndex = PLAN_Z.belt; // under the items riding it, and the plan buildings
  to.plan.addChild(s);
  const iso = new Sprite(tex);
  iso.setFromMatrix(new Matrix(TW / 2, TH / 2, -TW / 2, TH / 2, 0, -lv * LH).append(m));
  iso.zIndex = beltZ(x, y) - dz;
  to.volumes.addChild(iso);
  return [s, iso];
}

/** A moving part in the world: its sprites (iso, plan) with their phases, and how it turns. */
interface Spinner {
  ent: number;
  /** A wind turbine (turns with the wind on its grid) or a machine (turns while it works). */
  wind: boolean;
  /** Under construction or dormant: it does not turn. */
  still: boolean;
  /** Phases per period, periods per turn (the part's symmetry), this building's speed factor. */
  n: number;
  sym: number;
  vary: number;
  /** Where it is in its period [0, 1), how fast it goes now (periods per second), the phase shown. */
  phase: number;
  rate: number;
  k: number;
  sprites: Array<{ s: Sprite; tex: Texture[] }>;
}

export class BuildingsView {
  private sprites: Sprite[] = [];
  private spinners: Spinner[] = [];
  /** Game time of the last `animate` (s); local wind ‰ of each turbine on a grid, by graph version. */
  private lastSec = -1;
  private windVer = -1;
  private readonly windLocal = new Map<number, number>();
  /** Cast shadows: their sprites (iso world px), their masks, the look last applied (length, swing, quantised). */
  private readonly shadowRoot = new Container({ label: 'buildings:shadows' });
  private readonly shadowSheet = new DynAtlas();
  private shadows: Array<{ s: Sprite; x: number; y: number; cx: number; cy: number }> = [];
  /** The shadows of buildings standing above the floor: among the volumes (`objects`), each with its own alpha (its base, × the look's). */
  private liftShadows: Array<{ s: Sprite; a: number; ent: number }> = [];
  private liftAlpha = -1;
  private lookL = -1;
  private lookA = 0;
  private readonly mat = new Matrix();
  /** The traction elevators' cars (iso): each sprite, its y at the foot of its shaft, its low tile. */
  private cars: Array<{ s: Sprite; y0: number; x: number; y: number }> = [];
  /** How high each car stands above its low tile's top (levels), per frame: the items view's (belt-lift.ts `carAt`). */
  carHeight: ((x: number, y: number) => number) | null = null;
  /** Each building's sprites (both views, its chosen item), so one can be hidden without a rebuild. */
  private owned = new Map<number, Sprite[]>();
  /** Entities kept out of sight across rebuilds (the intro: the Heart until it lands, D31). */
  private readonly hidden = new Set<number>();
  /** The incinerators' pits: their flame (iso, among the volumes) and its plan glow, the heat shown. */
  private pits: Array<{ ent: number; flame: Sprite; glow: Sprite | null; heat: number }> = [];

  constructor(
    private readonly beltLayer: Container,
    private readonly objectLayer: Container,
    private readonly planLayer: Container,
    private readonly atlas: Atlas,
    shadowLayer?: Container,
  ) {
    objectLayer.sortableChildren = true;
    planLayer.sortableChildren = true;
    shadowLayer?.addChild(this.shadowRoot);
    this.shadowRoot.visible = false;
  }

  rebuild(sim: Sim): void {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    this.owned.clear();
    const kept = new Map(this.spinners.map((sp) => [sp.ent, sp]));
    this.spinners = [];
    this.kept = kept;
    this.shadows = [];
    this.liftShadows = [];
    this.cars = [];
    this.pits = [];
    this.liftAlpha = -1;
    this.lookL = -1;
    sim.ensureCompiled(); // the ribbons' bends come from the graph
    const stands = computeStands(sim); // who stands on the mountains, how high, how it sorts (once per rebuild)
    for (const e of sim.ents.sorted()) {
      const kind = BUILDING_KIND[e.def]!;
      if (kind === 'belt' || kind === 'conduit') { this.addBelt(sim, e); continue; }
      const n0 = this.sprites.length;
      this.addBuilding(e, sim.isDormant(e), stands.get(e.id));
      const mine = this.sprites.slice(n0);
      this.owned.set(e.id, mine);
      if (this.hidden.has(e.id)) for (const s of mine) s.visible = false;
    }
    this.addDecks(sim);
    this.addFlag(sim, stands);
    for (const m of this.marks) this.planLayer.addChild(m);
    this.marks = [];
    this.kept.clear();
    this.shadowSheet.flush();
  }

  /** Spinners of the last build, by entity: a rebuild keeps each part where it was in its turn. */
  private kept = new Map<number, Spinner>();

  /**
   * Per frame, with the game time (s): turn the moving parts. A turbine on a grid turns with
   * the wind it sees (local ‰ × gust ‰), one on no grid idles, a machine's part turns while it
   * works; speeds ease towards their target over a second or so (a gust spins the crowns up).
   * Paused, game time stands and nothing turns. Cost: a little arithmetic per part, and a
   * texture swap when its phase changes.
   */
  animate(sim: Sim, seconds: number, grade?: Grade): void {
    if (grade) this.shade(grade);
    this.waveFlag(sim, seconds);
    // The elevators' cars, where the items view last left them.
    if (this.carHeight) for (const c of this.cars) c.s.position.y = c.y0 - this.carHeight(c.x, c.y) * LH;
    if (this.pits.length) this.burn(sim, seconds * TPS);
    const dt = this.lastSec < 0 ? 0 : seconds - this.lastSec;
    this.lastSec = seconds;
    if (!this.spinners.length || dt <= 0) return;
    const step = Math.min(dt, 0.25); // a jump (catch-up, a hidden tab) turns it no more than a frame's worth
    const g = sim.graph;
    if (g && g.version !== this.windVer) {
      this.windVer = g.version;
      this.windLocal.clear();
      for (const net of g.nets) for (const p of net.producers) if (p.kind === 'wind') this.windLocal.set(p.ent, p.local);
    }
    const gust = gustPermille(sim.absEpoch(), sim.worldSeed, sim.mods.gustVariance);
    for (const sp of this.spinners) {
      let turns = 0;
      if (sp.still) turns = 0;
      else if (sp.wind) {
        const local = this.windLocal.get(sp.ent);
        turns = local === undefined ? IDLE_TURNS : windTurns(local, gust);
      } else {
        const node = g?.nodeByEnt.get(sp.ent);
        turns = node ? workTurns(node.status, node.net >= 0 ? sim.ctx.sat[node.net] ?? 0 : 0) : 0;
      }
      sp.rate += (turns * sp.sym * sp.vary - sp.rate) * Math.min(1, step * 1.5);
      sp.phase = (sp.phase + sp.rate * step) % 1;
      const k = Math.floor(sp.phase * sp.n) % sp.n;
      if (k === sp.k) continue;
      sp.k = k;
      for (const p of sp.sprites) p.s.texture = p.tex[k]!;
    }
  }

  /** Moving parts in the world (perf, tests). */
  get movingCount(): number { return this.spinners.length; }

  /**
   * Per frame, at render tick `t`: each pit's flame from its fire (world/pits.ts) — its height and
   * flicker in iso (a texture swap on the pits' own sheet when it changes), its plan glow's alpha.
   */
  private burn(sim: Sim, t: number): void {
    const fire = pitFire(sim);
    fire.update(sim, t);
    const frames = flameFrames(), v = flicker(fire.tick);
    for (const p of this.pits) {
      const h = this.hidden.has(p.ent) ? 0 : Math.round(fire.heat(p.ent) * 40) / 40;
      const lv = flameLevel(h);
      if (lv < 0) { if (p.flame.visible) p.flame.visible = false; }
      else {
        const tex = frames[lv]![v]!.tex;
        if (p.flame.texture !== tex) p.flame.texture = tex;
        if (!p.flame.visible) p.flame.visible = true;
      }
      if (p.glow && h !== p.heat) { p.glow.alpha = 0.95 * h; p.glow.visible = h > 0.02; }
      p.heat = h;
    }
  }

  /**
   * An incinerator's pit (iso, world/pits.ts): its back at its key, its flame over it (hidden
   * until something burns), its near rim over that — an item tipping in is drawn between them.
   */
  private addPit(e: Ent, rot: Rot, wx: number, wy: number, alpha: number, tint: number, z: number): void {
    const fr = pitFrames(rot);
    const lay = (tex: Texture, ox: number, oy: number, dz: number): Sprite => {
      const s = new Sprite(tex);
      s.scale.set(PIT_ISO_K);
      s.position.set(wx - ox * PIT_ISO_K, wy - oy * PIT_ISO_K);
      s.zIndex = z + dz;
      s.alpha = alpha;
      s.tint = tint;
      this.objectLayer.addChild(s);
      this.sprites.push(s);
      return s;
    };
    lay(fr.back.tex, fr.back.ox, fr.back.oy, 0);
    const f0 = flameFrames()[0]![0]!;
    const flame = lay(f0.tex, f0.ox, f0.oy, PIT_Z.flame);
    flame.visible = false;
    flame.tint = 0xffffff;
    lay(fr.front.tex, fr.front.ox, fr.front.oy, PIT_Z.front);
    this.pits.push({ ent: e.id, flame, glow: null, heat: -1 });
  }

  /** The plan view's flame over a pit's plan sprite (faded in with its fire by `burn`). */
  private addPitGlow(e: Ent): void {
    const fr = planFlameFrame();
    const s = new Sprite(fr.tex);
    s.scale.set(PIT_PLAN_K);
    s.position.set(e.x - fr.ox * PIT_PLAN_K, e.y - fr.oy * PIT_PLAN_K);
    s.alpha = 0;
    s.visible = false;
    this.planLayer.addChild(s);
    this.sprites.push(s);
    const p = this.pits[this.pits.length - 1];
    if (p && p.ent === e.id) p.glow = s;
  }

  /**
   * The cast shadows for the time of day: their opacity (one alpha on their container, none at
   * night), and — when the sun has moved enough to show — their length and swing, one matrix per
   * sprite (a linear map about its building's foot).
   */
  private shade(g: Grade): void {
    const look = shadowLook(g.hour, g.night);
    const on = look.alpha > 0.01 && this.shadows.length > 0;
    this.shadowRoot.visible = on;
    // The lifted ones lie among the volumes, out of the container: their alpha one by one (few), when it shows a change.
    const la = on ? Math.round(look.alpha * 256) : 0;
    if (la !== this.liftAlpha) {
      this.liftAlpha = la;
      for (const l of this.liftShadows) { l.s.visible = la > 0 && !this.hidden.has(l.ent); l.s.alpha = (la / 256) * l.a; }
    }
    if (!on) return;
    this.shadowRoot.alpha = look.alpha;
    const L = Math.round(look.length * 80), A = Math.round(look.angle * 160);
    if (L === this.lookL && A === this.lookA) return;
    this.lookL = L;
    this.lookA = A;
    const [a, b, c, d] = shadowMap(L / 80, A / 160);
    for (const sh of this.shadows) {
      const px = sh.x - sh.cx, py = sh.y - sh.cy;
      sh.s.setFromMatrix(this.mat.set(a, b, c, d, sh.cx + a * px + c * py, sh.cy + b * px + d * py));
    }
  }

  /**
   * A building's shadow mask for a rotation, baked the first time (1 px per world px: half the
   * sprites' scale): only the far side of the seam through its foot (cast-shadows.ts `seamClip`),
   * so the day's stretch about the foot never pushes any of it towards the sun.
   */
  private shadowMask(id: BuildingId, rot: Rot): DynFrame {
    const key = `${id}:${rot}`;
    const got = this.shadowSheet.get(key);
    if (got) return got;
    const f = shadowFrameOf(id, rot, SHADOW_DX, SHADOW_DY);
    const [fx, fy] = f.pr(f.rw / 2, f.rh / 2, 0); // the foot: the footprint's centre on the ground (atlas px)
    return this.shadowSheet.add(key, f.SW / 2, f.SH / 2, f.ox / 2, f.oy / 2, (ctx) => {
      const clip = seamClip(fx / 2, fy / 2, f.SW + f.SH);
      ctx.beginPath();
      ctx.moveTo(clip[0]![0], clip[0]![1]);
      for (const [x, y] of clip) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.clip();
      ctx.scale(0.5, 0.5);
      drawBuildingShadow(id, rot, SHADOW_DX, SHADOW_DY, silhouette(ctx));
    });
  }

  /**
   * A building's cast shadow (iso), anchored on its footprint, faint while it is built. On the
   * floor it lies on the ground layer, under every volume; standing above the floor (`st`) it
   * lies on the rock top at its level, among the volumes just under the building (key − 0.3:
   * after the rock it falls on, under its moving part too), hidden until the day's look is set.
   */
  private addShadow(e: Ent, id: BuildingId, rot: Rot, alpha: number, st?: Stand): void {
    const fr = this.shadowMask(id, rot);
    const s = new Sprite(fr.tex);
    s.tint = SHADOW_TINT;
    const lv = st?.level ?? 0;
    const [ax, ay] = tileToIso(e.x, e.y, lv);
    const [w, h] = footprint(e.def, e.rot);
    const [cx, cy] = tileToIso(e.x + w / 2, e.y + h / 2, lv);
    s.position.set(ax - fr.ox, ay - fr.oy);
    if (st) {
      s.zIndex = st.z - 0.3;
      s.visible = false;
      this.objectLayer.addChild(s);
      this.liftShadows.push({ s, a: alpha, ent: e.id });
    } else {
      s.alpha = alpha;
      this.shadowRoot.addChild(s);
    }
    this.sprites.push(s);
    this.shadows.push({ s, x: ax - fr.ox, y: ay - fr.oy, cx, cy });
  }

  /** Hide a building's sprites (both views) until `show`; it stays hidden through rebuilds. */
  hide(id: number): void {
    this.hidden.add(id);
    for (const s of this.owned.get(id) ?? []) s.visible = false;
  }

  show(id: number): void {
    this.hidden.delete(id);
    for (const s of this.owned.get(id) ?? []) s.visible = true;
  }

  isHidden(id: number): boolean {
    return this.hidden.has(id);
  }

  /**
   * Per frame: nothing to move. A skybridge's span is drawn as the buildings are — iso volumes
   * among them, plan sprites with theirs (`addDecks`) — so the layers' cross-fade carries it
   * through the morph; the frame still calls this at its place in the order.
   */
  setPlanness(t: number): void {
    void t;
  }

  /**
   * The span of every skybridge pair (an end whose graph target is the next end ahead,
   * `graph.jumps`): the start's ramp up, the deck over each square between, the far end's ramp
   * down (world/sky-decks.ts, baked on demand), at the ends' height (an end standing on rock lifts
   * its pair). Iso: volumes among the buildings — a ramp just after the end on its square (it lies
   * over the footing and draws the end's gantry over itself), a deck square after whatever stands
   * on it — so the line the bridge crosses, on the ground layers, runs under it, and the items
   * riding it are drawn over it (items view). Plan: over the plan's buildings. Shadows: with the
   * buildings', laid along the light by the day.
   */
  private addDecks(sim: Sim): void {
    if (!sim.graph) return;
    const lay = (piece: SkyPiece, x: number, y: number, rot: Rot, level: number, key: number, ent: number): void => {
      const fr = skyFrames(piece, rot, SHADOW_DX, SHADOW_DY);
      const [wx, wy] = tileToIso(x, y, level);
      const iso = new Sprite(fr.iso.tex);
      iso.scale.set(ISO_K);
      iso.position.set(wx - fr.iso.ox * ISO_K, wy - fr.iso.oy * ISO_K);
      iso.zIndex = key + 0.25;
      this.objectLayer.addChild(iso);
      const plan = new Sprite(fr.plan.tex);
      plan.scale.set(PLAN_K);
      plan.position.set(x - fr.plan.ox * PLAN_K, y - fr.plan.oy * PLAN_K);
      this.planLayer.addChild(plan);
      const sh = new Sprite(fr.shadow.tex);
      sh.tint = SHADOW_TINT;
      sh.position.set(wx - fr.shadow.ox, wy - fr.shadow.oy);
      const [cx, cy] = tileToIso(x + 0.5, y + 0.5, level);
      if (level > 0) {
        // On the rock top, as a lifted building's shadow: among the volumes, just under the span.
        sh.zIndex = key - 0.3;
        sh.visible = false;
        this.objectLayer.addChild(sh);
        this.liftShadows.push({ s: sh, a: 1, ent });
      } else this.shadowRoot.addChild(sh);
      this.shadows.push({ s: sh, x: wx - fr.shadow.ox, y: wy - fr.shadow.oy, cx, cy });
      this.sprites.push(iso, plan, sh);
    };
    const keyOf = (o: Ent): number => standOf(o)?.z ?? buildingZ(o.x, o.y, 1, 1);
    for (const [t, g] of sim.graph.jumps) {
      const x = t % WORLD, y = (t - x) / WORLD;
      const e = sim.entityAt(x, y);
      if (!e || BUILDING_KIND[e.def] !== 'bridge') continue; // a line through junctions: nothing to draw
      const gx = g % WORLD, gy = (g - gx) / WORLD;
      const far = sim.entityAt(gx, gy);
      if (!far || BUILDING_KIND[far.def] !== 'bridge' || far.rot !== e.rot) continue; // past junctions, no leap
      const lv = liftOf(e);
      lay('up', x, y, e.rot, lv, keyOf(e), e.id);
      const n = Math.max(Math.abs(gx - x), Math.abs(gy - y)) - 1;
      for (let k = 1; k <= n; k++) {
        const tx = x + DX[e.rot]! * k, ty = y + DY[e.rot]! * k;
        lay('deck', tx, ty, e.rot, lv, lv > 0 ? standZ(tx, ty, 1, 1, 0) : buildingZ(tx, ty, 1, 1), e.id);
      }
      lay('down', gx, gy, far.rot, liftOf(far), keyOf(far), far.id);
    }
  }

  private beltSprite(tex: Texture, x: number, y: number, rot: Rot, mirror: boolean, lv: number): void {
    this.sprites.push(...layBelt(tex, x, y, rot, mirror, lv, { ground: this.beltLayer, volumes: this.objectLayer, plan: this.planLayer }));
  }

  /**
   * A traction ribbon's elevator up (or down) a terrace's wall, when it hands on a step away and
   * there is room for its shaft: in iso on the low tile against the wall (`liftZ`), its three parts
   * on one frame anchored at the two tiles' top corner on the low top — the back, the car (moved
   * up and down by `animate`, from `carHeight`), the front over it; in plan its mark centred on
   * the wall, turned with the ribbon.
   */
  private addLift(sim: Sim, e: Ent): void {
    const l = liftOfBelt(sim.grid, (x, y) => sim.ents.get(sim.grid.occ[tileIndex(x, y)]!)?.def ?? -1, e);
    if (!l?.shaft) return;
    const fr = liftFrames(l.rot, l.up);
    const ox = Math.min(l.x, l.x + DX[l.rot]!), oy = Math.min(l.y, l.y + DY[l.rot]!);
    const [wx, wy] = tileToIso(ox, oy, l.low);
    const z = liftZ(l.lowX, l.lowY);
    const lay = (f: DynFrame, dz: number): Sprite => {
      const s = new Sprite(f.tex);
      s.scale.set(LIFT_ISO_K);
      s.position.set(wx - f.ox * LIFT_ISO_K, wy - f.oy * LIFT_ISO_K);
      s.zIndex = z + dz;
      this.objectLayer.addChild(s);
      this.sprites.push(s);
      return s;
    };
    lay(fr.back, 0);
    const car = lay(fr.car, 0.01);
    lay(fr.front, 0.02);
    this.cars.push({ s: car, y0: car.position.y, x: l.lowX, y: l.lowY });
    const plan = new Sprite(fr.plan.tex);
    plan.setFromMatrix(new Matrix()
      .translate(-fr.plan.ox, -fr.plan.oy)
      .scale(LIFT_PLAN_K, LIFT_PLAN_K)
      .rotate((l.rot * Math.PI) / 2)
      .translate(l.x + 0.5 + DX[l.rot]! * 0.5, l.y + 0.5 + DY[l.rot]! * 0.5));
    plan.zIndex = PLAN_Z.mark;
    this.marks.push(plan); // laid after every ribbon (`rebuild`), over the plan copies of those on rock
    this.sprites.push(plan);
  }

  /** The elevators' plan marks of this rebuild, laid last. */
  private marks: Sprite[] = [];

  /** The claim's flag on the Heart (heart-flag.ts): its sprites, the emblem it shows, its wave's frame. */
  private flag: { iso: Sprite; badge: Sprite; key: string; frames: FlagFrames; k: number } | null = null;

  /**
   * The flag on the Heart's roof: the waving pole and cloth in iso (just after the Heart: it stands
   * on its roof), the emblem as a badge in plan; hidden with the Heart (the intro's landing).
   */
  private addFlag(sim: Sim, stands: ReadonlyMap<number, Stand>): void {
    this.flag = null;
    const h = sim.ents.get(sim.hearthId);
    if (!h || BUILDING_IDS[h.def] !== 'hearth') return;
    const e = sim.emblem ?? defaultEmblem(sim.playerSeed);
    const frames = flagFrames(e);
    const st = stands.get(h.id);
    const [w, hh] = footprint(h.def, h.rot);
    const [wx, wy] = tileToIso(h.x + FLAG.x, h.y + FLAG.y, (st?.level ?? 0) + FLAG.roof);
    const f0 = frames.iso[0]!;
    const iso = new Sprite(f0.tex);
    iso.scale.set(FLAG_K);
    iso.position.set(wx - f0.ox * FLAG_K, wy - f0.oy * FLAG_K);
    iso.zIndex = (st ? st.z : buildingZ(h.x, h.y, w, hh)) + 0.05;
    this.objectLayer.addChild(iso);
    const badge = new Sprite(frames.badge.tex);
    const k = 0.5 / frames.badge.w; // half a tile across
    badge.scale.set(k);
    badge.position.set(h.x + FLAG.x - frames.badge.ox * k, h.y + FLAG.y - frames.badge.oy * k);
    this.planLayer.addChild(badge);
    this.sprites.push(iso, badge);
    this.owned.get(h.id)?.push(iso, badge);
    if (this.hidden.has(h.id)) iso.visible = badge.visible = false;
    this.flag = { iso, badge, key: emblemKey(e), frames, k: 0 };
  }

  /** Per frame: the flag's wave (game time: paused, it hangs still); a new emblem re-bakes it. */
  private waveFlag(sim: Sim, seconds: number): void {
    const fl = this.flag;
    if (!fl) return;
    const e = sim.emblem ?? defaultEmblem(sim.playerSeed);
    const key = emblemKey(e);
    if (key !== fl.key) { fl.frames = flagFrames(e); fl.key = key; fl.badge.texture = fl.frames.badge.tex; fl.k = -1; }
    const n = FLAG.phases, k = ((Math.floor(seconds * FLAG.wavesPerSec * n) % n) + n) % n;
    if (k === fl.k || !Number.isFinite(k)) return;
    fl.k = k;
    fl.iso.texture = fl.frames.iso[k]!.tex;
  }

  /** A sprite of an atlas frame anchored at (x, y) (the frame's own anchor), on a layer. */
  private place(key: string, layer: Container, x: number, y: number, alpha: number, tint: number, zIndex?: number): Sprite | null {
    const tex = this.atlas.textures.get(key), fr = this.atlas.frames.get(key);
    if (!tex || !fr) return null;
    const s = new Sprite(tex);
    s.scale.set(fr.k);
    s.position.set(x - fr.ox * fr.k, y - fr.oy * fr.k);
    s.alpha = alpha;
    s.tint = tint;
    if (zIndex !== undefined) s.zIndex = zIndex;
    layer.addChild(s);
    this.sprites.push(s);
    return s;
  }

  /** A building's sprites; `st`: where it stands when above the floor (D44: lifted onto the rock top, sorted by its stand). */
  private addBuilding(e: Ent, dormant = false, st?: Stand): void {
    const id = BUILDING_IDS[e.def]!;
    const pending = e.builtAt !== 0;
    const alpha = pending ? 0.45 : 1;
    // Dormant (its unlock given up): a grey wash, like an unpainted model.
    const tint = dormant ? 0x9b97a8 : 0xffffff;
    const [w, h] = footprint(e.def, e.rot);
    const z = st ? st.z : buildingZ(e.x, e.y, w, h);
    const parts: Spinner['sprites'] = [];
    // The iso volume (on the rock top it stands on); a moving part apart, just over or under its body.
    const isoKey = this.atlas.frames.has(bKey(id, e.rot)) ? bKey(id, e.rot) : bKey(id, 0);
    const [wx, wy] = tileToIso(e.x, e.y, st?.level ?? 0);
    const isoMv = this.atlas.moving.get(isoKey);
    const artRot = isoKey === bKey(id, e.rot) ? e.rot : 0;
    const pit = BUILDING_KIND[e.def] === 'sink';
    this.addShadow(e, id as BuildingId, artRot, pending ? 0.35 : 1, st);
    if (pit) this.addPit(e, artRot, wx, wy, alpha, tint, z);
    else this.place(isoMv ? bodyKey(isoKey) : isoKey, this.objectLayer, wx, wy, alpha, tint, z);
    if (isoMv) {
      const s = this.place(partKey(isoKey, 0), this.objectLayer, wx, wy, alpha, tint, z + (isoMv.over ? 0.2 : -0.2));
      if (s) parts.push({ s, tex: this.phases(isoKey, isoMv.n) });
    }
    // The plan sprite (flat; above the floor, over its hint of height); a moving part over it.
    const topKey = this.atlas.frames.has(btKey(id, e.rot)) ? btKey(id, e.rot) : btKey(id, 0);
    const topMv = this.atlas.moving.get(topKey);
    if (st) this.riseHint(topMv ? bodyKey(topKey) : topKey, e.x, e.y, st.level, alpha);
    this.place(topMv ? bodyKey(topKey) : topKey, this.planLayer, e.x, e.y, alpha, tint);
    if (pit) this.addPitGlow(e);
    if (topMv) {
      const s = this.place(partKey(topKey, 0), this.planLayer, e.x, e.y, alpha, tint);
      if (s) parts.push({ s, tex: this.phases(topKey, topMv.n) });
    }
    if (parts.length) this.addSpinner(e, id as BuildingId, pending || dormant, parts);
    this.addChosenItem(e, id, st);
  }

  /**
   * Plan: a building standing above the floor lays a short ink shadow on the map, down-right of
   * it as the art's shadows fall, longer the higher it stands — the plan's hint of its height.
   * Its own sprite, tinted ink, under the plan sprite.
   */
  private riseHint(key: string, x: number, y: number, level: number, alpha: number): void {
    const off = riseOffset(level);
    this.place(key, this.planLayer, x + off, y + off, RISE_ALPHA * alpha, SHADOW_TINT);
  }

  /** The textures of a moving part's phases. */
  private phases(key: string, n: number): Texture[] {
    return Array.from({ length: n }, (_, k) => this.atlas.textures.get(partKey(key, k))!);
  }

  /** Register a moving part: where it was before a rebuild (else its own start), how it turns. */
  private addSpinner(e: Ent, id: BuildingId, still: boolean, sprites: Spinner['sprites']): void {
    const spec = MOVING[id];
    if (!spec) return;
    const old = this.kept.get(e.id), seed = spinSeed(e.id);
    const sp: Spinner = {
      ent: e.id, wind: BUILDING_KIND[e.def] === 'wind', still, n: spec.frames, sym: spec.sym, vary: seed.vary,
      phase: old?.phase ?? seed.phase, rate: old?.rate ?? 0, k: -1, sprites,
    };
    sp.k = Math.floor(sp.phase * sp.n) % sp.n;
    for (const p of sprites) p.s.texture = p.tex[sp.k]!;
    this.spinners.push(sp);
  }

  /** Sorters and unloaders wear their chosen item on top (both views; in iso on the lid, lifted with the block). */
  private addChosenItem(e: Ent, id: string, st?: Stand): void {
    const logic = buildingDef(e.def).logic;
    if (logic !== 'sorter' && logic !== 'inverted' && logic !== 'unloader') return;
    const item = filterOf(e.cfg, 0);
    const key = item >= 0 ? iKey(ITEM_IDS[item]!) : '';
    const tex = key ? this.atlas.textures.get(key) : undefined, fr = key ? this.atlas.frames.get(key) : undefined;
    if (!tex || !fr) return;
    // Iso: on the block's lid; plan: in its window (0.4 tile).
    const iso = new Sprite(tex);
    iso.anchor.set(0.5, 0.8); // stands in the lid's window like an object in a tray
    const [wx, wy] = tileToIso(e.x + 0.5, e.y + 0.5, st?.level ?? 0);
    iso.position.set(wx, wy - isoHead(id as BuildingId) * LH);
    iso.scale.set((0.32 * 64) / Math.max(fr.w, fr.h));
    iso.zIndex = st ? st.z + 0.4 : buildingZ(e.x, e.y, 1, 1) + 0.5;
    this.objectLayer.addChild(iso);
    const plan = new Sprite(tex);
    plan.anchor.set(0.5);
    plan.position.set(e.x + 0.5, e.y + 0.5);
    plan.scale.set(0.4 / Math.max(fr.w, fr.h));
    this.planLayer.addChild(plan);
    this.sprites.push(iso, plan);
  }

  private addBelt(sim: Sim, e: Ent): void {
    const tier = tierOf(e.def) ?? 'ribbon';
    const p = beltPiece(sim, e);
    const tex = this.atlas.textures.get(beltKey(tier, p.corner));
    if (!tex) return;
    const lv = tileTop(sim.grid, e.x, e.y);
    this.beltSprite(tex, e.x, e.y, p.rot, p.mirror, lv);
    this.addLift(sim, e);
    if (p.corner) return;
    // A straight piece fed from a side (a merging line, a router, a machine's outlet): open the
    // rail there so the connection reads. The inlet art comes in from the left; mirror for the right.
    const fed = sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0;
    const inlet = this.atlas.textures.get(inletKey(tier));
    if (!fed || !inlet) return;
    const left = ((e.rot + 3) & 3) as Rot, right = ((e.rot + 1) & 3) as Rot;
    if (fed & (1 << left)) this.beltSprite(inlet, e.x, e.y, e.rot, false, lv);
    if (fed & (1 << right)) this.beltSprite(inlet, e.x, e.y, e.rot, true, lv);
  }
}
