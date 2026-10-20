// neighbour-lod.ts — which neighbouring bases are drawn, and in which look (D162). With no fog
// (D148) a dozen bases are in sight at once, and drawn with the claim's atlas they pulled most of its
// 2048² pages onto the GPU (+230 MB on a fresh base) though their frames fill under two. So a base
// is drawn in one of two looks, by how much of the art the screen can show:
// - `far` (zoom × the screen's density under `FAR_UNDER`): every texture a half-size copy on a small
//   sheet of the neighbours' own (world/neighbour-art.ts). At that zoom the GPU samples the atlas a
//   mip level down anyway (its art is baked at 2×), so the copy is as sharp: the same picture.
// - `detail` (from `DETAIL_OVER` up): the claim's frames where its page is on the GPU already (shared,
//   nothing more), copies of the others; the dress at full size.
// Between the two the look holds (hysteresis), so a zoom resting on a threshold never flips it.
// Bases are laid near the view (`MARGIN` round it) and dropped once out of a wider ring (`KEEP`) for
// `DROP_MS`; the detail sheet goes once no base has been drawn in detail for `DETAIL_HOLD_MS`.
// Pure: the view (world/neighbours-view.ts) applies `planBases`, a step a frame.

/** The two looks of a base. */
export type Look = 'far' | 'detail';

/** The far copies' scale down (the atlas is baked at 2× world px: half of it is one texel a world px). */
export const FAR_K = 2;
/** Zoom × density from which a base is drawn in detail, and under which it goes back to far (2 / FAR_K = 1: where the far copy would start to blur). */
export const DETAIL_OVER = 0.9, FAR_UNDER = 0.75;
/** How far past the view a base is laid (tiles), and past which it is dropped after `DROP_MS` (ms). */
export const MARGIN = 34, KEEP = 3 * 23;
export const DROP_MS = 10_000;
/** The detail sheet is let go once no base has been drawn in detail for this long (ms). */
export const DETAIL_HOLD_MS = 20_000;
/** A sheet grown past this many 1024² pages is renewed: its bases re-laid on a fresh one, the old let go. */
export const SHEET_CAP = 6;

/** The look for zoom × density `zr`: detail from `DETAIL_OVER`, far under `FAR_UNDER`, between them what it was (far to start with). */
export function zoomLook(prev: Look | null, zr: number): Look {
  if (zr >= DETAIL_OVER) return 'detail';
  if (zr < FAR_UNDER) return 'far';
  return prev ?? 'far';
}

/** A tile box [x0, y0, x1, y1]. */
export type Box = readonly [number, number, number, number];

/** Do two boxes overlap (edges touching count)? */
export const overlaps = (a: Box, b: Box): boolean => a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];

/** A box grown by m tiles on every side. */
export const grow = (b: Box, m: number): Box => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];

/** A base as laid: its hub, its look and the generation of the sheet it was drawn from. */
export interface LaidBase { hub: number; look: Look; gen: number }

/**
 * What to do with the bases, given those laid, those near the view (by squared distance to its
 * middle), the look the zoom wants and each look's current sheet: `lay` the hubs to lay or lay again
 * (a new look, a renewed sheet), nearest first; `drop` the laid ones to drop now — out of the view's
 * ring while their look or sheet is stale (laying them again out of sight would be wasted: they are
 * laid afresh when they come near).
 */
export function planBases(laid: readonly LaidBase[], near: ReadonlyArray<{ hub: number; d: number }>, look: Look, gen: Readonly<Record<Look, number>>): { lay: number[]; drop: number[] } {
  const byHub = new Map(laid.map((b) => [b.hub, b]));
  const isNear = new Set(near.map((n) => n.hub));
  const lay = [...near].sort((a, b) => a.d - b.d || a.hub - b.hub).filter((n) => {
    const b = byHub.get(n.hub);
    return !b || b.look !== look || b.gen !== gen[look];
  }).map((n) => n.hub);
  const drop = laid.filter((b) => !isNear.has(b.hub) && ((b.look === 'detail' && look === 'far') || b.gen !== gen[b.look])).map((b) => b.hub).sort((a, b) => a - b);
  return { lay, drop };
}
