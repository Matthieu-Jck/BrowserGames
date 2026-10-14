// main.ts — boot: renderer, screens, audio, RAF loop, debug handle.
/// <reference types="vite/client" />
import './ui/styles/base.css';
import './ui/styles/cards.css';
import './ui/styles/screens.css';

import { Game } from './game';
import { qs } from './ui/dom';
import { initTooltip } from './ui/components/tooltip';
import { initModal } from './ui/components/modal';
import { initHud } from './ui/hud';
import { initAudioDirector } from './audio/audio-director';
import { updateTweens } from './vfx/tween';
import { createTitleScreen } from './ui/screens/title-screen';
import { createCutsceneScreen } from './ui/screens/cutscene-screen';
import { createGalaxyScreen } from './ui/screens/galaxy-screen';
import { createSurfaceScreen } from './ui/screens/surface-screen';
import { createCombatScreen } from './ui/screens/combat-screen';
import { createEventScreen } from './ui/screens/event-screen';
import { createRewardScreen } from './ui/screens/reward-screen';
import { createShopScreen } from './ui/screens/shop-screen';
import { createForgeScreen } from './ui/screens/forge-screen';
import { createWakeScreen } from './ui/screens/wake-screen';
import { createGameoverScreen, createEndingScreen } from './ui/screens/end-screens';
import { installDebug } from './debug';

if (import.meta.env.DEV) {
  void import('./content/validate').then((m) => m.validateContent());
}

const canvas = qs<HTMLCanvasElement>('#game');
const game = new Game(canvas);
const ui = qs('#ui');

initTooltip();
initModal();
initAudioDirector();

const screens = {
  title: createTitleScreen(game),
  cutscene: createCutsceneScreen(game),
  galaxy: createGalaxyScreen(game),
  surface: createSurfaceScreen(game),
  combat: createCombatScreen(game),
  event: createEventScreen(game),
  reward: createRewardScreen(game),
  shop: createShopScreen(game),
  forge: createForgeScreen(game),
  wake: createWakeScreen(game),
  gameover: createGameoverScreen(game),
  ending: createEndingScreen(game),
} as const;

for (const [id, screen] of Object.entries(screens)) {
  ui.appendChild(screen.root);
  game.register(id as keyof typeof screens, screen);
}
initHud(game);

addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });

function tick(): void {
  requestAnimationFrame(tick);
  const dt = game.sm.render();
  updateTweens(dt);
  game.update(dt);
}
tick();
game.toTitle();

installDebug(game);
