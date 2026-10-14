// tip.ts — the build tip that follows the cursor in the plan view: no words but what matter
// while placing (owner, 2026-10-13: "delete those texts when you want to place something") —
// what it costs, as icons and amounts (missing materials in coral), and, when it does not fit,
// why. What the building does is on its card in the tray, before it is in hand. Refused off the
// claim's land (or on a sister claim's, D60), it adds the land mode's key cap. In the land mode it
// shows the hovered parcel's price instead (the claim's flag on a parcel it holds for good).
import { itemDef } from '@/content/registry';
import { el, setAttr } from '@/core/dom';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import type { Preview } from '@/input/tools';
import type { Sim } from '@/sim/state';
import { itemIcon } from './build-bar';
import { glyph } from './glyphs';
import { ownsForGood, parcelState } from './land-facts';
import { oc } from './trade-view';

export class Tip {
  private sig = '';

  constructor(private readonly node: HTMLElement, private readonly atlas: Atlas) {
    node.classList.add('tip', 'cartouche');
  }

  hide(): void {
    if (this.sig !== '') { this.sig = ''; this.node.hidden = true; }
  }

  show(sim: Sim, def: string | null, pre: Preview, sx: number, sy: number): void {
    this.node.style.transform = `translate(${Math.round(sx + 18)}px, ${Math.round(sy + 20)}px)`;
    const cost = [...pre.cost].sort((a, b) => a[0] - b[0]);
    const sig = JSON.stringify([def, cost, pre.reason, pre.doomed.length, pre.mark?.n, pre.mark?.clear, locale()]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.node.hidden = false;
    const L = locale();
    const kids: HTMLElement[] = [];
    if (def) {
      kids.push(el('div.tip-cost', {}, cost.length
        ? cost.map(([item, mu]) => el('span.tip-chip', { 'data-poor': sim.stock[item]! < mu ? '' : null, title: itemDef(item).name[L] }, [itemIcon(this.atlas, item, 16), String(Math.ceil(mu / 1000))]))
        : [el('span', {}, t('build.free'))]));
    }
    if (pre.mark) kids.push(el('div.tip-title.lettering', {}, tr(pre.mark.clear ? 'toast.cleared' : 'toast.marked', { n: pre.mark.n })));
    if (pre.reason && pre.reason !== 'ok') kids.push(el('div.tip-why', {}, t(`reason.${pre.reason}` as MsgKey)));
    // Not the claim's land: the way to it, the land mode's key (I).
    if (pre.reason === 'outside_zone' || pre.reason === 'sister_land') kids.push(el('div.tip-key', {}, [el('span.bb-key', {}, 'I'), glyph('parcel'), t('land.keyAct')]));
    this.node.replaceChildren(...kids);
    setAttr(this.node, 'data-bad', pre.reason && pre.reason !== 'ok' ? '' : null);
  }

  /** The land mode: the hovered parcel's price with the ocelle sign, or the claim's flag on land it holds for good. */
  land(sim: Sim, p: number, sx: number, sy: number): void {
    this.node.style.transform = `translate(${Math.round(sx + 18)}px, ${Math.round(sy + 20)}px)`;
    const held = ownsForGood(parcelState(sim, p));
    const cents = held ? 0 : sim.landPrice(p);
    const sig = JSON.stringify(['land', p, held, cents, sim.credits >= cents, locale()]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.node.hidden = false;
    this.node.replaceChildren(el('div.tip-land', { 'data-poor': !held && sim.credits < cents ? '' : null }, held ? [glyph('flag', t('land.legend.held'))] : [glyph('parcel'), oc(cents)]));
    setAttr(this.node, 'data-bad', null);
  }
}
