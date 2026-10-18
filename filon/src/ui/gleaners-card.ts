// gleaners-card.ts — the Gleaners' two cards (D103), shown, not told: the night they first strike on a
// base, a card introduces them — one of them drawn, the fence and the glazed ribbon that keep them
// off, what they took so far, two sentences in the lore's voice, the Logistique view's button (F)
// and « Compris »; then at each dawn after a night they took something, the morning report: what
// went, each item by its glyph and a count, one sentence, the same two buttons, gone by itself after
// a while. The first card is shown once per base (remembered in localStorage, like the night notice);
// either card waits while a full screen or a side panel stands where it goes (top right). Fed by the
// sim's `gleaners` events (app/sim-events.ts); reads the sim, never changes it.
import { el, setAttr, setText } from '@/core/dom';
import { makeStore } from '@/core/store';
import { num } from '@/i18n/format';
import { locale, t } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { GLEANER_H, GLEANER_HAND, GLEANER_W, RISEN_LIFT, drawGleanerRisen } from '@/render/art/recipes/gleaners';
import type { Sim } from '@/sim/state';
import { buildingIcon, itemIcon } from './build-bar';
import { itemRef } from './mention';
import './styles/gleaners.css';

export interface GleanCardHost {
  sim(): Sim;
  /** A full screen or the naming modal is up: the card waits. */
  covered(): boolean;
  /** Open the Logistique view (its exposure marks). */
  openView(): void;
}

/** How long the morning report stays on show by itself (ms of it being visible). */
const DAWN_MS = 25_000;
/** At most this many items on a card (the most taken first). */
const CHIPS = 6;

const prefs = makeStore<{ version: 1; met: string[] }>('filon.gleaners.v1', 1, () => ({ version: 1, met: [] }));
const baseKey = (sim: Sim): string => `${sim.playerSeed}:${sim.foundingEpoch}`;

/** A Gleaner, risen out of the sand to its shoulders (carrying something up, or not). */
function figure(carry: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = GLEANER_W * 2; cv.height = GLEANER_H * 2;
  cv.style.width = `${GLEANER_W}px`; cv.style.height = `${GLEANER_H}px`;
  const g = cv.getContext('2d')!;
  g.scale(2, 2);
  g.lineJoin = 'round'; g.lineCap = 'round';
  drawGleanerRisen(g, carry);
  if (carry) {
    // What it took, a small glint over its hand.
    const [hx, hy] = GLEANER_HAND;
    g.fillStyle = 'rgba(255, 246, 210, 0.9)';
    g.beginPath(); g.arc(hx, hy + RISEN_LIFT, 3.4, 0, Math.PI * 2); g.fill();
  }
  return cv;
}

export class GleanCard {
  readonly root: HTMLElement;
  private readonly title = el('h3.nn-title.lettering');
  private readonly text = el('p.nn-text');
  private readonly chips = el('div.gn-chips');
  private readonly art: HTMLElement;
  private readonly guards: HTMLElement;
  private readonly viewBtn: HTMLButtonElement;
  private readonly okBtn: HTMLButtonElement;
  /** What is on show: the first strike, or a morning's report (null: nothing). */
  private on: { what: 'night' | 'dawn'; taken: Array<[number, number]>; base: string } | null = null;
  /** How long the morning report has been visible (ms). */
  private shownMs = 0;
  private last = 0;

  constructor(private readonly atlas: Atlas, private readonly host: GleanCardHost) {
    this.viewBtn = el<'button'>('button.btn.nn-view', { type: 'button', 'data-gleaners-view': '', onclick: () => { this.host.openView(); this.close(); } });
    this.okBtn = el<'button'>('button.btn.primary', { type: 'button', 'data-gleaners-ok': '', onclick: () => this.close() });
    this.guards = el('div.gn-guards', {}, [buildingIcon(atlas, 'fence', 30), buildingIcon(atlas, 'glazed_ribbon', 30)]);
    this.art = el('div.gn-art', {}, [figure(false), this.guards]);
    this.root = el('aside.nnotice.gnotice.cartouche', { 'data-screen': 'gleaners', hidden: true }, [
      this.art,
      el('div.nn-body', {}, [this.title, this.text, this.chips, el('div.nn-actions', {}, [this.viewBtn, this.okBtn])]),
    ]);
  }

  /** Is a card on show (FL / the smoke)? Which one? */
  get shown(): 'night' | 'dawn' | null { return this.root.hasAttribute('hidden') ? null : (this.on?.what ?? null); }

  /** The sim's `gleaners` event: the first strike (once per base), or the morning report. */
  event(ev: { what: 'night' | 'dawn'; taken: Array<[number, number]> }): void {
    const sim = this.host.sim(), base = baseKey(sim);
    if (ev.what === 'night') {
      if (prefs.load().met.includes(base)) return;
      const p = prefs.load();
      prefs.save({ version: 1, met: [...p.met, base].slice(-24) });
    }
    this.show(ev.what, ev.taken);
  }

  /** Show a card now (`FL.gleaners`, the screenshots). */
  show(what: 'night' | 'dawn', taken: Array<[number, number]>): void {
    this.on = { what, taken: [...taken].sort((a, b) => b[1] - a[1] || a[0] - b[0]), base: baseKey(this.host.sim()) };
    this.shownMs = 0;
    this.last = performance.now();
    this.paint();
  }

  /** 4 Hz. */
  refresh(): void {
    const now = performance.now(), dt = now - this.last;
    this.last = now;
    if (!this.on) return;
    if (this.on.base !== baseKey(this.host.sim())) { this.close(); return; } // another base was loaded
    const hide = this.host.covered() || sidePanel();
    setAttr(this.root, 'hidden', hide ? '' : null);
    if (hide) return;
    if (this.on.what === 'dawn') {
      this.shownMs += Math.min(dt, 1000);
      if (this.shownMs >= DAWN_MS) this.close();
    }
  }

  private paint(): void {
    const on = this.on;
    if (!on) return;
    const night = on.what === 'night';
    setText(this.title, t(night ? 'glean.title' : 'glean.dawn.title'));
    const list = on.taken.slice(0, CHIPS).map(([item, mu]) => t('glean.item', { n: num(Math.round(mu / 1000)), item: itemRef(item) }));
    setText(this.text, night ? t('glean.text') : t('glean.dawn.text', { list: new Intl.ListFormat(locale(), { type: 'conjunction' }).format(list) }));
    this.chips.replaceChildren(...on.taken.slice(0, CHIPS).map(([item, mu]) =>
      el('span.gn-chip', { 'data-item': String(item) }, [itemIcon(this.atlas, item, 22), el('b', {}, `${num(Math.round(mu / 1000))}`)])));
    setAttr(this.chips, 'hidden', on.taken.length ? null : '');
    this.art.replaceChildren(figure(!night), this.guards);
    setText(this.viewBtn, t('glean.view'));
    setText(this.okBtn, t('glean.ok'));
    setAttr(this.root, 'data-what', on.what);
    setAttr(this.root, 'hidden', this.host.covered() || sidePanel() ? '' : null);
  }

  /** Put the card away (`FL.gleaners({ card: null })`). */
  hide(): void { this.close(); }

  private close(): void {
    this.on = null;
    setAttr(this.root, 'hidden', '');
  }
}

/** A side panel (the inspector, a view's card, the land panel) stands where the card goes (as the night notice's). */
const sidePanel = (): boolean => !!document.querySelector('[data-screen="inspector"]:not([hidden]), [data-screen="view"]:not([hidden]), [data-screen="land"]:not([hidden])');
