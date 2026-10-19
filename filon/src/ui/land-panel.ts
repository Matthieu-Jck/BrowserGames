// land-panel.ts — the land mode's card (D60, docs/land.md; owner, 2026-10-14: "you have to either
// buy or rent square parcels… The price should vary depending on what's on it"). It sits where
// the inspector does while the land mode is on. With no parcel picked it is a legend of the
// overlay — the same marks as on the map, one word each — and a one-line hint. With one picked it
// shows rather than tells (owner, D53): a little map of the parcel's 16 × 16 tiles, its name on
// the map (a compass offset from the Heart), who holds it (an owner's flag and the name: the
// claim, a neighbouring base with its emblem and its trade — D110 —, CrierBelt) and how (a tag), what it holds as glyphs and tile counts (each
// ore's icon, rock, water, salt flats, vents, the dune sea, chasms and rivers, the buildings on
// it), its usable floor as a gauge and a share (D94: where a 2 × 2
// machine stands; the price follows it), then the price
// with the ocelle sign and « Acheter », the rent an hour and « Louer » (Land Registry first), or on
// a leased parcel its hour as a bar and « Rendre le bail »; a bought one, « Revendre » and what CrierBelt gives back (D119: the market price less the Cadastre's tax). A button the colony would
// refuse is disabled, with its reason in a few words under it — the sim's own `buyBlock` /
// `leaseBlock` / `sellBlock`, the checks its deeds make. Built with `el()`; refreshed at 4 Hz with
// change-only writes. A neighbouring base's parcel shows its buildings on the map (coral) and no
// deal: it is not for sale (D110). The parcel's part is rebuilt only when its signature (parcel, holder,
// contents, language) changes. Buying and leasing go through the Sim's commands; what they did is
// told by the sim's `land` event (app/sim-events.ts).
import { BAL } from '@/content/balance';
import { COLONY_PROFILES, type ColonyProfile } from '@/content/colonies';
import { colonyEmblem } from '@/content/emblem';
import { ITEM_IDS, itemDef } from '@/content/registry';
import { nodeName } from '@/content/research';
import { el, setAttr, setText, setStyle } from '@/core/dom';
import { duration, pct } from '@/i18n/format';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import { drawEmblem } from '@/render/art/emblem';
import { C } from '@/render/art/tokens';
import { TICK_MS } from '@/sim/constants';
import { footprint } from '@/sim/entities';
import type { Sim } from '@/sim/state';
import { LEASE_TICKS, type LandRefusal } from '@/sim/systems/land';
import { parcelFloor, parcelOre } from '@/sim/world/floor';
import { PARCEL, parcelRect } from '@/sim/world/land';
import { glyph, type GlyphId } from './glyphs';
import { itemMention } from './mention';
import { buildingsOn, contentsSig, neighbourName, neighbourTrade, ownsForGood, parcelContents, parcelLabel, parcelState, type ParcelState } from './land-facts';
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
  C.chasm, C.river,
];
/** The map's size: pixels a tile (CSS px; drawn at twice that for sharp edges), the parcel about 112 px a side whatever its size (D74: 23 tiles). */
const MAP_PX = Math.max(3, Math.round(112 / PARCEL));

/** What a refusal says under its button; `locked` names the research that lifts it (Land Registry unless told). */
function whyText(sim: Sim, r: LandRefusal, short: number, research = 'tr4'): string {
  if (r === 'credits') return t('land.why.credits', { v: oc(short) });
  if (r === 'locked') return t('land.why.locked', { res: nodeName(research)[locale()] });
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
    this.legend = el('div.land-legend', {}, ([['held', 'land.legend.held'], ['leased', 'land.legend.leased'], ['neighbour', 'land.legend.neighbour'], ['free', 'land.legend.free']] as const)
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
    setText(this.title, p >= 0 ? t('land.title') : t('land.tool')); // the Terrain view (D88) until a parcel is picked
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
      this.floor(sim, p),
      this.ore(sim, p),
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
        g.fillStyle = TERRAIN_COL[sim.grid.terrain(x, y)] ?? C.cirque;
        g.fillRect((x - x0) * k, (y - y0) * k, k, k);
        const ore = sim.grid.ore(x, y);
        if (ore >= 0) {
          const k0 = itemDef(ore).color, col = k0.startsWith('#') ? k0 : (C as Record<string, string>)[k0] ?? C.ink; // a hex or a token
          g.fillStyle = col;
          g.beginPath(); g.arc((x - x0 + 0.5) * k, (y - y0 + 0.5) * k, k * 0.32, 0, Math.PI * 2); g.fill();
          g.strokeStyle = C.ink; g.lineWidth = 1.2; g.stroke();
        }
      }
    }
    // A neighbouring base's buildings and ribbons on it (D110), in coral: someone else's.
    const nb = sim.neighbours.holdingOf(p);
    if (nb && sim.land.neighbour(p) >= 0) {
      const L = sim.neighbours.layout(nb), { x0: px0, y0: py0, x1: px1, y1: py1 } = parcelRect(p);
      g.fillStyle = C.coralD;
      for (const r of L.ribbons) for (let i = 0; i < r.tiles.length; i += 3) {
        const x = r.tiles[i]!, y = r.tiles[i + 1]!;
        if (x >= px0 && x < px1 && y >= py0 && y < py1) g.fillRect((x - x0 + 0.3) * k, (y - y0 + 0.3) * k, 0.4 * k, 0.4 * k);
      }
      for (const s of sim.neighbours.structsOn(p)) {
        const [bw, bh] = footprint(s.def, s.rot);
        g.fillStyle = C.coral; g.fillRect((s.x - x0) * k + 1, (s.y - y0) * k + 1, bw * k - 2, bh * k - 2);
        g.strokeStyle = C.ink; g.lineWidth = 2; g.strokeRect((s.x - x0) * k + 1, (s.y - y0) * k + 1, bw * k - 2, bh * k - 2);
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

  /**
   * Who holds it: an owner's flag and the name (the claim, CrierBelt), and how (a tag); a neighbouring
   * base (D110): its emblem, its name (the Crier's colony) and its trade.
   */
  private holder(sim: Sim, p: number, st: ParcelState): HTMLElement {
    const ours = ownsForGood(st) || st === 'leased';
    const colony = st === 'neighbour' ? sim.land.neighbour(p) : -1;
    const tag = el('span.land-tag', { 'data-state': st }, t(`land.state.${st}` as MsgKey));
    if (colony >= 0) {
      const h = sim.neighbours.holdingOf(p)!;
      const badge = el('canvas.land-emblem', { width: 44, height: 44, 'aria-hidden': 'true' }) as HTMLCanvasElement;
      const ctx = badge.getContext('2d');
      if (ctx) drawEmblem(ctx, colonyEmblem(sim.worldSeed, colony), 22, 22, 19, 2.2);
      const name = neighbourName(sim, colony) || t('land.state.neighbour');
      const does = neighbourTrade(sim, h.hub);
      const trade = el('span.land-trade', { title: `${t('land.neighbour.trade')}${does?.lines.length ? `\u00a0: ${does.lines.map((l) => l.names.join(' → ')).join(' · ')}` : ''}` }, does?.label ?? (COLONY_PROFILES[h.profile] as ColonyProfile).name[locale()]);
      return el('div.land-who', { 'data-neighbour': '' }, [
        el('div.land-owner', { title: t('land.owner') }, [badge, el('b', {}, name)]),
        el('div.land-tags', {}, [tag, trade]),
      ]);
    }
    const name = ours ? sim.colonyName || t('land.owner.self') : t('land.owner.crier');
    const g: GlyphId = ours ? 'flag' : 'crier';
    const who = el('div.land-owner', { title: t('land.owner') }, [glyph(g, t('land.owner')), el('b', {}, name)]);
    return el('div.land-who', {}, [who, el('div.land-tags', {}, [tag])]);
  }

  /** What it holds: each ore's icon, then the grounds, as glyphs with their tile counts; the buildings on it. */
  private contents(sim: Sim, p: number, c: ReturnType<typeof parcelContents>): HTMLElement {
    const chip = (icon: HTMLElement, n: number, label: string, k: string): HTMLElement =>
      el('span.land-chip', { 'data-k': k, title: `${label} · ${tr('land.tiles', { n })}` }, [icon, el('b', {}, String(n))]);
    const kids: HTMLElement[] = c.ores.map(([i, n]) => chip(itemMention(i, { name: false }), n, itemDef(i).name[locale()], ITEM_IDS[i]!));
    for (const [k, n] of [['rock', c.rock], ['water', c.water], ['river', c.river], ['chasm', c.chasm], ['salt', c.salt], ['vent', c.vent], ['dunes', c.dunes], ['floor', c.floor]] as const) {
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

  /**
   * Its usable floor (D94, sim/world/floor.ts): a gauge of the share of its tiles where a 2 × 2
   * machine stands on level ground, and the figure — over the whole parcel, as its price reads it.
   * Under a third the gauge turns amber: land cut up by cliffs, chasms or rivers.
   */
  private floor(sim: Sim, p: number): HTMLElement {
    const fill = el('span.land-bar-fill');
    const share = el('b');
    const row = el('div.land-floor', { title: t('land.floor.tip') }, [glyph('floor'), el('span', {}, t('land.floor')), el('span.land-bar', {}, [fill]), share]);
    this.live.push(() => {
      const f = parcelFloor(sim.grid, p);
      setStyle(fill, 'transform', `scaleX(${(f.permille / 1000).toFixed(3)})`);
      setText(share, pct(f.permille / 1000));
      setAttr(row, 'data-low', f.permille < 333 ? '' : null);
    });
    return row;
  }

  /**
   * Its ore (D94: space or ore): three pips filled up to its tier (`parcelOre`: none, a thin blob, a
   * field, a rich one) in the colour of the ore it holds most, and its deposit tiles — the land
   * panel's twin of the Terrain view's pips.
   */
  private ore(sim: Sim, p: number): HTMLElement {
    const pips = [0, 1, 2].map(() => el('i.land-pip'));
    const tiles = el('b');
    const row = el('div.land-ore', { title: t('land.ore.tip') }, [glyph('ore'), el('span', {}, t('land.ore')), el('span.land-pips', {}, pips), tiles]);
    this.live.push(() => {
      const o = parcelOre(sim.grid, p);
      const col = o.item >= 0 ? itemDef(o.item).color : '';
      pips.forEach((n, k) => {
        setAttr(n, 'data-on', k < o.tier ? '' : null);
        setStyle(n, '--pip', col.startsWith('#') ? col : col ? ((C as Record<string, string>)[col] ?? C.ink) : '');
      });
      setText(tiles, String(o.tiles));
    });
    return row;
  }

  /**
   * The deal: the price and « Acheter »; the rent and « Louer », or a lease's hour and « Rendre le
   * bail ». Held for good: nothing to do, but a bought parcel sells back at any time (D119).
   */
  private deal(sim: Sim, p: number, st: ParcelState): HTMLElement[] {
    if (st === 'bought') return [this.resale(sim, p)];
    if (ownsForGood(st)) return [];
    // A neighbouring base's (D110): not for sale nor lease; what treaties allow.
    if (st === 'neighbour') return [el('p.land-why.land-note', { 'data-deal': 'neighbour' }, t('land.neighbour.note'))];
    const out: HTMLElement[] = [];
    // Buy (a leased parcel too: its lease ends).
    const price = el('span.land-price');
    const buyWhy = el('p.land-why');
    const buy = el<'button'>('button.btn.primary.land-act', { type: 'button', 'data-land-act': 'buy', onclick: () => { const need = sim.landPrice(p); this.act(sim.buyLand(p), need); } }, [el('span', {}, t('land.buy')), price]);
    this.live.push(() => {
      const cents = sim.landPrice(p);
      setText(price, oc(cents));
      const r = sim.buyBlock(p);
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
      const r = sim.leaseBlock(p);
      setAttr(lease, 'disabled', r ? '' : null);
      setText(leaseWhy, r ? whyText(sim, r, cents - sim.credits) : '');
      setAttr(leaseWhy, 'hidden', r ? null : '');
    });
    out.push(el('div.land-deal', { 'data-deal': 'lease' }, [el('span.land-deal-label', {}, t('land.rent')), lease, leaseWhy]));
    return out;
  }

  /** « Revendre » (D119): what CrierBelt gives back — the market price less the Cadastre's tax — and what would stop on it. */
  private resale(sim: Sim, p: number): HTMLElement {
    const price = el('span.land-price');
    const why = el('p.land-why');
    const note = el('span.land-price-note', { 'data-k': 'resale-note' });
    const sell = el<'button'>('button.btn.land-act', { type: 'button', 'data-land-act': 'sell', onclick: () => this.act(sim.sellLand(p), 0) }, [el('span', {}, t('land.sell')), price]);
    this.live.push(() => {
      const tax = pct(BAL.landResaleTax / 1000);
      setText(price, oc(sim.resalePrice(p)));
      setText(note, tr('land.sell.note', { mkt: oc(sim.marketPrice(p)), pct: tax }));
      setAttr(sell, 'title', tr('land.sell.tip', { pct: tax, n: buildingsOn(sim, p).length }));
      const r = sim.sellBlock(p);
      setAttr(sell, 'disabled', r ? '' : null);
      setText(why, r ? whyText(sim, r, 0) : '');
      setAttr(why, 'hidden', r ? null : '');
    });
    return el('div.land-deal', { 'data-deal': 'sell' }, [el('span.land-deal-label', {}, t('land.resale')), sell, note, why]);
  }

  /** A command's answer: done (the sim's `land` event tells it), or its refusal as a notice; the panel follows at once. */
  private act(r: LandRefusal | null, need: number, research?: string): void {
    const sim = this.host.sim();
    if (r) this.host.notify('bad', whyText(sim, r, Math.max(0, need - sim.credits), research));
    this.sig = '';
    this.refresh();
  }
}
