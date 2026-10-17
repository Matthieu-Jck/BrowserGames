// expertise.ts (screen) — the Expertise window (D93; E, the HUD's chip, the Core's inspector, or a
// click on the Archive the Core mounts at its level 3): what the base has learnt to do well,
// shown rather than told (D53), in the panels' kit (D89):
// · on top, the two SLOTS: each expertise in place as a big card — its picture, its name, its rank
//   as pips, its effect as a figure (« +15 % » beside what it improves) and « En place », or the
//   24 h of a réorientation as a bar running down to « En place dans 18 h » —, an empty slot
//   dashed; beside them, whether Tier 2 is open (two chosen open it);
// · below, the twelve EXPERTISES by family, two each (production, research): a card each with its
//   picture, its rank pips, its effect at the rank it holds (or at rank I, faded, before), its feat
//   as a meter towards the next rank with the figures (« 8 245 / 10 000 »), and its action —
//   « Choisir » into a free slot, « Réorienter » (its price, 24 h) once both are taken, which arms
//   the slots' « Remplacer » buttons; Esc or « Annuler » disarms. In place: « En place · 1 ».
// Before the Archive is mounted (the Core under level 3) the cards show their feats and ranks, and
// a banner says where the Archive comes from. The sim decides (`chooseBlock`, `reorientBlock`): a
// refused action is greyed with its reason in its tooltip. Built once per language; the 4 Hz
// refresh writes only what changed.
import '../styles/expertise.css';
import { BAL } from '@/content/balance';
import { EXPERTISES, EXPERTISE_IDS, effectAt, type ExpertiseDef, type ExpertiseId, type FeatKind } from '@/content/expertises';
import { FAMILIES, FAMILY_IDS } from '@/content/research';
import { itemIdx } from '@/content/registry';
import type { FamilyId } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { duration, num } from '@/i18n/format';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import type { Sim } from '@/sim/state';
import { archiveOpen, featValue, inSlot, rankOf, tierTwoOpen, type ExpertiseBlock } from '@/sim/systems/expertise';
import { EPOCH, TPS } from '@/sim/constants';
import { buildingIcon, itemIcon } from '../build-bar';
import { glyph, type GlyphId } from '../glyphs';
import { kw, mark, meter, type MarkId } from '../inspector/kit';
import { oc, spct } from '../trade-view';

export interface ExpertiseHost {
  sim(): Sim;
  close(): void;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
}

const NS = 'http://www.w3.org/2000/svg';

/** I, II, III (0: none). */
export const romanRank = (r: number): string => ['', 'I', 'II', 'III'][Math.max(0, Math.min(3, r))]!;

/**
 * The Archive's mark (the Core's level-3 corner piece, D86): a squat drum banded in violet, its
 * glazed band of platters, a stub antenna — the window's, the HUD chip's and the Core inspector's.
 */
export function archiveGlyph(): HTMLElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag: string, a: Record<string, string>): void => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
    svg.append(n);
  };
  add('path', { class: 'xa-line', d: 'M10 1.6v3' });
  add('circle', { class: 'xa-lamp', cx: '10', cy: '1.6', r: '1.3' });
  add('path', { class: 'xa-body', d: 'M3.6 6.4c0-1.2 2.9-2 6.4-2s6.4.8 6.4 2v9.2c0 1.2-2.9 2.2-6.4 2.2s-6.4-1-6.4-2.2z' });
  add('path', { class: 'xa-band', d: 'M3.6 9.2c0 1.2 2.9 2 6.4 2s6.4-.8 6.4-2v3.6c0 1.2-2.9 2-6.4 2s-6.4-.8-6.4-2z' });
  add('path', { class: 'xa-plate', d: 'M5.6 11.6c1.2.4 2.7.6 4.4.6s3.2-.2 4.4-.6M5.6 13.4c1.2.4 2.7.6 4.4.6s3.2-.2 4.4-.6' });
  add('ellipse', { class: 'xa-top', cx: '10', cy: '6.4', rx: '6.4', ry: '2' });
  const span = el('span.xa-glyph');
  span.append(svg);
  return span;
}

/** An expertise's picture (content `icon`): an item's or a building's icon, a glyph, a kit mark, the ocelle. */
export function expertiseIcon(atlas: Atlas, spec: string, size: number): HTMLElement {
  const box = el('span.ex-icon', { style: `--s:${size}px` });
  const [kind, id] = spec.split(':') as [string, string | undefined];
  let n: Node | null = null;
  if (kind === 'item' && id) n = itemIcon(atlas, itemIdx(id), size);
  else if (kind === 'building' && id) n = buildingIcon(atlas, id, size);
  else if (kind === 'glyph' && id) n = glyph(id as GlyphId);
  else if (kind === 'mark' && id) n = mark(id as MarkId);
  else if (kind === 'coin') n = el('span.ex-coin', {}, '◉');
  if (n) box.append(n);
  return box;
}

/** What an expertise improves, as a picture: the production number's, or research's mark beside the aspect. */
function effectIcon(atlas: Atlas, d: ExpertiseDef): HTMLElement {
  if (d.effect.k === 'research') {
    const aspect = d.effect.aspect === 'time' ? mark('order') : d.effect.aspect === 'tokens' ? mark('token') : expertiseIcon(atlas, 'item:journal_1', 16);
    return el('span.ex-fxicon', {}, [mark('tree'), aspect]);
  }
  const target = d.effect.targets[0]!;
  const spec: Record<string, string> = { genOut: 'glyph:power', drillRate: 'building:drill', craftSpeed: 'building:workshop', dataRate: 'item:journal_1', deliveryDelay: 'mark:flight', landPrice: 'glyph:parcel' };
  return el('span.ex-fxicon', {}, [expertiseIcon(atlas, spec[target] ?? 'mark:level', 18)]);
}

/** What an expertise improves, in words: « Cadence des foreuses », « Recherche Extraction · temps de recherche ». */
export function effectLabel(d: ExpertiseDef): string {
  if (d.effect.k === 'research') return `${t('exp.fx.family', { family: FAMILIES[d.family].name[locale()] })} · ${t(`exp.fx.${d.effect.aspect}` as MsgKey)}`;
  return t(`exp.fx.${d.effect.targets[0]}` as MsgKey);
}

/** Its effect at a rank, as a signed percentage: « +15 % », « −25 % ». */
export const effectFigure = (d: ExpertiseDef, rank: number): string => spct(effectAt(d, Math.max(1, rank)) / 1000 - 1);

/** A feat's value in its unit: a duration, kW, ocelles, a count. */
export function featText(kind: FeatKind, v: number): string {
  switch (kind) {
    case 'grid': return duration(v * 60);
    case 'capacity': return kw(v);
    case 'sold': case 'bought': return oc(v * 100, false, 0);
    default: return num(v);
  }
}

/** Three pips, the earned ones inked; the rank in roman beside them. */
function pips(): { root: HTMLElement; set(rank: number): void } {
  const dots = [0, 1, 2].map(() => el('i.ex-pip'));
  const label = el('b.ex-rank.lettering');
  const root = el('span.ex-pips', {}, [...dots, label]);
  return {
    root,
    set(rank: number): void {
      dots.forEach((d, i) => setAttr(d, 'data-on', i < rank ? '' : null));
      setText(label, romanRank(rank));
      setAttr(root, 'data-rank', String(rank));
    },
  };
}

interface Card {
  id: ExpertiseId;
  root: HTMLElement;
  pips: ReturnType<typeof pips>;
  fx: HTMLElement;
  bar: ReturnType<typeof meter>;
  feat: HTMLElement;
  next: HTMLElement;
  btn: HTMLButtonElement;
  badge: HTMLElement;
}

interface SlotView {
  root: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  pips: ReturnType<typeof pips>;
  fx: HTMLElement;
  fxIcon: HTMLElement;
  fxLabel: HTMLElement;
  state: HTMLElement;
  gap: ReturnType<typeof meter>;
  replace: HTMLButtonElement;
  sig: string;
}

export class ExpertiseScreen {
  readonly root: HTMLElement;
  private body = el('div.ex-body');
  private readonly title = el('h1.lettering');
  private readonly tier = el('span.ex-tier');
  private readonly cancel: HTMLButtonElement;
  private cards: Card[] = [];
  private slots: SlotView[] = [];
  private banner: HTMLElement | null = null;
  private count: HTMLElement | null = null;
  private built = '';
  /** The expertise a réorientation is armed with: the slots offer « Remplacer » (null: none). */
  private arming: ExpertiseId | null = null;

  constructor(private readonly atlas: Atlas, private readonly host: ExpertiseHost) {
    this.cancel = el<'button'>('button.btn.ex-cancel', { type: 'button', hidden: true, onclick: () => { this.arming = null; this.refresh(); } });
    const close = el('button.btn.rs-close', { type: 'button', onclick: () => host.close() }, '✕');
    this.root = el('section.screen.expertise', { 'data-screen': 'expertise' }, [
      el('header.rs-head', {}, [el('span.ex-headglyph', {}, archiveGlyph()), this.title, this.tier, this.cancel, close]),
      this.body,
    ]);
  }

  /** Esc: a réorientation armed is put down first. */
  back(): boolean {
    if (!this.arming) return false;
    this.arming = null;
    this.refresh();
    return true;
  }

  closed(): void { this.arming = null; }

  private build(): void {
    const L = locale();
    this.built = L;
    setText(this.title, t('screen.expertise'));
    setAttr(this.title, 'title', t('exp.tip'));
    setText(this.cancel, t('exp.cancel'));
    // ── the slots ──
    this.slots = Array.from({ length: BAL.expertise.slots }, (_, i) => this.slotView(i));
    this.banner = el('p.ex-banner', { hidden: true }, [el('span.ex-bannerpic'), el('span', {}, t('exp.locked'))]);
    const heart = buildingIcon(this.atlas, 'hearth', 46, BAL.expertise.level);
    if (heart) this.banner.firstElementChild!.append(heart);
    const slotsSec = el('section.ksec.ex-slots', { 'data-sec': 'slots' }, [
      el('header.ksec-head', { title: t('exp.slots.tip') }, [el('span.ksec-icon', {}, archiveGlyph()), el('h4.ksec-title.lettering', {}, t('exp.slots'))]),
      this.banner,
      el('div.ex-slotrow', {}, this.slots.map((s) => s.root)),
    ]);
    // ── the expertises, by family ──
    this.cards = [];
    this.count = el('span.ksec-aside');
    const fams = FAMILY_IDS.map((f) => this.family(f));
    const listSec = el('section.ksec.ex-list', { 'data-sec': 'list' }, [
      el('header.ksec-head', { title: t('exp.list.tip') }, [el('span.ksec-icon', {}, mark('level')), el('h4.ksec-title.lettering', {}, t('exp.list')), this.count]),
      el('div.ex-grid', {}, fams),
    ]);
    this.body.replaceChildren(slotsSec, listSec);
  }

  private slotView(i: number): SlotView {
    const icon = el('span.ex-sloticon'), name = el('b.ex-slotname.lettering'), state = el('span.ex-slotstate');
    const p = pips(), fx = el('b.ex-fig'), fxIcon = el('span'), fxLabel = el('span.ex-fxlabel'), gap = meter();
    const replace = el<'button'>('button.btn.primary.ex-replace', { type: 'button', hidden: true, 'data-ex-replace': String(i), onclick: () => this.replace(i) }, t('exp.reorient.pick'));
    const root = el('div.ex-slot', { 'data-slot': String(i) }, [
      el('span.ex-slotnum.lettering', {}, String(i + 1)),
      icon,
      el('div.ex-slotmain', {}, [
        el('div.ex-slottop', {}, [name, p.root]),
        el('div.ex-fx', {}, [fx, fxIcon, fxLabel]),
        el('div.ex-slotfoot', {}, [state, gap.root]),
      ]),
      replace,
    ]);
    return { root, icon, name, pips: p, fx, fxIcon, fxLabel, state, gap, replace, sig: '-' }; // '-': never a slot's, so the first refresh writes it
  }

  private family(f: FamilyId): HTMLElement {
    const cards = EXPERTISE_IDS.filter((id) => EXPERTISES[id].family === f).map((id) => this.card(id));
    return el('div.ex-fam', { 'data-fam': f }, [
      el('header.ex-famhead', {}, [el('span.ex-famname.lettering', {}, FAMILIES[f].name[locale()])]),
      el('div.ex-fampair', {}, cards.map((c) => c.root)),
    ]);
  }

  private card(id: ExpertiseId): Card {
    const d: ExpertiseDef = EXPERTISES[id];
    const p = pips(), fx = el('b.ex-fig'), bar = meter(), feat = el('span.ex-featval'), next = el('small.ex-next');
    const btn = el<'button'>('button.btn.ex-act', { type: 'button', 'data-ex-act': id, onclick: () => this.act(id) });
    const badge = el('span.ex-badge', { hidden: true });
    const ranks = d.permille.map((_, r) => effectFigure(d, r + 1)).join(' · ');
    const root = el('article.ex-card', { 'data-ex': id }, [
      el('div.ex-cardtop', {}, [expertiseIcon(this.atlas, d.icon, 34), el('b.ex-name.lettering', {}, d.name[locale()]), p.root]),
      el('div.ex-fx', { title: t('exp.fx.ranks', { list: ranks }) }, [fx, effectIcon(this.atlas, d), el('span.ex-fxlabel', {}, effectLabel(d))]),
      el('div.ex-feat', { title: t(`exp.feat.${d.feat}` as MsgKey) }, [el('div.ex-featrow', {}, [el('span.ex-featname', {}, t(`exp.feat.${d.feat}` as MsgKey)), feat]), bar.root, next]),
      el('div.ex-foot', {}, [badge, btn]),
    ]);
    const c: Card = { id, root, pips: p, fx, bar, feat, next, btn, badge };
    this.cards.push(c);
    return c;
  }

  /** A card's action: choose into the first free slot, or arm a réorientation. */
  private act(id: ExpertiseId): void {
    const sim = this.host.sim();
    const free = sim.expertise.slots.findIndex((s) => s === null);
    if (free >= 0) {
      const r = sim.chooseExpertise(free, id);
      if (r) this.host.notify('bad', this.why(sim, r));
      else this.host.notify('good', t('exp.done.chosen', { name: EXPERTISES[id].name[locale()] }));
    } else this.arming = this.arming === id ? null : id;
    this.refresh();
  }

  /** A slot's « Remplacer »: the armed réorientation goes through (or says why not). */
  private replace(slot: number): void {
    const sim = this.host.sim(), id = this.arming;
    if (!id) return;
    const r = sim.reorient(slot, id);
    if (r) this.host.notify('bad', this.why(sim, r));
    else this.host.notify('info', t('exp.done.reoriented', { name: EXPERTISES[id].name[locale()] }));
    this.arming = null;
    this.refresh();
  }

  private why(sim: Sim, b: ExpertiseBlock): string {
    return tr(`exp.block.${b}`, { v: oc(Math.max(0, sim.reorientCost() - sim.credits)) });
  }

  refresh(): void {
    const sim = this.host.sim();
    if (this.built !== locale()) this.build();
    const open = archiveOpen(sim);
    setAttr(this.root, 'data-locked', open ? null : '');
    setAttr(this.banner!, 'hidden', open ? '' : null);
    // Tier 2: open once two are chosen (D93).
    const t2 = tierTwoOpen(sim);
    setAttr(this.tier, 'data-open', t2 ? '' : null);
    const tierSig = `${t2}|${locale()}`;
    if (this.tier.dataset.sig !== tierSig) {
      this.tier.dataset.sig = tierSig;
      this.tier.replaceChildren(mark(t2 ? 'on' : 'tree'), t(t2 ? 'exp.tier2.open' : 'exp.tier2.closed'));
    }
    if (this.arming && (!open || inSlot(sim, this.arming) >= 0)) this.arming = null;
    setAttr(this.cancel, 'hidden', this.arming ? null : '');
    setAttr(this.root, 'data-arming', this.arming ? '' : null);
    this.refreshSlots(sim);
    this.refreshCards(sim, open);
  }

  private refreshSlots(sim: Sim): void {
    const now = sim.tick;
    this.slots.forEach((v, i) => {
      const s = sim.expertise.slots[i] ?? null;
      const d: ExpertiseDef | undefined = s ? EXPERTISES[s.id as ExpertiseId] : undefined;
      const sig = s && d ? `${s.id}|${locale()}` : '';
      if (sig !== v.sig) {
        v.sig = sig;
        v.icon.replaceChildren(d ? expertiseIcon(this.atlas, d.icon, 52) : el('span.ex-plus', {}, '+'));
        setText(v.name, d ? d.name[locale()] : t('exp.slot.empty'));
        v.fxIcon.replaceChildren(d ? effectIcon(this.atlas, d) : '');
        setText(v.fxLabel, d ? effectLabel(d) : t('exp.slot.emptyTip'));
      }
      setAttr(v.root, 'data-state', !s ? 'empty' : s.on ? 'on' : 'coming');
      const rank = s ? rankOf(sim, s.id) : 0;
      v.pips.set(rank);
      setText(v.fx, d ? effectFigure(d, rank) : '');
      setAttr(v.pips.root, 'hidden', s ? null : '');
      if (s && !s.on) {
        // The gap: the bar runs down to the boundary it comes into place at.
        const due = (s.at - sim.foundingEpoch) * EPOCH, total = BAL.expertise.gapMinutes * EPOCH;
        const left = Math.max(0, due - now);
        setText(v.state, t('exp.slot.coming', { d: duration(left / TPS) }));
        v.gap.set(total - left, total, 'warn', '');
        v.gap.root.hidden = false;
      } else {
        setText(v.state, s ? t('exp.slot.on') : '');
        v.gap.root.hidden = true;
      }
      // An armed réorientation: every filled slot offers itself.
      const can = !!this.arming && !!s && sim.reorientBlock(i, this.arming) === null;
      setAttr(v.replace, 'hidden', this.arming && s ? null : '');
      setAttr(v.replace, 'disabled', can ? null : '');
      if (this.arming && s) {
        const b = sim.reorientBlock(i, this.arming);
        setAttr(v.replace, 'title', b ? this.why(sim, b) : t('exp.reorient.pickTip', { name: EXPERTISES[this.arming].name[locale()], v: oc(sim.reorientCost(), false, 0) }));
      }
    });
  }

  private refreshCards(sim: Sim, open: boolean): void {
    let earned = 0;
    const free = sim.expertise.slots.some((s) => s === null);
    for (const c of this.cards) {
      const d: ExpertiseDef = EXPERTISES[c.id];
      const rank = rankOf(sim, c.id);
      if (rank > 0) earned++;
      c.pips.set(rank);
      setText(c.fx, effectFigure(d, rank));
      const v = featValue(sim, d.feat);
      const goal = rank < 3 ? d.ranks[rank]! : d.ranks[2]!;
      const from = rank > 0 && rank < 3 ? d.ranks[rank - 1]! : 0;
      c.bar.set(rank >= 3 ? 1 : Math.max(0, v - from), rank >= 3 ? 1 : goal - from, rank >= 3 ? 'good' : rank > 0 ? 'good' : 'idle', '');
      setText(c.feat, rank >= 3 ? featText(d.feat, v) : `${featText(d.feat, v)} / ${featText(d.feat, goal)}`);
      setText(c.next, rank >= 3 ? t('exp.max') : t('exp.next', { r: romanRank(rank + 1), v: featText(d.feat, goal) }));
      if (d.feat === 'grid') setAttr(c.feat, 'title', t('exp.feat.grid.now', { d: duration(sim.expertise.streak * 60) }));
      const slot = inSlot(sim, c.id);
      const held = slot >= 0 ? sim.expertise.slots[slot]! : null;
      setAttr(c.root, 'data-state', held ? (held.on ? 'held' : 'coming') : rank > 0 ? 'earned' : 'locked');
      setAttr(c.root, 'data-armed', this.arming === c.id ? '' : null);
      setAttr(c.badge, 'hidden', held ? null : '');
      if (held) {
        const sig = `${slot}|${held.on}|${locale()}`;
        if (c.badge.dataset.sig !== sig) { c.badge.dataset.sig = sig; c.badge.replaceChildren(mark(held.on ? 'on' : 'order'), `${held.on ? t('exp.inSlot') : t('exp.coming')} · ${slot + 1}`); }
      }
      // The action: choose (a free slot), reorient (both taken), nothing once it is in a slot.
      setAttr(c.btn, 'hidden', held ? '' : null);
      if (held) continue;
      const block = !open ? 'locked' : free ? sim.chooseBlock(sim.expertise.slots.findIndex((s) => s === null), c.id) : sim.reorientBlock(sim.expertise.slots.findIndex((s) => s !== null), c.id);
      // A réorientation's own refusals (the purse) show on the slot's button, not here: arming is always offered.
      const shown = free ? block : block === 'funds' ? null : block;
      setAttr(c.btn, 'disabled', shown ? '' : null);
      setAttr(c.btn, 'data-kind', free ? 'choose' : 'reorient');
      setAttr(c.btn, 'data-on', this.arming === c.id ? '' : null);
      const label = free ? t('exp.choose') : this.arming === c.id ? t('exp.cancel') : `${t('exp.reorient')} · ${oc(sim.reorientCost(), false, 0)}`;
      setText(c.btn, rank > 0 ? label : t('exp.rank.none'));
      setAttr(c.btn, 'title', shown ? this.why(sim, shown) : free ? t('exp.choose.tip') : t('exp.reorient.tip', { v: oc(sim.reorientCost(), false, 0) }));
    }
    if (this.count) setText(this.count, t('exp.earned', { n: earned, of: this.cards.length }));
  }
}

/** How many earned expertises could go into a free slot now (the HUD's badge). */
export function choosable(sim: Sim): number {
  const free = sim.expertise.slots.findIndex((s) => s === null);
  if (free < 0 || !archiveOpen(sim)) return 0;
  return EXPERTISE_IDS.filter((id) => sim.chooseBlock(free, id) === null).length;
}

/** The plural line of the HUD's tip. */
export const choosableText = (n: number): string => tr('hud.expertise.free', { n });
