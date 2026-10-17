// night-notice.ts — the one-time notice before the first night (D101; owner, 2026-10-16: « something
// should tell the user that the core has solar panels that will stop producing electricity at
// night »). About one game hour (1.5 game minutes) before a sunset, while the sun is a real share of
// the Core's grid (`SOLAR_SHARE` % of what it has now) and the grid would not hold the night
// (`nightCover`, sim/readouts/night.ts, under « Tenir la nuit »'s 80 %): a card shown, not told — the
// sun going down behind the Crown, the turbine and the coal generator that answer it, two figures
// (the sun's share now, what the night would leave) —, one sentence, the Électricité view's button
// (P) and « Compris ». Once per base (remembered in localStorage); it waits under a full screen or
// while a side panel stands where it goes (top right); it goes by itself at nightfall, the night
// itself saying the rest, or as soon as the base holds the night. Reads the sim, never changes it.
import { DAY_EPOCHS, EPOCH, SOLAR } from '@/sim/constants';
import { el, setAttr, setText } from '@/core/dom';
import { makeStore } from '@/core/store';
import { num } from '@/i18n/format';
import { t } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { nightCover } from '@/sim/readouts/night';
import type { Sim } from '@/sim/state';
import { buildingIcon } from './build-bar';

export interface NightNoticeHost {
  sim(): Sim;
  /** A full screen or the naming modal is up: the notice waits. */
  covered(): boolean;
  /** Is the Électricité view offered yet (the tutorial reveals it with the smelter)? */
  powerView(): boolean;
  /** Open the Électricité view. */
  openPowerView(): void;
}

/**
 * The sun's share of the Core's grid (%) from which its setting is worth a word: the Core's panel
 * gives about 30 % of it in full sun (BAL.hearthSolarKw against hearthCoreKw, D101), less under cloud.
 */
const SOLAR_SHARE = 15;
/** What the night must leave for the notice to stay away (%): « Tenir la nuit »'s target. */
const HOLDS = 80;
/** How long before the sun starts going down it comes (ticks): one game hour of the 24 a day. */
const AHEAD = Math.round((DAY_EPOCHS * EPOCH) / 24);
/** The day's first epoch where the full sun ends (dusk: the SOLAR table's first step down after its peak). */
const DUSK = SOLAR.findIndex((s, i) => i > 0 && s < 1000 && SOLAR[i - 1] === 1000);

const prefs = makeStore<{ version: 1; seen: string[] }>('filon.night.v1', 1, () => ({ version: 1, seen: [] }));
const baseKey = (sim: Sim): string => `${sim.playerSeed}:${sim.foundingEpoch}`;

export class NightNotice {
  readonly root: HTMLElement;
  private readonly share = el('b');
  private readonly cover = el('b');
  private readonly viewBtn: HTMLButtonElement;
  private readonly texts: Array<[HTMLElement, () => string]> = [];
  /** The base it is on show for (null: none). */
  private on: string | null = null;
  /** Shown by `show` (FL, the screenshots): it stays whatever the night's share. */
  private forced = false;

  constructor(atlas: Atlas, private readonly host: NightNoticeHost) {
    const txt = <E extends HTMLElement>(node: E, f: () => string): E => { this.texts.push([node, f]); return node; };
    this.viewBtn = el<'button'>('button.btn.nn-view', { type: 'button', 'data-night-view': '', onclick: () => { this.host.openPowerView(); this.close(); } });
    txt(this.viewBtn, () => t('night.view'));
    this.root = el('aside.nnotice.cartouche', { 'data-screen': 'night', hidden: true }, [
      el('div.nn-art', {}, [sunset(), el('span.nn-arrow', {}, '→'), buildingIcon(atlas, 'wind_flower', 34), buildingIcon(atlas, 'brazier', 30)]),
      el('div.nn-body', {}, [
        txt(el('h3.nn-title.lettering'), () => t('night.title')),
        txt(el('p.nn-text'), () => t('night.text')),
        el('div.nn-figs', {}, [el('span.nn-fig', {}, [this.share]), el('span.nn-fig', { 'data-k': 'night' }, [this.cover])]),
        el('div.nn-actions', {}, [this.viewBtn, txt(el('button.btn.primary', { type: 'button', 'data-night-ok': '', onclick: () => this.close() }), () => t('night.ok'))]),
      ]),
    ]);
  }

  /** Is it on show (FL / the smoke)? */
  get shown(): boolean { return !this.root.hasAttribute('hidden'); }

  /** Show it now on this base, whatever the hour (`FL.nightNotice`, the screenshots). */
  show(): void {
    this.forced = true;
    this.on = baseKey(this.host.sim());
    this.paint(this.host.sim());
  }

  /** 4 Hz. */
  refresh(): void {
    const sim = this.host.sim();
    const key = baseKey(sim);
    if (this.on && this.on !== key) this.on = null; // another base was loaded
    const phase = (((sim.absEpoch() % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS) * EPOCH + (sim.tick % EPOCH);
    const night = SOLAR[Math.floor(phase / EPOCH)] === 0;
    if (this.on) {
      // Nightfall says the rest; a base that now holds the night needs it no more.
      const held = (nightCover(sim)?.pct ?? 0) >= HOLDS;
      if (night || (held && !this.forced)) this.close();
      else this.paint(sim);
      return;
    }
    if (DUSK < 0 || this.host.covered() || prefs.load().seen.includes(key)) return;
    const soon = phase >= DUSK * EPOCH - AHEAD && phase < DUSK * EPOCH;
    if (!soon) return;
    const c = nightCover(sim);
    if (!c || c.demand <= 0 || c.pct >= HOLDS) return;
    const have = c.now + c.fuel;
    if (have <= 0 || c.solar * 100 < SOLAR_SHARE * have) return;
    this.on = key;
    this.paint(sim);
  }

  private paint(sim: Sim): void {
    for (const [node, f] of this.texts) setText(node, f());
    const c = nightCover(sim);
    const have = c ? c.now + c.fuel : 0;
    setText(this.share, t('night.share', { pct: num(have > 0 && c ? Math.round((c.solar * 100) / have) : 0) }));
    setText(this.cover, t('night.cover', { pct: num(c?.pct ?? 0) }));
    setAttr(this.viewBtn, 'hidden', this.host.powerView() ? null : '');
    // It waits, still on, while a side panel stands where it goes (the play-through bot: it covered
    // the inspector's recipe buttons) or a full screen is up.
    setAttr(this.root, 'hidden', this.host.covered() || sidePanel() ? '' : null);
  }

  private close(): void {
    const sim = this.host.sim(), key = this.on ?? baseKey(sim);
    const p = prefs.load();
    if (!p.seen.includes(key)) prefs.save({ version: 1, seen: [...p.seen, key].slice(-24) });
    this.on = null;
    this.forced = false;
    setAttr(this.root, 'hidden', '');
  }
}

/** A side panel on show at the right (the inspector, a view's card, the land panel): the notice waits. */
const sidePanel = (): boolean => !!document.querySelector('[data-screen="inspector"]:not([hidden]), [data-screen="view"]:not([hidden]), [data-screen="land"]:not([hidden])');

/** The sun going down behind the Crown: a half disc on a ridge line, three rays (inline SVG, inked). */
function sunset(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 28');
  svg.setAttribute('class', 'nn-sun');
  const add = (tag: string, attrs: Record<string, string>): void => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  };
  add('path', { class: 'nn-disc', d: 'M9 20a11 11 0 0 1 22 0z' });
  add('path', { class: 'nn-ray', d: 'M20 4v4M8.5 8.5l2.8 2.8M31.5 8.5l-2.8 2.8' });
  add('path', { class: 'nn-ridge', d: 'M1 21l7-4 6 3 6-5 7 4 5-3 7 5' });
  add('path', { class: 'nn-ground', d: 'M1 24h38' });
  return svg;
}
