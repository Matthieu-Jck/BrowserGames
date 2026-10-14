// solar.ts — photovoltaic cells: the colour and the panel every solar array in the art uses.
//
// The day / night views (world/lights-view.ts) give solar panels their state — dark at night,
// a warm glint at dawn and dusk, a white sheen in full sun — without knowing any building's
// geometry: the light spy (recipes/fx.ts) re-runs a building's recipe and notes every polygon
// filled with `PV` at full opacity, and the states are drawn over exactly those polygons. So:
// draw solar cells with `PV` (or with `pvPanel`, which does) and nothing else in that colour.
// Pure Canvas2D, worker-safe (no DOM, no Pixi).
import { C, mix } from './tokens';
import { flat, ink, shape, type Ctx, type Pt } from './ink';

/** Photovoltaic cells: a deep cobalt between the steel blues and the violets of the palette. */
export const PV = '#2b3f8e';
/** The cells' grid lines and the panel's lit rim. */
const PV_GRID = mix(C.steelL, C.ice, 0.35);

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * A framed solar panel over a quad [p00, p10, p11, p01] (any projection: give its four corners
 * in canvas px): a steel frame, `cols × rows` cells in `PV` with pale grid gaps, an inked edge
 * and a lit rim along the first side.
 */
export function pvPanel(ctx: Ctx, quad: readonly [Pt, Pt, Pt, Pt], cols = 3, rows = 2, seed = 1): void {
  const [a, b, c, d] = quad;
  shape(ctx, quad, C.steelD, { w: 1.6, seed });
  const at = (u: number, v: number): Pt => lerp(lerp(a, b, u), lerp(d, c, u), v);
  const g = 0.06; // frame and gap, in panel units
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u0 = g + ((1 - 2 * g) * i) / cols + g * 0.25, u1 = g + ((1 - 2 * g) * (i + 1)) / cols - g * 0.25;
      const v0 = g + ((1 - 2 * g) * j) / rows + g * 0.25, v1 = g + ((1 - 2 * g) * (j + 1)) / rows - g * 0.25;
      flat(ctx, [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], PV);
    }
  }
  // One fine line across each cell (the cells' busbars).
  for (let i = 0; i < cols; i++) {
    const u = g + ((1 - 2 * g) * (i + 0.5)) / cols;
    ink(ctx, [at(u, g), at(u, 1 - g)], { w: 0.8, color: PV_GRID, alpha: 0.45, shade: false, taper: 0, jitter: 0, seed: seed + 1 + i });
  }
  ink(ctx, [a, b], { w: 1.2, color: PV_GRID, alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: seed + 9 });
}
