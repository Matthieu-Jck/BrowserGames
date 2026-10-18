// pits.ts — the incinerators' pits in the world (D51; owner, 2026-10-14: "the incinerator should
// have a style that shows more clearly that it will destroy the item. Maybe a hole in the ground
// with a flame that activates when an item falls in it?"). Three things the views share:
//
// - **The way in** (`pitPath`, pure): an item a ribbon hands to an incinerator glides on from the
//   ribbon's last tile across the pit's tile, at the line's pace (a tile a step), up its chute
//   onto the collar, tips over the lip and falls into the throat — shrinking and fading into the
//   dark — gone before it reaches the fire bed. cell-flow.ts draws it so; `d` is how far it has
//   fallen, which the items view reads to draw it behind the pit's near rim (world/belt-lift.ts).
// - **The fire** (`PitFire`, pure, one per colony: `pitFire(sim)`): when an item has fallen into a
//   pit, the flame flares — up in a sixth of a second, down over half a second, embers for a second
//   more. An item a ribbon handed in has fallen once its glide is over (the chain's `lastOut`: the
//   tick it went in, the line's step); one a routing block or a machine handed straight in (D125: the
//   layout waste sorting makes, a sorter's side against the pit) burns a tick after the engine's
//   `SinkNode` took it (its render-only `burnTick`, `burnItem`, `burnPort`). Read from the engine every
//   frame, so it is the same on every screen (a look only: nothing in src/sim changes). The engine
//   keeps only the last item out of a line, and the glide is drawn a tick behind it, so on a full
//   line the next item goes in a tick before the one before it has fallen: each feeding ribbon's
//   previous hand-off is kept too, and per pit the last fall seen and the time between the last two.
//   A pit fed every two seconds or faster burns steadily between flares (`steadyHeat`) instead of
//   strobing to embers. Each fall begins a burst (D125, pit-burst.ts: sparks, a puff, the flame's tip
//   tinted by the item) unless the last began under half a second ago, in one of `BURST.slots`.
// - **The frames** (`pitFrames`, baked on demand on a DynAtlas of their own, like the elevators'):
//   the pit's back and front parts (the flame and a falling item go between them), the flame at
//   `PIT_FLAMES` heights in two flickers and the embers, the plan view's flame seen from above, and
//   the burst's spark and puffs (`burstFrames`). The buildings view lays them and steps the flame and
//   the bursts (`animate`); the lights view glows with them at night (lights-view.ts).
import type { Chain } from '@/sim/flow/chain';
import type { SinkNode } from '@/sim/flow/nodes';
import type { Sim } from '@/sim/state';
import { DynAtlas, type DynFrame } from '../art/dyn-atlas';
import type { Ctx } from '../art/ink';
import { PIT, PIT_FLAMES, PIT_SPARK, drawPitFlame, drawPitPart, drawPitPuff, drawPitSpark } from '../art/recipes/buildings';
import { TOP_MARGIN, TOP_PX, pitFlameTop } from '../art/recipes/buildings-top';
import type { Rot } from '@/sim/types';
import { LH } from '../iso';
import { BURST, burstSeed } from './pit-burst';

/**
 * Where an item gliding into a pit is, by f, its progress from the centre of the ribbon's last
 * tile (0) to the pit's centre (1, a tile on: one step at the line's pace): it crosses the tile's
 * edge at 0.5, climbs the chute onto the collar, tips over the lip at `tip`, and is gone at `gone`.
 */
export const PIT_WAY = { tip: 1 - (PIT.lip - 0.015), gone: 0.88 } as const;

/**
 * The depth keys of a pit's parts above its own (`objects`, world/stand.ts): an item falling in (or
 * riding a chute on the far half), the flame, a burst's puff (D125: over the flame it rises from),
 * the near rim, a burst's sparks (they leap out over the rim); an item riding a chute on the near
 * half is drawn over them all.
 */
export const PIT_Z = { fall: 0.1, flame: 0.12, puff: 0.13, front: 0.15, spark: 0.17, over: 0.2 } as const;

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

/**
 * The flame kept up by a steady feed: a pit fed every `gap` ticks or faster (up to 2 s) burns on
 * between its flares instead of dying to embers each time (owner: a line of one item a second
 * should burn, not strobe) — higher the faster it is fed, held a beat past the next item's due
 * time, then dying down over 0.8 s once the feed stops.
 */
export function steadyHeat(gap: number, age: number): number {
  if (!(gap > 0 && gap <= 20) || !(age >= 0)) return 0;
  const base = Math.min(0.6, 0.85 - gap / 28);
  const hold = gap * 1.25;
  return age <= hold ? base : Math.max(0, base * (1 - (age - hold) / 8));
}

/** A pit's bursts (pit-burst.ts), newest last in ring order: when each began (fractional tick; −∞: none), its item, its seed. */
export interface PitBursts {
  readonly at: Float64Array;
  readonly item: Int32Array;
  readonly seed: Uint32Array;
  /** How many have begun (the next takes slot `n % BURST.slots`). */
  readonly n: number;
}

/** One pit's fire: its last fall, the time between the last two, its bursts. */
interface PitState { last: number; gap: number; at: Float64Array; item: Int32Array; seed: Uint32Array; n: number }

/** A sink node's in-ports fed by a ribbon (whose items the chain logic times by their glide). */
interface SinkFeed { ent: number; node: SinkNode; ribbon: boolean[] }

/**
 * The fire in every pit of one colony: when the last item fell into each, its heat now, its bursts.
 * Two ways in (D125): an item a ribbon hands in has fallen once its glide is over (the chain's
 * `lastOut`: `tick + 1 + PIT_WAY.gone · stepTicks`); one a routing block or a machine hands straight
 * in (no glide: it vanishes in the block) burns at once, a tick after the engine's `SinkNode` took it
 * (`burnTick + 1`, the views being drawn a tick behind it). A `burnTick` past the sim's tick (a
 * catch-up's warm-up may leave one) is ignored.
 */
export class PitFire {
  /** Each pit's feeding ribbons (by its entity), its sink nodes, from the compiled graph; its graph version. */
  private feeds = new Map<number, Chain[]>();
  private sinks: SinkFeed[] = [];
  private ver = -1;
  /** Per feeding ribbon: the hand-off seen last (its `lastOut` tick and item), and the one before it. */
  private seenT = new Map<Chain, number>();
  private seenI = new Map<Chain, number>();
  private prevT = new Map<Chain, number>();
  private prevI = new Map<Chain, number>();
  /** Each pit's fire (by entity); the frame's tick. */
  private readonly state = new Map<number, PitState>();
  private t = 0;
  /** This frame's latest fall per pit while scanning (scratch, no allocation per frame). */
  private fT = 0;
  private fI = -1;
  private fS = 0;

  /** Per frame, at render tick `t` (fractional): the latest fall in each pit, a burst for each new one. */
  update(sim: Sim, t: number): void {
    this.t = t;
    const g = sim.graph;
    if (!g) return;
    if (g.version !== this.ver) {
      this.ver = g.version;
      this.feeds.clear();
      this.seenT.clear(); this.seenI.clear(); this.prevT.clear(); this.prevI.clear();
      this.sinks = [];
      for (const c of g.chains) {
        const e = c.outE[0];
        if (c.fluid || e === undefined) continue;
        const dst = g.nodes[g.eDst[e]!];
        if (!dst || dst.kind !== 'sink' || !dst.ent) continue;
        let arr = this.feeds.get(dst.ent);
        if (!arr) this.feeds.set(dst.ent, (arr = []));
        arr.push(c);
      }
      for (const n of g.nodes) {
        if (n.kind !== 'sink' || !n.ent) continue;
        const ribbon: boolean[] = [];
        for (const e of n.inE) {
          const src = g.nodes[g.eSrc[e]!];
          ribbon[g.eDstPort[e]!] = !!src && src.kind === 'chain' && !(src as Chain).fluid;
        }
        this.sinks.push({ ent: n.ent, node: n as SinkNode, ribbon });
      }
    }
    // Ribbons: the glide's end of each hand-off (the last and the one before it).
    for (const [ent, chains] of this.feeds) {
      this.fT = this.state.get(ent)?.last ?? -Infinity;
      this.fI = -2;
      for (const c of chains) {
        const lo = c.lastOut;
        if (lo.item < 0 || lo.edge !== c.outE[0]) continue;
        const was = this.seenT.get(c);
        if (was !== lo.tick) {
          if (was !== undefined) { this.prevT.set(c, was); this.prevI.set(c, this.seenI.get(c)!); }
          this.seenT.set(c, lo.tick); this.seenI.set(c, lo.item);
        }
        this.fall(ent, lo.tick, lo.tick + 1 + PIT_WAY.gone * c.stepTicks, lo.item);
        const pt = this.prevT.get(c);
        if (pt !== undefined) this.fall(ent, pt, pt + 1 + PIT_WAY.gone * c.stepTicks, this.prevI.get(c)!);
      }
      if (this.fI !== -2) this.fell(ent);
    }
    // Routing blocks and machines: the sink's own record, a tick on (a ribbon's item is timed above).
    for (const f of this.sinks) {
      const n = f.node;
      if (n.burnTick < 0 || n.burnTick > sim.tick || f.ribbon[n.burnPort] === true) continue;
      this.fT = this.state.get(f.ent)?.last ?? -Infinity;
      this.fI = -2;
      this.fall(f.ent, n.burnTick, n.burnTick + 1, n.burnItem);
      if (this.fI !== -2) this.fell(f.ent);
    }
  }

  /** A candidate fall into pit `ent` (the engine's tick it went in, when it is seen to fall, its item): kept if it is the latest so far and has happened. */
  private fall(ent: number, tick: number, at: number, item: number): void {
    if (at <= this.t && at > this.fT) { this.fT = at; this.fI = item; this.fS = burstSeed(ent, tick); }
  }

  /** The scan found a new fall in pit `ent`: the fire's clock restarts, and a burst begins unless the last one is too fresh. */
  private fell(ent: number): void {
    let st = this.state.get(ent);
    if (!st) {
      st = { last: -Infinity, gap: Infinity, at: new Float64Array(BURST.slots).fill(-Infinity), item: new Int32Array(BURST.slots).fill(-1), seed: new Uint32Array(BURST.slots), n: 0 };
      this.state.set(ent, st);
    }
    st.gap = st.last > -Infinity ? this.fT - st.last : Infinity;
    st.last = this.fT;
    const newest = st.n > 0 ? st.at[(st.n - 1) % BURST.slots]! : -Infinity;
    if (this.fT - newest < BURST.gap) return;
    const k = st.n % BURST.slots;
    st.at[k] = this.fT;
    st.item[k] = this.fI;
    st.seed[k] = this.fS;
    st.n++;
  }

  /** The heat of pit `ent`'s fire at the last update (0…1): the last flare's, or the steady feed's if higher. */
  heat(ent: number): number {
    const st = this.state.get(ent);
    if (!st) return 0;
    const age = this.t - st.last;
    return Math.max(heatAt(age), steadyHeat(st.gap, age));
  }

  /** Pit `ent`'s bursts (undefined: nothing ever burnt there since this fire began watching). */
  bursts(ent: number): PitBursts | undefined {
    return this.state.get(ent);
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
let burst: BurstFrames | null = null;

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

/** The burst's sprites (pit-burst.ts): a spark's streak (anchored at its head) and two puffs (at their centre), at 2× world. */
export interface BurstFrames { spark: DynFrame; puffs: readonly DynFrame[] }

/** The burst's frames, baked the first time (a few thousand px on the pits' sheet). */
export function burstFrames(): BurstFrames {
  if (burst) return burst;
  const { w, h, head, puffW, puffH } = PIT_SPARK;
  const spark = sheet.add('spark', w, h, w / 2, head, (ctx) => drawPitSpark(ctx));
  const puffs = [0, 1].map((v) => sheet.add(`puff:${v}`, puffW, puffH, puffW / 2, puffH / 2, (ctx) => drawPitPuff(ctx, v)));
  sheet.flush();
  burst = { spark, puffs };
  return burst;
}
