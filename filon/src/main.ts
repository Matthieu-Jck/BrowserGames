// main.ts — boot: fonts and styles, settings → language and UI scale, boot veil, Pixi stage, the
// atlas bake, the colony (opened from its save and caught up, or founded: app/persistence.ts), the
// app, the main menu, persistence (autosave, the world clock), the sound, one rAF loop, and the
// debug handle last.
import '@fontsource/patrick-hand-sc';
import '@fontsource-variable/atkinson-hyperlegible-next';
import './ui/styles/base.css';
import './ui/styles/screens.css';
import './ui/styles/hud.css';
import './ui/styles/crier.css';
import './ui/styles/orbit.css';
import './ui/styles/menu.css';
import './ui/styles/card.css';
import './ui/styles/quests.css';
import './ui/styles/intro.css';
import './ui/styles/absence.css';
import { createStage } from '@/render/stage';
import { bakeAtlas } from '@/render/art/atlas';
import { pushTokensToCss } from '@/render/art/tokens';
import { App } from './app/app';
import { installMenu } from './app/screens';
import { installIntro } from './app/intro';
import { installSound } from './app/sound';
import { bootColony, installPersistence } from './app/persistence';
import { installDebug } from './debug';
import { installCoins } from './ui/coin';
import { installMentions } from './ui/mention';
import { applyUiScale, settings } from './settings';
import { locale, pickLocale, setLocale, t, onLocale } from '@/i18n/i18n';
import { el, qs, setText } from '@/core/dom';
import { updateTweens } from '@/core/tween';
import { Sim } from '@/sim/state';
import { MapGen } from '@/sim/world/mapgen';
import { MAP_VERSION, WORLD_SEED } from '@/content/world';
import { WORLD_EPOCH0 } from '@/sim/constants';
import { validateContent } from '@/content/validate';
import { buildDemo } from '@/sim/dev';

function applyLocaleToDocument(): void {
  document.documentElement.lang = locale();
  document.title = `${t('app.title')} — ${t('app.tagline')}`;
}

/** A new colony on the land of `playerSeed`, founded this minute on today's map (when the player has no base yet; ?demo). */
function foundColony(playerSeed: number): Sim {
  const nowEpoch = Math.floor(Date.now() / 60000);
  return new Sim({ worldSeed: WORLD_SEED, playerSeed, source: new MapGen(WORLD_SEED, playerSeed, MAP_VERSION), foundingEpoch: Math.max(WORLD_EPOCH0, nowEpoch) });
}

/**
 * Does the main menu open by itself (at boot, and on Esc once nothing is left to unwind)? Not
 * under automation (`navigator.webdriver`: the smoke test and the screenshot scripts drive the
 * game headless and must not find a menu in the way) nor with ?nomenu; ?menu forces it.
 */
function menuAuto(q: URLSearchParams): boolean {
  if (q.has('menu')) return true;
  return !navigator.webdriver && !q.has('nomenu');
}

async function boot(): Promise<void> {
  // Content mistakes fail loudly in development (the same invariants run in the tests).
  if (import.meta.env.DEV) {
    const problems = validateContent();
    if (problems.length) throw new Error(`content invariants: ${problems.join(' · ')}`);
  }
  setLocale(settings.locale ?? pickLocale(navigator.languages));
  applyLocaleToDocument();
  onLocale(() => applyLocaleToDocument());
  applyUiScale();
  pushTokensToCss();

  const veilSub = el('div.sub', {}, t('boot.loading'));
  const veil = el('div.boot', { 'data-screen': 'boot' }, [
    el('div', {}, [el('div.title', {}, t('app.title')), veilSub]),
  ]);
  document.body.append(veil);

  const stage = await createStage(qs('#stage'), { perf: settings.perf });
  const atlas = bakeAtlas();
  installMentions(document.body, atlas); // every item the UI names shows its icon (ui/mention.ts)
  // The player's base: its newest whole save, caught up for the time away (« Jouer » then opens
  // the report), or a new one. There is no « new game » to offer: one persistent colony per player (D1).
  const q = new URLSearchParams(location.search);
  const booted = await bootColony(q, foundColony, (text) => setText(veilSub, text));
  const sim = booted.sim;
  // ?demo: a working base around the Hearth (drills, ribbons, kiln, wind, a trade post) to look at.
  if (q.has('demo')) buildDemo(sim);
  const app = new App(stage, atlas, sim);
  if (q.has('paused')) app.paused = true; // tests: the base as it was opened, until `FL.resume()`
  installCoins(document.body); // every « ◉ » the UI writes is drawn as the ocelle sign
  // The main menu over the live colony (D27): it is up when the boot veil lifts.
  const auto = menuAuto(q);
  const menu = installMenu(app, auto);
  // Autosave (always the player's own base, never a debug base) and the world clock (M7).
  const persistence = installPersistence(app, booted, menu.bases);
  // A new base opens on its story when the menu closes (D31): the comic-strip intro, the
  // company's name, the Heart's landing. Not under automation, ?nomenu or ?demo.
  const intro = installIntro(app, !navigator.webdriver && !q.has('nomenu') && !q.has('demo'));
  if (auto) menu.open();
  else if (app.away || app.changes) app.screens.open('absence'); // no menu to pass through (?nomenu)
  // Music, ambience and cues (D30): silent until the first click or key (« Jouer »), as browsers require.
  const sound = installSound(app, Date.now());

  // Echo worker probe (M0): proves module workers bundle in dev and in the preview build.
  const worker = new Worker(new URL('./sim/echo.worker.ts', import.meta.url), { type: 'module' });
  const echo = (msg: string): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker timeout')), 4000);
      worker.onmessage = (e: MessageEvent) => { clearTimeout(timer); resolve(e.data); };
      worker.postMessage(msg);
    });

  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    updateTweens(dt);
    app.frame(dt);
    sound.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  veil.setAttribute('data-hide', '');
  setTimeout(() => veil.remove(), 450);
  document.body.setAttribute('data-ready', '');
  app.perf.set('atlasMs', Math.round(atlas.bakeMs));
  installDebug(app, { echo, menu, intro, persistence });
}

boot().catch((err: unknown) => {
  const box = document.getElementById('err');
  if (box) {
    box.hidden = false;
    box.textContent = t('boot.error', { msg: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
  throw err;
});
