// layout.ts — the shell's side of the responsive layout (D96). The DOM interface lays itself out in
// CSS (styles/responsive.css: the breakpoints, the bottom sheets, the folded HUD); this module keeps
// the few numbers CSS cannot know in step with the window:
// - the zoom of #ui and #screens: the player's UI scale times the window's fit (ui/fit.ts: smaller
//   on a small window, never larger than drawn), applied by `applyUiScale` as `--ui-zoom`;
// - the window's size in those px (`--win-w`, `--win-h`: vw / vh would be zoomed twice by Chrome);
// - where the HUD ends (`--hud-b`, its whole height; `--hud-rb`, the bottom of its right cluster,
//   under which the side panels start on a wide window) and how tall the open build bar stands
//   from the window's bottom (`--bar-h`), so that a panel or a sheet never covers either. They are
//   in #ui's own (zoomed) px, measured by ResizeObservers whenever a cartouche wraps or unfolds;
// - the Pixi canvas and the camera follow the window: a resize, an orientation change, the
//   on-screen keyboard (the visual viewport) re-size the renderer on the next frame. The camera's
//   centre is in tiles, so the same ground stays in the middle; nothing is stretched.
import { applyUiScale } from '../settings';
import type { App } from './app';

export interface Layout {
  /** Measure again now (the HUD or the bar changed in a way no observer sees). */
  measure(): void;
}

/** The zoom the last `applyUiScale` set (1 before the first). */
function zoomNow(): number {
  return Number.parseFloat(document.documentElement.style.getPropertyValue('--ui-zoom')) || 1;
}

export function installLayout(app: App): Layout {
  const root = document.documentElement.style;
  const set = (name: string, px: number): void => {
    const v = `${Math.round(px * 10) / 10}px`;
    if (root.getPropertyValue(name) !== v) root.setProperty(name, v);
  };

  const measure = (): void => {
    const z = zoomNow();
    const H = window.innerHeight;
    set('--win-w', window.innerWidth / z);
    set('--win-h', H / z);
    const hud = app.hud.root.getBoundingClientRect();
    // The right cluster has no box of its own once the narrow layout flattens the HUD (display: contents).
    const right = app.hud.root.querySelector('.hud-right')?.getBoundingClientRect();
    const hudB = hud.height > 0 ? hud.bottom : 0;
    set('--hud-b', hudB / z);
    set('--hud-rb', (right && right.height > 0 ? right.bottom : hudB) / z);
    // The build bar: fixed at the bottom; no height while building is closed.
    const bar = app.bar.root.getBoundingClientRect();
    set('--bar-h', bar.height > 2 ? Math.max(0, H - bar.top) / z : 0);
  };

  let queued = false;
  const fit = (): void => {
    queued = false;
    applyUiScale();
    // The renderer at the window's size (stage.ts listens to `resize` too; an orientation change or
    // the visual viewport can arrive without one, or before the new size is known).
    if (app.stage.width !== window.innerWidth || app.stage.height !== window.innerHeight) app.stage.resize();
    measure();
  };
  const later = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(fit);
  };
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', () => { later(); setTimeout(later, 350); });
  window.visualViewport?.addEventListener('resize', later);
  // The pointer kind can change (a tablet's keyboard cover, a mouse plugged into a phone): the touch floor of the fit follows.
  matchMedia('(pointer: coarse)').addEventListener?.('change', later);

  // The HUD wraps or unfolds, the bar opens or closes: the panels move with them.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => measure());
    ro.observe(app.hud.root);
    const right = app.hud.root.querySelector('.hud-right');
    if (right) ro.observe(right);
    ro.observe(app.bar.root);
  }
  fit();
  return { measure };
}
