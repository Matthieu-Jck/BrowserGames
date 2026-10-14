// overlays-view.ts — what the plan plane draws over the land, in tile units: the build grid
// (fades in with the plan view, out when zoomed far), the claim's land (D60, docs/land.md: the
// parcels it holds for good washed turquoise inside one solid border, leased ones in a dashed
// amber frame, a sister claim's hatched coral — shown while building, and always in the land
// mode, which adds the parcel grid over the land for sale and marks the hovered and the selected
// parcel; only the parcels near the view are drawn, rebuilt when the held set, the view's parcels
// or the zoom's step change, its lines a constant width on screen), the power overlay (P: each grid's
// buildings washed in its colour — its wires take the same colour in the wires view —, the
// buildings that make or use power but hang on no wire outlined in coral), the Link tool's
// marks (the source's reach, what a click would wire, its wires, the pillars to start from),
// and the selection outline (both views: flat in plan; in iso on the rock top the building stands
// on, as the dig marks are — owner, 2026-10-13: a turbine on the mountains showed its outline on
// the ground below it, as if it stood somewhere else).
import { Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import type { Sim } from '@/sim/state';
import type { LinkPreview } from '@/input/link-tool';
import { footprint } from '@/sim/entities';
import { isLinkPoint, linkable } from '@/sim/power/links';
import { BUILDING_KIND } from '@/content/registry';
import { BAL } from '@/content/balance';
import { C, num } from '../art/tokens';
import { SHIFT } from '../relief';
import { GRID_COLORS } from './wires-view';
import { footLevel } from './stand';
import { PARCEL_COLS, parcelAt, parcelRect } from '@/sim/world/land';
import { WORLD } from '@/sim/constants';
import { TOP } from '../projection';

/** The parcel holding a tile, the tile clamped to the world: its column and row on the parcel grid. */
function cellOf(x: number, y: number): [number, number] {
  const p = parcelAt(Math.max(0, Math.min(WORLD - 1, Math.floor(x))), Math.max(0, Math.min(WORLD - 1, Math.floor(y))));
  return [p % PARCEL_COLS, Math.floor(p / PARCEL_COLS)];
}

/** An axis-aligned dashed line (tile units): `on` drawn, `off` skipped, from a to b. */
function dash(g: Graphics, ax: number, ay: number, bx: number, by: number, on: number, off: number): void {
  const len = Math.abs(bx - ax) + Math.abs(by - ay);
  if (len <= 0) return;
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  for (let d = 0; d < len; d += on + off) {
    const e = Math.min(len, d + on);
    g.moveTo(ax + ux * d, ay + uy * d).lineTo(ax + ux * e, ay + uy * e);
  }
}

/** A 64 px tile of grid: a thin inked line on two edges (the tiling draws the rest). */
function gridTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.strokeStyle = 'rgba(30, 27, 46, 0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 0.5); g.lineTo(64, 0.5);
  g.moveTo(0.5, 0); g.lineTo(0.5, 64);
  g.stroke();
  // Small crosses at the tile corners read better than a full grid at a glance.
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(9, 0); g.moveTo(0, 0); g.lineTo(0, 9);
  g.moveTo(64, 0); g.lineTo(55, 0); g.moveTo(0, 64); g.lineTo(0, 55);
  g.stroke();
  const t = Texture.from(cv);
  t.source.scaleMode = 'linear';
  return t;
}

export class OverlaysView {
  private readonly grid: TilingSprite;
  /** The claim's land (D60): held, leased and sister parcels; the parcel grid (land mode); the hovered and selected parcel. */
  private readonly landHeld = new Graphics();
  private readonly landGrid = new Graphics();
  private readonly landMark = new Graphics();
  /** The selection outline: flat in plan, lifted onto the rock top in iso (cross-faded). */
  private readonly sel = new Graphics();
  private readonly selIso = new Graphics();
  /** Marked tiles: flat in plan, lifted onto the rock tops in iso (cross-faded). */
  private readonly marksPlan = new Graphics();
  private readonly marksIso = new Graphics();
  private readonly routes = new Graphics();
  private readonly reach = new Graphics();
  private readonly power = new Graphics();
  private readonly linkG = new Graphics();
  private powerSig = '';
  private linkSig = '';
  private landSig = '';
  private landMarkSig = '';
  private selSig = '';
  private markSig = '';
  private routeSig = '';
  private reachSig = '';
  /** The land mode (I, the HUD's « Terrain »): the land overlay at full strength in both views, with the parcel grid. */
  landOn = false;
  /** The land mode's hovered and selected parcels (−1: none), set by the shell each frame. */
  landHover = -1;
  landSel = -1;
  /** The power overlay (P): grids by colour. */
  powerOn = false;
  /** The Link tool's preview while it is in hand (set by the shell each frame), else null. */
  linking: LinkPreview | null = null;

  /** `landLayer`: where the land's parcels go (above the fog, layers.ts `land`); default, with the overlays. */
  constructor(gridLayer: Container, overlayLayer: Container, landLayer: Container = overlayLayer) {
    this.grid = new TilingSprite({ texture: gridTexture(), width: 1, height: 1 });
    this.grid.tileScale.set(1 / 64);
    gridLayer.addChild(this.grid);
    landLayer.addChild(this.landGrid, this.landHeld, this.landMark);
    overlayLayer.addChild(this.power, this.routes, this.marksPlan, this.marksIso, this.reach, this.linkG, this.sel, this.selIso);
  }

  /**
   * Per frame. `view` is the visible tile rect [x0, y0, x1, y1]; t the plan-ness; `selected`
   * the inspected entity (0 = none).
   */
  update(sim: Sim, view: [number, number, number, number], t: number, zoom: number, selected: number, levelAt: (x: number, y: number) => number = () => 0, ghostReach: [number, number, number] | null = null): void {
    this.updateMarks(sim, t, levelAt);
    this.updateRoutes(sim);
    this.updateReach(sim, selected, ghostReach);
    this.updatePower(sim);
    this.updateLinking(sim);
    // Grid over the visible tiles only.
    const [x0, y0, x1, y1] = view.map((v, i) => (i < 2 ? Math.floor(v) - 1 : Math.ceil(v) + 1)) as [number, number, number, number];
    this.grid.position.set(x0, y0);
    this.grid.width = Math.max(1, x1 - x0);
    this.grid.height = Math.max(1, y1 - y0);
    this.grid.tilePosition.set(0, 0);
    const zf = Math.max(0, Math.min(1, (zoom - 0.3) / 0.35));
    this.grid.alpha = t * zf * 0.55;
    this.grid.visible = this.grid.alpha > 0.01;

    // The claim's land: shown while building (with the plan view), always in the land mode.
    this.updateLand(sim, view, zoom);
    this.landHeld.alpha = Math.max(t, this.landOn ? 1 : 0);
    this.landHeld.visible = this.landHeld.alpha > 0.01;
    this.landGrid.visible = this.landMark.visible = this.landOn;

    this.marksPlan.alpha = t;
    this.marksPlan.visible = t > 0.01;
    this.marksIso.alpha = 1 - t;
    this.marksIso.visible = t < 0.99;
    // Selection outline: flat in plan, on the rock top the building stands on in iso.
    const e = selected ? sim.ents.get(selected) : undefined;
    const [sw, sh] = e ? footprint(e.def, e.rot) : [0, 0];
    const lift = e ? footLevel(levelAt, e.x, e.y, sw, sh) : 0;
    const ssig = e ? `${e.id}:${e.x}:${e.y}:${e.rot}:${lift}` : '';
    if (ssig !== this.selSig) {
      this.selSig = ssig;
      for (const [g, d] of [[this.sel, 0], [this.selIso, lift * SHIFT]] as const) {
        g.clear();
        if (!e) continue;
        const x = e.x - d, y = e.y - d;
        g.rect(x - 0.08, y - 0.08, sw + 0.16, sh + 0.16).stroke({ width: 0.1, color: num(C.cyan), alpha: 1 });
        // Corner ticks.
        const k = 0.35;
        for (const [cx, cy, dx, dy] of [[x - 0.08, y - 0.08, 1, 1], [x + sw + 0.08, y - 0.08, -1, 1], [x - 0.08, y + sh + 0.08, 1, -1], [x + sw + 0.08, y + sh + 0.08, -1, -1]] as const) {
          g.moveTo(cx, cy + dy * k).lineTo(cx, cy).lineTo(cx + dx * k, cy);
        }
        g.stroke({ width: 0.22, color: num(C.ink), alpha: 0.9 });
      }
    }
    this.sel.alpha = t;
    this.sel.visible = t > 0.01;
    this.selIso.alpha = 1 - t;
    this.selIso.visible = t < 0.99;
  }

  /**
   * The claim's land over the parcels near the view (one beyond each side): the parcels held for
   * good (the starting square, bought, granted) washed turquoise, one solid border round all of
   * them — drawn where a held parcel meets one that is not — and a faint line between two held
   * ones; a leased parcel washed amber in a dashed frame; a sister claim's hatched coral in a thin
   * frame (nothing may be built or laid on it). The land mode adds the parcel grid and the hovered
   * (paper wash, ink frame) and selected (cyan frame, ink corners) parcels. Line widths are screen
   * pixels at the zoom's step (`TOP` px a tile in plan): a border reads the same zoomed in or out.
   */
  private updateLand(sim: Sim, view: [number, number, number, number], zoom: number): void {
    const L = sim.land;
    const zq = 2 ** (Math.round(Math.log2(Math.max(0.05, zoom)) * 3) / 3); // a third of an octave
    const px = 1 / (TOP * zq); // tiles per screen pixel
    const [c0a, r0a] = cellOf(view[0], view[1]), [c1a, r1a] = cellOf(view[2], view[3]);
    const c0 = Math.max(0, c0a - 1), r0 = Math.max(0, r0a - 1), c1 = Math.min(PARCEL_COLS - 1, c1a + 1), r1 = Math.min(PARCEL_COLS - 1, r1a + 1);
    const ids = (set: Iterable<number>): string => [...set].sort((a, b) => a - b).join(',');
    const sig = `${c0},${r0},${c1},${r1}|${zq}|${L.reach}|${ids(L.bought)}|${ids(L.granted)}|${ids(L.leases.keys())}|${this.landOn ? 1 : 0}`;
    if (sig !== this.landSig) {
      this.landSig = sig;
      const g = this.landHeld, grid = this.landGrid;
      g.clear();
      grid.clear();
      const at = (c: number, r: number): number => r * PARCEL_COLS + c;
      const good = (c: number, r: number): boolean => {
        if (c < 0 || r < 0 || c >= PARCEL_COLS || r >= PARCEL_COLS) return false;
        const p = at(c, r);
        return L.inStart(p) || L.bought.has(p) || L.granted.has(p);
      };
      const held: Array<[number, number]> = [], leased: number[] = [], sister: number[] = [];
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const p = at(c, r);
          if (good(c, r)) held.push([c, r]);
          else if (L.leases.has(p)) leased.push(p);
          else if (L.sister(p) >= 0) sister.push(p);
        }
      }
      // Held for good: the wash, the faint cut between two held parcels, the border round them all.
      for (const [c, r] of held) { const q = parcelRect(at(c, r)); g.rect(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0); }
      if (held.length) g.fill({ color: num(C.turq), alpha: 0.07 });
      for (const [c, r] of held) {
        const q = parcelRect(at(c, r));
        if (good(c - 1, r)) g.moveTo(q.x0, q.y0).lineTo(q.x0, q.y1);
        if (good(c, r - 1)) g.moveTo(q.x0, q.y0).lineTo(q.x1, q.y0);
      }
      if (held.length) g.stroke({ width: 1.2 * px, color: num(C.turqD), alpha: 0.35 });
      for (const [c, r] of held) {
        const q = parcelRect(at(c, r));
        if (!good(c - 1, r)) g.moveTo(q.x0, q.y0).lineTo(q.x0, q.y1);
        if (!good(c + 1, r)) g.moveTo(q.x1, q.y0).lineTo(q.x1, q.y1);
        if (!good(c, r - 1)) g.moveTo(q.x0, q.y0).lineTo(q.x1, q.y0);
        if (!good(c, r + 1)) g.moveTo(q.x0, q.y1).lineTo(q.x1, q.y1);
      }
      if (held.length) g.stroke({ width: 3.2 * px, color: num(C.turqD), alpha: 0.95 });
      // Leased: an amber wash in a dashed frame (dashes in screen pixels too).
      for (const p of leased) { const q = parcelRect(p); g.rect(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0); }
      if (leased.length) g.fill({ color: num(C.warn), alpha: 0.1 });
      const on = 14 * px, off = 9 * px, inset = 1.6 * px;
      for (const p of leased) {
        const q = parcelRect(p), x0 = q.x0 + inset, y0 = q.y0 + inset, x1 = q.x1 - inset, y1 = q.y1 - inset;
        dash(g, x0, y0, x1, y0, on, off); dash(g, x1, y0, x1, y1, on, off); dash(g, x1, y1, x0, y1, on, off); dash(g, x0, y1, x0, y0, on, off);
      }
      if (leased.length) g.stroke({ width: 2.8 * px, color: num(C.peachD), alpha: 0.95 });
      // A sister claim's: hatched coral (every two tiles, along x + y), a thin frame.
      for (const p of sister) {
        const q = parcelRect(p);
        for (let k = q.x0 + q.y0 + 2; k < q.x1 + q.y1; k += 2) {
          const xa = Math.max(q.x0, k - q.y1), xb = Math.min(q.x1, k - q.y0);
          if (xb > xa) g.moveTo(xa, k - xa).lineTo(xb, k - xb);
        }
      }
      if (sister.length) g.stroke({ width: 1.3 * px, color: num(C.coral), alpha: 0.5 });
      for (const p of sister) { const q = parcelRect(p); g.rect(q.x0 + inset, q.y0 + inset, q.x1 - q.x0 - 2 * inset, q.y1 - q.y0 - 2 * inset); }
      if (sister.length) g.stroke({ width: 1.6 * px, color: num(C.coralD), alpha: 0.7 });
      // The land mode's parcel grid over everything in range: where each parcel for sale begins.
      if (this.landOn) {
        const a = parcelRect(at(c0, r0)), b = parcelRect(at(c1, r1));
        for (let c = c0; c <= c1 + 1; c++) { const x = c <= c1 ? parcelRect(at(c, r0)).x0 : b.x1; grid.moveTo(x, a.y0).lineTo(x, b.y1); }
        for (let r = r0; r <= r1 + 1; r++) { const y = r <= r1 ? parcelRect(at(c0, r)).y0 : b.y1; grid.moveTo(a.x0, y).lineTo(b.x1, y); }
        grid.stroke({ width: 1.2 * px, color: num(C.ink), alpha: 0.28 });
      }
    }
    // The hovered and the selected parcel (land mode).
    const msig = this.landOn ? `${this.landHover}:${this.landSel}:${zq}` : '';
    if (msig !== this.landMarkSig) {
      this.landMarkSig = msig;
      const g = this.landMark;
      g.clear();
      if (!msig) return;
      if (this.landHover >= 0 && this.landHover !== this.landSel) {
        const q = parcelRect(this.landHover);
        g.rect(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0).fill({ color: num(C.paper), alpha: 0.16 }).stroke({ width: 2.2 * px, color: num(C.ink), alpha: 0.75 });
      }
      if (this.landSel >= 0) {
        const q = parcelRect(this.landSel), d = 2.5 * px;
        g.rect(q.x0 + d, q.y0 + d, q.x1 - q.x0 - 2 * d, q.y1 - q.y0 - 2 * d).fill({ color: num(C.cyan), alpha: 0.08 }).stroke({ width: 4 * px, color: num(C.cyan), alpha: 1 });
        const k = 22 * px;
        for (const [cx, cy, dx, dy] of [[q.x0, q.y0, 1, 1], [q.x1, q.y0, -1, 1], [q.x0, q.y1, 1, -1], [q.x1, q.y1, -1, -1]] as const) {
          g.moveTo(cx, cy + dy * k).lineTo(cx, cy).lineTo(cx + dx * k, cy);
        }
        g.stroke({ width: 4.5 * px, color: num(C.ink), alpha: 0.9 });
      }
    }
  }

  /** Dig marks (coral hatching) and fill marks (turquoise), brighter where a machine works. */
  private updateMarks(sim: Sim, t: number, levelAt: (x: number, y: number) => number): void {
    const working = new Map(sim.jobs.map((j) => [j.tile, j]));
    const sig = `${sim.designated.size}:${[...sim.designated.keys()].slice(-3).join(',')}:${sim.jobs.map((j) => `${j.tile}:${Math.floor(j.el / Math.max(1, j.dur) / 100)}`).join(',')}`;
    if (sig === this.markSig) return;
    this.markSig = sig;
    void t;
    for (const [g, lift] of [[this.marksPlan, false], [this.marksIso, true]] as const) {
      g.clear();
      for (const [tile, kind] of sim.designated) {
        const x = tile % 1024, y = (tile - x) / 1024;
        const d = lift ? levelAt(x, y) * SHIFT : 0;
        const ox = x - d, oy = y - d;
        const col = kind === 'dig' ? num(C.coral) : num(C.cyan);
        const job = working.get(tile);
        g.rect(ox + 0.08, oy + 0.08, 0.84, 0.84).fill({ color: col, alpha: job ? 0.45 : 0.22 }).stroke({ width: 0.06, color: col, alpha: 0.95 });
        // Two hatch strokes read as "marked" at any zoom.
        g.moveTo(ox + 0.2, oy + 0.8).lineTo(ox + 0.8, oy + 0.2).moveTo(ox + 0.45, oy + 0.85).lineTo(ox + 0.85, oy + 0.45);
        g.stroke({ width: 0.07, color: col, alpha: 0.9 });
        if (job) {
          const f = Math.min(1, job.el / Math.max(1, job.dur * 1000));
          g.rect(ox + 0.12, oy + 0.78, 0.76 * f, 0.1).fill({ color: num(C.ink), alpha: 0.85 });
        }
      }
    }
  }

  /** Freight routes: a dashed line from dock to dock. */
  private updateRoutes(sim: Sim): void {
    const sig = sim.routes.map((r) => `${r.from}>${r.to}`).join(',');
    if (sig === this.routeSig) return;
    this.routeSig = sig;
    const g = this.routes;
    g.clear();
    for (const r of sim.routes) {
      const a = sim.ents.get(r.from), b = sim.ents.get(r.to);
      if (!a || !b) continue;
      const ax = a.x + 1.5, ay = a.y + 1.5, bx = b.x + 1.5, by = b.y + 1.5;
      const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.floor(len / 0.8));
      for (let i = 0; i < n; i += 2) {
        const t0 = i / n, t1 = Math.min(1, (i + 1) / n);
        g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0).lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1);
      }
      g.stroke({ width: 0.16, color: num(C.violet), alpha: 0.8 });
    }
  }

  /** Reach circle of the selected excavator / backfiller (or of one in hand). */
  private updateReach(sim: Sim, selected: number, ghost: [number, number, number] | null): void {
    const e = selected ? sim.ents.get(selected) : undefined;
    const k = e ? BUILDING_KIND[e.def] : '';
    let c: [number, number, number] | null = ghost;
    if (!c && e && (k === 'excavator' || k === 'backfiller')) {
      const [w, h] = footprint(e.def, e.rot);
      c = [e.x + w / 2, e.y + h / 2, k === 'excavator' ? BAL.digReach + Math.max(w, h) / 2 : BAL.fillReach]; // from its edge (D54)
    }
    const sig = c ? c.join(',') : '';
    if (sig === this.reachSig) return;
    this.reachSig = sig;
    this.reach.clear();
    if (!c) return;
    this.reach.circle(c[0], c[1], c[2]).fill({ color: num(C.coral), alpha: 0.05 }).stroke({ width: 0.12, color: num(C.coralD), alpha: 0.85 });
  }

  /** The power overlay (P): each grid's buildings washed in its colour; unwired ones that need power outlined in coral. */
  private updatePower(sim: Sim): void {
    const g = sim.graph;
    const sig = this.powerOn && g ? `${g.version}:${sim.links.version}` : '';
    if (sig === this.powerSig) return;
    this.powerSig = sig;
    const p = this.power;
    p.clear();
    if (!sig) return;
    const byColor = new Map<number, Array<[number, number, number, number]>>();
    const loose: Array<[number, number, number, number]> = [];
    for (const e of sim.ents.sorted()) {
      if (!linkable(e.def)) continue;
      const [w, h] = footprint(e.def, e.rot);
      const net = g.netOfEnt.get(e.id);
      if (net === undefined) {
        if (e.builtAt === 0 && !isLinkPoint(e.def) && !sim.isDormant(e)) loose.push([e.x, e.y, w, h]);
        continue;
      }
      const col = num(GRID_COLORS[net % GRID_COLORS.length]!);
      let arr = byColor.get(col);
      if (!arr) byColor.set(col, (arr = []));
      arr.push([e.x, e.y, w, h]);
    }
    for (const [col, rects] of byColor) {
      for (const [x, y, w, h] of rects) p.rect(x + 0.06, y + 0.06, w - 0.12, h - 0.12);
      p.fill({ color: col, alpha: 0.3 }).stroke({ width: 0.09, color: col, alpha: 0.95 });
    }
    for (const [x, y, w, h] of loose) {
      // A dashed coral frame: "needs a wire".
      const pts: Array<[number, number]> = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
        const len = Math.hypot(bx - ax, by - ay);
        for (let d = 0; d < len; d += 0.5) {
          const t0 = d / len, t1 = Math.min(1, (d + 0.3) / len);
          p.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0).lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1);
        }
      }
    }
    if (loose.length) p.stroke({ width: 0.12, color: num(C.coral), alpha: 0.95 });
  }

  /**
   * The Link tool: with a source, its reach (its footprint grown by the wire range: the rounded
   * rectangle a footprint edge-to-edge range sweeps), the buildings a click would wire
   * (turquoise) and the ones it is wired to (ink); without one, a ring on every pillar and on the
   * Heart to start from. The hovered building is outlined in the colour of what a click would do.
   */
  private updateLinking(sim: Sim): void {
    const pv = this.linking;
    const sig = pv ? pv.sig : '';
    if (sig === this.linkSig) return;
    this.linkSig = sig;
    const g = this.linkG;
    g.clear();
    if (!pv) return;
    const rectOf = (id: number): [number, number, number, number] | null => {
      const e = sim.ents.get(id);
      if (!e) return null;
      const [w, h] = footprint(e.def, e.rot);
      return [e.x, e.y, w, h];
    };
    if (pv.ring) {
      const [x, y, w, h, r] = pv.ring;
      g.roundRect(x - r, y - r, w + 2 * r, h + 2 * r, r).fill({ color: num(C.turq), alpha: 0.07 }).stroke({ width: 0.12, color: num(C.turqD), alpha: 0.9 });
      g.rect(x - 0.12, y - 0.12, w + 0.24, h + 0.24).stroke({ width: 0.16, color: num(C.cyan), alpha: 1 });
    }
    for (const id of pv.targets) {
      const r = rectOf(id);
      if (r) g.rect(r[0] + 0.05, r[1] + 0.05, r[2] - 0.1, r[3] - 0.1);
    }
    if (pv.targets.length) g.fill({ color: num(C.turq), alpha: 0.16 }).stroke({ width: 0.08, color: num(C.turq), alpha: 0.95 });
    for (const id of pv.linked) {
      const r = rectOf(id);
      if (r) g.rect(r[0] + 0.05, r[1] + 0.05, r[2] - 0.1, r[3] - 0.1);
    }
    if (pv.linked.length) g.fill({ color: num(C.ink), alpha: 0.12 }).stroke({ width: 0.1, color: num(C.ink), alpha: 0.9 });
    for (const id of pv.points) {
      const r = rectOf(id);
      if (r) g.circle(r[0] + r[2] / 2, r[1] + r[3] / 2, Math.max(r[2], r[3]) / 2 + 0.35);
    }
    if (pv.points.length) g.stroke({ width: 0.12, color: num(C.cyan), alpha: 0.95 });
    const hv = pv.hover && pv.verdict ? rectOf(pv.hover) : null;
    if (hv) {
      const v = pv.verdict;
      const col = v === 'link' || v === 'pick' ? C.turq : v === 'unlink' ? C.coral : v === 'drop' ? C.cyan : C.ledRed;
      g.rect(hv[0] - 0.15, hv[1] - 0.15, hv[2] + 0.3, hv[3] + 0.3).stroke({ width: 0.18, color: num(col), alpha: 1 });
    }
  }
}
