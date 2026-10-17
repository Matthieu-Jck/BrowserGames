// settings.ts — player preferences (not the colony): language, UI scale, perf mode, sound.
// Stored in localStorage via core/store (falling back to defaults is harmless here). The
// settings page of the main menu (src/ui/screens/settings.ts) edits them through the shell
// (`installMenu` in app/screens.ts): the UI layer may not import this file. The volumes are read
// every frame by the sound (app/sound.ts), so a slider acts at once.
import { DEFAULT_VOLUMES } from '@/audio/levels';
import { makeStore, readRaw } from '@/core/store';
import type { Locale } from '@/core/kinds';
import { uiFit } from '@/ui/fit';

export interface Settings {
  version: 1;
  locale: Locale | null; // null = follow the browser
  uiScale: number;
  perf: boolean;
  /** Basse consommation (D100): the game drawn at 30 frames a second at most, at once (the sim keeps its pace); the economical GPU from the next launch. */
  lowPower: boolean;
  edgeScroll: boolean;
  /** The three volume sliders, 0–1 (a squared taper: audio/levels.ts). */
  volMaster: number;
  volMusic: number;
  volSfx: number;
}

const KEY = 'filon.settings.v1';

export const settingsStore = makeStore<Settings>(KEY, 1, () => ({
  version: 1,
  locale: null,
  uiScale: 1,
  perf: false,
  lowPower: false,
  edgeScroll: false,
  volMaster: DEFAULT_VOLUMES.master,
  volMusic: DEFAULT_VOLUMES.music,
  volSfx: DEFAULT_VOLUMES.sfx,
}));

export const settings: Settings = settingsStore.load();

// A hand-edited or corrupt value must not leave the interface unusable.
if (!Number.isFinite(settings.uiScale)) settings.uiScale = 1;
settings.uiScale = Math.min(1.6, Math.max(0.7, settings.uiScale));
if (typeof settings.lowPower !== 'boolean') settings.lowPower = false;
// Before sound existed the two volumes were inert placeholders (stored with any other change):
// they were never the player's choice, so the mix's defaults replace them once.
if (!(readRaw(KEY) ?? '{}').includes('"volMaster"')) {
  settings.volMusic = DEFAULT_VOLUMES.music;
  settings.volSfx = DEFAULT_VOLUMES.sfx;
}
for (const k of ['volMaster', 'volMusic', 'volSfx'] as const) {
  const v = settings[k];
  settings[k] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUMES[k === 'volMaster' ? 'master' : k === 'volMusic' ? 'music' : 'sfx'];
}

export function saveSettings(): void {
  settingsStore.save(settings);
}

/**
 * Apply the UI scale to the page: `--ui-scale` (the player's), and `--ui-zoom`, the scale times the
 * window's fit (D96, ui/fit.ts: a little smaller on a small window), which menu.css turns into a
 * zoom of #ui and #screens. app/layout.ts calls it again on every resize.
 */
export function applyUiScale(scale = settings.uiScale): void {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const zoom = Math.round(scale * uiFit(window.innerWidth, window.innerHeight, coarse) * 1000) / 1000;
  const style = document.documentElement.style;
  style.setProperty('--ui-scale', String(scale));
  if (style.getPropertyValue('--ui-zoom') !== String(zoom)) style.setProperty('--ui-zoom', String(zoom));
}
