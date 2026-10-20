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
// middle) carries none. In the Électricité view (D88: P) each grid's wires take its colour,
// drawn bold over the veiled base. While the Link tool is in hand, a preview wire runs from its source to
// the hovered building, terminal to terminal: turquoise (would wire), coral (would cut), red
// (refused).
//
// The wire geometry is rebuilt only when the wires or the compiled graph change, and redrawn
// when it differs from what is drawn (D92: a ribbon laid recompiles the graph, but leaves every
// wire as it was — a redraw re-tessellated thousands of strokes) or a grid's powered state flips;
// each style is one batched stroke. The glints are pooled sprites moved each frame with no allocation.
//
// The neighbouring bases' wires (D110, `layForeign`: world/neighbours-view.ts hands each base's grid
// as it lays the base) hang the same way, terminal to terminal, always lit (their grids always run),
// in a graphics of their own drawn after the claim's: never part of the claim's grids, kept until
// another colony comes into play (`clearForeign`).
//
// Drawn over every volume, a wire hung behind a cliff would show across the rock in front of it
// (owner, 2026-10-18, on a neighbouring base at a cliff's foot): in iso each wire is drawn only
// where the relief leaves it in view (wire-geom `wireRuns`, cut at the cliff's edges), its glints
// too; the plan view has no relief. Worked out with the geometry, again when the land changes
// (`landChanged`: a dig, a fill).
import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { LinkPreview } from '@/input/link-tool';
import type { Sim } from '@/sim/state';
import type { Ent } from '@/sim/types';
import { buildingDef } from '@/content/registry';
import { C, num } from '../art/tokens';
import { GRID_COLORS } from '../art/view-icons';
import { tileToIso } from '../iso';
import type { ReliefLand } from '../relief';
import { flowWays, inHidden, pointAlong, polyLengths, wireCurve, wireEnds, wireRuns, type Anchor } from './wire-geom';

/** One wire as drawn. */
interface Wire {
  a: number;
  b: number;
  /** The grid both ends are on (-1: an end is not live yet — a construction site, a dormant building). */
  net: number;
  iso: Float32Array;
  isoLen: Float32Array;
  /** What the relief in front leaves in view of `iso` (iso polylines), and the hidden spans (pairs of the curve's parameter). */
  runs: Float32Array[];
  hidden: number[];
  /** Plan: the two terminals (tiles). */
  ax: number; ay: number; bx: number; by: number;
  /** Glint phase, from the ids. */
  seed: number;
  /** Which way power runs along it: 1 from a to b, -1 from b to a, 0 no way to tell (no glint). */
  way: number;
}

/** The kinds of building that put power into a grid (accumulators only give back what they took). */
const SOURCE_KINDS: ReadonlySet<string> = new Set(['hearth', 'wind', 'solar', 'geothermal', 'generator']);

/** Colours the Électricité view gives the grids, in grid order (art/view-icons.ts: the panels show them too). */
export { GRID_COLORS };

const INK = num(C.ink);
const LIT = num(C.ice);
const DIM_HI = num(C.steelL);
const MAX_GLINTS = 400;
const GLINT_TILES_PER_S = 2.4;

/**
 * The wires' line (owner, 2026-10-12: thinner, slightly transparent): widths in iso px and in
 * tiles (plan), alphas of the dark line and of its light hair, live / dim / planned. Readable on
 * sand by day and under the night grade; in the Électricité view (D88) they run bold, in their grid's colour.
 */
const LINE = {
  iso: 1.8, isoGrid: 4.2, isoHi: 0.65, plan: 0.055, planGrid: 0.15, planHi: 0.02, hiOff: 0.8, planHiOff: 0.018,
  on: 0.78, onHi: 0.55, off: 0.42, offHi: 0.2, planned: 0.36, grid: 1,
} as const;
/** The Link tool's preview: a little bolder than a wire (it is a pointer), the same shape. */
const PREVIEW = { iso: 2.4, isoDash: 1.7, plan: 0.075, planDash: 0.055, alpha: 0.85, endIso: 2.6, endPlan: 0.09 } as const;

/** Are two lists of wires drawn alike: the same wires in the same order, on the same grids, the same way, along the same curves? */
function sameWires(a: readonly Wire[], b: readonly Wire[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!, q = b[i]!;
    if (p.a !== q.a || p.b !== q.b || p.net !== q.net || p.way !== q.way || p.ax !== q.ax || p.ay !== q.ay || p.bx !== q.bx || p.by !== q.by) return false;
    if (p.iso.length !== q.iso.length || p.hidden.length !== q.hidden.length) return false;
    for (let k = 0; k < p.iso.length; k++) if (p.iso[k] !== q.iso[k]) return false;
    for (let k = 0; k < p.hidden.length; k++) if (p.hidden[k] !== q.hidden[k]) return false;
  }
  return true;
}

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
  /** The neighbouring bases' wires (D110): by base, drawn in their own graphics. */
  private readonly foreignIso = new Graphics();
  private readonly foreignPlan = new Graphics();
  private readonly foreign = new Map<number, Array<{ A: Anchor; B: Anchor; runs: Float32Array[]; ax: number; ay: number; bx: number; by: number }>>();
  /** The land the neighbouring bases' wires are cut against (`layForeign`). */
  private foreignLand: ReliefLand | null = null;
  /** Each wire's cut against the relief, by its two ends: a rebuild works out only new wires (some 36 ms a thousand); emptied when the land changes. */
  private seen = new Map<string, { runs: Float32Array[]; hidden: number[] }>();

  constructor(isoLayer: Container, planLayer: Container) {
    this.glintTex = glintTexture();
    isoLayer.addChild(this.foreignIso, this.isoG, this.isoPre, this.isoGlints);
    planLayer.addChild(this.foreignPlan, this.planG, this.planPre, this.planGlints);
    this.isoGlints.blendMode = 'add';
    this.planGlints.blendMode = 'add';
  }

  /** How many wires are drawn (perf overlay, smoke test). */
  get count(): number { return this.wires.length; }

  /** Is this neighbouring base's grid drawn (D110)? */
  hasForeign(key: number): boolean { return this.foreign.has(key); }

  /** How many neighbouring bases' wires are drawn (smoke). */
  get foreignCount(): number { let n = 0; for (const ws of this.foreign.values()) n += ws.length; return n; }

  /** A neighbouring base's grid (D110): its wires, end to end (terminals the caller picked: its Core's are its own), hung as the claim's are, lit, hidden where the relief in front of them rises (`land`). */
  layForeign(key: number, ends: ReadonlyArray<readonly [Anchor, Anchor]>, land: ReliefLand | null = null): void {
    if (this.foreign.has(key)) return;
    this.foreignLand = land;
    this.foreign.set(key, ends.map(([A, B]) => ({ A, B, runs: wireRuns(A, B, land).runs, ax: A.x, ay: A.y, bx: B.x, by: B.y })));
    this.drawForeign();
  }

  /** The land changed (a dig, a fill: the chunks the relief redraws): every wire's view of it worked out again. */
  landChanged(): void {
    this.linksV = -1;
    this.seen.clear();
    if (!this.foreign.size) return;
    for (const ws of this.foreign.values()) for (const w of ws) w.runs = wireRuns(w.A, w.B, this.foreignLand).runs;
    this.drawForeign();
  }

  /** One neighbouring base's wires dropped (D162: the neighbours view let it go, out of the view's ring a while). */
  dropForeign(key: number): void {
    if (this.foreign.delete(key)) this.drawForeign();
  }

  /** Every neighbouring base's wires dropped (another colony). */
  clearForeign(): void {
    if (!this.foreign.size) return;
    this.foreign.clear();
    this.drawForeign();
  }

  private drawForeign(): void {
    const iso = this.foreignIso, plan = this.foreignPlan;
    iso.clear(); plan.clear();
    const all = [...this.foreign.values()].flat();
    if (!all.length) return;
    for (const w of all) for (const r of w.runs) isoPath(iso, r, 0);
    iso.stroke({ width: LINE.iso, color: INK, alpha: LINE.on, cap: 'round', join: 'round' });
    for (const w of all) for (const r of w.runs) isoPath(iso, r, -LINE.hiOff);
    iso.stroke({ width: LINE.isoHi, color: LIT, alpha: LINE.onHi, cap: 'round', join: 'round' });
    for (const w of all) plan.moveTo(w.ax, w.ay).lineTo(w.bx, w.by);
    plan.stroke({ width: LINE.plan, color: INK, alpha: LINE.on, cap: 'round' });
  }

  /**
   * Per frame. `te`: the eased plan-ness; `preview`: the Link tool's (null when not in hand);
   * `byGrid`: the Électricité view is on (D88: wires bold, in their grid's colour).
   */
  update(sim: Sim, te: number, dt: number, preview: LinkPreview | null, byGrid: boolean): void {
    this.time += dt;
    const g = sim.graph;
    if (!g) return;
    let restyle = false;
    if (sim.links.version !== this.linksV || g.version !== this.graphV) {
      this.linksV = sim.links.version; this.graphV = g.version;
      restyle = this.rebuild(sim);
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

  /** The wires from the colony; false when every one is drawn as before (same ends, grid, way and curve). */
  private rebuild(sim: Sim): boolean {
    const out: Wire[] = [], seen = new Map<string, { runs: Float32Array[]; hidden: number[] }>();
    for (const [ia, ib] of sim.links.pairs()) {
      const ea = sim.ents.get(ia), eb = sim.ents.get(ib);
      if (!ea || !eb) continue;
      const [A, B] = wireEnds(ea, eb);
      const key = `${A.x},${A.y},${A.z},${B.x},${B.y},${B.z}`, cut = this.seen.get(key) ?? seen.get(key) ?? wireRuns(A, B, sim.grid);
      seen.set(key, cut);
      const iso = wireCurve(A, B), { runs, hidden } = cut;
      const na = sim.graph.netOfEnt.get(ia), nb = sim.graph.netOfEnt.get(ib);
      out.push({
        a: ia, b: ib, net: na !== undefined && na === nb ? na : -1, iso, isoLen: polyLengths(iso), runs, hidden,
        ax: A.x, ay: A.y, bx: B.x, by: B.y,
        seed: ((ia * 0.618034 + ib * 0.414214) % 1 + 1) % 1, way: 0,
      });
    }
    flowWays(out, (id) => {
      const e = sim.ents.get(id);
      return !!e && e.builtAt === 0 && !sim.isDormant(e) && SOURCE_KINDS.has(buildingDef(e.def).kind);
    });
    const same = sameWires(this.wires, out);
    this.wires = out;
    this.seen = seen;
    return !same;
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
      if (!grp) groups.set(k, (grp = { color, alpha: byGrid ? (on ? LINE.grid : LINE.on) : on ? LINE.on : LINE.off, hi: on ? LIT : DIM_HI, hiAlpha: on ? LINE.onHi : LINE.offHi, ws: [] }));
      grp.ws.push(w);
    }
    // The ends sit on the terminals the art draws (plan insulators included): no knots on top.
    const wIso = byGrid ? LINE.isoGrid : LINE.iso, wPlan = byGrid ? LINE.planGrid : LINE.plan;
    for (const grp of groups.values()) {
      for (const w of grp.ws) for (const r of w.runs) isoPath(iso, r, 0);
      iso.stroke({ width: wIso, color: grp.color, alpha: grp.alpha, cap: 'round', join: 'round' });
      for (const w of grp.ws) for (const r of w.runs) isoPath(iso, r, -LINE.hiOff);
      iso.stroke({ width: LINE.isoHi, color: grp.hi, alpha: grp.hiAlpha, cap: 'round', join: 'round' });
      for (const w of grp.ws) plan.moveTo(w.ax, w.ay).lineTo(w.bx, w.by);
      plan.stroke({ width: wPlan, color: grp.color, alpha: grp.alpha, cap: 'round' });
      for (const w of grp.ws) plan.moveTo(w.ax - LINE.planHiOff, w.ay - LINE.planHiOff).lineTo(w.bx - LINE.planHiOff, w.by - LINE.planHiOff);
      plan.stroke({ width: LINE.planHi, color: grp.hi, alpha: grp.hiAlpha, cap: 'round' });
    }
    if (planned.length) {
      for (const w of planned) for (const r of w.runs) dashedIso(iso, r, 5, 4);
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
      // Behind a cliff, no glint (its span hidden: the fraction along the curve stands in for its parameter).
      if (showIso && !inHidden(w.hidden, f)) {
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
