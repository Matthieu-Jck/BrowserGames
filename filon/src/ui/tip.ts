// tip.ts — the build tip that follows the cursor in the plan view: no words but what matter
// while placing (owner, 2026-10-13: "delete those texts when you want to place something") —
// what it costs, as icons and amounts (missing materials in coral), and, when it does not fit,
// why. What the building does is on its card in the tray, before it is in hand. Refused off the
// claim's land (or on a neighbouring base's, D60, D110), it adds the land mode's key cap; a ribbon facing a
// step (D77), the traction ribbon that takes it, its key in the tray (or the tree's, T, while it is
// still to learn). In the land mode it shows the hovered parcel's price instead (the claim's flag
// on a parcel it holds for good). A turbine in hand once the Anémométrie plan is learnt (D95):
// the wind mark, a bar of what it would give over the next day against its rating, and that in
// kW (the words — the wind's factor here — in its tooltip). A drag that buries pieces off the
// claim's land (D109): the camouflaged ribbon's icon, how many, and whose land; a ribbon refused on a
// neighbouring base's land, the camouflaged ribbon that would take it (T, the tree, while it is still to learn).
// Refused at a junction's deck end (D158): the junction, its deck coming down, the ribbon it takes there.
// A blueprint in hand or an upgrade box (D154): the whole's cost against the Core (coral where it
// lacks, and then nothing is laid), and its pieces as three counts — to lay, already there, refused.
// It stays inside the window (D96: `tipPlace` flips it to the pointer's other side near an edge)
// and, under a finger, sits above it, where the hand does not cover it.
import { BUILDING_KIND, buildingDef, buildingIdx, itemDef, itemIdx } from '@/content/registry';
import { el, setAttr } from '@/core/dom';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import type { GhostPiece, Preview } from '@/input/tools';
import { viewIconCanvas } from '@/render/art/view-icons';
import { C } from '@/render/art/tokens';
import { num } from '@/i18n/format';
import { windOutlook } from '@/sim/readouts/wind';
import type { Sim } from '@/sim/state';
import { analyticsOn } from './analytics';
import { buildingIcon, itemIcon, unlockedTray } from './build-bar';
import { glyph } from './glyphs';
import { ownsForGood, parcelState } from './land-facts';
import { compact as compactNum } from './stock-panel';
import { oc } from './trade-view';

/** Under a finger the tip goes above the touch point (D96). */
const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;

/**
 * Where the tip's top-left goes for a pointer at (sx, sy) (D96): below-right of a cursor, above a
 * finger; flipped to the other side when that side lacks room, and kept 8 px inside the window.
 */
export function tipPlace(sx: number, sy: number, tw: number, th: number, W: number, H: number, touch: boolean): [number, number] {
  let x = sx + 18;
  let y = touch ? sy - th - 36 : sy + 20;
  if (x + tw > W - 8) x = sx - tw - 18;
  if (!touch && y + th > H - 8) y = sy - th - 14;
  if (touch && y < 8) y = sy + 44;
  return [Math.round(Math.max(8, Math.min(W - tw - 8, x))), Math.round(Math.max(8, Math.min(H - th - 8, y)))];
}

export class Tip {
  private sig = '';
  /** Its size, measured when its content changes (`tipPlace` keeps it inside the window). */
  private size: [number, number] = [0, 0];
  /** A turbine in hand (D95): what it would give where the ghost stands, kept per spot and epoch. */
  private wind: { key: string; mean: number; overall: number; full: number } | null = null;

  constructor(private readonly node: HTMLElement, private readonly atlas: Atlas) {
    node.classList.add('tip', 'cartouche');
  }

  hide(): void {
    if (this.sig !== '') { this.sig = ''; this.node.hidden = true; }
  }

  show(sim: Sim, def: string | null, pre: Preview, sx: number, sy: number): void {
    this.place(sx, sy);
    const cost = [...pre.cost].sort((a, b) => a[0] - b[0]);
    const lift = pre.reason === 'needs_lift' ? liftKey(sim) : null;
    // Refused on a neighbouring base's land with no camouflaged ribbon to bury it yet (D109): point to it.
    const camo = pre.reason === 'neighbour_land' && def && BUILDING_KIND[buildingIdx(def)] === 'belt' && !sim.unlocked(buildingDef(buildingIdx(CAMO)).unlock);
    const wind = def && pre.pieces[0] && BUILDING_KIND[buildingIdx(def)] === 'wind' && analyticsOn(sim, 'wind') ? this.windOf(sim, def, pre.pieces[0]) : null;
    // What the Heart holds of each cost item, beside the cost (owner, 2026-10-17: « quand le joueur a
    // sélectionné un truc à construire qui coûte des ressources, il faut lui afficher le nombre de
    // ressources qu'il a dans le cœur »): part of the signature, so the chip follows the stock.
    const have = cost.map(([item]) => Math.floor(sim.stock[item]! / 1000));
    const plan = pre.plan;
    const sig = JSON.stringify([def, cost, have, pre.reason, lift, camo, pre.buried, pre.tee, pre.doomed.length, pre.mark?.n, pre.mark?.clear, locale(), wind?.mean, wind?.overall, plan && [plan.n, plan.kept, plan.skipped, plan.gone], pre.area?.k === 'copy' ? pre.area.ids.length : -1]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.node.hidden = false;
    const L = locale();
    const kids: HTMLElement[] = [];
    // The copy tool's box (D154): how many buildings it takes.
    if (pre.area?.k === 'copy') kids.push(el('div.tip-plan', {}, [el('span.tip-n', { 'data-k': 'copy' }, [el('i', {}, '⧉'), el('b', {}, String(pre.area.ids.length))])]));
    // A paste or an upgrade (D154): its pieces — to lay, already standing, refused — before its cost.
    if (plan) {
      kids.push(el('div.tip-plan', { title: t('bp.tip.count', { n: plan.n, kept: plan.kept, skipped: plan.skipped }) }, [
        el('span.tip-n', { 'data-k': 'lay' }, [el('i', {}, '✓'), el('b', {}, String(plan.n))]),
        plan.kept ? el('span.tip-n', { 'data-k': 'kept' }, [el('i', {}, '='), el('b', {}, String(plan.kept))]) : null,
        plan.skipped ? el('span.tip-n', { 'data-k': 'skip' }, [el('i', {}, '✕'), el('b', {}, String(plan.skipped))]) : null,
      ]));
      if (plan.gone) kids.push(el('div.tip-why', {}, tr('bp.tip.gone', { n: plan.gone })));
    }
    if (def || plan) {
      kids.push(el('div.tip-cost', {}, cost.length
        ? cost.map(([item, mu], k) => el('span.tip-chip', { 'data-poor': sim.stock[item]! < mu ? '' : null, title: t('tip.costHave', { item: itemDef(item).name[L], n: num(Math.ceil(mu / 1000)), have: num(have[k]!) }) }, [
          itemIcon(this.atlas, item, 16), el('b', {}, String(Math.ceil(mu / 1000))), el('small.tip-have', {}, `/ ${compactNum(have[k]!)}`),
        ]))
        : [el('span', {}, t('build.free'))]));
    }
    // A turbine in hand with the Anémométrie plan (D95): what it would give here over the next day.
    if (wind) {
      kids.push(el('div.tip-wind', { title: t('build.wind.outlook', { mean: num(wind.mean), f: `×${num(Math.round(wind.overall / 10) / 100)}` }) }, [
        viewIconCanvas('wind', 18),
        el('i.vp-mini-bar', {}, [el('i', { style: `width:${Math.round((100 * wind.mean) / Math.max(1, wind.full))}%` })]),
        el('span', {}, t('insp.kw', { v: num(wind.mean) })),
      ]));
    }
    if (pre.mark) kids.push(el('div.tip-title.lettering', {}, tr(pre.mark.clear ? 'toast.cleared' : 'toast.marked', { n: pre.mark.n })));
    if (pre.reason && pre.reason !== 'ok') kids.push(el('div.tip-why', {}, t(`reason.${pre.reason}` as MsgKey)));
    // A junction's deck end (D158): shown — the junction, its deck coming down onto a ribbon at each end, the ribbon.
    if (pre.reason === 'junction_deck') {
      const say = t('reason.junction_deck');
      kids.push(el('div.tip-key.tip-deck', { title: say, 'aria-label': say }, [buildingIcon(this.atlas, 'crossing', 18), glyph('deckEnds'), buildingIcon(this.atlas, 'ribbon', 18)]));
    }
    // Buried off the claim's land (D109): the piece, how many, whose land — at the price above, no surcharge.
    if (pre.buried) {
      kids.push(el('div.tip-key.tip-buried', {}, [
        buildingIcon(this.atlas, CAMO, 18), el('span', {}, tr('build.buried', { n: pre.buried.n })), glyph('parcel'), el('span', {}, t(`reason.${pre.buried.land}` as MsgKey)),
      ]));
    }
    // A conduit drawn off a pipe's side, or into it (D152): the pipe, the tee's mark (a line parting in
    // two, or two meeting), the water — shown, not told; the words for a screen reader and on hover.
    if (pre.tee && def) {
      const say = t(pre.tee === 'split' ? 'build.tee.split' : 'build.tee.join');
      kids.push(el('div.tip-key.tip-tee', { 'data-tee': pre.tee, title: say, 'aria-label': say }, [buildingIcon(this.atlas, def, 18), teeMark(pre.tee), itemIcon(this.atlas, itemIdx('water'), 16)]));
    }
    // Not the claim's land: the way to it, the land mode's key (I).
    if (pre.reason === 'outside_zone' || pre.reason === 'neighbour_land') kids.push(el('div.tip-key', {}, [el('span.bb-key', {}, 'I'), glyph('parcel'), t('land.keyAct')]));
    if (camo) kids.push(el('div.tip-key.tip-lift', { 'data-locked': '' }, [el('span.bb-key', {}, 'T'), buildingIcon(this.atlas, CAMO, 18), t('tree.hud')]));
    // A step (D77): the piece that takes it, and the key that takes it in hand (the tree's while it is still to learn).
    if (lift !== null) {
      kids.push(el('div.tip-key.tip-lift', { 'data-locked': lift === 'T' ? '' : null }, [
        lift ? el('span.bb-key', {}, lift) : null,
        buildingIcon(this.atlas, LIFT, 18),
        lift === 'T' ? t('tree.hud') : buildingDef(buildingIdx(LIFT)).name[L],
      ]));
    }
    this.node.replaceChildren(...kids);
    setAttr(this.node, 'data-bad', pre.reason && pre.reason !== 'ok' ? '' : null);
    this.measure(sx, sy);
  }

  /** At the pointer, inside the window (D96). */
  private place(sx: number, sy: number): void {
    const [x, y] = tipPlace(sx, sy, this.size[0], this.size[1], window.innerWidth, window.innerHeight, !!coarse?.matches);
    this.node.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** New content: its size, and its place for that size. */
  private measure(sx: number, sy: number): void {
    this.size = [this.node.offsetWidth, this.node.offsetHeight];
    this.place(sx, sy);
  }

  /** What a turbine of `def` would give at the ghost's spot (D95), worked out once per spot and epoch. */
  private windOf(sim: Sim, def: string, p: GhostPiece): { mean: number; overall: number; full: number } {
    const key = `${def}:${p.x},${p.y},${p.rot}:${sim.absEpoch()}`;
    if (this.wind?.key !== key) {
      const o = windOutlook(sim, def, p.x, p.y, p.rot);
      this.wind = { key, mean: o.mean, overall: o.overall, full: o.full };
    }
    return this.wind;
  }

  /** The land mode: the hovered parcel's price with the ocelle sign, or the claim's flag on land it holds for good. */
  land(sim: Sim, p: number, sx: number, sy: number): void {
    this.place(sx, sy);
    const held = ownsForGood(parcelState(sim, p));
    const cents = held ? 0 : sim.landPrice(p);
    const sig = JSON.stringify(['land', p, held, cents, sim.credits >= cents, locale()]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.node.hidden = false;
    this.node.replaceChildren(el('div.tip-land', { 'data-poor': !held && sim.credits < cents ? '' : null }, held ? [glyph('flag', t('land.legend.held'))] : [glyph('parcel'), oc(cents)]));
    setAttr(this.node, 'data-bad', null);
    this.measure(sx, sy);
  }
}

/** The piece that takes a ribbon up or down a step (D45). */
const LIFT = 'traction_ribbon';

/** A tee's mark for the tip (D152): a line parting in two (`split`) or two meeting in one (`join`), in the water's teal, its valve's brass hub. */
function teeMark(k: 'split' | 'join'): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'tip-tee-mark');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', k === 'split' ? 'M1.5 8H8M8 8l5.6-4.6M8 8l5.6 4.6M10.8 3.1l2.9.2-.4 2.8M10.8 12.9l2.9-.2-.4-2.8' : 'M2.4 3.4L8 8M2.4 12.6L8 8M8 8h6.4M12.2 5.7L14.5 8l-2.3 2.3');
  for (const [a, v] of [['fill', 'none'], ['stroke', C.deepD], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']] as const) path.setAttribute(a, v);
  const hub = document.createElementNS(NS, 'circle');
  for (const [a, v] of [['cx', '8'], ['cy', '8'], ['r', '2.1'], ['fill', C.brass], ['stroke', C.ink], ['stroke-width', '0.8']] as const) hub.setAttribute(a, v);
  svg.append(path, hub);
  return svg;
}
/** The piece buried where the land refuses the others (D109). */
const CAMO = 'camo_ribbon';

/**
 * The key that takes the traction ribbon in hand: its digit in the logistics tray (the ribbon in
 * hand keeps that tray open; '' past the tenth slot), or T, the tree, while it is still to learn.
 */
function liftKey(sim: Sim): string {
  if (!sim.unlocked(buildingDef(buildingIdx(LIFT)).unlock)) return 'T';
  const i = unlockedTray(sim, 'logistics').indexOf(LIFT);
  return i >= 0 && i < 10 ? String((i + 1) % 10) : '';
}
