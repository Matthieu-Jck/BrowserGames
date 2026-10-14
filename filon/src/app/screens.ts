// screens.ts — full screens over the world (research T, stats G, the Crier M, the main menu with
// its settings and credits; the absence report in M7): at most one open, toggled by its key or
// button, closed by Esc (a screen with pages goes back a page first), refreshed at the UI's 4 Hz
// while open. A screen is any object with a DOM root and a refresh().
//
// The main menu's shell side lives here too (`installMenu`, D27): the menu and settings pages
// (plain DOM in src/ui/screens), the preferences they write (src/settings.ts), the HUD stepping
// aside and the slow camera drift behind the veil, and the rule for when it opens by itself — at
// boot (main.ts) and on Esc once nothing is left to unwind, except under automation
// (navigator.webdriver: the smoke test, screenshot scripts) or with ?nomenu, where it only opens
// on demand (`FL.menu(true)`, the HUD's menu button). The base keeps running behind it. In
// development (or with ?debug) it also offers the « Débogage » page: ready-made bases swapped in
// for the player's, which is kept aside (app/debug-bases.ts), and the badge saying so.
import { bus } from '@/core/bus';
import type { ScreenId } from '@/core/kinds';
import { locale, onLocale, setLocale, t } from '@/i18n/i18n';
import type { Camera } from '@/render/camera';
import { apply, invert } from '@/render/projection';
import { DEBUG_LEVEL_TEXT, DebugBadge, MainMenu, type MenuDebugHost, type MenuPage } from '@/ui/screens/menu';
import { SettingsScreen, type SaveHost } from '@/ui/screens/settings';
import { el } from '@/core/dom';
import { writeRaw } from '@/core/store';
import { EXPORTED_KEY, type Persistence } from './persistence';
import { forecast } from '@/persist/colony';
import { TICK_MS } from '@/sim/constants';
import { applyUiScale, saveSettings, settings } from '../settings';
import type { App } from './app';
import { installDebugBases, type DebugBases } from './debug-bases';

export interface Screen {
  readonly root: HTMLElement;
  /** Re-read the model and update the DOM (change-only writes). */
  refresh(): void;
  /** Every frame while open (animations such as the orbital view); optional. */
  frame?(dt: number): void;
  /** Esc: go back a level inside the screen (a page); false when there is none (the host closes it). */
  back?(): boolean;
  /** Called once the screen is in / out of the page. */
  opened?(): void;
  closed?(): void;
  /** While it is open the game's keys wait (Esc and the perf overlay still work): the main menu. */
  readonly modal?: boolean;
}

export class ScreenHost {
  /** The open screen (null = the world). */
  current: ScreenId | null = null;
  /** What Esc opens once nothing is left to unwind (the main menu); null: Esc stops there. */
  escapeTo: ScreenId | null = null;
  private readonly screens = new Map<ScreenId, Screen>();

  constructor(private readonly host: HTMLElement | null) {}

  register(id: ScreenId, screen: Screen): void {
    this.screens.set(id, screen);
  }

  /** Open a screen (opening the open one closes it), or close any (null). */
  open(id: ScreenId | null): void {
    if (this.current === id) id = null;
    const was = this.current;
    for (const sc of this.screens.values()) sc.root.remove();
    this.current = id;
    if (was && was !== id) {
      this.screens.get(was)?.closed?.();
      bus.emit('screen:closed', { id: was });
    }
    const sc = id ? this.screens.get(id) : undefined;
    if (!id || !sc || !this.host) { this.current = null; return; }
    sc.root.setAttribute('data-open', '');
    this.host.append(sc.root);
    sc.refresh();
    sc.opened?.();
    bus.emit('screen:opened', { id });
  }

  /** Esc on the open screen: back a page if it has one, else close it. */
  back(): void {
    const sc = this.current ? this.screens.get(this.current) : undefined;
    if (!sc?.back?.()) this.open(null);
  }

  /** Is a modal screen (the main menu) up? The game's keys wait. */
  get modal(): boolean {
    return !!this.current && !!this.screens.get(this.current)?.modal;
  }

  /** 4 Hz: the open screen re-reads its model. */
  refresh(): void {
    if (this.current) this.screens.get(this.current)?.refresh();
  }

  /** Every frame: the open screen animates (if it wants to). */
  frame(dt: number): void {
    if (this.current) this.screens.get(this.current)?.frame?.(dt);
  }
}

// ── the main menu ───────────────────────────────────────────────────────────

/** The main menu as the shell runs it (`FL.menu` drives it). */
export interface MenuShell {
  readonly menu: MainMenu;
  /** Open the menu, on a page ('home': just the buttons). */
  open(page?: MenuPage): void;
  close(): void;
  isOpen(): boolean;
  /** The debug bases behind the « Débogage » page (null when it is not offered); `FL.debugSave` drives them. */
  readonly bases: DebugBases | null;
}

/** Is the « Débogage » page offered: in development (the dev server), or with ?debug (a preview build). */
export function debugOffered(): boolean {
  return import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
}

/**
 * Register the main menu (and its settings, credits and debug pages) on the app's screens. `auto`:
 * the menu belongs to play — Esc opens it once nothing is left to unwind, and the caller shows it
 * at boot; false under automation and with ?nomenu. `debug`: offer the « Débogage » page (ready-made
 * bases, app/debug-bases.ts) and its badge.
 */
export function installMenu(app: App, auto: boolean, debug = debugOffered()): MenuShell {
  const settingsPage = new SettingsScreen({
    values: () => settings,
    setLocale: (l) => { settings.locale = l; saveSettings(); setLocale(l); menu.refresh(); },
    setUiScale: (s) => { settings.uiScale = s; saveSettings(); applyUiScale(); },
    setPerf: (on) => { settings.perf = on; saveSettings(); },
    // The sound reads the volumes every frame (app/sound.ts): moving a slider is heard at once;
    // releasing it stores it, and the effects sliders play a cue at the new level.
    setVolume: (which, v, done) => {
      const x = Math.min(1, Math.max(0, v));
      if (which === 'master') settings.volMaster = x;
      else if (which === 'music') settings.volMusic = x;
      else settings.volSfx = x;
      if (done) { saveSettings(); if (which !== 'music') bus.emit('sfx', { cue: 'toast.good' }); }
    },
    soundAvailable: () => app.sound?.sound.available ?? true,
    close: () => menu.show('home'),
    save: saveHost(app),
  });
  // The debug bases: one click builds one and plays it (the menu closes), the player's base kept
  // aside; the way back closes the menu too. A badge says so while one is in.
  let badge: DebugBadge | null = null;
  const bases = debug ? installDebugBases(app, () => { menu.refresh(); badge?.refresh(); }) : null;
  const debugHost: MenuDebugHost | undefined = bases ? {
    levels: () => bases.levels,
    current: () => bases.current(),
    load: (id) => {
      const { report, ms } = bases.load(id);
      app.toasts.show('info', t('debug.loaded', { level: t(DEBUG_LEVEL_TEXT[id][0]), ms }));
      if (report.skipped.length || report.forced.length || report.granted.length) console.info(`debug base ${id}:`, report);
      app.screens.open(null);
    },
    restore: () => {
      if (bases.restore()) app.toasts.show('info', t('debug.restored'));
      if (app.screens.current === 'menu') app.screens.open(null);
    },
  } : undefined;
  // « Jouer »: the world, or first the report of what happened while the player was away (M7).
  const menu = new MainMenu({
    baseName: () => app.sim.colonyName,
    play: () => app.screens.open(app.away || app.changes ? 'absence' : null),
    debug: debugHost,
    // « Avant de partir »: the base on screen, caught up on a copy for that long (persist/colony.ts).
    forecast: { run: async (hours) => forecast(app.sim, Math.round((hours * 3_600_000) / TICK_MS)) },
  }, settingsPage);
  if (debugHost) {
    badge = new DebugBadge(debugHost);
    app.hud.pin(badge.root);
    badge.refresh();
    onLocale(() => badge?.refresh());
  }
  const drift = new MenuDrift(app.camera, () => ({ w: app.stage.width, h: app.stage.height }));
  app.screens.register('menu', {
    root: menu.root,
    modal: true,
    refresh: () => menu.refresh(),
    frame: (dt) => drift.update(dt),
    back: () => menu.back(),
    opened: () => {
      document.body.setAttribute('data-menu', ''); // menu.css: the HUD fades out
      drift.start();
      menu.focus();
    },
    closed: () => {
      document.body.removeAttribute('data-menu');
      drift.stop();
      menu.show('home');
    },
  });
  if (auto) app.screens.escapeTo = 'menu';
  return {
    menu,
    open: (page = 'home') => {
      if (app.screens.current !== 'menu') app.screens.open('menu');
      menu.show(page);
    },
    close: () => { if (app.screens.current === 'menu') app.screens.open(null); },
    isOpen: () => app.screens.current === 'menu',
    bases,
  };
}

/** The settings' « Sauvegarde » row, on the app's persistence (M7): the file, and the questions before a change. */
function saveHost(app: App): SaveHost {
  const p = (): Persistence | null => app.persistence;
  return {
    kept: () => !!p()?.slots && !p()?.volatile,
    lastSaved: () => p()?.last?.savedAt ?? null,
    exportFile: () => void (async () => {
      const text = await p()?.exportText();
      if (!text) return;
      const name = (p()?.realSim() ?? app.sim).colonyName.normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'ocelle';
      const file = `${name}-${new Date().toISOString().slice(0, 10)}.ocelle`;
      const a = el<'a'>('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: file });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      writeRaw(EXPORTED_KEY, String(Date.now()));
      app.toasts.show('good', t('save.export.done', { file }));
    })(),
    importFile: (f) => void (async () => {
      const text = await f.text();
      const info = await p()?.peek(text);
      if (!info) { app.toasts.show('bad', t('save.import.bad')); return; }
      const date = new Date(info.savedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
      if (!confirm(t('save.import.ask', { name: info.name || t('quest.unnamed'), n: info.buildings, lvl: info.heartLevel, date }))) return;
      if (!(await p()?.importText(text))) app.toasts.show('bad', t('save.import.bad'));
    })(),
    wipe: () => {
      const word = t('save.wipe.word');
      const typed = prompt(t('save.wipe.ask', { word }));
      if (typed && typed.trim().toLowerCase() === word.toLowerCase()) void p()?.wipe();
    },
  };
}

const smooth = (x: number): number => x * x * (3 - 2 * x);

/**
 * The camera behind the menu: frames the colony to the right of the menu column, a little wider,
 * and wanders slowly (two slow sways and a breath of zoom, in screen px through the current
 * projection, so it reads the same in iso and plan). On close it glides back to where the player
 * was. With reduced motion it only frames.
 */
export class MenuDrift {
  private home: { tx: number; ty: number; zoom: number } | null = null;
  private t = 0;
  private readonly still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly camera: Camera, private readonly size: () => { w: number; h: number }) {}

  start(): void {
    if (!this.home) this.home = { ...this.camera.target };
    this.t = 0;
  }

  update(dt: number): void {
    const home = this.home;
    if (!home) return;
    this.t += dt;
    const { w, h } = this.size();
    const ease = smooth(Math.min(1, this.t / 2.5)); // settle into the framing
    const sway = (period: number): number => (this.still ? 0 : Math.sin((this.t * 2 * Math.PI) / period));
    const zoom = home.zoom * (1 - 0.12 * ease) * (1 + 0.025 * sway(83));
    // Screen offset of the scene (+x: to the right of the menu column), then into tiles.
    const sx = ease * w * (0.16 + 0.045 * sway(71));
    const sy = ease * h * 0.035 * sway(53);
    const [ux, uy] = apply(invert(this.camera.P), sx / zoom, sy / zoom);
    this.camera.glideTo(home.tx - ux, home.ty - uy, zoom);
  }

  stop(): void {
    if (this.home) this.camera.glideTo(this.home.tx, this.home.ty, this.home.zoom);
    this.home = null;
  }
}
