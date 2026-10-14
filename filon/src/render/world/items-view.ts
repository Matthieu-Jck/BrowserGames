// items-view.ts — items riding the ribbons, in both views. Where each item is comes from the
// engine's own cells, one item per tile (D57, cell-flow.ts), each eased in from where it was over
// one step along the ribbons' paths (item-flow.ts). This file only draws them: each item is placed
// in world px by the current view (P), lifted onto skybridge decks and junction bridges in iso,
// glyphs upright. Items are the belt variant of their glyph (a paper halo keeps them readable on the
// teal belt), about half a tile across. One ParticleContainer per atlas page and per layer;
// particles are pooled and the particle lists rebuilt only when the count changes.
//
// Two layers (owner, 2026-10-13: a junction is "a little bridge, with items going under it in
// one direction, and over it in another"): items are drawn under the buildings (`items`), so
// those passing under a junction vanish under its bridge and show through its tunnel; an item
// riding a junction's deck (flagged by the model) is drawn on `itemsOver`, over the buildings.
// The junctions' passages — the under line's ribbon through each tunnel — are laid by
// `JunctionsView` (junctions-view.ts), which this view owns and rebuilds with its pieces.
//
// On the mountains (owner, 2026-10-13: "on the traction ribbons, the items still go straight, not
// up"): an item rides at the height of the land where it is (belt-lift.ts) — its tile's top, or on
// a traction ribbon's elevator car, waiting on it while it rises or sinks — and in iso, above the
// floor, it is drawn over the volumes (the rock it rides on would cover it) unless higher rock or a
// building in front hides its tile. After the items, the idle cars go back to wait (`settle`).
import { Container, Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { ITEM_IDS } from '@/content/registry';
import type { Sim } from '@/sim/state';
import { IB_PX, ibKey, type Atlas } from '../art/atlas';
import { DECK_Z, beltPiece } from './buildings-view';
import { BeltLift, type Placed } from './belt-lift';
import { LH } from '../iso';
import { buildPieces } from './item-flow';
import { CellFlow, type FlowItem } from './cell-flow';
import { JunctionsView } from './junctions-view';
import { TOP, type Lin } from '../projection';

/** Item frame size (world px): iso and plan (0.5 of a 32 px plan tile; the owner found 0.7, then 0.6 a bit big). */
const ISO_PX = 21;
const PLAN_PX = 0.5 * TOP;

/** Scratch for where an item is drawn (belt-lift.ts `place`). */
const AT: Placed = { x: 0, y: 0, lv: 0, shaft: false };

/** One drawn item, for the trace rigs (FL): its rank this frame, tile coords, height, item, and whether it is drawn over the buildings. */
export interface DrawnItem { id: number; x: number; y: number; z: number; item: number; over: boolean }

/** One layer of items: a ParticleContainer per atlas page, their pooled particles, how many are in use this frame. */
class Group {
  readonly pcs = new Map<number, ParticleContainer>();
  readonly pool = new Map<number, Particle[]>();
  readonly used = new Map<number, number>();
  constructor(readonly layer: Container) {}

  container(page: number): ParticleContainer {
    let pc = this.pcs.get(page);
    if (!pc) {
      pc = new ParticleContainer({
        dynamicProperties: { position: true, uvs: true, vertex: true, rotation: false, color: false },
        boundsArea: new Rectangle(-1e7, -1e7, 2e7, 2e7),
      });
      this.layer.addChild(pc);
      this.pcs.set(page, pc);
      this.pool.set(page, []);
    }
    return pc;
  }

  /** Hand the particles in use to their containers (lists rebuilt only when the count changes). */
  flush(): void {
    for (const [page, pc] of this.pcs) {
      const u = this.used.get(page) ?? 0;
      const pool = this.pool.get(page)!;
      if (pc.particleChildren.length !== u || pc.particleChildren[0] !== pool[0]) {
        pc.particleChildren.length = 0;
        for (let i = 0; i < u; i++) pc.particleChildren.push(pool[i]!);
        pc.update();
      }
    }
  }
}

export class ItemsView {
  private readonly under: Group;
  private readonly over: Group;
  readonly flow = new CellFlow();
  /** The height of the land under the items (rock tops, traction lifts). */
  readonly lift = new BeltLift();
  /** The ribbons laid through the junctions' tunnels (null without a ground layer). */
  readonly junctions: JunctionsView | null;
  count = 0;
  /** Debug (FL): record every drawn item of the last frame (tile coords) for the trace rigs. */
  debugOn = false;
  private dbg: DrawnItem[] = [];
  /** The items drawn last frame (recorded while `debugOn`). */
  debugSnapshot(): DrawnItem[] { return this.dbg; }

  /**
   * `layer`: items under the buildings; `overLayer`: items on a junction's bridge, over them (the
   * same layer when omitted); `ground`: where the junctions' passages are laid (the ribbons' layer),
   * `lifted` where those on rock go (the volumes, the plan sprites).
   */
  constructor(layer: Container, private readonly atlas: Atlas, overLayer: Container = layer, ground?: Container, lifted?: { volumes: Container; plan: Container }) {
    this.under = new Group(layer);
    this.over = new Group(overLayer);
    this.junctions = ground ? new JunctionsView(ground, atlas, lifted) : null;
  }

  /** Re-read the ribbon pieces and the junctions' passages (after structural changes); another colony starts afresh. */
  rebuild(sim: Sim): void {
    this.flow.setPieces(buildPieces(sim, beltPiece, DECK_Z));
    this.lift.rebuild(sim);
    this.junctions?.rebuild(sim);
  }

  /**
   * Per frame: `now` is the fractional tick (interpolation), P the view, t its plan-ness,
   * `view` the visible tile rect (items outside are skipped).
   */
  update(sim: Sim, now: number, P: Lin, t: number, zoom: number, view: [number, number, number, number]): void {
    for (const g of [this.under, this.over]) for (const page of g.pcs.keys()) g.used.set(page, 0);
    const [vx0, vy0, vx1, vy1] = view;
    const iso = 1 - t;
    // Items grow a little when zoomed out so they stay legible; hidden when tiny.
    const px = (ISO_PX + (PLAN_PX - ISO_PX) * t) / Math.max(0.75, Math.min(1, zoom));
    const scale = px / IB_PX;
    const show = zoom >= 0.28;
    if (this.debugOn) this.dbg = [];
    let n = 0;
    const draw = (k: FlowItem): void => {
      if (k.x < vx0 - 1 || k.x > vx1 + 2 || k.y < vy0 - 1 || k.y > vy1 + 2) return;
      const key = ibKey(ITEM_IDS[k.item]!);
      const fr = this.atlas.frames.get(key);
      const tex = this.atlas.textures.get(key);
      if (!fr || !tex) return;
      // The land under it: above the floor, over the rock it rides on (iso), unless hidden in front.
      const at = this.lift.place(k.x, k.y, AT), lv = at.lv;
      const g = k.o || ((lv > 0 || at.shaft) && iso > 0.5 && this.lift.over(Math.floor(at.x), Math.floor(at.y))) ? this.over : this.under;
      g.container(fr.page);
      const pool = g.pool.get(fr.page)!;
      const u = g.used.get(fr.page) ?? 0;
      let p = pool[u];
      if (!p) { p = new Particle({ texture: tex, anchorX: 0.5, anchorY: 0.5 }); pool.push(p); }
      p.texture = tex;
      p.x = P.a * at.x + P.c * at.y;
      // In iso the sticker stands a little proud of the belt, and rides decks and bridges at their height.
      p.y = P.b * at.x + P.d * at.y - (3 + k.z + lv * LH) * iso;
      p.scaleX = p.scaleY = scale;
      g.used.set(fr.page, u + 1);
      n++;
      if (this.debugOn) this.dbg.push({ id: n, x: k.x, y: k.y, z: k.z + lv * LH, item: k.item, over: g === this.over });
    };
    if (show && sim.graph) this.flow.each(sim, now, view, draw);
    this.lift.settle(now);
    this.under.flush();
    this.over.flush();
    this.count = n;
  }
}
