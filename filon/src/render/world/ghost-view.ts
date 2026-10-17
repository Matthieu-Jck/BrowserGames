// ghost-view.ts — the build ghost on the plan plane (tile units): the building's plan sprite
// or the ribbon pieces a drag would lay, over a footprint tinted by validity (turquoise when
// it fits, coral when it does not), what a placement would replace (amber, under the new
// piece: refunded, not destroyed), the demolition box with what it would take, and a light
// outline on the tile under the cursor. A ribbon piece refused at a step (`needs_lift`, D77) is
// drawn as the traction ribbon that would take it. A directional routing block (router, sorters, gates:
// in from the back only) shows its flow while it is placed: a big turquoise arrow into its
// back, small coral ones out of its three ways out — drawn from the piece's own rotation, which
// over a ribbon is the way the items enter that tile, its back to the feed even on a curve, until
// the player turns it with R (`Sim.placementRot`, D98). While a ribbon drag
// runs, nothing is laid yet (D73): its plan — traction steps, bridge pairs, a dashed leap between
// each pair's ends — is a faint placeholder until the release. A face cutter in hand (D87) shows which
// way it must face: the tiles its back would press on tinted turquoise where they hold a face ore,
// coral where not, and an arrow from the machine into the wall on its working side. A piece a drag
// buries (D109: the camouflaged ribbon, where the land refuses the dragged one) is drawn a little
// stronger — sand on sand fades — inside a dashed ink frame, so a mixed drag shows which tiles go
// underground. Redrawn only when the preview changes.
//
// A building that would stand above the floor (D44: on the mountains; world/stand.ts, from the
// one height function, relief.ts `tileTop`) is shown where it would stand: in iso its ghost is
// lifted onto the rock top — on this ground plane a shift of `level·SHIFT` tiles along −x −y is
// exactly `level` levels up — easing down to flat with the morph (the plan is flat), and in plan
// it lays the same ink hint of height under it as a placed one; red where `canPlace` refuses it
// (astride a cliff). Per frame only the lift's position, while the view morphs.
import { Container, Graphics, Sprite } from 'pixi.js';
import { buildingDef, buildingIdx } from '@/content/registry';
import { footprint } from '@/sim/entities';
import { backRow, faceTiles, workSide, worksFace } from '@/sim/face';
import type { Sim } from '@/sim/state';
import type { Rot } from '@/sim/types';
import { btKey, beltKey, type Atlas } from '../art/atlas';
import { arrowPoly } from '../art/shapes';
import { BELT_TIERS, type BeltTier } from '../art/recipes/belts';
import { num, C } from '../art/tokens';
import { isBeltDef } from '@/content/registry';
import type { Preview } from '@/input/tools';
import { SHIFT } from '../relief';
import { beltMatrix, SHADOW_TINT } from './buildings-view';
import { flowArrows, isDirectional } from './flow-arrows';
import { riseOffset, standLevel } from './stand';

const OK = num(C.cyan), BAD = num(C.ledRed), SWAP = num(C.warn);
const FLOW_IN = num(C.glowTurq), FLOW_OUT = num(C.coral), INK = num(C.ink);
/** A face cutter's back row (D87): a face ore there (turquoise), none (coral). */
const FACE_OK = num(C.turq), FACE_OK_FILL = num(C.glowTurq), FACE_NONE = num(C.coral);
/** Outward unit vectors of the sides (0 N, 1 E, 2 S, 3 W). */
const SIDE_V: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** The plan's hint of height under a ghost that would stand above the floor (as a placed building's, a little fainter). */
const RISE_ALPHA = 0.24;
/** A ribbon drag's placeholder: its pieces this faint until the release lays them (D73). */
const DRAG_ALPHA = 0.55;
/** A buried piece's frame (D109): ink dashes round the tile, inset. */
const BURIED_INK = num(C.inkSoft);

/** A dashed square frame round tile (x, y), inset by `m`: one dash per side's third. */
function buriedFrame(g: Graphics, x: number, y: number, m: number): void {
  const a = m, b = 1 - m, d = (b - a) / 5;
  for (let k = 0; k < 5; k += 2) {
    const s = a + k * d, e = s + d;
    g.moveTo(x + s, y + a).lineTo(x + e, y + a).moveTo(x + s, y + b).lineTo(x + e, y + b);
    g.moveTo(x + a, y + s).lineTo(x + a, y + e).moveTo(x + b, y + s).lineTo(x + b, y + e);
  }
}

/** A bridge pair's leap (tile units, centre to centre): turquoise dashes, gaps between. */
function leapDash(g: Graphics, ax: number, ay: number, bx: number, by: number): void {
  const len = Math.abs(bx - ax) + Math.abs(by - ay);
  if (len <= 0) return;
  for (let d = 0.45; d < len - 0.45; d += 0.36) {
    const t0 = d / len, t1 = Math.min(len - 0.45, d + 0.2) / len;
    g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0).lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1);
  }
  g.stroke({ width: 0.09, color: OK, alpha: 0.9 });
}

export class GhostView {
  private readonly g = new Graphics();
  /** Under the ghost sprites: footprints a placement would replace. */
  private readonly under = new Graphics();
  private readonly box = new Container();
  /** Everything above, lifted together onto the rock top a building would stand on (tile units). */
  private readonly lift = new Container();
  /** The level the piece in hand would stand at (0: the floor), and the lift's shift now (tiles). */
  private level = 0;
  private off = 0;
  private sig = '';

  constructor(private readonly layer: Container, private readonly atlas: Atlas) {
    this.lift.addChild(this.under, this.box, this.g);
    layer.addChild(this.lift);
  }

  /**
   * The view's plan-ness, read off the plane the ghost lies on: `top` carries P(te) (layers.ts),
   * turned by π/4·(1 − te) (projection.ts `proj`), so its angle gives te back.
   */
  private planness(): number {
    const plane = this.layer.parent;
    if (!plane) return 1;
    plane.updateLocalTransform();
    const m = plane.localTransform;
    return Math.min(1, Math.max(0, 1 - Math.atan2(-m.c, m.a) / (Math.PI / 4)));
  }

  /** Lift the ghost onto the rock top in iso, easing down to flat towards the plan (per frame: a position, while lifted). */
  private follow(): void {
    const off = this.level ? this.level * SHIFT * (1 - this.planness()) : 0;
    if (Math.abs(off - this.off) < 1e-4) return;
    this.off = off;
    this.lift.position.set(-off, -off);
  }

  draw(pre: Preview | null, sim: Sim, hover: [number, number] | null, showHover: boolean): void {
    this.follow();
    const sig = JSON.stringify([pre?.pieces.map((p) => [p.def, p.x, p.y, p.rot, p.ok, p.reason]), pre?.box, pre?.doomed, pre?.mark, pre?.drag, pre?.leaps, showHover ? hover : null]);
    if (sig === this.sig) return;
    this.sig = sig;
    for (const c of this.box.removeChildren()) c.destroy();
    const g = this.g;
    g.clear();
    this.under.clear();
    // One building in hand (never a ribbon drag, a box or a mark): where would it stand?
    const one = pre && !pre.box && !pre.mark && pre.pieces.length === 1 ? pre.pieces[0]! : null;
    this.level = one && !isBeltDef(one.def) ? standLevel(sim.grid, buildingIdx(one.def), one.x, one.y, one.rot) : 0;
    this.follow();
    if (pre && !pre.box) {
      for (const id of pre.doomed) {
        const e = sim.ents.get(id);
        if (!e) continue;
        const [w, h] = footprint(e.def, e.rot);
        this.under.rect(e.x, e.y, w, h).fill({ color: SWAP, alpha: 0.22 }).stroke({ width: 0.07, color: SWAP, alpha: 0.95 });
      }
    }
    if (pre) {
      // A ribbon drag is not laid before the release (D73): its plan shows as a placeholder, faint.
      const a = pre.drag ? DRAG_ALPHA : 1;
      const buriedAt: Array<[number, number]> = [];
      for (const p of pre.pieces) {
        const [w, h] = footprint(buildingIdx(p.def), p.rot);
        g.rect(p.x, p.y, w, h).fill({ color: p.ok ? OK : BAD, alpha: 0.2 * a }).stroke({ width: 0.06, color: p.ok ? OK : BAD, alpha: 0.95 * a });
        const tint = p.ok ? 0xffffff : 0xff9a8a;
        if (isBeltDef(p.def)) {
          // A ribbon facing a step it cannot take (D77): the piece that takes it, over the coral footprint.
          const tier: BeltTier = p.reason === 'needs_lift' ? 'traction_ribbon' : p.def in BELT_TIERS ? (p.def as BeltTier) : 'ribbon';
          const tex = this.atlas.textures.get(beltKey(tier, false));
          if (!tex) continue;
          const s = new Sprite(tex);
          s.setFromMatrix(beltMatrix(p.x, p.y, p.rot, false));
          const buried = !!buildingDef(buildingIdx(p.def)).camo && p.reason !== 'needs_lift';
          s.alpha = (buried ? 1 : 0.8) * Math.max(a, buried ? 0.8 : 0);
          s.tint = tint;
          this.box.addChild(s);
          if (buried) buriedAt.push([p.x, p.y]);
        } else {
          const key = this.atlas.frames.has(btKey(p.def, p.rot)) ? btKey(p.def, p.rot) : btKey(p.def, 0);
          const tex = this.atlas.textures.get(key), fr = this.atlas.frames.get(key);
          if (!tex || !fr) continue;
          if (this.level) {
            // The plan's hint of height under it: its own sprite in ink, down-right.
            const sh = new Sprite(tex), off = riseOffset(this.level);
            sh.scale.set(fr.k);
            sh.position.set(p.x + off - fr.ox * fr.k, p.y + off - fr.oy * fr.k);
            sh.alpha = RISE_ALPHA;
            sh.tint = SHADOW_TINT;
            this.box.addChild(sh);
          }
          const s = new Sprite(tex);
          s.scale.set(fr.k);
          s.position.set(p.x - fr.ox * fr.k, p.y - fr.oy * fr.k);
          s.alpha = 0.72 * a;
          s.tint = tint;
          this.box.addChild(s);
          if (isDirectional(p.def)) this.flow(p.x, p.y, p.rot, p.ok ? 1 : 0.55);
          const di = buildingIdx(p.def);
          if (worksFace(di)) this.face(sim, di, p.x, p.y, p.rot);
        }
      }
      // The buried pieces' frames (D109), one stroke after the footprints (they share the path otherwise).
      if (buriedAt.length) {
        for (const [x, y] of buriedAt) buriedFrame(g, x, y, 0.16);
        g.stroke({ width: 0.07, color: BURIED_INK, alpha: 0.9, cap: 'round' });
      }
      // A bridge pair's leap: a dashed line from end to end, over what it leaves as it is.
      for (const [x0, y0, x1, y1] of pre.leaps ?? []) leapDash(g, x0 + 0.5, y0 + 0.5, x1 + 0.5, y1 + 0.5);
      if (pre.mark) {
        const [x0, y0, x1, y1] = pre.mark.box;
        const col = pre.mark.clear ? num(C.ink) : num(C.coral);
        g.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1).fill({ color: col, alpha: 0.08 }).stroke({ width: 0.08, color: col, alpha: 0.9 });
      }
      if (pre.box) {
        const [x0, y0, x1, y1] = pre.box;
        for (const id of pre.doomed) {
          const e = sim.ents.get(id);
          if (!e) continue;
          const [w, h] = footprint(e.def, e.rot);
          g.rect(e.x, e.y, w, h).fill({ color: BAD, alpha: 0.32 });
        }
        g.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1).fill({ color: BAD, alpha: 0.08 }).stroke({ width: 0.08, color: BAD, alpha: 0.95 });
      }
    }
    if (showHover && hover && !(pre && (pre.pieces.length || pre.box || pre.mark))) {
      g.rect(hover[0], hover[1], 1, 1).stroke({ width: 0.05, color: 0xffffff, alpha: 0.85 });
    }
  }

  /**
   * A face cutter's working side (D87): its back row tinted — turquoise on the tiles that hold a
   * face ore it would cut (`faceTiles`), coral on the others — and a short arrow from the machine
   * across its back edge into the wall, turquoise when it meets quartz, coral when it meets none.
   */
  private face(sim: Sim, def: number, x: number, y: number, rot: Rot): void {
    const g = this.g;
    const hits = new Set(faceTiles(sim.grid, def, x, y, rot).map(([tx, ty]) => `${tx},${ty}`));
    for (const [tx, ty] of backRow(def, x, y, rot)) {
      const ok = hits.has(`${tx},${ty}`);
      g.rect(tx + 0.05, ty + 0.05, 0.9, 0.9).fill({ color: ok ? FACE_OK_FILL : FACE_NONE, alpha: ok ? 0.34 : 0.22 }).stroke({ width: 0.06, color: ok ? FACE_OK : FACE_NONE, alpha: 0.95 });
    }
    const [w, h] = footprint(def, rot);
    const side = workSide(rot), [vx, vy] = SIDE_V[side]!;
    const ex = x + w / 2 + (vx * w) / 2, ey = y + h / 2 + (vy * h) / 2; // the back edge's middle
    const arrow = arrowPoly(ex - vx * 0.5, ey - vy * 0.5, ex + vx * 0.62, ey + vy * 0.62, 0.1, 0.24, 0.28);
    const col = hits.size ? FACE_OK_FILL : FACE_NONE;
    g.poly(arrow.map(([px, py]) => [px + 0.04, py + 0.05]).flat()).fill({ color: INK, alpha: 0.3 });
    g.poly(arrow.flat()).fill({ color: col, alpha: 1 }).stroke({ width: 0.055, color: INK, alpha: 1 });
  }

  /** A directional block's flow: the way in (big, turquoise, over a soft shadow), the ways out (coral). */
  private flow(x: number, y: number, rot: Rot, a: number): void {
    const g = this.g;
    const { into, out } = flowArrows(x, y, rot);
    for (const o of out) g.poly(o.flat()).fill({ color: FLOW_OUT, alpha: a }).stroke({ width: 0.035, color: INK, alpha: 0.9 * a });
    g.poly(into.map(([px, py]) => [px + 0.04, py + 0.05]).flat()).fill({ color: INK, alpha: 0.3 * a });
    g.poly(into.flat()).fill({ color: FLOW_IN, alpha: a }).stroke({ width: 0.055, color: INK, alpha: a });
  }
}
