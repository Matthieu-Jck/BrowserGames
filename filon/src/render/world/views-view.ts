// views-view.ts — the specialised views (D88; owner, 2026-10-15: « Plus clair, plus séparé, des
// vues spécialisées par exemple pour l'électricité »): one system at a time, drawn bold over the
// base dimmed. Render only: it reads the sim and the readouts the shell hands it (sim/readouts/*),
// and never changes anything.
//
// - **The veil.** A paper wash over the graded world (layers.ts `veil`: over the buildings, the
//   ribbons and their items, under the wires), so the base fades to a pale print and the view's
//   own marks, drawn untinted above it, stand out. It fades in and out with the view.
// - **Électricité** (`power`): each building washed by what it is to power (art/view-icons.ts
//   `POWER_GROUP_COLOR`; owner, 2026-10-16): what makes it gold, the accumulators turquoise, what draws
//   it slate blue, what needs it and reaches no grid coral (dashed when a wire is missing), what
//   needs none — ribbons, routing blocks, stores — greyed out most; each grid keeps its colour
//   (`GRID_COLORS`) on its pillars' rings and its wires (bold: wires-view.ts); a pillar's reach on
//   hover. Badges above the buildings: a source
//   by what it catches or burns (sun, wind, fuel, the ground's heat, the Core) with its output
//   against its rating as a small bar; an accumulator with its charge; a consumer by a short gauge
//   of what it draws (its height its rating). A building with no wire, asleep, without power or
//   short of it, or still being built carries that flag instead (dashed frames for the first two).
// - **Logistique** (`logistics`): every ribbon line as a heat (art/view-icons.ts `heatColor`) of
//   its throughput against its tier's pace, a jammed line red with a stop badge at its head, a dead
//   end's head marked (the skydocks and their drifter routes went in D108). The night (D103):
//   each ribbon tile the Gleaners reach from the desert hatched in midnight ink with a crescent
//   moon, each one kept from them (under glass, behind a fence) ringed in glass blue. A buried
//   line (D109: the camouflaged ribbon, faint on the sand in the normal view) edged on both sides
//   with inked sand dashes, so its owner sees where it runs.
// - **Production** (`production`): each production building washed by its state (at work
//   turquoise, a passing stop amber, stopped coral) and, when it does not work, why as a badge;
//   one at work on a grid under 100 % waits amber under the half-bolt (D91: `weakGrid`).
// - **Vent** (`wind`, D95): the land washed by its exposure to today's wind (art/view-icons.ts
//   `windColor`: calm paper to deep teal), in cells of one to four tiles by the zoom; ink arrows on
//   a lattice pointing the way the wind blows, longer where it blows harder; each turbine's
//   footprint inked, its badge with what it gives against its rating. The field is read chunk by
//   chunk (sim/world/wind.ts), a few chunks a frame, the wash redrawn as they come in.
//
// Space: flat marks in tile units on `viewFlat` (a P plane), in two copies like the overlays — flat
// in plan, lifted onto the rock top in iso (`levelAt` × `SHIFT`), cross-faded; badges in view world
// px on `viewMarks`, over each building's head in iso (its stand and its art's height, lowered
// with 1 − te), on its footprint in plan, sized for the screen (`markSize`). The flat marks are
// rebuilt only when their signature changes (the readouts come at 4 Hz), the badges' places only
// when the view moves.
import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BUILDING_IDS, buildingDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import type { MapView } from '@/core/kinds';
import { footprint } from '@/sim/entities';
import { linkPoint } from '@/sim/power/links';
import { needsNoPower, type PowerGroup, type PowerMark } from '@/sim/readouts/power';
import type { Readouts } from '@/sim/readouts/readouts';
import type { ProdMark, StopWhy } from '@/sim/readouts/production';
import type { RibbonLook } from '@/sim/readouts/ribbons';
import type { WindReport } from '@/sim/readouts/wind';
import type { Sim } from '@/sim/state';
import { DX, DY, type Ent } from '@/sim/types';
import { C, num } from '../art/tokens';
import { GRID_COLORS, POWER_GROUP_COLOR, drawViewIcon, heatColor, windColor, type ViewIcon } from '../art/view-icons';
import { COS64, SIN64 } from '@/content/world';
import { windField } from '@/sim/world/wind';
import { isoHead } from '../art/recipes/buildings';
import { LH } from '../iso';
import { apply, type Lin } from '../projection';
import { SHIFT } from '../relief';
import { needsWire } from './overlays-view';
import { liftOf } from './stand';
import { isSpanTile } from '@/sim/flow/chain';

/** What the shell computed for the view on show (4 Hz; sim/readouts/readouts.ts); `version` bumps with each new reading. */
export type ViewData = Readouts;

/** The view's frame: what is on show, the projection, the camera, the land's height, the building under the cursor. */
export interface ViewFrame {
  view: MapView;
  P: Lin;
  te: number;
  zoom: number;
  dt: number;
  /** The visible tile rect [x0, y0, x1, y1] (with the relief's headroom). */
  tiles: readonly [number, number, number, number];
  levelAt(x: number, y: number): number;
  hover: number;
}

/** How strongly each view veils the base (paper, alpha). */
export const VEIL: Readonly<Record<MapView, number>> = { normal: 0, land: 0, power: 0.66, logistics: 0.62, production: 0.5, wind: 0.55 };
/** The Vent view (D95): chunks of the wind field read a frame at most, the wash's alpha, the arrows' spacing (cells). */
const WIND_CHUNKS_PER_FRAME = 6;
const WIND_ALPHA = 0.78;
const ARROW_EVERY = 9;
/** Seconds the veil takes to come or go. */
const VEIL_FADE = 0.22;
/** A badge's size on screen (CSS px) at zoom 1; it follows √zoom within these bounds. */
const MARK_PX = 30;
const MARK_ZOOM: readonly [number, number] = [0.55, 1.2];
/** Below this zoom the consumers' gauges are left out (too many, too small). */
const GAUGE_MIN_ZOOM = 0.3;

/** The icon a production stop shows. */
const STOP_ICON: Record<StopWhy, ViewIcon> = { power: 'dark', unwired: 'unwired', inputs: 'inputs', output: 'output', recipe: 'recipe', asleep: 'asleep', site: 'site', idle: 'idle', weak: 'low' };
/** The wash of a production state. */
const WORK_COL = { on: C.turq, pause: C.warn, off: C.coral } as const;

interface Mark {
  c: Container;
  icon: Sprite;
  /** A bar or a gauge: its ink frame, its paper inside, its fill. */
  barBg: Sprite;
  barIn: Sprite;
  barFill: Sprite;
  /** Tile point it hangs over, and how high (levels) above the ground in iso. */
  x: number;
  y: number;
  head: number;
}

/** A crescent moon of radius r round (cx, cy), opening to the lower right: the Gleaners' night (D103). */
function crescent(g: Graphics, cx: number, cy: number, r: number): void {
  // The lit limb: the outer circle round its left between the two points where a circle of the same
  // radius, shifted right by `off`, meets it; then back round that circle's left.
  const off = 0.55 * r, h = Math.sqrt(r * r - (off * off) / 4), n = 14;
  const a0 = Math.atan2(-h, off / 2), a1 = Math.atan2(h, off / 2);
  const b0 = Math.atan2(h, -off / 2), b1 = Math.atan2(-h, -off / 2) + 2 * Math.PI;
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 - (i / n) * (2 * Math.PI - (a1 - a0)); pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  for (let i = 0; i <= n; i++) { const b = b0 + (i / n) * (b1 - b0); pts.push(cx + off + Math.cos(b) * r, cy + Math.sin(b) * r); }
  g.poly(pts);
}

/** A badge's texture: the mark on its paper disc, 64 px. */
function iconTexture(id: ViewIcon): Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 72;
  const g = cv.getContext('2d')!;
  drawViewIcon(g, id, 2, 2, 64);
  return new Texture({ source: new CanvasSource({ resource: cv, scaleMode: 'linear' }) });
}

export class ViewsView {
  private readonly veil = new Sprite(Texture.WHITE);
  private readonly flatPlan = new Graphics();
  private readonly flatIso = new Graphics();
  private readonly ringPlan = new Graphics();
  private readonly ringIso = new Graphics();
  /** The Vent view's wash and arrows (D95), apart from the flat marks: redrawn as the field comes in. */
  private readonly heatPlan = new Graphics();
  private readonly heatIso = new Graphics();
  private heatSig = '';
  private readonly marks = new Container();
  private readonly pool: Mark[] = [];
  private used = 0;
  private readonly tex = new Map<ViewIcon, Texture>();
  private veilA = 0;
  private flatSig = '';
  private ringSig = '';
  private placeSig = '';
  private markVersion = -1;
  private shown: MapView = 'normal';

  constructor(veilLayer: Container, flatLayer: Container, markLayer: Container) {
    this.veil.tint = num(C.paper);
    this.veil.alpha = 0;
    this.veil.visible = false;
    veilLayer.addChild(this.veil);
    flatLayer.addChild(this.heatIso, this.heatPlan, this.flatIso, this.flatPlan, this.ringIso, this.ringPlan);
    markLayer.addChild(this.marks);
  }

  /** How many badges are up (perf, the smoke test). */
  get count(): number { return this.used; }

  private icon(id: ViewIcon): Texture {
    let t = this.tex.get(id);
    if (!t) this.tex.set(id, (t = iconTexture(id)));
    return t;
  }

  /** Per frame. */
  update(sim: Sim, f: ViewFrame, d: ViewData): void {
    const on = f.view === 'power' || f.view === 'logistics' || f.view === 'production' || f.view === 'wind';
    // The veil: over the visible tiles (their projection covers the screen), easing to the view's strength.
    const target = VEIL[f.view] ?? 0;
    const step = f.dt / VEIL_FADE;
    this.veilA = this.veilA < target ? Math.min(target, this.veilA + step) : Math.max(target, this.veilA - step);
    this.veil.visible = this.veilA > 0.005;
    if (this.veil.visible) {
      const [x0, y0, x1, y1] = f.tiles;
      this.veil.position.set(Math.floor(x0) - 8, Math.floor(y0) - 8);
      this.veil.width = Math.ceil(x1 - x0) + 16;
      this.veil.height = Math.ceil(y1 - y0) + 16;
      this.veil.alpha = this.veilA;
    }
    if (f.view !== this.shown) { this.shown = f.view; this.flatSig = ''; this.markVersion = -1; this.ringSig = ''; }
    const fade = target > 0 ? this.veilA / target : 0;
    for (const g of [this.flatPlan, this.ringPlan, this.heatPlan]) { g.alpha = f.te * fade; g.visible = on && g.alpha > 0.01; }
    for (const g of [this.flatIso, this.ringIso, this.heatIso]) { g.alpha = (1 - f.te) * fade; g.visible = on && g.alpha > 0.01; }
    this.marks.alpha = fade;
    this.marks.visible = on && fade > 0.01;
    if (!on) {
      if (this.flatSig) { this.flatSig = ''; this.flatPlan.clear(); this.flatIso.clear(); }
      if (this.ringSig) { this.ringSig = ''; this.ringPlan.clear(); this.ringIso.clear(); }
      if (this.heatSig) { this.heatSig = ''; this.heatPlan.clear(); this.heatIso.clear(); }
      if (this.used) this.hideMarks(0);
      return;
    }
    if (f.view !== 'wind' && this.heatSig) { this.heatSig = ''; this.heatPlan.clear(); this.heatIso.clear(); }
    if (f.view === 'power' && d.power) this.drawPower(sim, d.power.marks, f);
    else if (f.view === 'logistics' && d.ribbons) this.drawLogistics(sim, d.ribbons, f);
    else if (f.view === 'production' && d.production) this.drawProduction(sim, d.production, f);
    else if (f.view === 'wind' && d.wind) this.drawWind(sim, d.wind, f);
    if (d.version !== this.markVersion) {
      this.markVersion = d.version;
      this.buildMarks(sim, f, d);
      this.placeSig = '';
    }
    this.placeMarks(f);
  }

  // ── flat marks ─────────────────────────────────────────────────────────────

  /** Draw into both copies: flat (plan) and lifted onto the rock tops (iso). `lift(x, y)` the tile's level there. */
  private both(fn: (g: Graphics, d: (lv: number) => number) => void): void {
    this.flatPlan.clear();
    this.flatIso.clear();
    fn(this.flatPlan, () => 0);
    fn(this.flatIso, (lv) => lv * SHIFT);
  }

  private drawPower(sim: Sim, marks: readonly PowerMark[], f: ViewFrame): void {
    const sig = `p${sim.graph?.version}:${sim.links.version}:${sim.ents.size}:${marks.map((m) => `${m.net}${m.flag ?? ''}${m.group ?? ''}`).join(',')}`;
    if (sig !== this.flatSig) {
      this.flatSig = sig;
      this.both((g, d) => {
        type R = [number, number, number, number];
        const rect = (e: Ent): R => { const [w, h] = footprint(e.def, e.rot), o = d(liftOf(e)); return [e.x - o, e.y - o, w, h]; };
        // What needs no power first, greyed out under the rest (its ribbons, routing blocks, stores).
        for (const e of sim.ents.sorted()) {
          if (!needsNoPower(e.def)) continue;
          const [x, y, w, h] = rect(e);
          g.rect(x + 0.04, y + 0.04, w - 0.08, h - 0.08);
        }
        const [nf, ns] = POWER_GROUP_COLOR.none;
        g.fill({ color: num(nf), alpha: 0.6 }).stroke({ width: 0.05, color: num(ns), alpha: 0.5 });
        // Then each group in its tone; the unwired dashed over it; the pillars ringed in their grid's colour.
        const byGroup = new Map<PowerGroup, R[]>();
        const rings: Array<[number, number, number, number, number]> = [];
        const loose: R[] = [];
        for (const m of marks) {
          const e = sim.ents.get(m.ent);
          if (!e) continue;
          const r = rect(e);
          if (m.role.k === 'pillar') { if (m.net >= 0) rings.push([...r, m.net]); continue; }
          if (m.flag === 'unwired') loose.push(r);
          if (!m.group) continue;
          let arr = byGroup.get(m.group);
          if (!arr) byGroup.set(m.group, (arr = []));
          arr.push(r);
        }
        for (const [grp, rects] of byGroup) {
          const [fc, sc] = POWER_GROUP_COLOR[grp];
          for (const [x, y, w, h] of rects) g.rect(x + 0.06, y + 0.06, w - 0.12, h - 0.12);
          g.fill({ color: num(fc), alpha: grp === 'unlinked' ? 0.5 : 0.55 }).stroke({ width: 0.11, color: num(sc), alpha: 1 });
        }
        // The pillars: a ring in their grid's colour over an ink one, hugging the footprint.
        for (const [x, y, w, h, net] of rings) {
          const r = Math.max(w, h) / 2 + 0.06;
          g.circle(x + w / 2, y + h / 2, r).stroke({ width: 0.2, color: num(C.ink), alpha: 0.8 });
          g.circle(x + w / 2, y + h / 2, r).stroke({ width: 0.11, color: num(GRID_COLORS[net % GRID_COLORS.length]!), alpha: 1 });
        }
        needsWire(g, loose);
      });
    }
    // A pillar's reach on hover (the Link tool's ring: its footprint swept out to its range).
    const e = f.hover ? sim.ents.get(f.hover) : undefined;
    const lp = e ? linkPoint(e.def, sim.mods) : null;
    const rsig = e && lp ? `${e.id}:${lp.range}:${liftOf(e)}` : '';
    if (rsig !== this.ringSig) {
      this.ringSig = rsig;
      this.ringPlan.clear();
      this.ringIso.clear();
      if (e && lp) {
        const [w, h] = footprint(e.def, e.rot), r = lp.range;
        const net = sim.graph?.netOfEnt.get(e.id);
        const col = num(net !== undefined ? GRID_COLORS[net % GRID_COLORS.length]! : C.turq);
        for (const [g, o] of [[this.ringPlan, 0], [this.ringIso, liftOf(e) * SHIFT]] as const) {
          g.roundRect(e.x - o - r, e.y - o - r, w + 2 * r, h + 2 * r, r).fill({ color: col, alpha: 0.1 }).stroke({ width: 0.14, color: col, alpha: 0.95 });
        }
      }
    }
  }

  private drawLogistics(sim: Sim, looks: readonly RibbonLook[], f: ViewFrame): void {
    const bucket = (l: RibbonLook): number => (l.jam ? -2 : l.util < 0 ? (l.fill > 0 ? 3 : -1) : l.util === 0 && l.fill === 0 ? -1 : Math.round(l.util / 100));
    const sig = `l${sim.graph?.version}:${looks.map((l) => bucket(l)).join(',')}`;
    if (sig !== this.flatSig) {
      this.flatSig = sig;
      const g = sim.graph;
      this.both((gr, d) => {
        // Lines grouped by their heat bucket: one batched stroke each, over an ink edge.
        const groups = new Map<number, RibbonLook[]>();
        for (const l of looks) { const b = bucket(l); let a = groups.get(b); if (!a) groups.set(b, (a = [])); a.push(l); }
        const lineOf = (l: RibbonLook): void => this.ribbonPath(gr, sim, l, f.levelAt, d, g?.jumps);
        for (const ls of groups.values()) for (const l of ls) lineOf(l);
        gr.stroke({ width: 0.5, color: num(C.ink), alpha: 0.6, cap: 'round', join: 'round' });
        for (const [b, ls] of groups) {
          for (const l of ls) lineOf(l);
          if (b === -1) gr.stroke({ width: 0.2, color: num(C.paperD), alpha: 1, cap: 'round', join: 'round' });
          else if (b === -2) gr.stroke({ width: 0.38, color: num(C.ledRed), alpha: 1, cap: 'round', join: 'round' });
          else gr.stroke({ width: 0.34, color: num(heatColor(b * 100)), alpha: 1, cap: 'round', join: 'round' });
        }
        // The Gleaners' night (D103): the tiles they reach, hatched, a crescent on each; those kept from them, ringed.
        const glean = g?.glean;
        if (glean) {
          for (const v of glean.exposed) {
            const x = v & 1023, y = v >> 10, o = d(f.levelAt(x, y));
            for (const k of [0.3, 0.7]) gr.moveTo(x - o + k - 0.12, y - o + 0.82).lineTo(x - o + k + 0.12, y - o + 0.18);
          }
          if (glean.exposed.length) gr.stroke({ width: 0.06, color: num(C.inkSoft), alpha: 0.85, cap: 'round' });
          // A night badge on each: the midnight disc, the crescent on it.
          for (const v of glean.exposed) {
            const x = v & 1023, y = v >> 10, o = d(f.levelAt(x, y));
            gr.circle(x - o + 0.5, y - o + 0.5, 0.3);
          }
          if (glean.exposed.length) gr.fill({ color: num(C.inkSoft), alpha: 1 }).stroke({ width: 0.05, color: num(C.ink), alpha: 1 });
          for (const v of glean.exposed) {
            const x = v & 1023, y = v >> 10, o = d(f.levelAt(x, y));
            crescent(gr, x - o + 0.5, y - o + 0.5, 0.21);
          }
          if (glean.exposed.length) gr.fill({ color: num(C.glowPeach), alpha: 1 });
          for (const v of glean.guarded) {
            const x = v & 1023, y = v >> 10, o = d(f.levelAt(x, y));
            gr.roundRect(x - o + 0.1, y - o + 0.1, 0.8, 0.8, 0.22);
          }
          if (glean.guarded.length) gr.stroke({ width: 0.09, color: num(C.ice), alpha: 1 });
        }
        // The buried lines (D109): sand dashes either side of each camouflaged tile, over an ink edge.
        const buried = sim.ents.sorted().filter((e) => buildingDef(e.def).camo);
        if (buried.length) {
          const dashes = (): void => {
            for (const e of buried) {
              const o = d(f.levelAt(e.x, e.y)), cx = e.x - o + 0.5, cy = e.y - o + 0.5;
              const ux = DX[e.rot]!, uy = DY[e.rot]!;
              for (const s of [-0.38, 0.38]) {
                for (const t0 of [-0.42, -0.08, 0.26]) {
                  const ax = cx - uy * s + ux * t0, ay = cy + ux * s + uy * t0;
                  gr.moveTo(ax, ay).lineTo(ax + ux * 0.16, ay + uy * 0.16);
                }
              }
            }
          };
          dashes();
          gr.stroke({ width: 0.17, color: num(C.ink), alpha: 0.8, cap: 'round' });
          dashes();
          gr.stroke({ width: 0.09, color: num(C.sand), alpha: 1, cap: 'round' });
        }
      });
    }
    if (this.ringSig) { this.ringSig = ''; this.ringPlan.clear(); this.ringIso.clear(); }
  }

  /** A line's path through its tiles' centres, from its tail's edge to its head's; a leap (a bridge, a junction's pass) left out. */
  private ribbonPath(g: Graphics, sim: Sim, l: RibbonLook, levelAt: (x: number, y: number) => number, d: (lv: number) => number, jumps?: ReadonlyMap<number, number>): void {
    // Its world tiles: the cells over a leap (D121, `isSpanTile`) are left out with the leap.
    const t = l.chain.tiles.filter((v) => !isSpanTile(v));
    if (!t.length) return;
    const at = (i: number): [number, number] => { const v = t[i]!, x = v & 1023, y = v >> 10, o = d(levelAt(x, y)); return [x + 0.5 - o, y + 0.5 - o]; };
    const dir = (i: number): [number, number] => { const v = t[i]!, e = sim.entityAt(v & 1023, v >> 10); const r = e?.rot ?? 0; return [[0, 1, 0, -1][r]!, [-1, 0, 1, 0][r]!]; };
    let [px, py] = at(0);
    const [dx0, dy0] = dir(0);
    g.moveTo(px - dx0 * 0.45, py - dy0 * 0.45).lineTo(px, py);
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1]!, b = t[i]!;
      const [x, y] = at(i);
      const adj = Math.abs((a & 1023) - (b & 1023)) + Math.abs((a >> 10) - (b >> 10)) === 1 && !jumps?.has(a);
      if (adj) g.lineTo(x, y);
      else g.moveTo(x, y);
      px = x; py = y;
    }
    const [dx1, dy1] = dir(t.length - 1);
    g.lineTo(px + dx1 * 0.45, py + dy1 * 0.45);
  }

  private drawProduction(sim: Sim, marks: readonly ProdMark[], _f: ViewFrame): void {
    const sig = `w${sim.graph?.version}:${marks.map((m) => `${m.work[1]}${m.why ?? ''}`).join(',')}`;
    if (sig !== this.flatSig) {
      this.flatSig = sig;
      this.both((g, d) => {
        for (const state of ['on', 'pause', 'off'] as const) {
          let n = 0;
          for (const m of marks) {
            if (m.work !== state) continue;
            const e = sim.ents.get(m.ent);
            if (!e) continue;
            const [w, h] = footprint(e.def, e.rot), o = d(liftOf(e));
            g.rect(e.x - o + 0.07, e.y - o + 0.07, w - 0.14, h - 0.14);
            n++;
          }
          const col = num(WORK_COL[state]);
          if (n) g.fill({ color: col, alpha: state === 'on' ? 0.28 : 0.42 }).stroke({ width: state === 'on' ? 0.08 : 0.13, color: col, alpha: 1 });
        }
      });
    }
    if (this.ringSig) { this.ringSig = ''; this.ringPlan.clear(); this.ringIso.clear(); }
  }

  /**
   * The Vent view (D95): the wash of today's exposure over the visible land in cells (1, 2 or 4
   * tiles by the zoom), the arrows, the turbines' footprints. The field's chunks not read yet are
   * read a few a frame; the wash is redrawn when more are in, the view moves past its margin, or
   * the bearing changes.
   */
  private drawWind(sim: Sim, w: WindReport, f: ViewFrame): void {
    const field = windField(sim.grid.source), b = w.bearing;
    const cell = f.zoom >= 0.9 ? 1 : f.zoom >= 0.26 ? 2 : 4;
    const span = 16 * cell;
    const [vx0, vy0, vx1, vy1] = f.tiles;
    const x0 = Math.max(0, Math.floor((vx0 - 8) / span) * span), y0 = Math.max(0, Math.floor((vy0 - 8) / span) * span);
    const x1 = Math.min(1024, Math.ceil((vx1 + 8) / span) * span), y1 = Math.min(1024, Math.ceil((vy1 + 8) / span) * span);
    // Read the chunks the rect needs, a few a frame.
    let ready = 0, total = 0, budget = WIND_CHUNKS_PER_FRAME;
    for (let cy = y0 >> 5; cy <= (y1 - 1) >> 5; cy++) for (let cx = x0 >> 5; cx <= (x1 - 1) >> 5; cx++) {
      total++;
      if (field.hasChunk(cx, cy, b)) { ready++; continue; }
      if (budget-- > 0) { field.chunk(cx, cy, b); ready++; }
    }
    const turbines = w.turbines.map((t) => t.ent).join(',');
    const sig = `${b}:${cell}:${x0},${y0},${x1},${y1}:${ready}/${total}:${turbines}:${sim.graph?.version}`;
    if (sig !== this.heatSig) {
      this.heatSig = sig;
      for (const [g, lift] of [[this.heatPlan, false], [this.heatIso, true]] as const) {
        g.clear();
        // The wash: cells grouped by their colour's step (one fill each).
        const groups = new Map<number, number[]>();
        for (let y = y0; y < y1; y += cell) for (let x = x0; x < x1; x += cell) {
          if (!field.hasChunk(x >> 5, y >> 5, b)) continue;
          const cxm = Math.min(1023, x + (cell >> 1)), cym = Math.min(1023, y + (cell >> 1));
          const k = Math.round(field.at(cxm, cym, b) / 100);
          let arr = groups.get(k);
          if (!arr) groups.set(k, (arr = []));
          arr.push(x, y, lift ? f.levelAt(cxm, cym) * SHIFT : 0);
        }
        for (const [k, cells] of groups) {
          for (let i = 0; i < cells.length; i += 3) g.rect(cells[i]! - cells[i + 2]!, cells[i + 1]! - cells[i + 2]!, cell, cell);
          g.fill({ color: num(windColor(k * 100)), alpha: WIND_ALPHA });
        }
        // The arrows: the way the wind blows (from bearing b, towards b + 32), longer where it blows harder.
        const ux = -COS64[b]! / 1024, uy = -SIN64[b]! / 1024, step = ARROW_EVERY * cell;
        for (let y = Math.ceil(y0 / step) * step + (step >> 1); y < y1; y += step) for (let x = Math.ceil(x0 / step) * step + (step >> 1); x < x1; x += step) {
          if (!field.hasChunk(x >> 5, y >> 5, b)) continue;
          const e = field.at(x, y, b), len = (1.2 + (2.6 * Math.min(e, 2400)) / 2400) * cell, o = lift ? f.levelAt(x, y) * SHIFT : 0;
          const ax = x + 0.5 - o - (ux * len) / 2, ay = y + 0.5 - o - (uy * len) / 2, bx = ax + ux * len, by = ay + uy * len;
          const hw = 0.42 * cell;
          g.moveTo(ax, ay).lineTo(bx, by);
          g.moveTo(bx - ux * hw * 1.4 - uy * hw, by - uy * hw * 1.4 + ux * hw).lineTo(bx, by).lineTo(bx - ux * hw * 1.4 + uy * hw, by - uy * hw * 1.4 - ux * hw);
        }
        g.stroke({ width: 0.17 * cell, color: num(C.ink), alpha: 0.85, cap: 'round', join: 'round' });
        // The turbines' footprints, inked over the wash.
        for (const t of w.turbines) {
          const e = sim.ents.get(t.ent);
          if (!e) continue;
          const [fw, fh] = footprint(e.def, e.rot), o = lift ? liftOf(e) * SHIFT : 0;
          g.rect(e.x - o + 0.06, e.y - o + 0.06, fw - 0.12, fh - 0.12);
        }
        g.stroke({ width: 0.14, color: num(C.ink), alpha: 1 });
      }
    }
    if (this.flatSig) { this.flatSig = ''; this.flatPlan.clear(); this.flatIso.clear(); }
    if (this.ringSig) { this.ringSig = ''; this.ringPlan.clear(); this.ringIso.clear(); }
  }

  // ── badges ─────────────────────────────────────────────────────────────────

  private mark(i: number): Mark {
    let m = this.pool[i];
    if (!m) {
      const c = new Container();
      const icon = new Sprite(Texture.WHITE);
      icon.anchor.set(0.5, 1);
      const barBg = new Sprite(Texture.WHITE), barIn = new Sprite(Texture.WHITE), barFill = new Sprite(Texture.WHITE);
      barBg.tint = num(C.ink);
      barIn.tint = num(C.paper);
      c.addChild(barBg, barIn, barFill, icon);
      m = { c, icon, barBg, barIn, barFill, x: 0, y: 0, head: 0 };
      this.pool.push(m);
      this.marks.addChild(c);
    }
    m.c.visible = true;
    return m;
  }

  private hideMarks(from: number): void {
    for (let i = from; i < this.pool.length; i++) this.pool[i]!.c.visible = false;
    this.used = from;
  }

  /** Where a building's badge hangs: its footprint's centre, its head (stand + art height) in levels. */
  private anchor(m: Mark, e: Ent): void {
    const [w, h] = footprint(e.def, e.rot);
    m.x = e.x + w / 2;
    m.y = e.y + h / 2;
    m.head = liftOf(e) + isoHead(BUILDING_IDS[e.def] as BuildingId) + 0.2;
  }

  /** A badge (icon), with a bar under it when `fill` is given (0–1, its colour `col`). */
  private badge(m: Mark, icon: ViewIcon, fill: number | null, col: string = C.turq): void {
    m.icon.texture = this.icon(icon);
    m.icon.visible = true;
    m.icon.width = m.icon.height = 72;
    m.icon.position.set(0, 0);
    const bar = fill !== null;
    m.barBg.visible = m.barIn.visible = m.barFill.visible = bar;
    if (!bar) return;
    m.barBg.position.set(-28, 1);
    m.barBg.width = 56; m.barBg.height = 15;
    m.barIn.position.set(-25, 4);
    m.barIn.width = 50; m.barIn.height = 9;
    m.barFill.position.set(-25, 4);
    m.barFill.height = 9;
    m.barFill.width = Math.max(0.01, 50 * Math.max(0, Math.min(1, fill)));
    m.barFill.tint = num(col);
  }

  /** A consumer's gauge: an upright inked pill as tall as its rating (log), filled from the bottom to what it draws. */
  private gauge(m: Mark, fill: number, full: number, col: string): void {
    m.icon.visible = false;
    const H = Math.round(18 + 9 * Math.log2(1 + Math.max(0, full) / 25));
    m.barBg.visible = m.barIn.visible = m.barFill.visible = true;
    m.barBg.position.set(-9, -H - 4); m.barBg.width = 18; m.barBg.height = H + 8;
    m.barIn.position.set(-5, -H); m.barIn.width = 10; m.barIn.height = H;
    const fh = Math.max(0.01, H * Math.max(0, Math.min(1, fill)));
    m.barFill.position.set(-5, -fh); m.barFill.width = 10; m.barFill.height = fh;
    m.barFill.tint = num(col);
  }

  private buildMarks(sim: Sim, f: ViewFrame, d: ViewData): void {
    let n = 0;
    const gauges = f.zoom >= GAUGE_MIN_ZOOM;
    if (f.view === 'power' && d.power) {
      for (const pm of d.power.marks) {
        const e = sim.ents.get(pm.ent);
        if (!e) continue;
        const r = pm.role;
        if (r.k === 'pillar' && !pm.flag) continue;
        if (r.k === 'consumer' && !pm.flag && !gauges) continue;
        const m = this.mark(n++);
        this.anchor(m, e);
        // A trouble first (no wire, asleep, no power, still being built); else its part: a source
        // and its output, an accumulator and its charge, a consumer's gauge (coral on a grid short of power).
        if (pm.flag && pm.flag !== 'low') this.badge(m, pm.flag, null);
        else if (r.k === 'source') this.badge(m, r.src, r.full > 0 ? r.kw / r.full : null, C.turq);
        else if (r.k === 'acc') this.badge(m, 'acc', r.charge / 1000, C.turq);
        else if (r.k === 'consumer') this.gauge(m, r.full > 0 ? r.kw / r.full : 0, r.full, pm.flag === 'low' ? C.coral : C.warn);
        else this.badge(m, 'low', null);
      }
    } else if (f.view === 'logistics' && d.ribbons) {
      for (const l of d.ribbons) {
        if (!l.jam && !l.dead) continue;
        const v = l.chain.lastTile;
        const x = v & 1023, y = v >> 10;
        const m = this.mark(n++);
        m.x = x + 0.5; m.y = y + 0.5; m.head = f.levelAt(x, y) + 0.4;
        this.badge(m, l.jam ? 'jam' : 'dead', null);
      }
    } else if (f.view === 'wind' && d.wind) {
      // Each turbine: the wind mark, its output against its rating (coral when it gives nothing).
      for (const tl of d.wind.turbines) {
        const e = sim.ents.get(tl.ent);
        if (!e) continue;
        const m = this.mark(n++);
        this.anchor(m, e);
        this.badge(m, 'wind', tl.full > 0 ? tl.kw / tl.full : 0, tl.kw > 0 ? C.turq : C.coral);
      }
    } else if (f.view === 'production' && d.production) {
      for (const pm of d.production) {
        if (pm.work === 'on' || !pm.why) continue;
        const e = sim.ents.get(pm.ent);
        if (!e) continue;
        const m = this.mark(n++);
        this.anchor(m, e);
        this.badge(m, STOP_ICON[pm.why], null);
      }
    }
    this.hideMarks(n);
  }

  /** Each badge over its building's head (iso) or footprint (plan), sized for the screen. */
  private placeMarks(f: ViewFrame): void {
    const sig = `${f.P.a},${f.P.b},${f.P.c},${f.P.d}:${f.zoom}:${this.used}:${this.markVersion}`;
    if (sig === this.placeSig) return;
    this.placeSig = sig;
    const px = MARK_PX * Math.max(MARK_ZOOM[0], Math.min(MARK_ZOOM[1], Math.sqrt(f.zoom)));
    const k = px / f.zoom / 64; // badge px (64 a badge) → view world px
    const up = LH * (1 - f.te);
    for (let i = 0; i < this.used; i++) {
      const m = this.pool[i]!;
      const [X, Y] = apply(f.P, m.x, m.y);
      m.c.position.set(X, Y - m.head * up);
      m.c.scale.set(k);
    }
  }
}
