// layers.ts — the fixed layer stack for two views of one world. `world` is a render group
// holding the camera transform. Flat things live in TILE units inside "plane" containers that
// all carry the view projection P(t): the ground and ribbons, the relief paint (iso only),
// the plan sprites (plan only), and above everything the grid, overlays, fog, the land's parcels
// and the ghost.
// Volumes (iso buildings and cliffs, depth-sorted together) live in iso world px under
// M(t) = P(t)·P(0)⁻¹; items on the floor are placed in world px by their view, under the
// buildings — but for those riding a junction's bridge, on their own layer over them — and
// items above the floor (on the rock, in an elevator's shaft, falling into an incinerator) are
// sorted among the volumes (world/items-view.ts). The buildings' cast shadows lie on the ground
// under the volumes, above the ribbons and their items (iso px under M, with the volumes' fade).
// Churny layers get their own render groups: the volumes too, since items moving among them
// re-sort them most frames, and a render group re-batches only itself.
// The specialised views (D88: Électricité, Logistique, Production) dim the base under a paper
// `veil` (inside the graded world, over the buildings and items, under the wires so the
// Électricité view's bold wires stay on top), then draw their own system untinted: flat marks in
// tile units (`viewFlat`, in `top`, under the overlays) and badges in view world px (`viewMarks`,
// above the drifters).
import { Container, Matrix } from 'pixi.js';
import { isoToView, type Lin } from './projection';

export type LayerName =
  | 'terrain' | 'decals' | 'belts' | 'items' | 'relief' | 'plan' | 'objects'
  | 'grid' | 'overlays' | 'fog' | 'ghost' | 'status' | 'fxTop'
  // Day / night (daynight.ts, world/lights-view.ts): cloud shadows inside the graded world,
  // night glows (additive) above it.
  | 'shade' | 'lights'
  // The buildings' cast shadows on the ground, following the sun (world/buildings-view.ts).
  | 'shadows'
  // Items riding a junction's bridge, drawn over the buildings (world/items-view.ts).
  | 'itemsOver'
  // Power wires (world/wires-view.ts), above every building: iso (with the volumes' M(t) and
  // fade), plan (tile units, with the plan sprites' fade).
  | 'wires' | 'wiresPlan'
  // Light-emitting effects above everything, outside the day / night grade, so they stay
  // bright at night: the thruster flames of the intro's sky-crane (world/landing-view.ts, D31)
  // and of the trade posts' cargo drones (world/cargo-view.ts), and the cargo drones themselves,
  // drawn over their flames and tinted by hand like `fxTop`.
  | 'fxGlow'
  // The claim's land (D60, world/overlays-view.ts): the parcels held, leased and a sister claim's,
  // the land mode's grid and marks — above the fog (a map of who holds what, readable on land not
  // explored yet: the price says what a parcel holds), below the ghost.
  | 'land'
  // The specialised views (D88, world/views-view.ts): the paper veil over the base, the view's
  // flat marks (tile units, untinted), its badges (view world px, untinted).
  | 'veil' | 'viewFlat' | 'viewMarks';

export class Layers {
  readonly world = new Container({ isRenderGroup: true, label: 'world' });
  /** The graded world (DayNight tints it): a render group, so its tint is one uniform. */
  readonly lit = new Container({ label: 'lit', isRenderGroup: true });
  private readonly plane = new Container({ label: 'plane' });
  private readonly reliefPlane = new Container({ label: 'reliefPlane' });
  private readonly planPlane = new Container({ label: 'planPlane' });
  private readonly volumes = new Container({ label: 'volumes', isRenderGroup: true });
  private readonly shadowsIso = new Container({ label: 'shadowsIso' });
  private readonly wiresIso = new Container({ label: 'wiresIso' });
  private readonly wiresPlanPlane = new Container({ label: 'wiresPlanPlane' });
  private readonly veilPlane = new Container({ label: 'veilPlane' });
  private readonly top = new Container({ label: 'top' });
  private readonly map = new Map<LayerName, Container>();

  constructor(root: Container) {
    root.addChild(this.world);
    this.world.addChild(this.lit);
    this.lit.addChild(this.plane);
    this.add(this.plane, 'terrain');
    this.add(this.plane, 'decals');
    this.add(this.plane, 'belts');
    this.add(this.lit, 'items', true);
    this.lit.addChild(this.shadowsIso);
    this.add(this.shadowsIso, 'shadows');
    this.lit.addChild(this.reliefPlane);
    this.add(this.reliefPlane, 'relief');
    this.lit.addChild(this.planPlane);
    this.add(this.planPlane, 'plan');
    this.lit.addChild(this.volumes);
    this.add(this.volumes, 'objects');
    this.add(this.lit, 'itemsOver', true);
    this.lit.addChild(this.veilPlane);
    this.add(this.veilPlane, 'veil');
    this.lit.addChild(this.wiresIso);
    this.add(this.wiresIso, 'wires', true);
    this.lit.addChild(this.wiresPlanPlane);
    this.add(this.wiresPlanPlane, 'wiresPlan', true);
    this.add(this.lit, 'shade');
    this.add(this.world, 'lights', true);
    this.world.addChild(this.top);
    this.add(this.top, 'grid');
    this.add(this.top, 'viewFlat', true);
    this.add(this.top, 'overlays');
    this.add(this.top, 'fog');
    this.add(this.top, 'land');
    this.add(this.top, 'ghost', true);
    this.add(this.world, 'status', true);
    this.add(this.world, 'viewMarks', true);
    this.add(this.world, 'fxTop');
    this.add(this.world, 'fxGlow');
  }

  private add(parent: Container, name: LayerName, group = false): void {
    const c = new Container({ label: name, isRenderGroup: group });
    parent.addChild(c);
    this.map.set(name, c);
  }

  get(name: LayerName): Container {
    return this.map.get(name)!;
  }

  /**
   * Set the view: P maps tiles to world px; t is the eased plan-ness (0 iso, 1 plan). Volumes
   * and the relief paint fade out over the first 60 % of the morph, the plan sprites fade in
   * over the last 70 %.
   */
  setView(P: Lin, t: number): void {
    const m = new Matrix(P.a, P.b, P.c, P.d, 0, 0);
    for (const c of [this.plane, this.reliefPlane, this.planPlane, this.top, this.wiresPlanPlane, this.veilPlane]) c.setFromMatrix(m);
    const V = isoToView(P);
    const mv = new Matrix(V.a, V.b, V.c, V.d, 0, 0);
    this.volumes.setFromMatrix(mv);
    this.shadowsIso.setFromMatrix(mv);
    this.wiresIso.setFromMatrix(mv);
    // Cross-fade with an overlap so the colony never vanishes mid-morph.
    const isoA = t <= 0 ? 1 : t >= 0.6 ? 0 : 1 - t / 0.6;
    const planA = t >= 1 ? 1 : t <= 0.3 ? 0 : (t - 0.3) / 0.7;
    this.volumes.alpha = isoA;
    this.volumes.visible = isoA > 0;
    this.shadowsIso.alpha = isoA;
    this.shadowsIso.visible = isoA > 0;
    this.reliefPlane.alpha = isoA;
    this.reliefPlane.visible = isoA > 0;
    this.planPlane.alpha = planA;
    this.planPlane.visible = planA > 0;
    this.wiresIso.alpha = isoA;
    this.wiresIso.visible = isoA > 0;
    this.wiresPlanPlane.alpha = planA;
    this.wiresPlanPlane.visible = planA > 0;
  }
}
