// launch-dialog.ts — launching a research, at every tier (D118, D122; owner, 2026-10-17: « Lorsque
// la recherche est sélectionnée et lancée par l'utilisateur, on lui demande s'il veut acheter un flux
// de tokens sur le marché. Combien, et le coût qui va avec. » — then « On va enlever le principe de la
// data… La monnaie pour débloquer les recherches sera uniquement les tokens, et des fois on aura
// besoin de certaines ressources qui font sens »). « Lancer » on any node opens this small dialog
// over the tech tree (screens/research.ts), in the panels' look (D89: the kit's marks, the building
// icons, ink and paper) — icons first, the words on hover (D53, « show, don't tell »):
//   · the node, its icon and name;
//   · the resources it takes from the Core at launch (D122: paid at once, as a plan's; handed back on
//     a cancel): each item's icon, how many, what the Core holds — coral when short;
//   · the tokens it needs, and the free flow it would get now: the Core's compute (from its level 2)
//     and the claim's servers — all of it unless an earlier project still needs tokens (they go in the
//     order projects started; a line says so) —, and the bank's tokens (an older save's data) if any;
//     a coral line when the lab it would run in has no power (it takes no tokens then);
//   · the flow to buy from CrierBelt, tokens a minute on the engine's ladder (`tokenFlowSteps`, up to
//     what would bring every token within a minute), proposed at `tokenBuyDefault` (often 0 at Tier 1:
//     the Core's compute suffices); its price a minute and, at that flow, what it should come to in
//     all. Locked at 0 while the purse is in the red (nothing can be bought then);
//   · when it would be done: its tokens alone (`tokenEtas` with this node appended at the end, as the
//     engine delivers them);
//   · « Annuler » and « Lancer » (the screen's start path: `startResearch(id, 0, buy)`), « Lancer »
//     off while the Core is short of a resource or the node cannot start; Esc or a click outside
//     cancels, Enter launches.
// It reads the sim and asks the host to act; the estimates are pure (`boughtEstimate`, `bankFirst`,
// tested in screens/tree-layout.test.ts). Hooks for tests and the shots: `[data-launch]` (the root),
// `[data-launch-res]` (the resources), `[data-launch-flow]` (the slider), `[data-launch-go]`,
// `[data-launch-cancel]`, `[data-launch-cost]`, `[data-launch-eta]`, `[data-launch-free]`.
import { familyName, nodeName, researchNode } from '@/content/research';
import { itemDef } from '@/content/registry';
import { el, setAttr, setText } from '@/core/dom';
import { num } from '@/i18n/format';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { effectiveCost, tokensLeft } from '@/sim/research/runtime';
import type { Sim } from '@/sim/state';
import { serverRate, tokenEtas, tokenFlowSteps } from '@/sim/systems/research';
import { buildingIcon, itemIcon } from './build-bar';
import { glyph } from './glyphs';
import { mark } from './inspector/kit';
import { minutes, oc } from './trade-view';

export interface LaunchHost {
  sim(): Sim;
  /** Start the node buying `buy` tokens a minute (the screen's start path: it says why when refused). */
  launch(id: string, buy: number): void;
}

/**
 * The tokens a new project would buy in all (D118), appended after the running ones: the free
 * `rate` a minute (the Core's compute and the servers) goes to the projects in order (each to its
 * need), then each buys its flow, at most what it still needs — stretch by stretch at fixed shares,
 * the last minute of each stepped exactly, as `tokenEtas` does. `need`/`buy`: the running projects'
 * tokens still needed (after the bank, `bankFirst`) and flows (0 while the purse is in the red).
 * 0 when no flow ever reaches it.
 */
export function boughtEstimate(rate: number, need: readonly number[], buy: readonly number[], extra: { tokens: number; buy: number }): number {
  const n = [...need, extra.tokens], b = [...buy, extra.buy];
  const x = n.length - 1;
  let total = 0;
  for (let guard = 0; n[x]! > 0 && guard < 64; guard++) {
    let left = rate;
    const s = n.map((v) => { if (v <= 0) return 0; const g = Math.min(v, left); left -= g; return g; });
    const r = n.map((v, i) => (v <= 0 ? 0 : s[i]! + Math.min(b[i]!, v - s[i]!)));
    let step = Infinity;
    n.forEach((v, i) => { if (v > 0 && r[i]! > 0) step = Math.min(step, Math.ceil(v / r[i]!)); });
    if (!Number.isFinite(step)) break;
    // The stretch's whole minutes before its last, at fixed shares…
    total += (r[x]! - s[x]!) * (step - 1);
    n.forEach((v, i) => { if (v > 0) n[i] = v - r[i]! * (step - 1); });
    // …then its last minute, as the boundary delivers it.
    left = rate;
    n.forEach((v, i) => {
      if (v <= 0) return;
      const g = Math.min(v, left);
      left -= g;
      const bb = Math.min(b[i]!, v - g);
      if (i === x) total += bb;
      n[i] = v - g - bb;
    });
  }
  return total;
}

/**
 * What each project still needs once the bank has paid (D122: the tokens an older save's data was
 * worth, given at the next boundary to the projects in the order they started, each to its need).
 */
export function bankFirst(need: readonly number[], bank: number): number[] {
  let left = Math.max(0, bank);
  return need.map((n) => { const k = Math.min(Math.max(0, n), left); left -= k; return n - k; });
}

/** A resource chip of the dialog: its item, and the live « have » under it. */
interface ResChip { item: number; mu: number; node: HTMLElement; have: HTMLElement }

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
  private readonly resSec: HTMLElement;
  private readonly resHead = el('span');
  private readonly resList = el('div.ld-res');
  private res: ResChip[] = [];
  private readonly needRow: HTMLElement;
  private readonly needV = el('b');
  private readonly needLabel = el('small');
  private readonly freeRow: HTMLElement;
  private readonly coreChip: HTMLElement;
  private readonly coreV = el('b');
  private readonly srvChip: HTMLElement;
  private readonly srvV = el('b');
  private readonly freeLabel = el('small');
  private readonly freeMine = el('small.ld-mine');
  private readonly freeNote = el('small.ld-note');
  private readonly bankRow: HTMLElement;
  private readonly bankV = el('b');
  private readonly bankLabel = el('small');
  private readonly powerNote = el('small.ld-note.ld-bad', { 'data-launch-power': '' });
  private readonly buyHead: HTMLElement;
  private readonly buyLabel = el('span');
  private readonly slider: HTMLInputElement;
  private readonly minus: HTMLButtonElement;
  private readonly plus: HTMLButtonElement;
  private readonly flowV = el('b');
  private readonly costV = el('b', { 'data-launch-cost': '' });
  private readonly totalV = el('small');
  private readonly debtNote = el('small.ld-note.ld-bad', { 'data-launch-debt': '' });
  private readonly etaV = el('b.ld-eta', { 'data-launch-eta': '' });
  private readonly goBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  /** The language the resource chips were built in. */
  private resLoc = '';
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
    this.resSec = el('section.ld-sec', { 'data-k': 'res', 'data-launch-res': '' }, [el('div.ld-buyhead', {}, [buildingIcon(atlas, 'hearth', 20), this.resHead]), this.resList]);
    this.needRow = el('div.ld-row', { 'data-k': 'need' }, [mark('token'), this.needV, this.needLabel]);
    // The free flows (D122): the Core's compute (its look) and the servers', side by side.
    this.coreChip = el('span.ld-chip', { 'data-k': 'core' }, [el('span.ld-coreicon'), this.coreV]);
    this.srvChip = el('span.ld-chip', { 'data-k': 'servers' }, [buildingIcon(atlas, 'server', 20), this.srvV]);
    this.freeRow = el('div.ld-row', { 'data-k': 'free', 'data-launch-free': '' }, [this.coreChip, this.srvChip, this.freeLabel, this.freeMine]);
    this.bankRow = el('div.ld-row', { 'data-k': 'bank' }, [mark('store'), this.bankV, this.bankLabel]);
    this.buyHead = el('div.ld-buyhead', {}, [glyph('crier'), this.buyLabel]);
    const card = el('div.ld.cartouche', {
      role: 'dialog', 'aria-modal': 'true',
      onkeydown: (e: KeyboardEvent) => this.key(e),
    }, [
      el('header.ld-head', {}, [this.iconBox, el('div.ld-title', {}, [this.kicker, this.nameEl, this.kindEl])]),
      this.resSec,
      el('section.ld-sec', { 'data-k': 'tokens' }, [this.needRow, this.freeRow, this.freeNote, this.bankRow, this.powerNote]),
      el('section.ld-sec.ld-buy', {}, [
        this.buyHead,
        el('div.ld-slide', {}, [this.minus, this.slider, this.plus, el('span.ld-flow', {}, [mark('token'), this.flowV])]),
        el('div.ld-cost', {}, [this.costV, this.totalV]),
        this.debtNote,
      ]),
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
    const id = this.id, buy = this.steps[this.idx] ?? 0;
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
    this.resSec.hidden = !this.res.length;
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
    // A purse in the red buys nothing (D118): the slider locked at 0.
    if (hold && this.idx !== 0) { this.idx = 0; this.slider.value = '0'; }
    setAttr(this.slider, 'disabled', hold ? '' : null);
    const buy = this.steps[this.idx] ?? 0;

    setText(this.kicker, t('launch.kicker'));
    setText(this.nameEl, nodeName(id)[L]);
    setText(this.kindEl, `${t('tree.rs.tier', { n: r.tier })} · ${r.branch === 'trunk' ? t('tree.rs.trunk') : familyName(r.branch, r.tier, r.spec)[L]}`);

    // Its resources (D122), taken from the Core at launch: have / need, coral when short.
    if (this.resLoc !== `${id}:${L}`) this.buildRes(e.cost, L);
    setText(this.resHead, t('launch.res'));
    setAttr(this.resSec, 'title', t('launch.res.tip'));
    let short = false;
    for (const c of this.res) {
      const have = Math.floor(sim.stock[c.item]! / 1000);
      setText(c.have, t('tree.have', { n: num(have) }));
      setAttr(c.node, 'data-poor', sim.stock[c.item]! < c.mu ? '' : null);
      if (sim.stock[c.item]! < c.mu) short = true;
    }

    // The tokens it needs, and the free flows: the Core's compute and the servers now, and what of
    // them this node would get (they go to the projects in the order they started, each to its need).
    setText(this.needV, num(e.tokens));
    setText(this.needLabel, t('launch.need'));
    setAttr(this.needRow, 'title', t('launch.need.tip', { v: num(e.tokens) }));
    const core = sim.coreComputeRate(), srv = serverRate(sim, satOf), rate = core + srv;
    const hasServers = (sim.graph?.servers.length ?? 0) > 0;
    // A running project whose lab has no power takes nothing this minute (the engine's own rule): it
    // leaves the free flows and the bank to the others.
    const litLab = (lab: number): boolean => { if (!lab) return true; const n = sim.graph?.nodeByEnt.get(lab)?.net ?? -1; return n >= 0 && satOf(n) > 0; };
    const need = bankFirst([...sim.projects.map((p) => (litLab(p.lab) ? tokensLeft(p) : 0)), e.tokens], sim.tokenBank);
    const mineNeed = need.pop()!;
    let left = rate, before = 0;
    need.forEach((n) => { if (n > 0) { before++; left -= Math.min(n, left); } });
    const mine = Math.min(left, mineNeed);
    const coreIcon = this.coreChip.querySelector('.ld-coreicon')!;
    if (coreIcon.getAttribute('data-lv') !== String(sim.hearthLevel)) {
      coreIcon.setAttribute('data-lv', String(sim.hearthLevel));
      coreIcon.replaceChildren(...[buildingIcon(this.atlas, 'hearth', 22, sim.hearthLevel)].filter((n): n is HTMLCanvasElement => !!n));
    }
    setText(this.coreV, t('hud.perMin', { v: num(core) }));
    setAttr(this.coreChip, 'title', core > 0 ? t('launch.core.tip', { v: num(core) }) : t('launch.core.none'));
    setAttr(this.coreChip, 'data-none', core > 0 ? null : '');
    setText(this.srvV, t('hud.perMin', { v: num(srv) }));
    setAttr(this.srvChip, 'title', t('launch.servers.tip', { v: num(srv) }));
    this.srvChip.hidden = !hasServers;
    setText(this.freeLabel, t('launch.free.label'));
    setText(this.freeMine, t('launch.free.mine', { v: num(mine) }));
    setAttr(this.freeMine, 'data-short', mine < Math.min(rate, mineNeed) ? '' : null);
    setAttr(this.freeRow, 'title', t('launch.free.tip', { v: num(rate), m: num(mine) }));
    const note = rate <= 0 ? t('launch.free.none') : before > 0 && mine < rate ? tr('launch.free.queue', { n: before }) : '';
    setText(this.freeNote, note);
    this.freeNote.hidden = !note;
    // The bank (D122): the tokens an older save's data was worth, given before any bought flow.
    this.bankRow.hidden = sim.tokenBank <= 0;
    if (sim.tokenBank > 0) {
      setText(this.bankV, num(sim.tokenBank));
      setText(this.bankLabel, t('launch.bank'));
      setAttr(this.bankRow, 'title', t('launch.bank.tip', { v: num(sim.tokenBank) }));
    }
    // The lab it would run in (the first idle one): without power it takes no tokens.
    const lab = sim.idleLabs()[0] ?? 0;
    const lit = lab > 0 && litLab(lab);
    setText(this.powerNote, t('launch.power'));
    this.powerNote.hidden = !lab || lit;

    // The flow bought from CrierBelt, its price a minute and what it should come to in all.
    setText(this.buyLabel, t('launch.buy'));
    setAttr(this.buyHead, 'title', t('launch.buy.tip', { p: oc(sim.tokenPriceK(), false, 0) }));
    setText(this.flowV, buy > 0 ? t('hud.perMin', { v: num(buy) }) : t('launch.buy.none'));
    setAttr(this.minus, 'disabled', hold || this.idx <= 0 ? '' : null);
    setAttr(this.plus, 'disabled', hold || this.idx >= this.steps.length - 1 ? '' : null);
    setAttr(this.minus, 'title', t('tree.rs.flow.less'));
    setAttr(this.plus, 'title', t('tree.rs.flow.more'));
    const perMin = Math.ceil((buy * sim.tokenPriceK()) / 1000);
    const flows = sim.projects.map((p) => (hold ? 0 : p.buy ?? 0));
    const bought = boughtEstimate(rate, need, flows, { tokens: mineNeed, buy: hold ? 0 : buy });
    const total = Math.ceil((bought * sim.tokenPriceK()) / 1000);
    setText(this.costV, buy > 0 ? t('hud.perMin', { v: oc(perMin, false, perMin < 10_000 ? 2 : 0) }) : t('launch.free'));
    setAttr(this.costV, 'data-free', buy > 0 ? null : '');
    setText(this.totalV, buy > 0 ? t('launch.total', { v: oc(total, false, total < 10_000 ? 2 : 0) }) : '');
    setText(this.debtNote, t('launch.debt'));
    this.debtNote.hidden = !hold;

    // When it would be done: its tokens, as the engine would deliver them (this node last). No end:
    // no flow reaches it at this pace (the slider can change that), or its lab has no power.
    const etas = tokenEtas(sim, satOf, { tokens: e.tokens, buy });
    const end = etas[etas.length - 1] ?? Infinity;
    const ok = Number.isFinite(end) && (lit || !lab);
    setText(this.etaV, !lit && lab ? t('launch.eta.noPower') : ok ? t('launch.eta', { d: minutes(Math.max(1, end)) }) : t('launch.eta.never'));
    setAttr(this.etaV, 'data-never', ok ? null : '');
    setAttr(this.etaV, 'title', t('launch.eta.tip'));

    // The actions; « Lancer » off while the Core is short of a resource or the node cannot start any more (a lab taken meanwhile…).
    setText(this.goBtn, t('research.start'));
    setText(this.cancelBtn, t('launch.cancel'));
    const block = sim.researchBlock(id);
    setAttr(this.goBtn, 'disabled', block || short ? '' : null);
    setAttr(this.goBtn, 'title', block ? tr(`research.block.${block}` as MsgKey) : null);
  }
}
