// menu.ts — the main menu: the OCELLE lettering over the live base, its tagline (a base piloted
// from Verrière with CrierBelt), the base's name, and « Jouer », « Paramètres », « À propos ».
// The world keeps running and drifting behind a paper veil (the shell moves the camera and
// hides the HUD: this component is plain DOM). The settings
// and the credits open as a page beside the buttons; Esc goes back from a page to the buttons,
// then closes the menu (the shell's Esc chain calls `back()` first). Shown at boot, and in game
// from the HUD's menu button or Esc when nothing else is open (D27).
//
// M7 (persistence) hook: today every boot founds a base, so « Jouer » just closes the menu.
// With saves, the shell loads the base (and runs the catch-up) before the menu shows, `MenuHost`
// gains what the menu should say about it (last visit, time away), and « Jouer » hands over to
// the absence report. There is no « Nouvelle partie » and there will not be one: one persistent
// base per player (D1).
//
// « Débogage » (in development, or with ?debug: `MenuHost.debug`): a page of ready-made bases at a
// few stages of the game (src/sim/scenarios.ts); one click builds one and plays it, the player's
// own base kept aside (app/debug-bases.ts); « Revenir à ma concession » brings it back. While a
// debug base is in, `DebugBadge` stays on screen.
import { el, setAttr, setText } from '@/core/dom';
import { t, type MsgKey } from '@/i18n/i18n';
import type { ScenarioId } from '@/sim/scenarios';
import type { SettingsScreen } from './settings';
import { ForecastPage, type ForecastHost } from './forecast';

export type MenuPage = 'home' | 'forecast' | 'settings' | 'about' | 'debug';

/** The debug bases, as the menu sees them (the shell builds and swaps). */
export interface MenuDebugHost {
  /** The levels, by advancement. */
  levels(): readonly ScenarioId[];
  /** The debug base on screen (null: the player's own base). */
  current(): ScenarioId | null;
  /** Build level `id` and play it (the shell swaps it in and closes the menu). */
  load(id: ScenarioId): void;
  /** Back to the player's own base, as it was left. */
  restore(): void;
}

export interface MenuHost {
  /** The base's name ('' while it has none). */
  baseName(): string;
  /** « Jouer »: close the menu, the base is the player's to pilot again. */
  play(): void;
  /** The « Débogage » page, when it is offered (development builds, ?debug). */
  debug?: MenuDebugHost;
  /** « Avant de partir »: the catch-up of an absence run on a copy of the base (M7). */
  forecast?: Omit<ForecastHost, 'close'>;
}

/** Each level's title and what it holds. */
export const DEBUG_LEVEL_TEXT: Record<ScenarioId, readonly [MsgKey, MsgKey]> = {
  claim: ['debug.level.claim', 'debug.level.claim.desc'],
  smelter: ['debug.level.smelter', 'debug.level.smelter.desc'],
  survey: ['debug.level.survey', 'debug.level.survey.desc'],
  tutorial: ['debug.level.tutorial', 'debug.level.tutorial.desc'],
  grown: ['debug.level.grown', 'debug.level.grown.desc'],
  late: ['debug.level.late', 'debug.level.late.desc'],
};

/** The Heart's dome (the base's core) on the horizon with a ribbon leaving it, inked like the favicon: the emblem. */
const EMBLEM = `<svg viewBox="0 0 150 92" aria-hidden="true">
  <circle class="em-glow" cx="60" cy="19" r="12"/>
  <path class="em-dune" d="M4 80 C18 66 34 64 50 80 Z"/>
  <rect class="em-ribbon" x="86" y="70" width="60" height="10" rx="2"/>
  <path class="em-chev" d="M99 72.5 l3.5 2.5 -3.5 2.5 M112 72.5 l3.5 2.5 -3.5 2.5 M125 72.5 l3.5 2.5 -3.5 2.5 M138 72.5 l3.5 2.5 -3.5 2.5"/>
  <path class="em-dome" d="M24 80 C24 38 96 38 96 80 Z"/>
  <path class="em-line" d="M38 80 C38 54 82 54 82 80 M60 48 V80 M30 66 H90"/>
  <path class="em-ink" d="M60 48 V26"/>
  <circle class="em-bulb" cx="60" cy="19" r="6"/>
  <path class="em-ink" d="M4 80 H146"/>
</svg>`;

export class MainMenu {
  readonly root: HTMLElement;
  /** The page beside the buttons ('home': none). */
  page: MenuPage = 'home';
  /** Labels built once and re-set on refresh, so they follow a language switch. */
  private readonly labels: Array<[HTMLElement, MsgKey]> = [];
  private readonly base: HTMLElement;
  /** The title: its first letter is drawn as the ocelle sign (the game is named after the currency), the rest as text. */
  private readonly titleO = el('span.menu-o', { 'aria-hidden': 'true' });
  private readonly titleRest = el('span', { 'aria-hidden': 'true' });
  private readonly title = el('h1.menu-title.lettering', {}, [this.titleO, this.titleRest]);
  private readonly pageBox: HTMLElement;
  private readonly about: HTMLElement;
  /** The build's version, at the foot of the credits. */
  private readonly version = el('span.set-note');
  private readonly buttons = new Map<'play' | MenuPage, HTMLButtonElement>();
  /** The « Débogage » page (null when it is not offered), its « en cours » line, its way back, a load button per level. */
  private readonly debugPage: HTMLElement | null = null;
  private readonly debugNow = el('p.dbg-now');
  private readonly debugBack: HTMLButtonElement;
  private readonly debugLoads = new Map<ScenarioId, HTMLButtonElement>();
  /** The level being built (its button says so until the shell has swapped it in). */
  private busy: ScenarioId | null = null;
  /** « Avant de partir » (null when the shell offers no forecast). */
  readonly forecast: ForecastPage | null;

  constructor(private readonly host: MenuHost, private readonly settings: SettingsScreen) {
    const button = (id: 'play' | MenuPage, key: MsgKey, primary = false): HTMLButtonElement => {
      const b = this.label(el<'button'>(`button.btn.menu-btn${primary ? '.primary' : ''}`, {
        type: 'button', 'data-act': id,
        onclick: () => (id === 'play' ? host.play() : this.show(this.page === id ? 'home' : id)),
      }), key);
      this.buttons.set(id, b);
      return b;
    };
    this.base = el('p.menu-base.lettering');
    this.about = el('section.about', { 'data-screen': 'about' }, [
      this.label(el('h2.lettering'), 'menu.about'),
      this.label(el('p.about-lead.lettering'), 'menu.about.lead'),
      this.label(el('p'), 'menu.about.text'),
      this.label(el('p'), 'menu.about.drones'),
      this.label(el('h3.lettering'), 'menu.about.credits'),
      el('ul.about-credits', {}, (['menu.about.art', 'menu.about.fonts', 'menu.about.tech'] as const).map((k) => this.label(el('li'), k))),
      el('div.set-foot', {}, [this.version, this.label(el<'button'>('button.btn.set-back', { type: 'button', onclick: () => this.show('home') }), 'menu.back')]),
    ]);
    this.debugBack = this.label(el<'button'>('button.btn.dbg-back', { type: 'button', 'data-debug-restore': '', onclick: () => host.debug?.restore() }), 'debug.back');
    const dbg = host.debug;
    if (dbg) {
      this.debugPage = el('section.dbg', { 'data-screen': 'debug' }, [
        this.label(el('h2.lettering'), 'menu.debug'),
        this.label(el('p.dbg-lead'), 'menu.debug.lead'),
        this.debugNow,
        this.debugBack,
        el('ol.dbg-levels', {}, dbg.levels().map((id) => {
          const [title, desc] = DEBUG_LEVEL_TEXT[id];
          const load = this.label(el<'button'>('button.btn.dbg-load', {
            type: 'button', 'data-debug-load': id,
            onclick: () => {
              if (this.busy) return;
              // Say it is building before the work starts (up to a second of game time runs: the page paints first).
              this.busy = id;
              this.refresh();
              window.setTimeout(() => { try { dbg.load(id); } finally { this.busy = null; this.refresh(); } }, 30);
            },
          }), 'debug.load');
          this.debugLoads.set(id, load);
          return el('li.dbg-level', { 'data-debug-level': id }, [
            el('div.dbg-text', {}, [this.label(el('h3.lettering'), title), this.label(el('p'), desc)]),
            load,
          ]);
        })),
        el('div.set-foot', {}, [this.label(el<'button'>('button.btn.set-back', { type: 'button', onclick: () => this.show('home') }), 'menu.back')]),
      ]);
    }
    const fc = host.forecast;
    this.forecast = fc ? new ForecastPage({ run: (h) => fc.run(h), close: () => this.show('home') }) : null;
    this.pageBox = el('div.menu-page.cartouche', { hidden: '' });
    this.root = el('section.menu', { 'data-screen': 'menu', 'data-page': 'home' }, [
      el('div.menu-col', {}, [
        el('div.menu-emblem', { html: EMBLEM }),
        this.title,
        this.label(el('p.menu-tagline.lettering'), 'menu.tagline'),
        this.base,
        el('nav.menu-nav', {}, [
          button('play', 'menu.play', true),
          ...(this.forecast ? [button('forecast', 'menu.forecast')] : []),
          button('settings', 'screen.settings'),
          button('about', 'menu.about'),
          ...(dbg ? [button('debug', 'menu.debug')] : []),
        ]),
      ]),
      this.pageBox,
      this.label(el('p.menu-foot'), 'menu.hint'),
    ]);
    this.refresh();
  }

  private label<E extends HTMLElement>(node: E, key: MsgKey): E {
    this.labels.push([node, key]);
    return node;
  }

  /** Show a page beside the buttons ('home' closes it). */
  show(page: MenuPage): void {
    this.page = page;
    const content = page === 'settings' ? this.settings.root : page === 'about' ? this.about : page === 'debug' ? this.debugPage
      : page === 'forecast' ? this.forecast?.root ?? null : null;
    if (!content) this.pageBox.replaceChildren();
    else if (this.pageBox.firstElementChild !== content) this.pageBox.replaceChildren(content);
    if (page === 'forecast') this.forecast?.open(); // from the base as it is now
    setAttr(this.pageBox, 'hidden', content ? null : '');
    setAttr(this.root, 'data-page', page);
    this.refresh();
  }

  /** Esc: from a page back to the buttons (true); on the buttons nothing is left (false: close). */
  back(): boolean {
    if (this.page === 'home') return false;
    const from = this.page;
    this.show('home');
    this.buttons.get(from)?.focus({ preventScroll: true });
    return true;
  }

  /** The keyboard lands on « Jouer », so Enter plays. */
  focus(): void {
    this.buttons.get('play')?.focus({ preventScroll: true });
  }

  /** Change-only writes: labels (language), the base's name, the open page. */
  refresh(): void {
    for (const [node, key] of this.labels) setText(node, t(key));
    const title = t('app.title');
    setAttr(this.title, 'aria-label', title);
    setText(this.titleO, title.slice(0, 1));
    setText(this.titleRest, title.slice(1));
    const name = this.host.baseName();
    const now = this.host.debug?.current() ?? null;
    setText(this.base, now ? t('debug.badge', { level: t(DEBUG_LEVEL_TEXT[now][0]) }) : name ? t('menu.base', { name }) : '');
    setAttr(this.base, 'data-debug', now ? '' : null);
    if (this.debugPage) {
      setText(this.debugNow, now ? t('debug.current', { level: t(DEBUG_LEVEL_TEXT[now][0]) }) : t('debug.own'));
      setAttr(this.debugBack, 'hidden', now ? null : '');
      for (const [id, b] of this.debugLoads) {
        setText(b, t(this.busy === id ? 'debug.building' : 'debug.load'));
        setAttr(b, 'data-busy', this.busy === id ? '' : null);
        setAttr(b.parentElement!, 'data-on', now === id ? '' : null);
      }
    }
    setText(this.version, t('menu.about.version', { v: __APP_VERSION__ }));
    for (const [id, b] of this.buttons) setAttr(b, 'data-on', id === this.page ? '' : null);
    if (this.page === 'settings') this.settings.refresh();
    if (this.page === 'forecast') this.forecast?.refresh();
  }
}

/**
 * The badge shown while a debug base is in play: a small chip at the end of the HUD's research row
 * (`Hud.pin`), out of the world's way (owner, 2026-10-14: the old badge, at the top centre, "blocks
 * my game"). It shows the level's name and a « ↩ » button back to the claim (its full wording in
 * the tooltip); the menu says which base is in play. Plain DOM; the shell refreshes it when a base
 * is swapped in or out, and on a language switch.
 */
export class DebugBadge {
  readonly root: HTMLElement;
  private readonly text = el('span.dbg-badge-text');
  private readonly back: HTMLButtonElement;

  constructor(private readonly host: MenuDebugHost) {
    this.back = el<'button'>('button.btn.dbg-badge-back', { type: 'button', 'data-debug-back': '', onclick: () => host.restore() }, '↩');
    // Its row opens the research screen on a click: the badge keeps its clicks to itself.
    this.root = el('div.dbg-badge.cartouche', { 'data-debug-badge': '', role: 'status', hidden: '', onclick: (e: MouseEvent) => e.stopPropagation() }, [el('span.dbg-badge-mark', {}, '⚑'), this.text, this.back]);
  }

  refresh(): void {
    const now = this.host.current();
    setAttr(this.root, 'hidden', now ? null : '');
    setAttr(this.root, 'data-level', now);
    setText(this.text, now ? t(DEBUG_LEVEL_TEXT[now][0]) : '');
    setAttr(this.root, 'title', now ? t('debug.badge', { level: t(DEBUG_LEVEL_TEXT[now][0]) }) : null);
    setAttr(this.back, 'title', t('debug.back'));
    setAttr(this.back, 'aria-label', t('debug.back'));
  }
}
