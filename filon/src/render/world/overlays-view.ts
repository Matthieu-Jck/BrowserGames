// overlays-view.ts — what the plan plane draws over the land, in tile units: the build grid
// (fades in with the plan view, out when zoomed far), the claim's land (D60, docs/land.md: the
// parcels it holds for good washed turquoise inside one solid border, leased ones in a dashed
// amber frame, a neighbouring base's (D110) in one coral outline round its holding, hatched in the
// land mode — shown while building, and always in the land mode, which adds the parcel grid over the land for sale, each parcel's usable floor as a gauge at
// its middle and its ore as three pips beside it (D94: space or ore, sim/world/floor.ts) and marks the hovered
// and the selected parcel; only the parcels near the view are drawn, rebuilt when the held set, the view's parcels
// or the zoom's step change, its lines a constant width on screen), the Link tool's
// marks (the source's reach, what a click would wire and is on no grid yet, what waits for a wire
// beyond, its wires, the pillars to start from, and the tile of land that bars the hovered wire —
// D78 —, flat in plan and on its rock top in iso) — the same reach and marks round a pole or a
// pylon held to be placed —,
// and the selection outline (the grids by colour are the Électricité view's since D88:
// world/views-view.ts) (both views: flat in plan; in iso on the rock top the building stands
// on, as the dig marks are — owner, 2026-10-13: a turbine on the mountains showed its outline on
// the ground below it, as if it stood somewhere else).
import { Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import type { Sim } from '@/sim/state';
import type { LinkPreview } from '@/input/link-tool';
import { footprint } from '@/sim/entities';
import { BUILDING_KIND } from '@/content/registry';
import { BAL } from '@/content/balance';
import { C, num } from '../art/tokens';
import { SHIFT } from '../relief';
import { footLevel } from './stand';
import { itemDef } from '@/content/registry';
import { parcelFloor, parcelOre } from '@/sim/world/floor';
import { PARCEL_COLS, parcelAt, parcelCentre, parcelRect } from '@/sim/world/land';
import { WORLD } from '@/sim/constants';
import { TOP } from '../projection';
import { colonyEmblem } from '@/content/emblem';
import { flagFrames } from './heart-flag';

/** The parcel holding a tile, the tile clamped to the world: its column and row on the parcel grid. */
function cellOf(x: number, y: number): [number, number] {
  const p = parcelAt(Math.max(0, Math.min(WORLD - 1, Math.floor(x))), Math.max(0, Math.min(WORLD - 1, Math.floor(y))));
  return [p % PARCEL_COLS, Math.floor(p / PARCEL_COLS)];
}

/** Dashed coral frames round footprints [x, y, w, h] (tile units): "needs a wire" (the Link tool; the Électricité view draws the same). */
export function needsWire(g: Graphics, rects: ReadonlyArray<readonly [number, number, number, number]>): void {
  for (const [x, y, w, h] of rects) {
    const pts: Array<[number, number]> = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < len; d += 0.5) {
        const t0 = d / len, t1 = Math.min(1, (d + 0.3) / len);
        g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0).lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1);
      }
    }
  }
  if (rects.length) g.stroke({ width: 0.12, color: num(C.coral), alpha: 0.95 });
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
  /** The claim's land (D60): held, leased and a neighbouring base's (D110); the parcel grid (land mode); the hovered and selected parcel. */
  private readonly landHeld = new Graphics();
  private readonly landGrid = new Graphics();
  private readonly landMark = new Graphics();
  /** The land mode's gauges: each parcel's usable floor (D94). */
  private readonly landFloor = new Graphics();
  /** The neighbouring bases' emblems at their hubs' middles (land mode, D110), pooled. */
  private readonly badges = new Container({ label: 'land:badges' });
  private readonly labels = new Container({ label: 'land:labels' });
  /** A neighbouring base's label under its emblem in the land mode: « Base voisine » and its name (the shell's: D110). */
  neighbourLabel: ((colony: number) => string) | null = null;
  /** The selection outline: flat in plan, lifted onto the rock top in iso (cross-faded). */
  private readonly sel = new Graphics();
  private readonly selIso = new Graphics();
  /** Marked tiles: flat in plan, lifted onto the rock tops in iso (cross-faded). */
  private readonly marksPlan = new Graphics();
  private readonly marksIso = new Graphics();
  private readonly reach = new Graphics();
  private readonly linkG = new Graphics();
  /** The tile that bars the Link tool's hovered wire (D78): flat in plan, on its rock top in iso (cross-faded). */
  private readonly blockPlan = new Graphics();
  private readonly blockIso = new Graphics();
  private linkSig = '';
  private landSig = '';
  private landMarkSig = '';
  private selSig = '';
  private markSig = '';
  private reachSig = '';
  /** The land mode (I, the HUD's « Terrain »): the land overlay at full strength in both views, with the parcel grid. */
  landOn = false;
  /** The land mode's hovered and selected parcels (−1: none), set by the shell each frame. */
  landHover = -1;
  landSel = -1;
  /** The Link tool's preview while it is in hand, else a pole's or pylon's held to be placed (set by the shell each frame), else null. */
  linking: LinkPreview | null = null;

  /** `landLayer`: where the land's parcels go (above the fog, layers.ts `land`); default, with the overlays. */
  constructor(gridLayer: Container, overlayLayer: Container, landLayer: Container = overlayLayer) {
    this.grid = new TilingSprite({ texture: gridTexture(), width: 1, height: 1 });
    this.grid.tileScale.set(1 / 64);
    gridLayer.addChild(this.grid);
    landLayer.addChild(this.landGrid, this.landHeld, this.landFloor, this.badges, this.labels, this.landMark);
    overlayLayer.addChild(this.marksPlan, this.marksIso, this.reach, this.linkG, this.blockPlan, this.blockIso, this.sel, this.selIso);
  }

  /**
   * Per frame. `view` is the visible tile rect [x0, y0, x1, y1]; t the plan-ness; `selected`
   * the inspected entity (0 = none).
   */
  update(sim: Sim, view: [number, number, number, number], t: number, zoom: number, selected: number, levelAt: (x: number, y: number) => number = () => 0, ghostReach: [number, number, number] | null = null): void {
    this.updateMarks(sim, t, levelAt);
    this.updateReach(sim, selected, ghostReach);
    this.updateLinking(sim, levelAt);
    this.blockPlan.alpha = t;
    this.blockPlan.visible = t > 0.01;
    this.blockIso.alpha = 1 - t;
    this.blockIso.visible = t < 0.99;
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
    this.landGrid.visible = this.landMark.visible = this.landFloor.visible = this.badges.visible = this.labels.visible = this.landOn;

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
   * ones; a leased parcel washed amber in a dashed frame; a neighbouring base's holding (D110) in one
   * coral outline round its parcels, hatched in the land mode (its buildings stand there, drawn by
   * the buildings view; nothing of the claim's may stand on them). The land mode adds the parcel grid and the hovered
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
    const sig = `${c0},${r0},${c1},${r1}|${zq}|${L.reach}|${ids(L.bought)}|${ids(L.granted)}|${ids(L.leases.keys())}|${this.landOn ? `1:${sim.grid.terrainDiff.size}:${sim.grid.levelDiff.size}` : 0}`;
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
      const held: Array<[number, number]> = [], leased: number[] = [], nb: number[] = [];
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const p = at(c, r);
          if (good(c, r)) held.push([c, r]);
          else if (L.leases.has(p)) leased.push(p);
          else if (L.neighbour(p) >= 0) nb.push(p);
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
      // A neighbouring base's (D110): hatched coral in the land mode (every three tiles, along x + y),
      // and one outline round its holding — drawn where its parcel meets one that is not its own.
      if (this.landOn) {
        for (const p of nb) {
          const q = parcelRect(p);
          for (let k = q.x0 + q.y0 + 3; k < q.x1 + q.y1; k += 3) {
            const xa = Math.max(q.x0, k - q.y1), xb = Math.min(q.x1, k - q.y0);
            if (xb > xa) g.moveTo(xa, k - xa).lineTo(xb, k - xb);
          }
        }
        if (nb.length) g.stroke({ width: 1.2 * px, color: num(C.coral), alpha: 0.32 });
      }
      const hubOf = (p: number): number => (L.neighbour(p) >= 0 ? sim.neighbours.holdingOf(p)?.hub ?? -1 : -1);
      for (const p of nb) {
        const q = parcelRect(p), h = hubOf(p), c = p % PARCEL_COLS, r = Math.floor(p / PARCEL_COLS);
        const same = (cc: number, rr: number): boolean => cc >= 0 && rr >= 0 && cc < PARCEL_COLS && rr < PARCEL_COLS && hubOf(at(cc, rr)) === h;
        if (!same(c - 1, r)) g.moveTo(q.x0 + inset, q.y0 + inset).lineTo(q.x0 + inset, q.y1 - inset);
        if (!same(c + 1, r)) g.moveTo(q.x1 - inset, q.y0 + inset).lineTo(q.x1 - inset, q.y1 - inset);
        if (!same(c, r - 1)) g.moveTo(q.x0 + inset, q.y0 + inset).lineTo(q.x1 - inset, q.y0 + inset);
        if (!same(c, r + 1)) g.moveTo(q.x0 + inset, q.y1 - inset).lineTo(q.x1 - inset, q.y1 - inset);
      }
      if (nb.length) g.stroke({ width: 2.2 * px, color: num(C.coralD), alpha: 0.8 });
      // The land mode's parcel grid over everything in range: where each parcel for sale begins.
      if (this.landOn) {
        const a = parcelRect(at(c0, r0)), b = parcelRect(at(c1, r1));
        for (let c = c0; c <= c1 + 1; c++) { const x = c <= c1 ? parcelRect(at(c, r0)).x0 : b.x1; grid.moveTo(x, a.y0).lineTo(x, b.y1); }
        for (let r = r0; r <= r1 + 1; r++) { const y = r <= r1 ? parcelRect(at(c0, r)).y0 : b.y1; grid.moveTo(a.x0, y).lineTo(b.x1, y); }
        grid.stroke({ width: 1.2 * px, color: num(C.ink), alpha: 0.28 });
      }
      this.drawFloors(sim, c0, r0, c1, r1, px);
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

  /**
   * The land mode's gauges (D94: space or ore): at each parcel's middle a paper disc, ink-ringed, its
   * share of usable floor filled clockwise from the top in turquoise — amber under a third, land cut
   * up by cliffs, chasms or rivers — and to its right three pips stacked, its ore's tier (`parcelOre`:
   * none, a thin blob, a field, a rich one) filled in the colour of the ore it holds most, the rest
   * empty rings: « beaucoup de place, peu de minerai » or the reverse at a glance across the map.
   * 1.6 tiles across, at least 8 screen pixels (far zooms).
   */
  private drawFloors(sim: Sim, c0: number, r0: number, c1: number, r1: number, px: number): void {
    const g = this.landFloor;
    g.clear();
    for (const b of this.badges.children) b.visible = false;
    for (const b of this.labels.children) b.visible = false;
    if (!this.landOn) return;
    const R = Math.max(1.6, 8 * px), top = -Math.PI / 2;
    let nBadge = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const p = r * PARCEL_COLS + c, [mx, my] = parcelCentre(p), x = mx + 0.5, y = my + 0.5;
        // A neighbouring base's parcel (D110): not for sale, no gauge; its emblem at its hub's middle.
        const colony = sim.land.neighbour(p);
        if (colony >= 0) {
          if (sim.neighbours.holdingOf(p)?.hub !== p) continue;
          const fr = flagFrames(colonyEmblem(sim.worldSeed, colony)).badge;
          let s = this.badges.children[nBadge] as Sprite | undefined;
          if (!s) { s = new Sprite(); this.badges.addChild(s); }
          nBadge++;
          const k = (R * 2.6) / fr.w;
          s.texture = fr.tex;
          s.scale.set(k);
          s.position.set(x - fr.ox * k, y - fr.oy * k);
          s.visible = true;
          // Under it, « Base voisine » and its name (the shell's words: render reads no i18n).
          const text = this.neighbourLabel?.(colony) ?? '';
          let lb = this.labels.children[nBadge - 1] as Text | undefined;
          if (!lb) {
            lb = new Text({ text, style: { fontFamily: "'Patrick Hand SC', 'Comic Sans MS', sans-serif", fontSize: 30, fill: C.ink, stroke: { color: C.paper, width: 7 }, align: 'center', lineHeight: 30 } });
            lb.anchor.set(0.5, 0);
            this.labels.addChild(lb);
          }
          if (lb.text !== text) lb.text = text;
          lb.position.set(x, y + R * 1.45);
          lb.scale.set(px * 0.5);
          lb.visible = !!text;
          continue;
        }
        const f = parcelFloor(sim.grid, p).permille;
        g.circle(x, y, R).fill({ color: num(C.paper), alpha: 0.9 });
        if (f > 0) {
          if (f < 1000) g.moveTo(x, y).arc(x, y, R * 0.8, top, top + (2 * Math.PI * f) / 1000).closePath();
          else g.circle(x, y, R * 0.8);
          g.fill({ color: num(f < 333 ? C.peachD : C.turqD), alpha: 0.95 });
        }
        g.circle(x, y, R).stroke({ width: 1.6 * px, color: num(C.ink), alpha: 0.85 });
        // The ore: three diamonds stacked by the disc's right, bottom up, filled up to its tier.
        const ore = parcelOre(sim.grid, p), pr = R * 0.36, px0 = x + R * 1.42;
        const tint = ore.item >= 0 ? itemDef(ore.item).color : C.ink, col = num(tint.startsWith('#') ? tint : ((C as Record<string, string>)[tint] ?? C.ink));
        for (let k = 0; k < 3; k++) {
          const py = y + R * 0.72 - k * pr * 2.2;
          g.poly([px0, py - pr, px0 + pr * 0.8, py, px0, py + pr, px0 - pr * 0.8, py]);
          if (k < ore.tier) g.fill({ color: col, alpha: 1 }).stroke({ width: 1.3 * px, color: num(C.ink), alpha: 0.9 });
          else g.fill({ color: num(C.paper), alpha: 0.75 }).stroke({ width: 1 * px, color: num(C.ink), alpha: 0.35 });
        }
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

  /**
   * The Link tool: with a source, its reach (its footprint grown by the wire range: the rounded
   * rectangle a footprint edge-to-edge range sweeps), the buildings a click would wire that are
   * on no grid yet (turquoise; the others in reach are wired by a click all the same), the ones
   * waiting for a wire beyond the reach (dashed coral) and the ones it is wired to (ink); without
   * one, a ring on every pillar and on the Heart to start from, and the hovered pillar's reach. A
   * pillar in hand (`LinkTool.ghost`) shows its reach and marks the same way. The hovered building
   * is outlined in the colour of what a click would do; when the land bars that wire, the tile
   * rising above it is marked red, a cross over it.
   */
  private updateLinking(sim: Sim, levelAt: (x: number, y: number) => number): void {
    const pv = this.linking;
    const sig = pv ? `${pv.sig}:${pv.block ? `${pv.block[0]},${pv.block[1]},${levelAt(pv.block[0], pv.block[1])}` : ''}` : '';
    if (sig === this.linkSig) return;
    this.linkSig = sig;
    const g = this.linkG;
    g.clear();
    for (const [bg, lift] of [[this.blockPlan, false], [this.blockIso, true]] as const) {
      bg.clear();
      if (!pv?.block) continue;
      const [bx, by] = pv.block, d = lift ? levelAt(bx, by) * SHIFT : 0, x = bx - d, y = by - d;
      bg.rect(x + 0.06, y + 0.06, 0.88, 0.88).fill({ color: num(C.ledRed), alpha: 0.3 }).stroke({ width: 0.1, color: num(C.ledRed), alpha: 1 });
      bg.moveTo(x + 0.22, y + 0.22).lineTo(x + 0.78, y + 0.78).moveTo(x + 0.78, y + 0.22).lineTo(x + 0.22, y + 0.78);
      bg.stroke({ width: 0.14, color: num(C.ledRed), alpha: 1, cap: 'round' });
    }
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
    // What waits for a wire beyond the reach: a dashed coral frame (the Électricité view's « no wire »).
    needsWire(g, pv.loose.map(rectOf).filter((r): r is [number, number, number, number] => !!r));
    // In reach and on no grid yet: green, a click wires it (owner, 2026-10-14: "green only the machines that are not already connected").
    for (const id of pv.targets) {
      const r = rectOf(id);
      if (r) g.rect(r[0] + 0.05, r[1] + 0.05, r[2] - 0.1, r[3] - 0.1);
    }
    if (pv.targets.length) g.fill({ color: num(C.turq), alpha: 0.26 }).stroke({ width: 0.1, color: num(C.turq), alpha: 0.95 });
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
