// wires-view.ts — the power wires (D25), drawn above every building in both views, from
// terminal to terminal: each end hangs from a precise point its building's art draws — an
// insulator on a roof's service mast, a pole's crossarm pin, the Heart's link mast
// (art/terminals.ts, picked per wire by world/wire-geom `wireEnds`). Iso: a gentle catenary in
// iso world px on the `wires` layer (it follows the volumes' M(t) and fades with them). Plan:
// straight inked lines between the same terminals, in tile units on the `wiresPlan` layer.
// Moebius ink, kept fine (owner, 2026-10-12: "a bit more thin, and slightly transparent"): a
// thin translucent dark line with a hair of light along it; a grid with no supply (night, no
// fuel) has dim wires, a wire to a construction site is dashed, and small glints run along the
// powered ones, quicker the better the grid is served — always from the generators' side towards
// what they feed (owner, 2026-10-13): each wire runs from its end nearer a generator, counted in
// wires (`flowWays`); a wire whose ends are as near as each other (two generators, a loop's
// middle) carries none. With the power overlay (P) each grid's
// wires take its colour. While the Link tool is in hand, a preview wire runs from its source to
// the hovered building, terminal to terminal: turquoise (would wire), coral (would cut), red
// (refused).
//
// The wire geometry is rebuilt only when the wires or the compiled graph change, and redrawn
// when a grid's powered state flips; each style is one batched stroke. The glints are pooled
// sprites moved each frame with no allocation.
import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { LinkPreview } from '@/input/link-tool';
import type { Sim } from '@/sim/state';
import type { Ent } from '@/sim/types';
import { buildingDef } from '@/content/registry';
import { C, num } from '../art/tokens';
import { tileToIso } from '../iso';
import { flowWays, pointAlong, polyLengths, wireCurve, wireEnds, type Anchor } from './wire-geom';

/** One wire as drawn. */
interface Wire {
  a: number;
  b: number;
  /** The grid both ends are on (-1: an end is not live yet — a construction site, a dormant building). */
  net: number;
  iso: Float32Array;
  isoLen: Float32Array;
  /** Plan: the two terminals (tiles). */
  ax: number; ay: number; bx: number; by: number;
  /** Glint phase, from the ids. */
  seed: number;
  /** Which way power runs along it: 1 from a to b, -1 from b to a, 0 no way to tell (no glint). */
  way: number;
}

/** The kinds of building that put power into a grid (accumulators only give back what they took). */
const SOURCE_KINDS: ReadonlySet<string> = new Set(['hearth', 'wind', 'solar', 'geothermal', 'generator']);

/** Colours the power overlay gives the grids, in grid order. */
export const GRID_COLORS: readonly string[] = [C.cyan, C.coral, C.brass, C.violetL, C.ledGreen, C.turqL, C.peachD, C.lilac, C.tealL, C.hazard];

const INK = num(C.ink);
const LIT = num(C.ice);
const DIM_HI = num(C.steelL);
const MAX_GLINTS = 400;
const GLINT_TILES_PER_S = 2.4;

/**
 * The wires' line (owner, 2026-10-12: thinner, slightly transparent): widths in iso px and in
 * tiles (plan), alphas of the dark line and of its light hair, live / dim / planned. Readable on
 * sand by day and under the night grade; the overlay's grid colours run a little wider.
 */
const LINE = {
  iso: 1.8, isoGrid: 2.4, isoHi: 0.65, plan: 0.055, planGrid: 0.075, planHi: 0.02, hiOff: 0.8, planHiOff: 0.018,
  on: 0.78, onHi: 0.55, off: 0.42, offHi: 0.2, planned: 0.36,
} as const;
/** The Link tool's preview: a little bolder than a wire (it is a pointer), the same shape. */
const PREVIEW = { iso: 2.4, isoDash: 1.7, plan: 0.075, planDash: 0.055, alpha: 0.85, endIso: 2.6, endPlan: 0.09 } as const;

/** A small four-pointed spark with a soft halo, white (tinted per use), 32 px. */
function glintTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d')!;
  const halo = g.createRadialGradient(16, 16, 0, 16, 16, 15);
  halo.addColorStop(0, 'rgba(255,255,255,0.95)');
  halo.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(16, 3); g.lineTo(18, 14); g.lineTo(29, 16); g.lineTo(18, 18);
  g.lineTo(16, 29); g.lineTo(14, 18); g.lineTo(3, 16); g.lineTo(14, 14);
  g.closePath();
  g.fill();
  return new Texture({ source: new CanvasSource({ resource: cv, scaleMode: 'linear' }) });
}

export class WiresView {
  private readonly isoG = new Graphics();
  private readonly planG = new Graphics();
  private readonly isoPre = new Graphics();
  private readonly planPre = new Graphics();
  private readonly isoGlints = new Container();
  private readonly planGlints = new Container();
  private readonly glintTex: Texture;
  private wires: Wire[] = [];
  /** What the geometry was built for (`links.version`, `graph.version`) and drawn with (powered grids, overlay). */
  private linksV = -1;
  private graphV = -1;
  private poweredKey = 0;
  private byGrid = false;
  private styled = false;
  /** The preview drawn last (the Link tool hands the same object while nothing changes) and the geometry it was drawn on. */
  private lastPre: LinkPreview | null = null;
  private preLinksV = -1;
  private preGraphV = -1;
  /** Per grid: has supply right now (1) or not (0); and how well it is served (‰). */
  private powered = new Uint8Array(0);
  private sat = new Int32Array(0);
  /** Frame stamps: each grid is read once per frame, however many wires it has. */
  private stamp = new Uint32Array(0);
  private frameNo = 0;
  private time = 0;
  private readonly pt = { x: 0, y: 0 };

  constructor(isoLayer: Container, planLayer: Container) {
    this.glintTex = glintTexture();
    isoLayer.addChild(this.isoG, this.isoPre, this.isoGlints);
    planLayer.addChild(this.planG, this.planPre, this.planGlints);
    this.isoGlints.blendMode = 'add';
    this.planGlints.blendMode = 'add';
  }

  /** How many wires are drawn (perf overlay, smoke test). */
  get count(): number { return this.wires.length; }

  /**
   * Per frame. `te`: the eased plan-ness; `preview`: the Link tool's (null when not in hand);
   * `byGrid`: the power overlay is on (wires take their grid's colour).
   */
  update(sim: Sim, te: number, dt: number, preview: LinkPreview | null, byGrid: boolean): void {
    this.time += dt;
    const g = sim.graph;
    if (!g) return;
    let restyle = false;
    if (sim.links.version !== this.linksV || g.version !== this.graphV) {
      this.linksV = sim.links.version; this.graphV = g.version;
      this.rebuild(sim);
      restyle = true;
    }
    const powered = this.readPower(sim);
    if (restyle || !this.styled || powered !== this.poweredKey || byGrid !== this.byGrid) {
      this.poweredKey = powered; this.byGrid = byGrid; this.styled = true;
      this.draw(byGrid);
    }
    this.drawPreview(sim, preview);
    this.moveGlints(te);
  }

  // ── geometry ───────────────────────────────────────────────────────────────

  private rebuild(sim: Sim): void {
    const out: Wire[] = [];
    for (const [ia, ib] of sim.links.pairs()) {
      const ea = sim.ents.get(ia), eb = sim.ents.get(ib);
      if (!ea || !eb) continue;
      const [A, B] = wireEnds(ea, eb);
      const iso = wireCurve(A, B);
      const na = sim.graph.netOfEnt.get(ia), nb = sim.graph.netOfEnt.get(ib);
      out.push({
        a: ia, b: ib, net: na !== undefined && na === nb ? na : -1, iso, isoLen: polyLengths(iso),
        ax: A.x, ay: A.y, bx: B.x, by: B.y,
        seed: ((ia * 0.618034 + ib * 0.414214) % 1 + 1) % 1, way: 0,
      });
    }
    flowWays(out, (id) => {
      const e = sim.ents.get(id);
      return !!e && e.builtAt === 0 && !sim.isDormant(e) && SOURCE_KINDS.has(buildingDef(e.def).kind);
    });
    this.wires = out;
  }

  /** Read each wired grid's supply and service; returns a key that changes when any of them flips. */
  private readPower(sim: Sim): number {
    const nets = sim.graph.nets;
    if (this.powered.length !== nets.length) {
      this.powered = new Uint8Array(nets.length); this.sat = new Int32Array(nets.length); this.stamp = new Uint32Array(nets.length);
    }
    const frame = ++this.frameNo;
    let key = 0;
    for (const w of this.wires) {
      const n = w.net;
      if (n < 0 || this.stamp[n] === frame) continue;
      this.stamp[n] = frame;
      const np = sim.netPower[n];
      let on = !!np && np.renew + np.fuel > 0;
      if (!on) for (const a of nets[n]?.accs ?? []) if ((sim.accEnergy.get(a.ent) ?? 0) > 0) { on = true; break; }
      this.powered[n] = on ? 1 : 0;
      this.sat[n] = on ? np?.sat ?? 1000 : 0;
      key = (key * 31 + (on ? n + 1 : 0)) | 0;
    }
    return key;
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  private draw(byGrid: boolean): void {
    const iso = this.isoG, plan = this.planG;
    iso.clear(); plan.clear();
    // Groups by style, each one batched stroke: live wires dim / lit (or by grid colour), planned ones dashed.
    const groups = new Map<string, { color: number; alpha: number; hi: number; hiAlpha: number; ws: Wire[] }>();
    const planned: Wire[] = [];
    for (const w of this.wires) {
      if (w.net < 0) { planned.push(w); continue; }
      const on = this.powered[w.net] === 1;
      const color = byGrid ? num(GRID_COLORS[w.net % GRID_COLORS.length]!) : INK;
      const k = `${color}:${on ? 1 : 0}`;
      let grp = groups.get(k);
      if (!grp) groups.set(k, (grp = { color, alpha: on ? LINE.on : LINE.off, hi: on ? LIT : DIM_HI, hiAlpha: on ? LINE.onHi : LINE.offHi, ws: [] }));
      grp.ws.push(w);
    }
    // The ends sit on the terminals the art draws (plan insulators included): no knots on top.
    const wIso = byGrid ? LINE.isoGrid : LINE.iso, wPlan = byGrid ? LINE.planGrid : LINE.plan;
    for (const grp of groups.values()) {
      for (const w of grp.ws) isoPath(iso, w.iso, 0);
      iso.stroke({ width: wIso, color: grp.color, alpha: grp.alpha, cap: 'round', join: 'round' });
      for (const w of grp.ws) isoPath(iso, w.iso, -LINE.hiOff);
      iso.stroke({ width: LINE.isoHi, color: grp.hi, alpha: grp.hiAlpha, cap: 'round', join: 'round' });
      for (const w of grp.ws) plan.moveTo(w.ax, w.ay).lineTo(w.bx, w.by);
      plan.stroke({ width: wPlan, color: grp.color, alpha: grp.alpha, cap: 'round' });
      for (const w of grp.ws) plan.moveTo(w.ax - LINE.planHiOff, w.ay - LINE.planHiOff).lineTo(w.bx - LINE.planHiOff, w.by - LINE.planHiOff);
      plan.stroke({ width: LINE.planHi, color: grp.hi, alpha: grp.hiAlpha, cap: 'round' });
    }
    if (planned.length) {
      for (const w of planned) dashedIso(iso, w.iso, 5, 4);
      iso.stroke({ width: LINE.iso * 0.8, color: INK, alpha: LINE.planned, cap: 'round' });
      for (const w of planned) dashed(plan, w.ax, w.ay, w.bx, w.by, 0.24, 0.18);
      plan.stroke({ width: LINE.plan * 0.85, color: INK, alpha: LINE.planned, cap: 'round' });
    }
  }

  /** The Link tool's preview wire, from its source to the hovered building. */
  private drawPreview(sim: Sim, pv: LinkPreview | null): void {
    const p = pv && pv.source && pv.hover && pv.hover !== pv.source ? pv : null;
    if (p === this.lastPre && this.preLinksV === this.linksV && this.preGraphV === this.graphV) return;
    this.lastPre = p; this.preLinksV = this.linksV; this.preGraphV = this.graphV;
    this.isoPre.clear(); this.planPre.clear();
    if (!p) return;
    const s = sim.ents.get(p.source), h = sim.ents.get(p.hover);
    if (!s || !h || p.verdict === 'pick' || p.verdict === 'drop' || p.verdict === null) return;
    const color = p.verdict === 'link' ? num(C.turq) : p.verdict === 'unlink' ? num(C.coral) : num(C.ledRed);
    // Terminal to terminal, picked in the wire table's order, so the wire it makes hangs just so.
    const [A, B] = endsOf(s, h);
    const pts = wireCurve(A, B);
    if (p.verdict === 'link' || p.verdict === 'unlink') {
      isoPath(this.isoPre, pts, 0);
      this.isoPre.stroke({ width: PREVIEW.iso, color, alpha: PREVIEW.alpha, cap: 'round', join: 'round' });
      this.planPre.moveTo(A.x, A.y).lineTo(B.x, B.y).stroke({ width: PREVIEW.plan, color, alpha: PREVIEW.alpha, cap: 'round' });
    } else {
      dashedIso(this.isoPre, pts, 5, 4);
      this.isoPre.stroke({ width: PREVIEW.isoDash, color, alpha: PREVIEW.alpha, cap: 'round' });
      dashed(this.planPre, A.x, A.y, B.x, B.y, 0.22, 0.16);
      this.planPre.stroke({ width: PREVIEW.planDash, color, alpha: PREVIEW.alpha, cap: 'round' });
    }
    // A dot on the hovered building's terminal: where the wire would hang.
    const [ex, ey] = tileToIso(B.x, B.y, B.z);
    this.isoPre.circle(ex, ey, PREVIEW.endIso).fill({ color, alpha: 0.95 });
    this.planPre.circle(B.x, B.y, PREVIEW.endPlan).fill({ color, alpha: 0.95 });
  }

  // ── glints ─────────────────────────────────────────────────────────────────

  private moveGlints(te: number): void {
    const showIso = te < 0.6, showPlan = te > 0.3;
    let ni = 0, np = 0;
    for (const w of this.wires) {
      if (ni >= MAX_GLINTS) break;
      if (w.net < 0 || this.powered[w.net] !== 1 || w.way === 0) continue;
      const sat = this.sat[w.net]! / 1000;
      const lenTiles = Math.hypot(w.bx - w.ax, w.by - w.ay) + 0.5;
      const run = (this.time * GLINT_TILES_PER_S * (0.35 + 0.65 * sat) / lenTiles + w.seed) % 1;
      const f = w.way > 0 ? run : 1 - run; // from the generators' side
      if (showIso) {
        const s = this.glint(this.isoGlints, ni, 0.2);
        pointAlong(w.iso, w.isoLen, f, this.pt);
        s.position.set(this.pt.x, this.pt.y);
        ni++;
      }
      if (showPlan) {
        const s = this.glint(this.planGlints, np, 0.009);
        s.position.set(w.ax + (w.bx - w.ax) * f, w.ay + (w.by - w.ay) * f);
        np++;
      }
    }
    hideFrom(this.isoGlints, ni);
    hideFrom(this.planGlints, np);
  }

  /** The i-th pooled glint sprite of a container (created on first use). */
  private glint(c: Container, i: number, scale: number): Sprite {
    let s = c.children[i] as Sprite | undefined;
    if (!s) {
      s = new Sprite(this.glintTex);
      s.anchor.set(0.5);
      s.tint = num(C.glowCyan);
      s.scale.set(scale);
      c.addChild(s);
    }
    s.visible = true;
    return s;
  }
}

/** The two terminals of a wire from `s` to `h` ([s's, h's]), picked in the wire table's order (lower id first). */
function endsOf(s: Ent, h: Ent): [Anchor, Anchor] {
  if (s.id <= h.id) return wireEnds(s, h);
  const [B, A] = wireEnds(h, s);
  return [A, B];
}

/** A polyline into a Graphics path, shifted `dy` px (the highlight sits just above the ink). */
function isoPath(g: Graphics, pts: Float32Array, dy: number): void {
  g.moveTo(pts[0]!, pts[1]! + dy);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]! + dy);
}

/** A dashed polyline (dash / gap in px along the curve). */
function dashedIso(g: Graphics, pts: Float32Array, dash: number, gap: number): void {
  let on = true, left = dash;
  for (let i = 2; i < pts.length; i += 2) {
    let x0 = pts[i - 2]!, y0 = pts[i - 1]!;
    const x1 = pts[i]!, y1 = pts[i + 1]!;
    let seg = Math.hypot(x1 - x0, y1 - y0);
    while (seg > 0) {
      const step = Math.min(left, seg);
      const t = step / seg;
      const xm = x0 + (x1 - x0) * t, ym = y0 + (y1 - y0) * t;
      if (on) g.moveTo(x0, y0).lineTo(xm, ym);
      x0 = xm; y0 = ym; seg -= step; left -= step;
      if (left <= 1e-6) { on = !on; left = on ? dash : gap; }
    }
  }
}

/** A dashed straight line (tile units). */
function dashed(g: Graphics, ax: number, ay: number, bx: number, by: number, dash: number, gap: number): void {
  const len = Math.hypot(bx - ax, by - ay);
  if (len <= 0) return;
  for (let d = 0; d < len; d += dash + gap) {
    const t0 = d / len, t1 = Math.min(1, (d + dash) / len);
    g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0).lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1);
  }
}

/** Hide pooled sprites from index i on. */
function hideFrom(c: Container, i: number): void {
  for (let k = i; k < c.children.length; k++) { const s = c.children[k]!; if (s.visible) s.visible = false; }
}
