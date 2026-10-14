// land-panel.ts — the land mode's card (D60, docs/land.md; owner, 2026-10-14: "you have to either
// buy or rent square parcels… The price should vary depending on what's on it"). It sits where
// the inspector does while the land mode is on. With no parcel picked it is a legend of the
// overlay — the same marks as on the map, one word each — and a one-line hint. With one picked it
// shows rather than tells (owner, D53): a little map of the parcel's 16 × 16 tiles, its name on
// the map (a compass offset from the Heart), who holds it (an owner's flag and the name: the
// claim, a sister claim, CrierBelt) and how (a tag), what it holds as glyphs and tile counts (each
// ore's icon, rock, water, salt flats, vents, the dune sea, the fog over what is not explored yet,
// the buildings on it), then the price
// with the ocelle sign and « Acheter », the rent an hour and « Louer » (Land Registry first), or on
// a leased parcel its hour as a bar and « Rendre le bail ». A button the colony would refuse is
// disabled, with its reason in a few words under it. Built with `el()`; refreshed at 4 Hz with
// change-only writes; the parcel's part is rebuilt only when its signature (parcel, holder,
// contents, language) changes. Buying and leasing go through the Sim's commands; what they did is
// told by the sim's `land` event (app/sim-events.ts).
import { BAL } from '@/content/balance';
import { ITEM_IDS, itemDef } from '@/content/registry';
import { nodeName } from '@/content/research';
import { el, setAttr, setText, setStyle } from '@/core/dom';
import { duration, num } from '@/i18n/format';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { C } from '@/render/art/tokens';
import { TICK_MS } from '@/sim/constants';
import { footprint } from '@/sim/entities';
import type { Sim } from '@/sim/state';
import { canLease, LEASE_TICKS, type LandRefusal } from '@/sim/systems/land';
import { parcelRect } from '@/sim/world/land';
import { glyph, type GlyphId } from './glyphs';
import { itemMention } from './mention';
import { buildingsOn, contentsSig, ownsForGood, parcelContents, parcelLabel, parcelState, sisterName, type ParcelState } from './land-facts';
import { oc } from './trade-view';

export interface LandHost {
  sim(): Sim;
  /** Is the land mode on? The panel shows only then. */
  active(): boolean;
  /** The parcel picked (−1: none). */
  selected(): number;
  /** Put the land mode away (✕). */
  close(): void;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
}

/** A terrain tile's colour on the parcel's little map (the ground's palette: art/tokens.ts). */
const TERRAIN_COL: readonly string[] = [
  C.cirque, C.hardpan, C.rock1, C.rock2, C.rock3, C.rock4, C.shallow, C.deep, C.salt, C.vent, C.duneSea, C.dug, C.filled,
];
/** The map's size: pixels a tile (CSS px; drawn at twice that for sharp edges). */
const MAP_PX = 7;

/** What a refusal says under its button. */
function whyText(sim: Sim, r: LandRefusal, short: number): string {
  if (r === 'credits') return t('land.why.credits', { v: oc(short) });
  if (r === 'locked') return t('land.why.locked', { res: nodeName('tr4')[locale()] });
  return t(`land.why.${r}` as MsgKey);
}

export class LandPanel {
  readonly root: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly body = el('div.land-body');
  private readonly title = el('h3.lettering');
  private readonly sub = el('small');
  private sig = '';
  private live: Array<() => void> = [];

  constructor(private readonly host: LandHost) {
    const close = el('button.insp-x', { type: 'button', 'data-land-close': '', onclick: () => host.close() }, '✕');
    this.legend = el('div.land-legend', {}, ([['held', 'land.legend.held'], ['leased', 'land.legend.leased'], ['sister', 'land.legend.sister'], ['free', 'land.legend.free']] as const)
      .map(([k, key]) => el('span.land-key', { 'data-k': k }, [el('i.land-swatch', { 'data-k': k }), el('span', { 'data-label': key })])));
    this.hint = el('p.insp-note.land-hint');
    this.root = el('aside.land.cartouche', { 'data-screen': 'land', hidden: true }, [
      el('header.insp-head.land-head', {}, [glyph('parcel'), el('div', {}, [this.title, this.sub]), close]),
      this.legend,
      this.body,
      this.hint,
    ]);
    setAttr(close, 'title', t('insp.close'));
  }

  /** 4 Hz: shown with the land mode; the parcel's part rebuilt when its signature changes, its figures kept in step. */
  refresh(): void {
    const on = this.host.active();
    setAttr(this.root, 'hidden', on ? null : '');
    if (!on) { this.sig = ''; return; }
    const sim = this.host.sim();
    const p = this.host.selected();
    for (const n of this.legend.querySelectorAll<HTMLElement>('[data-label]')) setText(n, t(n.dataset.label as MsgKey));
    setText(this.hint, t('land.hint'));
    setAttr(this.hint, 'hidden', p >= 0 ? '' : null);
    setText(this.title, t('land.title'));
    setText(this.sub, p >= 0 ? parcelLabel(p) : t('land.tool.tip'));
    const sig = p >= 0 ? `${p}:${parcelState(sim, p)}:${contentsSig(parcelContents(sim, p))}:${locale()}:${sim.colonyName}` : '';
    if (sig !== this.sig) {
      this.sig = sig;
      this.live = [];
      this.body.replaceChildren(...(p >= 0 ? this.build(sim, p) : []));
    }
    for (const f of this.live) f();
  }

  /** The parcel's part: map and holder, what it holds, then the deal. */
  private build(sim: Sim, p: number): HTMLElement[] {
    const st = parcelState(sim, p);
    const c = parcelContents(sim, p);
    return [
      el('div.land-top', {}, [this.map(sim, p), this.holder(sim, p, st)]),
      this.contents(sim, p, c),
      ...this.deal(sim, p, st),
    ];
  }

  /** The parcel's 16 × 16 tiles, drawn in the ground's colours, each deposit tile dotted in its ore's colour. */
  private map(sim: Sim, p: number): HTMLCanvasElement {
    const { x0, y0, x1, y1 } = parcelRect(p);
    const w = x1 - x0, h = y1 - y0, k = MAP_PX * 2;
    const cv = el('canvas.land-map', { width: w * k, height: h * k, 'aria-hidden': 'true' }) as HTMLCanvasElement;
    cv.style.width = `${w * MAP_PX}px`;
    cv.style.height = `${h * MAP_PX}px`;
    const g = cv.getContext('2d');
    if (!g) return cv;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const seen = sim.revealed(x, y); // the fog keeps what it hides, as in the world
        g.fillStyle = seen ? TERRAIN_COL[sim.grid.terrain(x, y)] ?? C.cirque : C.fog;
        g.fillRect((x - x0) * k, (y - y0) * k, k, k);
        const ore = seen ? sim.grid.ore(x, y) : -1;
        if (ore >= 0) {
          const k0 = itemDef(ore).color, col = k0.startsWith('#') ? k0 : (C as Record<string, string>)[k0] ?? C.ink; // a hex or a token
          g.fillStyle = col;
          g.beginPath(); g.arc((x - x0 + 0.5) * k, (y - y0 + 0.5) * k, k * 0.32, 0, Math.PI * 2); g.fill();
          g.strokeStyle = C.ink; g.lineWidth = 1.2; g.stroke();
        }
      }
    }
    // The buildings standing on it, as ink outlines (what a lease given up would stop).
    g.strokeStyle = C.ink; g.lineWidth = 2;
    for (const id of buildingsOn(sim, p)) {
      const e = sim.ents.get(id)!;
      const [bw, bh] = footprint(e.def, e.rot);
      g.strokeRect((e.x - x0) * k + 1, (e.y - y0) * k + 1, bw * k - 2, bh * k - 2);
    }
    g.strokeStyle = C.ink; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w * k - 3, h * k - 3);
    return cv;
  }

  /** Who holds it: an owner's flag and the name (the claim, a sister claim, CrierBelt), and how (a tag). */
  private holder(sim: Sim, p: number, st: ParcelState): HTMLElement {
    const ours = ownsForGood(st) || st === 'leased';
    const sister = st === 'sister' ? sim.land.sister(p) : -1;
    const name = ours ? sim.colonyName || t('land.owner.self') : sister >= 0 ? sisterName(sim, sister) || t('land.state.sister') : t('land.owner.crier');
    const g: GlyphId = ours ? 'flag' : sister >= 0 ? 'flagSister' : 'crier';
    const tag = el('span.land-tag', { 'data-state': st }, t(`land.state.${st}` as MsgKey));
    const who = el('div.land-owner', { title: t('land.owner') }, [glyph(g, t('land.owner')), el('b', {}, name)]);
    // A sister claim sets its own price: its markup on what the parcel holds, as a figure.
    const markup = sister >= 0 ? BAL.land.sisterMarkup[sister % BAL.land.sisterMarkup.length]! / 1000 : 0;
    const m = markup ? el('span.land-markup', { title: t('land.markup', { m: num(markup) }) }, `×${num(markup)}`) : null;
    return el('div.land-who', {}, [who, el('div.land-tags', {}, [tag, m])]);
  }

  /** What it holds: each ore's icon, then the grounds, as glyphs with their tile counts; the buildings on it. */
  private contents(sim: Sim, p: number, c: ReturnType<typeof parcelContents>): HTMLElement {
    const chip = (icon: HTMLElement, n: number, label: string, k: string): HTMLElement =>
      el('span.land-chip', { 'data-k': k, title: `${label} · ${tr('land.tiles', { n })}` }, [icon, el('b', {}, String(n))]);
    const kids: HTMLElement[] = c.ores.map(([i, n]) => chip(itemMention(i, { name: false }), n, itemDef(i).name[locale()], ITEM_IDS[i]!));
    for (const [k, n] of [['rock', c.rock], ['water', c.water], ['salt', c.salt], ['vent', c.vent], ['dunes', c.dunes], ['floor', c.floor], ['fog', c.hidden]] as const) {
      if (n > 0) kids.push(chip(glyph(k), n, t(`land.c.${k}` as MsgKey), k));
    }
    const built = el('b');
    const builtChip = el('span.land-chip', { 'data-k': 'buildings' }, [glyph('building'), built]);
    this.live.push(() => {
      const n = buildingsOn(sim, p).length;
      setText(built, String(n));
      setAttr(builtChip, 'hidden', n ? null : '');
      setAttr(builtChip, 'title', `${t('land.c.buildings')} · ${n}`);
    });
    return el('div.land-holds', { title: t('land.holds') }, [...kids, builtChip]);
  }

  /** The deal: the price and « Acheter »; the rent and « Louer », or a lease's hour and « Rendre le bail ». Held for good: nothing to do. */
  private deal(sim: Sim, p: number, st: ParcelState): HTMLElement[] {
    if (ownsForGood(st)) return [];
    const out: HTMLElement[] = [];
    // Buy (a leased parcel too: its lease ends).
    const price = el('span.land-price');
    const buyWhy = el('p.land-why');
    const buy = el<'button'>('button.btn.primary.land-act', { type: 'button', 'data-land-act': 'buy', onclick: () => { const need = sim.landPrice(p); this.act(sim.buyLand(p), need); } }, [el('span', {}, t('land.buy')), price]);
    this.live.push(() => {
      const cents = sim.landPrice(p);
      setText(price, oc(cents));
      const r: LandRefusal | null = sim.credits < cents ? 'credits' : null;
      setAttr(buy, 'disabled', r ? '' : null);
      setText(buyWhy, r ? whyText(sim, r, cents - sim.credits) : '');
      setAttr(buyWhy, 'hidden', r ? null : '');
    });
    out.push(el('div.land-deal', { 'data-deal': 'buy' }, [el('span.land-deal-label', {}, t('land.price')), buy, buyWhy]));
    if (st === 'leased') {
      // The lease's hour: a bar filling towards the next rent, the rent fixed for its life, and the way out.
      const lease = sim.land.leases.get(p)!;
      const fill = el('span.land-bar-fill');
      const bar = el('span.land-bar', {}, [fill]);
      const rent = el('span.land-price');
      const give = el<'button'>('button.btn.land-act', { type: 'button', 'data-land-act': 'end', onclick: () => this.act(sim.endLease(p), 0) }, [glyph('lease'), el('span', {}, t('land.endLease'))]);
      this.live.push(() => {
        const l = sim.land.leases.get(p) ?? lease;
        const left = Math.max(0, l.next - sim.tick);
        setStyle(fill, 'transform', `scaleX(${(1 - left / LEASE_TICKS).toFixed(3)})`);
        setAttr(bar, 'title', t('land.lease.next', { d: duration((left * TICK_MS) / 1000) }));
        setText(rent, t('land.perHour', { v: oc(l.cents) }));
        setAttr(give, 'title', tr('land.endLease.tip', { n: buildingsOn(sim, p).length }));
      });
      out.push(el('div.land-deal', { 'data-deal': 'lease' }, [el('span.land-deal-label', {}, t('land.rent')), el('div.land-lease', {}, [glyph('lease'), bar, rent]), give]));
      return out;
    }
    // Lease, once Land Registry is learnt.
    const rent = el('span.land-price');
    const leaseWhy = el('p.land-why');
    const lease = el<'button'>('button.btn.land-act', { type: 'button', 'data-land-act': 'lease', onclick: () => { const need = sim.landRent(p); this.act(sim.rentLand(p), need); } }, [el('span', {}, t('land.lease')), rent]);
    this.live.push(() => {
      const cents = sim.landRent(p);
      setText(rent, t('land.perHour', { v: oc(cents) }));
      const r: LandRefusal | null = !canLease(sim) ? 'locked' : sim.credits < cents ? 'credits' : null;
      setAttr(lease, 'disabled', r ? '' : null);
      setText(leaseWhy, r ? whyText(sim, r, cents - sim.credits) : '');
      setAttr(leaseWhy, 'hidden', r ? null : '');
    });
    out.push(el('div.land-deal', { 'data-deal': 'lease' }, [el('span.land-deal-label', {}, t('land.rent')), lease, leaseWhy]));
    return out;
  }

  /** A command's answer: done (the sim's `land` event tells it), or its refusal as a notice; the panel follows at once. */
  private act(r: LandRefusal | null, need: number): void {
    const sim = this.host.sim();
    if (r) this.host.notify('bad', whyText(sim, r, Math.max(0, need - sim.credits)));
    this.sig = '';
    this.refresh();
  }
}
