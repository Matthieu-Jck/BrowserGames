// neighbour-card.ts — a neighbouring base's card (D110; owner, 2026-10-17: clicking its Core, or
// anything of it, shows the base). A click with nothing in hand on one of its pieces — its Core, its
// buildings, its ribbons, its dress — pops a small cartouche beside the pointer: its emblem and its
// name (the Crier's colony), « Base voisine » and its trade, and what that means for the claim (not
// for sale; Neighbour Treaties let its ribbons through between its buildings). It stays while the
// pointer stays near (a tap's slop, wider for a mouse), and goes with the next click elsewhere. Built
// with `el()`, the deposit card's look (styles/neighbour-card.css); it catches no pointer and stays
// inside the window (`tipPlace`, D96).
import { COLONY_PROFILES, type ColonyProfile } from '@/content/colonies';
import { colonyEmblem } from '@/content/emblem';
import { el } from '@/core/dom';
import { locale, t } from '@/i18n/i18n';
import { drawEmblem } from '@/render/art/emblem';
import type { Sim } from '@/sim/state';
import { neighbourName } from './land-facts';
import { tipPlace } from './tip';
import './styles/neighbour-card.css';

/** Screen px the pointer may wander from where it clicked before the card goes. */
const SLOP = 90;

const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;

export class NeighbourCard {
  readonly root = el('div.ncard.cartouche', { hidden: true, role: 'tooltip', 'data-neighbour-card': '' });
  private at: { hub: number; sx: number; sy: number } | null = null;
  private sig = '';
  private size: [number, number] = [0, 0];
  private zoom = 1;

  /** Is the card up, and for which base (its hub parcel; −1: none)? */
  get hub(): number { return this.at?.hub ?? -1; }

  /** A click on a base's piece: its card, beside the pointer. */
  show(sim: Sim, hub: number, sx: number, sy: number): void {
    const h = sim.neighbours.holdingOf(hub);
    if (!h) { this.hide(); return; }
    this.at = { hub: h.hub, sx, sy };
    const sig = `${h.hub}:${locale()}`;
    if (sig !== this.sig) {
      this.sig = sig;
      const badge = el('canvas.ncard-emblem', { width: 64, height: 64, 'aria-hidden': 'true' }) as HTMLCanvasElement;
      const ctx = badge.getContext('2d');
      if (ctx) drawEmblem(ctx, colonyEmblem(sim.worldSeed, h.colony), 32, 32, 27, 3);
      this.root.replaceChildren(
        el('div.ncard-head', {}, [badge, el('div', {}, [el('span.ncard-name.lettering', {}, neighbourName(sim, h.colony) || t('land.state.neighbour')), el('span.ncard-tag', {}, t('land.state.neighbour'))])]),
        el('div.ncard-trade', {}, [el('span', {}, t('land.neighbour.trade')), el('b', {}, (COLONY_PROFILES[h.profile] as ColonyProfile).name[locale()])]),
        el('p.ncard-note', {}, t('land.neighbour.note')),
      );
      this.root.hidden = false;
      this.size = [this.root.offsetWidth, this.root.offsetHeight];
      this.zoom = this.size[0] > 0 ? this.root.getBoundingClientRect().width / this.size[0] : 1;
    }
    this.root.hidden = false;
    this.place(sx, sy);
  }

  /** Each frame, the pointer: the card goes once it wanders off. */
  update(sx: number, sy: number): void {
    if (this.at && (Math.abs(sx - this.at.sx) > SLOP || Math.abs(sy - this.at.sy) > SLOP)) this.hide();
  }

  hide(): void {
    this.at = null;
    if (!this.root.hidden) this.root.hidden = true;
  }

  private place(sx: number, sy: number): void {
    const zoom = this.zoom;
    const [x, y] = tipPlace(sx, sy, this.size[0] * zoom, this.size[1] * zoom, window.innerWidth, window.innerHeight, !!coarse?.matches);
    this.root.style.left = `${Math.round(x / zoom)}px`;
    this.root.style.top = `${Math.round(y / zoom)}px`;
  }
}
