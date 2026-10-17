// picking.ts — screen ⇄ world for the current view: the ground tile under a screen point, a
// tile's screen position (the smoke test drives the real mouse with it), and the building
// under the cursor. In plan a tile's occupant is what you point at. In iso tall sprites reach
// up over the ground behind them, so what you click is what you SEE: the front-most building
// whose drawn pixel is under the cursor (its atlas frame's alpha, read back once per frame and
// cached), with its volume box (footprint lifted to its art height) as a cheap first test. A
// box alone was too greedy: a mast or a derrick in front stole clicks aimed at what is behind.
// A building standing on the mountains (D44) is tested where it is drawn, lifted onto the rock
// top (a ribbon there on its tile's top), and ranks by the depth key it is drawn with
// (render/world/stand.ts). A ribbon (not a traction ribbon: its elevator stands) or a conduit is a flat piece (the belts layer, or the rock top):
// its tile's diamond and nothing above — testing it as a volume with its iso frame let a ribbon in
// front take the clicks aimed at the trade post's apron behind it (owner, 2026-10-14). A click that hits no
// sprite takes what the cursor's ray meets first: a rock top or a cliff (that tile's occupant, if
// any — not some building on the ground far behind it), else the ground.
import { BUILDING_IDS, BUILDING_KIND, buildingDef } from '@/content/registry';
import { bKey, type Atlas } from '@/render/art/atlas';
import type { BuildingId } from '@/content/buildings';
import { HEART_CORNERS, heartCornerAt, isoHead, type HeartPiece } from '@/render/art/recipes/buildings';
import type { Camera } from '@/render/camera';
import { screenToWorld } from '@/render/camera-math';
import { LH, tileToIso } from '@/render/iso';
import { apply, ISO_LIN, screenTile } from '@/render/projection';
import { surfaceTile } from '@/render/relief';
import { beltZ, buildingZ, drawnLevel, standOf } from '@/render/world/stand';
import { footprint } from '@/sim/entities';
import type { Sim } from '@/sim/state';
import type { ViewState } from './view';

export interface PickerDeps {
  camera: Camera;
  view: ViewState;
  size(): { w: number; h: number };
  sim(): Sim;
  /** The baked sprites: iso picking tests their pixels. */
  atlas?: Atlas;
}

/** Alpha above which a sprite pixel counts as solid, and the slack (atlas px) around a thin line. */
const SOLID = 40, SLACK = 2;

export class Picker {
  /** Per atlas frame: its alpha channel, read back from the page on first use. */
  private readonly alpha = new Map<string, Uint8Array>();

  constructor(private readonly d: PickerDeps) {}

  /** Is the iso sprite of a building (standing `lift` levels up) drawn at world point (X, Y)? Null when its art is unknown. */
  private solidAt(def: number, rot: number, ex: number, ey: number, lift: number, X: number, Y: number): boolean | null {
    const atlas = this.d.atlas;
    if (!atlas) return null;
    const id = BUILDING_IDS[def]!;
    const key = atlas.frames.has(bKey(id, rot as 0)) ? bKey(id, rot as 0) : bKey(id, 0);
    const fr = atlas.frames.get(key);
    const page = fr ? atlas.pages[fr.page] : undefined;
    if (!fr || !page) return null;
    let a = this.alpha.get(key);
    if (!a) {
      const data = page.getContext('2d')!.getImageData(fr.x, fr.y, fr.w, fr.h).data;
      a = new Uint8Array(fr.w * fr.h);
      for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3]!;
      this.alpha.set(key, a);
    }
    // The sprite sits at tileToIso(e.x, e.y, lift) − anchor·k, scaled by k (see BuildingsView).
    const [wx, wy] = tileToIso(ex, ey, lift);
    const u = Math.floor((X - wx) / fr.k + fr.ox), v = Math.floor((Y - wy) / fr.k + fr.oy);
    for (let dv = -SLACK; dv <= SLACK; dv++) {
      for (let du = -SLACK; du <= SLACK; du++) {
        const x = u + du, y = v + dv;
        if (x >= 0 && y >= 0 && x < fr.w && y < fr.h && a[y * fr.w + x]! > SOLID) return true;
      }
    }
    return false;
  }

  /** The ground tile under a screen point (CSS px). */
  tileAt(sx: number, sy: number): [number, number] {
    const { w, h } = this.d.size();
    const [x, y] = screenTile(this.d.view.P, this.d.camera.state, w, h, sx, sy);
    return [Math.floor(x), Math.floor(y)];
  }

  /**
   * The tile under a screen point as the eye sees it (the deposit card, D99): in plan the ground's;
   * in iso the one its ray meets first — a rock top or a cliff face (`surfaceTile`), else the ground.
   */
  seenTileAt(sx: number, sy: number): [number, number] {
    const { w, h } = this.d.size();
    const [x, y] = screenTile(this.d.view.P, this.d.camera.state, w, h, sx, sy);
    return this.d.view.building ? [Math.floor(x), Math.floor(y)] : surfaceTile(this.d.sim().grid, x, y);
  }

  /** Screen px (CSS) of a tile's centre. */
  tileToScreen(tx: number, ty: number): [number, number] {
    const { w, h } = this.d.size();
    const [X, Y] = apply(this.d.view.P, tx + 0.5, ty + 0.5);
    const c = this.d.camera.state;
    return [(X - c.cx) * c.zoom + w / 2, (Y - c.cy) * c.zoom + h / 2];
  }

  /** The entity under a screen point (0 = none). */
  entityAt(sx: number, sy: number): number {
    const sim = this.d.sim();
    const { w: W, h: H } = this.d.size();
    const [px, py] = screenTile(this.d.view.P, this.d.camera.state, W, H, sx, sy);
    const gx = Math.floor(px), gy = Math.floor(py);
    if (this.d.view.building) return sim.entityAt(gx, gy)?.id ?? 0;
    const [X, Y] = screenToWorld(this.d.camera.state, W, H, sx, sy);
    let best = 0, bestZ = -Infinity;
    const seen = new Set<number>();
    for (let y = gy - 1; y <= gy + 8; y++) {
      for (let x = gx - 1; x <= gx + 8; x++) {
        const e = sim.entityAt(x, y);
        if (!e || seen.has(e.id)) continue;
        seen.add(e.id);
        const [w, h] = footprint(e.def, e.rot);
        // On the mountains its volume stands on the rock top (a ribbon lies on it), and it ranks as it is drawn.
        const st = standOf(e), lift = drawnLevel(sim.grid, e), foot = lift * LH;
        const flat = (BUILDING_KIND[e.def] === 'belt' && !buildingDef(e.def).lift) || BUILDING_KIND[e.def] === 'conduit'; // a traction ribbon has its elevator
        const top = flat ? foot : foot + isoHead(BUILDING_IDS[e.def] as BuildingId) * LH;
        const P = (u: number, v: number, z: number): [number, number] => { const [a, b] = apply(ISO_LIN, u, v); return [a, b - z]; };
        const hull: Array<[number, number]> = [P(e.x, e.y, top), P(e.x + w, e.y, top), P(e.x + w, e.y, foot), P(e.x + w, e.y + h, foot), P(e.x, e.y + h, foot), P(e.x, e.y + h, top)];
        if (!inConvex(hull, X, Y)) continue;
        const z = st ? st.z : lift > 0 ? beltZ(e.x, e.y) : buildingZ(e.x, e.y, w, h);
        if (z <= bestZ) continue;
        if (!flat && this.solidAt(e.def, e.rot, e.x, e.y, lift, X, Y) === false) continue; // inside its box, but nothing drawn there
        bestZ = z;
        best = e.id;
      }
    }
    if (best) return best;
    // No sprite under the cursor: what its ray meets first — a rock top or a cliff (that tile's
    // occupant, if any; not a building on the ground far behind it), else the ground.
    const [tx, ty] = surfaceTile(sim.grid, px, py);
    return sim.entityAt(tx, ty)?.id ?? 0;
  }

  /**
   * The Core's corner piece under a screen point (D86: the data outlet, the Archive, the grid
   * station; null: none, or not mounted at its level): in plan its corner tile, in iso its volume —
   * a box round the piece's centre up to its height. The Archive opens the Expertise window (D93).
   */
  heartPieceAt(sx: number, sy: number): HeartPiece | null {
    const sim = this.d.sim();
    const e = sim.ents.get(sim.hearthId);
    if (!e) return null;
    const pieces = HEART_CORNERS.filter((c) => c.piece && c.lv <= sim.hearthLevel);
    if (this.d.view.building) {
      const [x, y] = this.tileAt(sx, sy);
      return pieces.find((c) => e.x + c.tx === x && e.y + c.ty === y)?.piece ?? null;
    }
    const { w: W, h: H } = this.d.size();
    const [X, Y] = screenToWorld(this.d.camera.state, W, H, sx, sy);
    const foot = drawnLevel(sim.grid, e) * LH, top = foot + PIECE_H * LH;
    const P = (u: number, v: number, z: number): [number, number] => { const [a, b] = apply(ISO_LIN, u, v); return [a, b - z]; };
    for (const c of pieces) {
      const [lx, ly] = heartCornerAt(c.tx, c.ty);
      const x0 = e.x + lx - PIECE_R, y0 = e.y + ly - PIECE_R, x1 = e.x + lx + PIECE_R, y1 = e.y + ly + PIECE_R;
      const hull: Array<[number, number]> = [P(x0, y0, top), P(x1, y0, top), P(x1, y0, foot), P(x1, y1, foot), P(x0, y1, foot), P(x0, y1, top)];
      if (inConvex(hull, X, Y)) return c.piece;
    }
    return null;
  }
}

/** How far a corner piece reaches round its centre (tiles), and how tall it stands (levels): the Archive's drum and antenna (D86). */
const PIECE_R = 0.42, PIECE_H = 2.1;

/** Is (x, y) inside a convex polygon given in either winding? */
export function inConvex(poly: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!, [bx, by] = poly[(i + 1) % poly.length]!;
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
