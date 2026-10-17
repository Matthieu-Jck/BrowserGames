// fit.ts — the responsive layout's numbers (D96), pure: the breakpoints, and the fit factor that
// shrinks the whole interface a little on a small window (the UI scale's zoom times this). The CSS
// breakpoints (styles/responsive.css) repeat `NARROW`, `PHONE` and `SHORT`: media queries cannot
// read a variable.
// The shell applies the fit on every resize (app/layout.ts).

/** Below this window width (CSS px): the panels turn into bottom sheets, the HUD folds its rows, the screens go full screen. */
export const NARROW = 900;
/** Below this width: a phone held upright (the HUD on two short rows). */
export const PHONE = 560;
/** Below this window height: a phone on its side (the HUD on one row where it can, the sheets lower). */
export const SHORT = 540;

/** The window the desktop interface is drawn for at 100 %: smaller, it zooms out down to `FIT_MIN`. */
const DESK_REF: readonly [number, number] = [1280, 720];
/** The same for the narrow layout: a tablet upright (768 × 1024) or a phone on its side, and a phone upright (390 × 844). */
const NARROW_REF: readonly [number, number] = [820, 600];
const PHONE_REF: readonly [number, number] = [400, 640];
/** The least the fit goes down to: with a mouse, and on touch (where a 46 px target must stay ≥ 40 px). */
export const FIT_MIN = 0.84;
export const FIT_MIN_TOUCH = 0.88;

/**
 * The fit factor for a window of `w` × `h` CSS px: 1 on a desktop window of 1280 × 720 and more,
 * less on a smaller one (by whichever side is short), never under its floor and never over 1 (a
 * large screen keeps the drawn sizes: the UI scale setting is the player's way to enlarge).
 */
export function uiFit(w: number, h: number, coarse: boolean): number {
  const [rw, rh] = w >= NARROW ? DESK_REF : w >= PHONE ? NARROW_REF : PHONE_REF;
  const f = Math.min(w / rw, h / rh, 1);
  const lo = coarse ? FIT_MIN_TOUCH : FIT_MIN;
  return Math.round(Math.max(lo, f) * 1000) / 1000;
}
