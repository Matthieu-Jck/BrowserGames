// pits.ts — the incinerators' pits in the world (D51; owner, 2026-10-14: "the incinerator should
// have a style that shows more clearly that it will destroy the item. Maybe a hole in the ground
// with a flame that activates when an item falls in it?"). Three things the views share:
//
// - **The way in** (`pitPath`, pure): an item a ribbon hands to an incinerator glides on from the
//   ribbon's last tile across the pit's tile, at the line's pace (a tile a step), up its chute
//   onto the collar, tips over the lip and falls into the throat — shrinking and fading into the
//   dark — gone before it reaches the fire bed. cell-flow.ts draws it so; `d` is how far it has
//   fallen, which the items view reads to draw it behind the pit's near rim (world/belt-lift.ts).
// - **The fire** (`PitFire`, pure, one per colony: `pitFire(sim)`): when an item a ribbon handed
//   to a pit has fallen (its glide in, from the chain's `lastOut`: the tick it went in, the line's
//   step), the flame flares — up in a sixth of a second, down over half a second, embers for a
//   second more. Read from the engine every frame, so it is the same on every screen (a look only:
//   nothing in src/sim changes). The engine keeps only the last item out of a line, and the glide is
//   drawn a tick behind it, so on a full line the next item goes in a tick before the one before it
//   has fallen: each feeding ribbon's previous hand-off is kept too, and per pit the last fall seen.
//   A pit fed faster than a flame dies down (a swift line) burns on.
// - **The frames** (`pitFrames`, baked on demand on a DynAtlas of their own, like the elevators'):
//   the pit's back and front parts (the flame and a falling item go between them), the flame at
//   `PIT_FLAMES` heights in two flickers and the embers, and the plan view's flame seen from above.
//   The buildings view lays them and steps the flame (`animate`); the lights view glows with it at
//   night (lights-view.ts).
import type { Chain } from '@/sim/flow/chain';
import type { Sim } from '@/sim/state';
import { DynAtlas, type DynFrame } from '../art/dyn-atlas';
import type { Ctx } from '../art/ink';
import { PIT, PIT_FLAMES, drawPitFlame, drawPitPart } from '../art/recipes/buildings';
import { TOP_MARGIN, TOP_PX, pitFlameTop } from '../art/recipes/buildings-top';
import type { Rot } from '@/sim/types';
import { LH } from '../iso';

/**
 * Where an item gliding into a pit is, by f, its progress from the centre of the ribbon's last
 * tile (0) to the pit's centre (1, a tile on: one step at the line's pace): it crosses the tile's
 * edge at 0.5, climbs the chute onto the collar, tips over the lip at `tip`, and is gone at `gone`.
 */
export const PIT_WAY = { tip: 1 - (PIT.lip - 0.015), gone: 0.88 } as const;

/** The depth keys of a pit's parts above its own (`objects`, world/stand.ts): an item falling in (or riding a chute on the far half), the flame, the near rim; an item riding a chute on the near half is drawn over them all. */
export const PIT_Z = { fall: 0.1, flame: 0.12, front: 0.15, over: 0.2 } as const;

/** An item on its way into a pit at progress f: how high over the ground it rides (iso px), how far it has fallen (0…1). */
export function pitPath(f: number, out: { z: number; d: number }): { z: number; d: number } {
  const { ro, zr } = PIT;
  const r = 1 - f; // its distance from the pit's centre (tiles)
  const top = (zr + 0.03) * LH;
  if (r >= 0.5) { out.z = 0; out.d = 0; return out; }
  if (f < PIT_WAY.tip) { out.z = r >= ro ? top * ((0.5 - r) / (0.5 - ro)) : top; out.d = 0; return out; }
  const d = Math.min(1, (f - PIT_WAY.tip) / (PIT_WAY.gone - PIT_WAY.tip));
  out.d = d;
  out.z = top - (zr - PIT.floor) * LH * d * d; // it falls, faster and faster, into the dark
  return out;
}

/**
 * The flame's heat by the time since the last item fell in (ticks): up in 0.15 s, down to a
 * quarter over half a second, embers dying for a second more; 0 before anything fell.
 */
export function heatAt(age: number): number {
  if (!(age >= 0)) return 0;
  if (age < 1.5) return 0.4 + 0.6 * (age / 1.5);
  if (age < 6) return 1 - 0.75 * ((age - 1.5) / 4.5);
  if (age < 18) return 0.25 * (1 - (age - 6) / 12);
  return 0;
}

/** What the flame shows at a heat: a flame level (1…`PIT_FLAMES`), the embers (0), or nothing (−1). */
export const flameLevel = (heat: number): number => (heat >= 0.12 ? Math.max(1, Math.min(PIT_FLAMES, Math.round(heat * PIT_FLAMES))) : heat > 0.02 ? 0 : -1);

/** The fire in every pit of one colony: when the last item fell into each, its heat now. */
export class PitFire {
  /** Each pit's feeding ribbons (by its entity), from the compiled graph; its graph version. */
  private feeds = new Map<number, Chain[]>();
  private ver = -1;
  /** Per feeding ribbon: the hand-off seen last (its `lastOut` tick), and the one before it. */
  private seen = new Map<Chain, number>();
  private prev = new Map<Chain, number>();
  /** The last fall seen in each pit (fractional tick), the frame's tick. */
  private readonly last = new Map<number, number>();
  private t = 0;

  /** Per frame, at render tick `t` (fractional): the latest fall in each pit. */
  update(sim: Sim, t: number): void {
    this.t = t;
    const g = sim.graph;
    if (!g) return;
    if (g.version !== this.ver) {
      this.ver = g.version;
      this.feeds.clear();
      this.seen.clear();
      this.prev.clear();
      for (const c of g.chains) {
        const e = c.outE[0];
        if (c.fluid || e === undefined) continue;
        const dst = g.nodes[g.eDst[e]!];
        if (!dst || dst.kind !== 'sink' || !dst.ent) continue;
        let arr = this.feeds.get(dst.ent);
        if (!arr) this.feeds.set(dst.ent, (arr = []));
        arr.push(c);
      }
    }
    for (const [ent, chains] of this.feeds) {
      let last = this.last.get(ent) ?? -Infinity;
      for (const c of chains) {
        const lo = c.lastOut;
        if (lo.item < 0 || lo.edge !== c.outE[0]) continue;
        const was = this.seen.get(c);
        if (was !== lo.tick) { if (was !== undefined) this.prev.set(c, was); this.seen.set(c, lo.tick); }
        const fall = (tick: number | undefined): void => {
          if (tick === undefined) return;
          const fell = tick + 1 + PIT_WAY.gone * c.stepTicks;
          if (fell <= t && fell > last) last = fell;
        };
        fall(lo.tick);
        fall(this.prev.get(c));
      }
      if (last > -Infinity) this.last.set(ent, last);
    }
  }

  /** The heat of pit `ent`'s fire at the last update (0…1). */
  heat(ent: number): number {
    const l = this.last.get(ent);
    return l === undefined ? 0 : heatAt(this.t - l);
  }

  /** The frame's tick (the flame's flicker steps with it). */
  get tick(): number { return this.t; }
}

const fires = new WeakMap<object, PitFire>();
/** The fire of one colony (a Sim): one per colony, shared by the views that draw it. */
export function pitFire(sim: object): PitFire {
  let f = fires.get(sim);
  if (!f) fires.set(sim, (f = new PitFire()));
  return f;
}

/** The flame's flicker: one of two frames, swapped about seven times a second of game time. */
export const flicker = (tick: number): number => Math.floor(tick / 1.4) & 1;

// ── frames ─────────────────────────────────────────────────────────────────────

/** The pit's frames: its two parts for a rotation, the flame by level and flicker (level 0: embers), the plan flame. Iso at 2× world (`PIT_ISO_K`), plan at TOP_PX a tile (`PIT_PLAN_K`). */
export interface PitFrames { back: DynFrame; front: DynFrame }
export const PIT_ISO_K = 0.5, PIT_PLAN_K = 1 / TOP_PX;

const sheet = new DynAtlas();
const parts = new Map<number, PitFrames>();
let flames: DynFrame[][] | null = null;
let planFlame: DynFrame | null = null;

function canvasOf(w: number, h: number): { ctx: Ctx; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { ctx, canvas };
}

const bake = (key: string, d: { canvas: unknown; frame: { ox: number; oy: number } }): DynFrame => {
  const c = d.canvas as HTMLCanvasElement;
  return sheet.add(key, c.width, c.height, d.frame.ox, d.frame.oy, (ctx) => ctx.drawImage(c, 0, 0));
};

/** The pit's back and front for a rotation of its art, baked the first time. */
export function pitFrames(rot: Rot): PitFrames {
  const got = parts.get(rot);
  if (got) return got;
  const f: PitFrames = { back: bake(`b:${rot}`, drawPitPart('back', rot, canvasOf)), front: bake(`f:${rot}`, drawPitPart('front', rot, canvasOf)) };
  sheet.flush();
  parts.set(rot, f);
  return f;
}

/** The flame's frames, `[level][flicker]` (level 0: the embers), baked the first time. */
export function flameFrames(): DynFrame[][] {
  if (flames) return flames;
  flames = Array.from({ length: PIT_FLAMES + 1 }, (_, lv) => [0, 1].map((v) => bake(`fl:${lv}:${v}`, drawPitFlame(lv, v, canvasOf))));
  sheet.flush();
  return flames;
}

/** The plan view's flame over a pit (anchored at its tile's top-left corner, as the plan sprites), baked the first time. */
export function planFlameFrame(): DynFrame {
  if (planFlame) return planFlame;
  const S = TOP_PX + 2 * TOP_MARGIN;
  planFlame = sheet.add('plan', S, S, TOP_MARGIN, TOP_MARGIN, (ctx) => pitFlameTop(ctx, 5));
  sheet.flush();
  return planFlame;
}
