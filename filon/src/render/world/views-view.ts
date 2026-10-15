// views-view.ts — the specialised views (D88; owner, 2026-10-15: « Plus clair, plus séparé, des
// vues spécialisées par exemple pour l'électricité »): one system at a time, drawn bold over the
// base dimmed. Render only: it reads the sim and the readouts the shell hands it (sim/readouts/*),
// and never changes anything.
//
// - **The veil.** A paper wash over the graded world (layers.ts `veil`: over the buildings, the
//   ribbons and their items, under the wires), so the base fades to a pale print and the view's
//   own marks, drawn untinted above it, stand out. It fades in and out with the view.
// - **Électricité** (`power`): each grid in its colour (art/view-icons.ts `GRID_COLORS`): its
//   buildings' footprints washed and outlined in it, its pillars ringed (the wires go bold in their
//   grid's colour: wires-view.ts), a pillar's reach on hover. Badges above the buildings: a source
//   by what it catches or burns (sun, wind, fuel, the ground's heat, the Core) with its output
//   against its rating as a small bar; an accumulator with its charge; a consumer by a short gauge
//   of what it draws (its height its rating). A building with no wire, asleep, without power or
//   short of it, or still being built carries that flag instead (dashed frames for the first two).
// - **Logistique** (`logistics`): every ribbon line as a heat (art/view-icons.ts `heatColor`) of
//   its throughput against its tier's pace, a jammed line red with a stop badge at its head, a dead
//   end's head marked; the skydocks and their drifter routes bold violet, arrowed.
// - **Production** (`production`): each production building washed by its state (at work
//   turquoise, a passing stop amber, stopped coral) and, when it does not work, why as a badge.
//
// Space: flat marks in tile units on `viewFlat` (a P plane), in two copies like the overlays — flat
// in plan, lifted onto the rock top in iso (`levelAt` × `SHIFT`), cross-faded; badges in view world
// px on `viewMarks`, over each building's head in iso (its stand and its art's height, lowered
// with 1 − te), on its footprint in plan, sized for the screen (`markSize`). The flat marks are
// rebuilt only when their signature changes (the readouts come at 4 Hz), the badges' places only
// when the view moves.
import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BUILDING_IDS, BUILDING_KIND } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import type { MapView } from '@/core/kinds';
import { footprint } from '@/sim/entities';
import { linkPoint } from '@/sim/power/links';
import type { PowerMark } from '@/sim/readouts/power';
import type { Readouts } from '@/sim/readouts/readouts';
import type { ProdMark, StopWhy } from '@/sim/readouts/production';
import type { RibbonLook } from '@/sim/readouts/ribbons';
import type { Sim } from '@/sim/state';
import type { Ent } from '@/sim/types';
import { C, num } from '../art/tokens';
import { GRID_COLORS, drawViewIcon, heatColor, type ViewIcon } from '../art/view-icons';
import { isoHead } from '../art/recipes/buildings';
import { LH } from '../iso';
import { apply, type Lin } from '../projection';
import { SHIFT } from '../relief';
import { needsWire } from './overlays-view';
import { liftOf } from './stand';

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
export const VEIL: Readonly<Record<MapView, number>> = { normal: 0, land: 0, power: 0.66, logistics: 0.62, production: 0.5 };
/** Seconds the veil takes to come or go. */
const VEIL_FADE = 0.22;
/** A badge's size on screen (CSS px) at zoom 1; it follows √zoom within these bounds. */
const MARK_PX = 30;
const MARK_ZOOM: readonly [number, number] = [0.55, 1.2];
/** Below this zoom the consumers' gauges are left out (too many, too small). */
const GAUGE_MIN_ZOOM = 0.3;

/** The icon a production stop shows. */
const STOP_ICON: Record<StopWhy, ViewIcon> = { power: 'dark', unwired: 'unwired', inputs: 'inputs', output: 'output', recipe: 'recipe', asleep: 'asleep', site: 'site', idle: 'idle' };
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
    flatLayer.addChild(this.flatIso, this.flatPlan, this.ringIso, this.ringPlan);
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
    const on = f.view === 'power' || f.view === 'logistics' || f.view === 'production';
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
    for (const g of [this.flatPlan, this.ringPlan]) { g.alpha = f.te * fade; g.visible = on && g.alpha > 0.01; }
    for (const g of [this.flatIso, this.ringIso]) { g.alpha = (1 - f.te) * fade; g.visible = on && g.alpha > 0.01; }
    this.marks.alpha = fade;
    this.marks.visible = on && fade > 0.01;
    if (!on) {
      if (this.flatSig) { this.flatSig = ''; this.flatPlan.clear(); this.flatIso.clear(); }
      if (this.ringSig) { this.ringSig = ''; this.ringPlan.clear(); this.ringIso.clear(); }
      if (this.used) this.hideMarks(0);
      return;
    }
    if (f.view === 'power' && d.power) this.drawPower(sim, d.power.marks, f);
    else if (f.view === 'logistics' && d.ribbons) this.drawLogistics(sim, d.ribbons, f);
    else if (f.view === 'production' && d.production) this.drawProduction(sim, d.production, f);
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
    const sig = `p${sim.graph?.version}:${sim.links.version}:${marks.map((m) => `${m.net}${m.flag ?? ''}`).join(',')}`;
    if (sig !== this.flatSig) {
      this.flatSig = sig;
      this.both((g, d) => {
        const byNet = new Map<number, Array<[number, number, number, number]>>();
        const rings: Array<[number, number, number, number, number]> = [];
        const loose: Array<[number, number, number, number]> = [];
        const asleep: Array<[number, number, number, number]> = [];
        for (const m of marks) {
          const e = sim.ents.get(m.ent);
          if (!e) continue;
          const [w, h] = footprint(e.def, e.rot), o = d(liftOf(e));
          const r: [number, number, number, number] = [e.x - o, e.y - o, w, h];
          if (m.flag === 'unwired') { loose.push(r); continue; }
          if (m.flag === 'asleep' || m.flag === 'site') { asleep.push(r); continue; }
          if (m.net < 0) continue;
          let arr = byNet.get(m.net);
          if (!arr) byNet.set(m.net, (arr = []));
          arr.push(r);
          if (m.role.k === 'pillar') rings.push([...r, m.net]);
        }
        for (const [net, rects] of byNet) {
          const col = num(GRID_COLORS[net % GRID_COLORS.length]!);
          for (const [x, y, w, h] of rects) g.rect(x + 0.06, y + 0.06, w - 0.12, h - 0.12);
          g.fill({ color: col, alpha: 0.32 }).stroke({ width: 0.11, color: col, alpha: 1 });
        }
        // The pillars: a ring in their grid's colour over an ink one, hugging the footprint.
        for (const [x, y, w, h, net] of rings) {
          const r = Math.max(w, h) / 2 + 0.06;
          g.circle(x + w / 2, y + h / 2, r).stroke({ width: 0.2, color: num(C.ink), alpha: 0.8 });
          g.circle(x + w / 2, y + h / 2, r).stroke({ width: 0.11, color: num(GRID_COLORS[net % GRID_COLORS.length]!), alpha: 1 });
        }
        needsWire(g, loose);
        for (const [x, y, w, h] of asleep) g.rect(x + 0.08, y + 0.08, w - 0.16, h - 0.16);
        if (asleep.length) g.fill({ color: num(C.lilacL), alpha: 0.35 }).stroke({ width: 0.08, color: num(C.lilacD), alpha: 0.8 });
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
    const sig = `l${sim.graph?.version}:${sim.routes.length}:${looks.map((l) => bucket(l)).join(',')}`;
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
        // The skydocks and their drifter routes: bold violet, an arrow halfway towards the dock it serves.
        for (const r of sim.routes) {
          const a = sim.ents.get(r.from), b = sim.ents.get(r.to);
          if (!a || !b) continue;
          const [aw, ah] = footprint(a.def, a.rot), [bw, bh] = footprint(b.def, b.rot);
          const ax = a.x + aw / 2 - d(liftOf(a)), ay = a.y + ah / 2 - d(liftOf(a)), bx = b.x + bw / 2 - d(liftOf(b)), by = b.y + bh / 2 - d(liftOf(b));
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 0.5) continue;
          const ux = (bx - ax) / len, uy = (by - ay) / len;
          for (let s = 0; s < len; s += 1.1) gr.moveTo(ax + ux * s, ay + uy * s).lineTo(ax + ux * Math.min(len, s + 0.7), ay + uy * Math.min(len, s + 0.7));
          gr.stroke({ width: 0.24, color: num(C.violet), alpha: 0.95, cap: 'round' });
          const mx = (ax + bx) / 2, my = (ay + by) / 2, k = 0.9;
          gr.poly([mx + ux * k, my + uy * k, mx - ux * k * 0.6 - uy * k * 0.7, my - uy * k * 0.6 + ux * k * 0.7, mx - ux * k * 0.6 + uy * k * 0.7, my - uy * k * 0.6 - ux * k * 0.7])
            .fill({ color: num(C.violet), alpha: 1 }).stroke({ width: 0.08, color: num(C.ink), alpha: 0.9 });
        }
        for (const e of sim.ents.sorted()) {
          if (BUILDING_KIND[e.def] !== 'dock') continue;
          const [w, h] = footprint(e.def, e.rot), o = d(liftOf(e));
          gr.rect(e.x - o + 0.08, e.y - o + 0.08, w - 0.16, h - 0.16);
        }
        gr.fill({ color: num(C.violetL), alpha: 0.3 }).stroke({ width: 0.14, color: num(C.violet), alpha: 1 });
      });
    }
    if (this.ringSig) { this.ringSig = ''; this.ringPlan.clear(); this.ringIso.clear(); }
  }

  /** A line's path through its tiles' centres, from its tail's edge to its head's; a leap (a bridge, a junction's pass) left out. */
  private ribbonPath(g: Graphics, sim: Sim, l: RibbonLook, levelAt: (x: number, y: number) => number, d: (lv: number) => number, jumps?: ReadonlyMap<number, number>): void {
    const t = l.chain.tiles;
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
        const v = l.chain.tiles[l.chain.tiles.length - 1]!;
        const x = v & 1023, y = v >> 10;
        const m = this.mark(n++);
        m.x = x + 0.5; m.y = y + 0.5; m.head = f.levelAt(x, y) + 0.4;
        this.badge(m, l.jam ? 'jam' : 'dead', null);
      }
      for (const e of sim.ents.sorted()) {
        if (BUILDING_KIND[e.def] !== 'dock') continue;
        const m = this.mark(n++);
        this.anchor(m, e);
        const fleet = sim.fleet.get(e.id) ?? 0;
        this.badge(m, 'dock', fleet > 0 ? Math.min(1, fleet / 4) : null, C.violetL);
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
