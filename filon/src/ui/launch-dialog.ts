// launch-dialog.ts — launching a research, at every tier (D118, D122, D128; owner, 2026-10-17:
// « Lorsque la recherche est sélectionnée et lancée par l'utilisateur, on lui demande s'il veut
// acheter un flux de tokens sur le marché. Combien, et le coût qui va avec. »; 2026-10-18, on the
// dialog's « 1,500/min free · 0/min for it · 1,303,716 tokens in reserve »: « qu'est-ce que ça veut
// dire ça ? c'est vraiment pas clair »). « Lancer » on any node opens this small dialog over the tech
// tree (screens/research.ts), in the panels' look (D89: the kit's marks, the building icons, ink and
// paper), told around the outcome (D128), icons first and the words on hover (D53, « show, don't
// tell »):
//   · the node, its icon, its name, its tier and category;
//   · the resources it takes from the Core at launch (D122: paid at once, as a plan's; handed back on
//     a cancel), as the placing tip says a cost (452375a; D128: no heading, no line on when they are
//     paid): each item's icon, how many, and what the Core holds (« 60 / 3 010 ») — coral when short;
//   · the TOKENS it needs, big; under them a stacked BAR of where they will come from, as the engine
//     delivers them (`launchSources`): the reserve (an older save's data turned into tokens, D122) at
//     the first minute's end, then the free compute (the Core's and the servers', once the projects
//     launched before have theirs), then the flow bought — what no flow reaches hatched; each part's
//     icon and figure under it; and one plain sentence for what matters: « Ta réserve couvre tout »,
//     « Le calcul gratuit va d'abord à « X » (en cours) », no flow at all, a lab without power;
//   · the flow to buy from CrierBelt, tokens a minute on the engine's ladder (`tokenFlowSteps`),
//     proposed at `tokenBuyDefault` (often 0 at Tier 1: the Core's compute suffices; 0 when the
//     reserve covers it), its price a minute and what it should come to in all — the whole part gone
//     when the reserve or the free compute bring every token at the first minute's end (nothing to
//     buy would help); locked at 0 while the purse is in the red;
//   · when it would be done;
//   · « Annuler » and « Lancer » (the screen's start path: `startResearch(id, 0, buy)`), « Lancer »
//     off while the Core is short of a resource or the node cannot start; Esc or a click outside
//     cancels, Enter launches.
// It reads the sim and asks the host to act; the figures are the engine's pure estimate
// (`launchSources`, tested in sim/research/research.test.ts). Hooks for tests and the shots:
// `[data-launch]` (the root), `[data-launch-res]` (the resources), `[data-launch-bar]` (the bar, its
// parts `[data-k]`), `[data-launch-free]` (the free part's figure), `[data-launch-note]` (the
// sentence), `[data-launch-flow]` (the slider), `[data-launch-buy]` (its part), `[data-launch-go]`,
// `[data-launch-cancel]`, `[data-launch-cost]`, `[data-launch-eta]`.
import { categoryName, nodeName, researchNode } from '@/content/research';
import { itemDef } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { num } from '@/i18n/format';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { effectiveCost } from '@/sim/research/runtime';
import type { Sim } from '@/sim/state';
import { launchQueue, launchSources, serverRate, tokenFlowSteps, type LaunchSources } from '@/sim/systems/research';
import { buildingIcon, itemIcon } from './build-bar';
import { glyph } from './glyphs';
import { mark } from './inspector/kit';
import { compact } from './stock-panel';
import { minutes, oc } from './trade-view';

export interface LaunchHost {
  sim(): Sim;
  /** Start the node buying `buy` tokens a minute (the screen's start path: it says why when refused). */
  launch(id: string, buy: number): void;
}

/** A resource chip of the dialog: its item, and the live « have » under it. */
interface ResChip { item: number; mu: number; node: HTMLElement; have: HTMLElement }

/** The bar's parts, in the order the tokens come (D128). */
type Src = 'bank' | 'free' | 'bought' | 'short';
const SRCS: readonly Src[] = ['bank', 'free', 'bought', 'short'];

export class LaunchDialog {
  readonly root: HTMLElement;
  /** The node on show ('' while closed), the ladder of flows and the step chosen. */
  private id = '';
  private steps: number[] = [0];
  private idx = 0;
  private readonly iconBox = el('span.ld-icon');
  private readonly kicker = el('small.ld-kicker');
  private readonly nameEl = el('h3.ld-name.lettering');
  private readonly kindEl = el('small.ld-kind');
  private readonly resList = el('div.ld-res', { 'data-launch-res': '' });
  private res: ResChip[] = [];
  private readonly needRow: HTMLElement;
  private readonly needV = el('b');
  private readonly needLabel = el('small');
  private readonly bar = el('div.ld-bar', { 'data-launch-bar': '' });
  private readonly segs = new Map<Src, HTMLElement>();
  private readonly legend = new Map<Src, { chip: HTMLElement; v: HTMLElement; label: HTMLElement }>();
  private readonly coreIcon = el('span.ld-coreicon');
  private readonly srvIcon: HTMLElement;
  private readonly note = el('small.ld-say', { 'data-launch-note': '' });
  private readonly powerNote = el('small.ld-say.ld-bad', { 'data-launch-power': '' });
  private readonly buySec: HTMLElement;
  private readonly buyHead: HTMLElement;
  private readonly buyLabel = el('span');
  private readonly slider: HTMLInputElement;
  private readonly minus: HTMLButtonElement;
  private readonly plus: HTMLButtonElement;
  private readonly flowV = el('b');
  private readonly costV = el('b', { 'data-launch-cost': '' });
  private readonly totalV = el('small');
  private readonly debtNote = el('small.ld-say.ld-bad', { 'data-launch-debt': '' });
  private readonly etaV = el('b.ld-eta', { 'data-launch-eta': '' });
  private readonly goBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  /** The language the resource chips were built in. */
  private resLoc = '';
  private coreLv = -1;
  /** The pointer went down on the veil itself (a click outside the card, not a drag ending there). */
  private downOut = false;

  constructor(private readonly atlas: Atlas, private readonly host: LaunchHost) {
    this.slider = el<'input'>('input.ld-slider', {
      type: 'range', min: '0', max: '0', step: '1', value: '0', 'data-launch-flow': '',
      oninput: () => { this.idx = Number(this.slider.value) || 0; this.refresh(); },
    });
    this.minus = el<'button'>('button.ld-step', { type: 'button', 'data-launch-step': 'minus', onclick: () => this.step(-1) }, '−');
    this.plus = el<'button'>('button.ld-step', { type: 'button', 'data-launch-step': 'plus', onclick: () => this.step(1) }, '+');
    this.goBtn = el<'button'>('button.btn.primary', { type: 'button', 'data-launch-go': '', onclick: () => this.go() });
    this.cancelBtn = el<'button'>('button.btn', { type: 'button', 'data-launch-cancel': '', onclick: () => this.close() });
    this.needRow = el('div.ld-need', {}, [mark('token'), this.needV, this.needLabel]);
    // The bar's parts and, under it, each part's icon and figure (D128).
    this.srvIcon = buildingIcon(atlas, 'server', 20) ?? el('span');
    for (const k of SRCS) {
      const seg = el('span.ld-seg', { 'data-k': k });
      this.segs.set(k, seg);
      this.bar.append(seg);
      const v = el('b', k === 'free' ? { 'data-launch-free': '' } : {}), label = el('small');
      const icon = k === 'bank' ? [mark('store')] : k === 'free' ? [this.coreIcon, this.srvIcon] : k === 'bought' ? [glyph('crier')] : [el('i.ld-hatch')];
      this.legend.set(k, { chip: el('span.ld-src', { 'data-k': k }, [...icon, v, label]), v, label });
    }
    this.buyHead = el('div.ld-buyhead', {}, [glyph('crier'), this.buyLabel]);
    this.buySec = el('section.ld-sec.ld-buy', { 'data-launch-buy': '' }, [
      this.buyHead,
      el('div.ld-slide', {}, [this.minus, this.slider, this.plus, el('span.ld-flow', {}, [mark('token'), this.flowV])]),
      el('div.ld-cost', {}, [this.costV, this.totalV]),
      this.debtNote,
    ]);
    const card = el('div.ld.cartouche', {
      role: 'dialog', 'aria-modal': 'true',
      onkeydown: (e: KeyboardEvent) => this.key(e),
    }, [
      el('header.ld-head', {}, [this.iconBox, el('div.ld-title', {}, [this.kicker, this.nameEl, this.kindEl])]),
      el('section.ld-sec', { 'data-k': 'tokens' }, [
        this.resList,
        this.needRow, this.bar, el('div.ld-legend', {}, SRCS.map((k) => this.legend.get(k)!.chip)), this.note, this.powerNote,
      ]),
      this.buySec,
      el('section.ld-sec.ld-end', {}, [this.etaV]),
      el('footer.ld-actions', {}, [this.cancelBtn, this.goBtn]),
    ]);
    this.root = el('div.ld-veil', {
      'data-launch': '', hidden: '',
      // A click outside the card cancels (not one that started inside it, a slider dragged out).
      onpointerdown: (e: PointerEvent) => { this.downOut = e.target === this.root; },
      onclick: (e: MouseEvent) => { if (e.target === this.root && this.downOut) this.close(); },
    }, [card]);
  }

  get isOpen(): boolean { return !!this.id; }

  /** Open it for a node (its first icon, drawn by the tree), the flow at the engine's proposal (0 while the purse is in the red). */
  open(id: string, icon: Node | null): void {
    const sim = this.host.sim();
    this.id = id;
    const e = effectiveCost(id, sim.mods);
    this.steps = tokenFlowSteps(e.tokens);
    const def = sim.credits < 0 ? 0 : sim.tokenBuyDefault(id);
    const k = this.steps.findIndex((v) => v >= def);
    this.idx = k < 0 ? this.steps.length - 1 : k;
    setAttr(this.slider, 'max', String(this.steps.length - 1));
    this.slider.value = String(this.idx);
    this.iconBox.replaceChildren(...(icon ? [icon] : []));
    this.resLoc = '';
    this.root.hidden = false;
    this.refresh();
    this.slider.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.id) return;
    this.id = '';
    this.root.hidden = true;
  }

  private step(d: -1 | 1): void {
    if (this.slider.disabled) return;
    this.idx = Math.max(0, Math.min(this.steps.length - 1, this.idx + d));
    this.slider.value = String(this.idx);
    this.refresh();
  }

  /** Esc cancels, Enter launches (but on a button, which presses itself); no key reaches the game meanwhile. */
  private key(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); this.go(); }
  }

  private go(): void {
    if (!this.id || this.goBtn.disabled) return;
    const id = this.id, buy = this.buySec.hidden ? 0 : this.steps[this.idx] ?? 0;
    this.close();
    this.host.launch(id, buy);
  }

  /** The resources' chips (rebuilt for a node or a language): icon, how many, what the Core holds. */
  private buildRes(cost: ReadonlyArray<{ item: number; mu: number }>, L: string): void {
    this.resLoc = `${this.id}:${L}`;
    this.res = cost.map((c) => {
      const have = el('small.ld-have');
      const node = el('span.ld-reschip', { 'data-item': String(c.item), title: itemDef(c.item).name[L as 'fr' | 'en'] }, [
        itemIcon(this.atlas, c.item, 22), el('b', {}, num(Math.round(c.mu / 1000))), have,
      ]);
      return { item: c.item, mu: c.mu, node, have };
    });
    this.resList.replaceChildren(...this.res.map((r) => r.node));
    this.resList.hidden = !this.res.length;
  }

  /** The figures at this flow, now (4 Hz from the tree, and on every move of the slider). */
  refresh(): void {
    if (!this.id) return;
    const sim = this.host.sim();
    const id = this.id, L = locale();
    const r = researchNode(id);
    if (!r) { this.close(); return; }
    const e = effectiveCost(id, sim.mods);
    const satOf = (net: number): number => sim.netPower[net]?.sat ?? 0;
    const hold = sim.credits < 0;

    setText(this.kicker, t('launch.kicker'));
    setText(this.nameEl, nodeName(id)[L]);
    setText(this.kindEl, `${t('tree.rs.tier', { n: r.tier })} · ${categoryName(r.cat)[L]}`);

    // Its resources (D122), taken from the Core at launch: have / need, coral when short.
    if (this.resLoc !== `${id}:${L}`) this.buildRes(e.cost, L);
    let short = false;
    for (const c of this.res) {
      const have = Math.floor(sim.stock[c.item]! / 1000);
      setText(c.have, `/ ${compact(have)}`);
      setAttr(c.node, 'title', t('tip.costHave', { item: itemDef(c.item).name[L], n: num(Math.round(c.mu / 1000)), have: num(have) }));
      setAttr(c.node, 'data-poor', sim.stock[c.item]! < c.mu ? '' : null);
      if (sim.stock[c.item]! < c.mu) short = true;
    }

    // The tokens it needs, then where they will come from (D128), as the engine would deliver them.
    setText(this.needV, num(e.tokens));
    setText(this.needLabel, t('launch.need'));
    setAttr(this.needRow, 'title', t('launch.need.tip', { v: num(e.tokens) }));
    const q = launchQueue(sim, satOf);
    // Nothing to buy would help when the reserve or the free compute bring it all at the first boundary.
    const bare = launchSources(q.rate, q.running, sim.tokenBank, { tokens: e.tokens, buy: 0 });
    const useless = bare.minutes <= 1;
    this.buySec.hidden = useless;
    if ((hold || useless) && this.idx !== 0) { this.idx = 0; this.slider.value = '0'; }
    setAttr(this.slider, 'disabled', hold ? '' : null);
    const buy = this.steps[this.idx] ?? 0;
    const src = buy > 0 ? launchSources(q.rate, q.running, sim.tokenBank, { tokens: e.tokens, buy }) : bare;
    this.paintBar(sim, src, e.tokens, q.rate);

    // The lab it would run in (the first idle one): without power it takes no tokens.
    const lab = sim.idleLabs()[0] ?? 0;
    const n = lab ? sim.graph?.nodeByEnt.get(lab)?.net ?? -1 : -1;
    const lit = !lab || (n >= 0 && satOf(n) > 0);
    setText(this.powerNote, t('launch.power'));
    this.powerNote.hidden = lit;

    // The sentence (D128): what matters about where its tokens come from, in plain words.
    const before = q.running.filter((p) => p.need > 0);
    let say = '';
    if (src.bank >= e.tokens || (src.bank > 0 && src.minutes <= 1)) say = t('launch.say.bank');
    else if (src.bank > 0) say = t(src.bought > 0 ? 'launch.say.bankBuy' : 'launch.say.bankFree', { v: num(src.bank) });
    else if (q.rate <= 0 && buy <= 0) say = sim.coreComputeRate() <= 0 && sim.hearthLevel < 2 ? t('launch.free.none') : t('launch.say.never');
    else if (before.length && q.rate > 0) {
      const name = nodeName(before[0]!.id)[L];
      say = before.length > 1 ? tr('launch.say.busyMore', { name, n: before.length - 1 }) : t('launch.say.busy', { name });
    }
    else if (src.bought <= 0 && src.short <= 0) say = t('launch.say.free');
    else if (src.bought > 0 && src.free > 0) say = t('launch.say.buy', { v: num(src.free) });
    setText(this.note, say);
    this.note.hidden = !say;

    // The flow bought from CrierBelt, its price a minute and what it should come to in all.
    setText(this.buyLabel, t('launch.buy'));
    setAttr(this.buyHead, 'title', t('launch.buy.tip', { p: oc(sim.tokenPriceK(), false, 0) }));
    setText(this.flowV, buy > 0 ? t('hud.perMin', { v: num(buy) }) : t('launch.buy.none'));
    setAttr(this.minus, 'disabled', hold || this.idx <= 0 ? '' : null);
    setAttr(this.plus, 'disabled', hold || this.idx >= this.steps.length - 1 ? '' : null);
    setAttr(this.minus, 'title', t('tree.rs.flow.less'));
    setAttr(this.plus, 'title', t('tree.rs.flow.more'));
    const perMin = Math.ceil((buy * sim.tokenPriceK()) / 1000);
    const total = Math.ceil((src.bought * sim.tokenPriceK()) / 1000);
    setText(this.costV, buy > 0 ? t('hud.perMin', { v: oc(perMin, false, perMin < 10_000 ? 2 : 0) }) : t('launch.free'));
    setAttr(this.costV, 'data-free', buy > 0 ? null : '');
    setText(this.totalV, buy > 0 ? t('launch.total', { v: oc(total, false, total < 10_000 ? 2 : 0) }) : '');
    setText(this.debtNote, t('launch.debt'));
    this.debtNote.hidden = !hold;

    // When it would be done: its tokens in, as the engine would deliver them (this node last).
    const ok = Number.isFinite(src.minutes) && lit;
    setText(this.etaV, !lit ? t('launch.eta.noPower') : !ok ? t('launch.eta.never') : src.minutes <= 1 ? t('launch.eta.now') : t('launch.eta', { d: minutes(src.minutes) }));
    setAttr(this.etaV, 'data-never', ok ? null : '');
    setAttr(this.etaV, 'title', t('launch.eta.tip'));

    // The actions; « Lancer » off while the Core is short of a resource or the node cannot start any more (a lab taken meanwhile…).
    setText(this.goBtn, t('research.start'));
    setText(this.cancelBtn, t('launch.cancel'));
    const block = sim.researchBlock(id);
    setAttr(this.goBtn, 'disabled', block || short ? '' : null);
    setAttr(this.goBtn, 'title', block ? tr(`research.block.${block}` as MsgKey) : null);
  }

  /**
   * The bar and its legend (D128): each source's share of the tokens it needs, in the order they come —
   * the reserve, the free compute (the Core's look at its level, and the servers' when it has any), the
   * flow bought, what none reaches —; a part with nothing hidden, its tooltip saying what it is.
   */
  private paintBar(sim: Sim, src: LaunchSources, tokens: number, rate: number): void {
    const of: Record<Src, number> = { bank: src.bank, free: src.free, bought: src.bought, short: src.short };
    for (const k of SRCS) {
      const v = of[k], seg = this.segs.get(k)!, lg = this.legend.get(k)!;
      seg.style.width = `${tokens > 0 ? (v * 100) / tokens : 0}%`;
      seg.hidden = v <= 0;
      lg.chip.hidden = v <= 0 && !(k === 'free' && rate > 0);
      setText(lg.v, num(v));
    }
    if (this.coreLv !== sim.hearthLevel) {
      this.coreLv = sim.hearthLevel;
      this.coreIcon.replaceChildren(...[buildingIcon(this.atlas, 'hearth', 20, sim.hearthLevel)].filter((n): n is HTMLCanvasElement => !!n));
    }
    this.srvIcon.hidden = !(sim.graph?.servers.length ?? 0);
    const srv = serverRate(sim, (net) => sim.netPower[net]?.sat ?? 0);
    const lg = (k: Src): { chip: HTMLElement; label: HTMLElement } => this.legend.get(k)!;
    setText(lg('bank').label, t('launch.src.bank'));
    setAttr(lg('bank').chip, 'title', t('launch.src.bank.tip', { v: num(sim.tokenBank) }));
    setText(lg('free').label, t('launch.src.free', { v: num(rate) }));
    setAttr(lg('free').chip, 'title', t('launch.src.free.tip', { core: num(sim.coreComputeRate()), srv: num(srv) }));
    setText(lg('bought').label, t('launch.src.bought'));
    setAttr(lg('bought').chip, 'title', t('launch.buy.tip', { p: oc(sim.tokenPriceK(), false, 0) }));
    setText(lg('short').label, t('launch.src.short'));
    setAttr(lg('short').chip, 'title', t('launch.eta.never'));
  }
}
