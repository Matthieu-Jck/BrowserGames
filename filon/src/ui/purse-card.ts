// purse-card.ts — what the purse's « ◉/h » is made of (D102; owner, 2026-10-16: « Il faut que les
// ventes, achats etc. soient beaucoup plus clairs, et que le chiffre soit réel… Pareil pour les
// tokens, ce n'est pas clair »). A click on the HUD's purse (a rest of a mouse on it) opens this
// card, built from the panels' kit (D89):
//   · the headline — the purse's real recurring change an hour, over the last hour (or the minutes
//     seen so far: ui/purse-facts.ts reads the engine's journal) — turquoise or coral, with a
//     sparkline of the purse over the last hours and the biggest drain named;
//   · a section per trade post: each item it sold (its icon, « 12/min », a bar, « +8,4 k ◉/h »,
//     after CrierBelt's fee) and each standing order (« 30/min », its cost now at today's price);
//     « other trade » when the ledger no longer holds a minute's lines;
//   · « Vente automatique »: what the Core sold of its surplus at the minutes' ends (D127), item by
//     item, « 12/min » and the ◉/h after CrierBelt's 40 %;
//   · « Recherche »: the AI tokens bought — « 1 600/min · 13 ◉/min » and the share research got
//     free (D122: the Core's compute, the servers, the bank) as a chip with the Core's look (a line
//     of words on first sight, then the icons alone) —, the Compute Plan's fee, the servers' rental;
//     « Terres »: the leases' rent;
//   · the same minutes' one-offs apart, in a muted line: never in the headline;
//   · « Ouvrir la Criée ».
// Every line's ◉/h adds up to the headline. A click on a line goes where it is managed
// (`PurseHost.go`). The HUD owns it; the shell puts the root in #ui, under the purse, or a bottom
// sheet on a narrow window (responsive.css, ui/sheet.ts).
import { el, setAttr, setStyle, setText } from '@/core/dom';
import { makeStore } from '@/core/store';
import { locale, t, type MsgKey } from '@/i18n/i18n';
import { num } from '@/i18n/format';
import type { Atlas } from '@/render/art/atlas';
import type { Sim } from '@/sim/state';
import type { PurseKind } from '@/sim/purse';
import { buildingIcon, itemIcon } from './build-bar';
import { glyph } from './glyphs';
import { itemName, lang, mark, section, stat } from './inspector/kit';
import { parcelLabel } from './land-facts';
import { compact } from './stock-panel';
import type { FlowLine, PurseSummary } from './purse-facts';
import { oc } from './trade-view';
import './styles/purse.css';

export interface PurseHost {
  sim(): Sim;
  /** The summary the HUD keeps (sampled once a game minute). */
  summary(): PurseSummary;
  /** Go where a flow is managed (the shell: the Crier's order or post, the tree, the parcel). */
  go(f: FlowLine): void;
  /** The Crier (absent: no « Ouvrir la Criée »). */
  openCrier?(): void;
  close(): void;
}

/** Whether this viewer has read the tokens' line of words (D102: the words once, then the icons). */
const tokensSeen = makeStore<{ version: 1; seen: boolean }>('filon.tokens.seen.v1', 1, () => ({ version: 1, seen: false }));

/** « +1 450 ◉/h », « −2 250 ◉/h »: whole ocelles an hour, compact past ten thousand. */
export function perHour(cents: number): string {
  const v = Math.round(cents / 100);
  return t('purse.perHour', { v: `${v > 0 ? '+' : v < 0 ? '−' : ''}${compact(Math.abs(v))}` });
}

/** A rate a minute, short: « 12/min », « 1,6 k/min », « 0,4/min ». */
export const rateMin = (v: number): string => t('hud.perMin', { v: v >= 10 ? compact(v) : num(Math.round(v * 10) / 10) });

/** What a line is, in words (its name; the detail goes under it). */
export function flowName(f: FlowLine): string {
  switch (f.kind) {
    case 'sale': return itemName(f.item!);
    case 'order': return t('purse.order', { item: itemName(f.item!) });
    case 'trade': return t('purse.trade');
    case 'auto': return itemName(f.item!);
    case 'tokens': return t('purse.tokens');
    case 'fee': return t('purse.plan');
    case 'rental': return t('purse.rental');
    case 'rent': return t('purse.rent', { n: f.parcels?.length ?? 0 });
  }
}

/** A one-off, in words. */
const oneOffName = (k: PurseKind): string => t(`purse.once.${k}` as MsgKey);

interface Line { node: HTMLButtonElement; fill: HTMLElement; value: HTMLElement; detail: HTMLElement; chip: HTMLElement | null }

export class PurseCard {
  readonly root: HTMLElement;
  private readonly total = el('b');
  private readonly window = el('small.purse-window');
  private readonly spark = el('span.purse-spark', { 'aria-hidden': 'true' });
  private readonly drain = el('p.purse-drain');
  private readonly wait = el('p.insp-note.purse-empty');
  private readonly body = el('div.purse-body');
  private readonly once = el('div.purse-once');
  private lines: Line[] = [];
  private sig = '';
  private onceSig = '';
  private sparkSig = '';
  private explained = false;

  constructor(private readonly atlas: Atlas, private readonly host: PurseHost) {
    const x = el('button.insp-x', { type: 'button', 'data-purse-close': '', onclick: () => host.close() }, '✕');
    lang(x, () => t('insp.close'), 'title');
    lang(x, () => t('insp.close'), 'aria-label');
    const crier = host.openCrier
      ? lang(el<'button'>('button.btn.purse-crier', { type: 'button', 'data-hud-crier': '', onclick: () => host.openCrier?.() }), () => t('purse.crier'))
      : null;
    this.root = el('aside.purse.cartouche', { 'data-screen': 'purse', hidden: true }, [
      el('header.insp-head.purse-head', {}, [
        el('span.purse-coin', {}, '◉'),
        el('div.insp-titles', {}, [lang(el('h3.lettering'), () => t('purse.title')), lang(el('small'), () => t('purse.sub'))]),
        x,
      ]),
      el('div.purse-top', {}, [el('div.purse-headline', {}, [stat(this.total, ''), this.spark]), this.window, this.drain]),
      this.wait,
      this.body,
      this.once,
      crier ? el('div.kfoot.purse-foot', {}, [crier]) : null,
    ]);
    lang(this.root.querySelector('.kstat-cap')!, () => t('purse.totalCap'));
  }

  get open(): boolean { return !this.root.hasAttribute('hidden'); }

  show(on: boolean): void {
    // The tokens' words were read: from the next opening, the icons alone.
    if (!on && this.open && this.explained) tokensSeen.save({ version: 1, seen: true });
    if (on && !this.open) this.sig = ''; // rebuilt on opening (the words may go)
    setAttr(this.root, 'hidden', on ? null : '');
  }

  private icon(f: FlowLine): Node | null {
    switch (f.kind) {
      case 'sale': case 'order': case 'auto': return itemIcon(this.atlas, f.item!, 22);
      case 'trade': return buildingIcon(this.atlas, 'trade_post', 22);
      case 'tokens': case 'fee': return mark('token');
      case 'rental': return buildingIcon(this.atlas, 'server', 22);
      case 'rent': return glyph('lease');
    }
  }

  /** A line: icon, name over its detail, a bar, the ◉/h; a button to where it is managed. */
  private line(f: FlowLine): Line {
    const fill = el('i.purse-fill'), value = el('b.purse-v'), detail = el('small.purse-detail');
    // The free share (D122): the Core's compute, the servers and the bank, under the Core's look.
    const chip = f.kind === 'tokens' ? el('span.purse-chip', { 'data-purse-free': '' }, [buildingIcon(this.atlas, 'hearth', 14, this.host.sim().hearthLevel), el('b')]) : null;
    const node = el<'button'>('button.purse-line', { type: 'button', 'data-flow': f.kind, 'data-sign': f.perHour > 0 ? '+' : '-', onclick: () => this.host.go(f) }, [
      el('span.purse-icon', {}, this.icon(f)),
      el('span.purse-label', {}, [el('span.purse-name', {}, flowName(f)), el('span.purse-sub', {}, [detail, chip])]),
      el('span.purse-bar', {}, [fill]),
      value,
    ]);
    return { node, fill, value, detail, chip };
  }

  /** 4 Hz while open: the sections (rebuilt when the lines' list changes), their figures. */
  refresh(): void {
    if (!this.open) return;
    const s = this.host.summary();
    const L = locale();
    const key = (f: FlowLine): string => `${f.kind}:${f.post ?? ''}:${f.item ?? ''}:${f.order ?? ''}:${Math.sign(f.perHour)}`;
    const sig = `${s.lines.map(key).join('|')}|${L}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.lines = s.lines.map((f) => this.line(f));
      const at = (pred: (f: FlowLine) => boolean): HTMLElement[] => s.lines.map((f, k) => [f, this.lines[k]!] as const).filter(([f]) => pred(f)).map(([, l]) => l.node);
      const net = (pred: (f: FlowLine) => boolean): HTMLElement => {
        const v = s.lines.filter(pred).reduce((a, f) => a + f.perHour, 0);
        return el('span.purse-net', { 'data-sign': v > 0 ? '+' : v < 0 ? '-' : null }, perHour(v));
      };
      const posts = [...new Set(s.lines.filter((f) => f.post !== undefined).map((f) => f.post!))].sort((a, b) => a - b);
      const sections: Array<HTMLElement | null> = posts.map((p) => {
        const mine = (f: FlowLine): boolean => f.post === p;
        return section({ sec: `purse-post-${p}`, title: () => t('crier.post.name', { n: p }), icon: buildingIcon(this.atlas, 'trade_post', 20), aside: net(mine) }, at(mine));
      });
      const auto = (f: FlowLine): boolean => f.kind === 'auto';
      if (s.lines.some(auto)) sections.push(section({ sec: 'purse-auto', title: () => t('purse.auto'), icon: buildingIcon(this.atlas, 'hearth', 20, this.host.sim().hearthLevel), aside: net(auto) }, at(auto)));
      const other = (f: FlowLine): boolean => f.kind === 'trade';
      if (s.lines.some(other)) sections.push(section({ sec: 'purse-trade', title: () => t('purse.trade'), icon: buildingIcon(this.atlas, 'trade_post', 20), aside: net(other) }, at(other)));
      const research = (f: FlowLine): boolean => f.kind === 'tokens' || f.kind === 'fee' || f.kind === 'rental';
      if (s.lines.some(research)) {
        // The tokens in words once (this viewer), then the icons alone (the token, the server, CrierBelt's).
        this.explained = !tokensSeen.load().seen && s.lines.some((f) => f.kind === 'tokens');
        const words = this.explained ? el('p.insp-note.purse-explain', {}, t('purse.tokens.explain')) : null;
        sections.push(section({ sec: 'purse-research', title: () => t('purse.research'), icon: mark('token'), aside: net(research) }, [words, ...at(research)]));
      }
      const land = (f: FlowLine): boolean => f.kind === 'rent';
      if (s.lines.some(land)) sections.push(section({ sec: 'purse-land', title: () => t('purse.land'), icon: glyph('lease'), aside: net(land) }, at(land)));
      this.body.replaceChildren(...sections.filter((n): n is HTMLElement => !!n));
    }
    const top = Math.max(1, ...s.lines.map((f) => Math.abs(f.perHour)));
    s.lines.forEach((f, k) => {
      const l = this.lines[k];
      if (!l) return;
      setText(l.value, perHour(f.perHour));
      setStyle(l.fill, 'transform', `scaleX(${(Math.abs(f.perHour) / top).toFixed(3)})`);
      // The detail under the name: a rate, and what a minute costs now.
      const detail = f.kind === 'sale' ? rateMin(f.perMin ?? 0)
        : f.kind === 'auto' ? t('purse.auto.detail', { n: rateMin(f.perMin ?? 0) })
        : f.kind === 'order' ? `${rateMin(f.perMin ?? 0)}${f.liveCost !== undefined ? ` · ${t('purse.order.now', { v: oc(f.liveCost, false, 0) })}` : ''}`
        : f.kind === 'tokens' ? t('purse.tokens.detail', { n: rateMin(f.perMin ?? 0), c: oc(Math.round(-f.perHour / 60), false, 0) })
        : f.kind === 'rent' ? (f.parcels ?? []).map((p) => parcelLabel(p)).join(' · ')
        : '';
      setText(l.detail, detail);
      if (l.chip) {
        setText(l.chip.querySelector('b')!, `${Math.round((f.free ?? 0) / 10)} %`);
        setAttr(l.chip, 'title', t('purse.tokens.free', { p: Math.round((f.free ?? 0) / 10) }));
      }
      setAttr(l.node, 'title', f.kind === 'order' && f.liveCost !== undefined ? `${t('purse.order.tip', { v: oc(f.liveCost * 60, false, 0) })} · ${t('purse.go')}` : t('purse.go'));
    });
    setText(this.total, s.minutes ? perHour(s.total) : '…');
    setAttr(this.total, 'data-sign', s.total > 0 ? '+' : s.total < 0 ? '-' : null);
    setText(this.window, s.minutes >= 60 ? t('purse.window.hour') : s.minutes ? t('purse.window.min', { n: s.minutes }) : '');
    setText(this.wait, s.minutes ? '' : t('purse.wait'));
    setAttr(this.wait, 'hidden', s.minutes ? '' : null);
    setText(this.drain, s.drain ? t('purse.drain', { name: `${flowName(s.drain)}${s.drain.post !== undefined ? ` · ${t('crier.post.name', { n: s.drain.post })}` : ''}` }) : '');
    setAttr(this.drain, 'hidden', s.drain ? null : '');
    // The one-offs of the same minutes: apart, muted, never in the headline.
    const onceSig = `${s.oneOffs.map((o) => `${o.kind}:${o.cents}`).join('|')}|${L}`;
    if (onceSig !== this.onceSig) {
      this.onceSig = onceSig;
      this.once.replaceChildren(...(s.oneOffs.length ? [
        el('span.purse-once-title', {}, t('purse.once')),
        ...s.oneOffs.map((o) => el('span.purse-once-chip', { 'data-sign': o.cents > 0 ? '+' : '-' }, `${oneOffName(o.kind)} ${oc(o.cents, true, 0)}`)),
      ] : []));
    }
    this.paintSpark(s.spark);
  }

  /** The purse over the last hours: a small inked line, turquoise if it rose, coral if it fell. */
  private paintSpark(v: readonly number[]): void {
    const sig = `${v.length}:${v[v.length - 1] ?? ''}`;
    if (sig === this.sparkSig) return;
    this.sparkSig = sig;
    if (v.length < 3) { this.spark.replaceChildren(); return; }
    const W = 120, H = 30, lo = Math.min(...v), hi = Math.max(...v), span = Math.max(1, hi - lo);
    const pts = v.map((c, i) => `${((i / (v.length - 1)) * W).toFixed(1)},${(H - 2 - ((c - lo) / span) * (H - 4)).toFixed(1)}`).join(' ');
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('data-sign', v[v.length - 1]! >= v[0]! ? '+' : '-');
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', pts);
    svg.append(line);
    this.spark.replaceChildren(svg);
    setAttr(this.spark, 'title', t('purse.spark', { m: v.length - 1 }));
  }
}
