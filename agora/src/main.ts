// main.ts — boot. Build the app, run one rAF loop (tweens → update → render), wire
// keyboard/parallax input, install the debug handle last, and flush progress on exit.
import './ui/styles/base.css';
import './ui/styles/panels.css';
import './ui/styles/widgets.css';
import { App } from './app';
import { installDebug } from './debug';
import { updateTweens } from './core/tween';
import { flushProgress } from './scoring/progress';

const app = new App();

let last = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;

function tick(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  updateTweens(dt);
  app.update(dt, t);
  app.render(t);

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    app.fps = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Gentle pointer parallax — the living field drifts with the cursor.
window.addEventListener('pointermove', (e) => {
  app.layers.scroll = e.clientY * 0.6 + e.clientX * 0.1;
});

// Enter / Space / → advances by clicking the visible primary action.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
    const btn = document.querySelector<HTMLButtonElement>('.actions .btn.primary, .intro-actions .btn.primary');
    if (btn && !btn.hasAttribute('disabled')) {
      e.preventDefault();
      btn.click();
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushProgress();
});
window.addEventListener('pagehide', () => flushProgress());

installDebug(app);
