// view.ts — the two views of one world: iso (default: look, move, inspect) and plan (build).
// `mode` is the goal; `t` runs linearly towards it over MORPH_S seconds; `te` is the eased
// plan-ness every renderer reads and `P` the projection tiles → world px at that `te`
// (render/projection.ts). Opening the build bar asks for plan, closing it for iso.
import { bus } from '@/core/bus';
import type { ViewMode } from '@/core/kinds';
import { screenToWorld, type CamState } from '@/render/camera-math';
import { LH } from '@/render/iso';
import { apply, ease, invert, proj, type Lin } from '@/render/projection';
import { MAX_LEVEL } from '@/render/relief';

/** Seconds for the iso ⇄ plan morph. */
export const MORPH_S = 0.5;

export class ViewState {
  mode: ViewMode = 'iso';
  /** Morph parameter, linear: 0 iso … 1 plan. */
  t = 0;
  /** Eased plan-ness (what renderers use). */
  te = 0;
  /** Projection tiles → world px at `te`. */
  P: Lin = proj(0);

  /** Switch views (the board morphs there); emits `view:changed`. */
  setMode(mode: ViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    bus.emit('view:changed', { mode });
  }

  /** The plan side is in effect: tools act, the grid shows. */
  get building(): boolean { return this.te > 0.5; }

  /** At rest in one view (no morph running): pixel snapping is safe. */
  get settled(): boolean { return this.te === 0 || this.te === 1; }

  /** Advance the morph by dt seconds. */
  update(dt: number): void {
    const goal = this.mode === 'plan' ? 1 : 0;
    const step = dt / MORPH_S;
    this.t = goal > this.t ? Math.min(goal, this.t + step) : Math.max(goal, this.t - step);
    this.te = ease(this.t);
    this.P = proj(this.te);
  }

  /**
   * The tile rectangle [x0, y0, x1, y1] the screen covers (bounding box of its corners on the
   * ground — and, in iso, on the highest relief, which shows tiles from further down).
   */
  visibleTiles(cam: CamState, w: number, h: number): [number, number, number, number] {
    const inv = invert(this.P);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const lift = MAX_LEVEL * LH * (1 - this.te);
    for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
      const [X, Y] = screenToWorld(cam, w, h, sx, sy);
      for (const l of [0, lift]) {
        const [tx, ty] = apply(inv, X, Y + l);
        x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx); y1 = Math.max(y1, ty);
      }
    }
    return [x0, y0, x1, y1];
  }
}
