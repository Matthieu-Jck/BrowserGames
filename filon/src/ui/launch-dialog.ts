// launch-dialog.ts — launching a research from Tier 2 (D118; owner, 2026-10-17: « Lorsque la
// recherche est sélectionnée et lancée par l'utilisateur, on lui demande s'il veut acheter un flux de
// tokens sur le marché. Combien, et le coût qui va avec. Le temps pour débloquer la recherche dépend
// uniquement du temps pour acheminer la data au labo, et pour avoir le nombre de tokens requis. »).
// « Lancer » on a Tier 1 node starts it at once (data alone); from Tier 2 the tech tree opens this
// small dialog over itself (screens/research.ts), in the panels' look (D89: the kit's marks, the
// building icons, ink and paper) — icons first, the words on hover (D53, « show, don't tell »):
//   · the node, its icon and name;
//   · the tokens it needs, and the claim's servers: their flow now and what of it this node would get
//     (they serve the projects in the order they started: all of it unless an earlier one still needs
//     tokens — a line says so);
//   · the flow to buy from CrierBelt, tokens a minute on the engine's ladder (`tokenFlowSteps`, up to
//     what would bring every token within a minute), proposed at `tokenBuyDefault`; its price a minute
//     and, at that flow, what it should come to in all;
//   · when it would be done: its tokens (`tokenEtas` with this node appended at the end, as the engine
//     delivers them) and its data — for each kind, what it owes less what the first idle lab already
//     holds, over the base's production of it (the statistics' last ten minutes) — the later of the
//     two, « ≈ », and a plain word when nothing makes a kind of data;
//   · « Annuler » and « Lancer » (the screen's start path: `startResearch(id, 0, buy)`); Esc or a click
//     outside cancels, Enter launches.
// It reads the sim and asks the host to act; the estimates are pure (`boughtEstimate`, `dataMinutes`,
// tested in screens/tree-layout.test.ts). Hooks for tests and the shots: `[data-launch]` (the root),
// `[data-launch-flow]` (the slider), `[data-launch-go]`, `[data-launch-cancel]`, `[data-launch-cost]`,
// `[data-launch-eta]`.
import { itemDef } from '@/content/registry';
import { familyName, nodeName, researchNode } from '@/content/research';
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
  /** The base's production of an item now, items a minute; null while not measured yet. */
  dataRate?(item: number): number | null;
  /** Start the node buying `buy` tokens a minute (the screen's start path: it says why when refused). */
  launch(id: string, buy: number): void;
}

/**
 * The tokens a new project would buy in all (D118), appended after the running ones: the servers'
 * `rate` a minute goes to the projects in order (each to its need), then each buys its flow, at most
 * what it still needs — stretch by stretch at fixed shares, the last minute of each stepped exactly,
 * as `tokenEtas` does. `need`/`buy`: the running projects' tokens still needed and flows (0 while the
 * purse is in the red). 0 when no flow ever reaches it.
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
 * Minutes until each kind of a node's data would be in its lab (D118): what it owes (milli-items)
 * less what the lab already holds, over the base's production of it (items a minute). 0: already
 * there; null: the production not measured yet; Infinity: nothing makes it.
 */
export function dataMinutes(
  owed: ReadonlyArray<{ item: number; mu: number }>, held: (item: number) => number, rate: (item: number) => number | null,
): Array<{ item: number; left: number; min: number | null }> {
  return owed.map((c) => {
    const left = Math.max(0, Math.ceil((c.mu - held(c.item)) / 1000));
    if (left <= 0) return { item: c.item, left: 0, min: 0 };
    const r = rate(c.item);
    if (r === null) return { item: c.item, left, min: null };
    return { item: c.item, left, min: r > 1e-6 ? Math.max(1, Math.ceil(left / r)) : Infinity };
  });
}

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
  private readonly needRow: HTMLElement;
  private readonly needV = el('b');
  private readonly needLabel = el('small');
  private readonly srvRow: HTMLElement;
  private readonly srvV = el('b');
  private readonly srvLabel = el('small');
  private readonly srvMine = el('small.ld-mine');
  private readonly srvNote = el('small.ld-note');
  private readonly buyHead: HTMLElement;
  private readonly buyLabel = el('span');
  private readonly slider: HTMLInputElement;
  private readonly minus: HTMLButtonElement;
  private readonly plus: HTMLButtonElement;
  private readonly flowV = el('b');
  private readonly costV = el('b', { 'data-launch-cost': '' });
  private readonly totalV = el('small');
  private readonly etaV = el('b.ld-eta', { 'data-launch-eta': '' });
  private readonly parts = el('div.ld-parts');
  private partsSig = '';
  private readonly goBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
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
    this.needRow = el('div.ld-row', { 'data-k': 'need' }, [mark('token'), this.needV, this.needLabel]);
    this.srvRow = el('div.ld-row', { 'data-k': 'servers' }, [buildingIcon(atlas, 'server', 22), this.srvV, this.srvLabel, this.srvMine]);
    this.buyHead = el('div.ld-buyhead', {}, [glyph('crier'), this.buyLabel]);
    const card = el('div.ld.cartouche', {
      role: 'dialog', 'aria-modal': 'true',
      onkeydown: (e: KeyboardEvent) => this.key(e),
    }, [
      el('header.ld-head', {}, [this.iconBox, el('div.ld-title', {}, [this.kicker, this.nameEl, this.kindEl])]),
      el('section.ld-sec', { 'data-k': 'tokens' }, [this.needRow, this.srvRow, this.srvNote]),
      el('section.ld-sec.ld-buy', {}, [
        this.buyHead,
        el('div.ld-slide', {}, [this.minus, this.slider, this.plus, el('span.ld-flow', {}, [mark('token'), this.flowV])]),
        el('div.ld-cost', {}, [this.costV, this.totalV]),
      ]),
      el('section.ld-sec.ld-end', {}, [this.etaV, this.parts]),
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

  /** Open it for a node (its first icon, drawn by the tree), the flow at the engine's proposal. */
  open(id: string, icon: Node | null): void {
    const sim = this.host.sim();
    this.id = id;
    const e = effectiveCost(id, sim.mods);
    this.steps = tokenFlowSteps(e.tokens);
    const def = sim.tokenBuyDefault(id);
    const k = this.steps.findIndex((v) => v >= def);
    this.idx = k < 0 ? this.steps.length - 1 : k;
    setAttr(this.slider, 'max', String(this.steps.length - 1));
    this.slider.value = String(this.idx);
    this.iconBox.replaceChildren(...(icon ? [icon] : []));
    this.partsSig = '';
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

  /** The figures at this flow, now (4 Hz from the tree, and on every move of the slider). */
  refresh(): void {
    if (!this.id) return;
    const sim = this.host.sim();
    const id = this.id, L = locale();
    const r = researchNode(id);
    if (!r) { this.close(); return; }
    const e = effectiveCost(id, sim.mods);
    const satOf = (net: number): number => sim.netPower[net]?.sat ?? 0;
    const buy = this.steps[this.idx] ?? 0;
    const hold = sim.credits < 0;

    setText(this.kicker, t('launch.kicker'));
    setText(this.nameEl, nodeName(id)[L]);
    setText(this.kindEl, `${t('tree.rs.tier', { n: r.tier })} · ${r.branch === 'trunk' ? t('tree.rs.trunk') : familyName(r.branch, r.tier, r.spec)[L]}`);

    // The tokens it needs, and the servers: their flow now, and what of it this node would get (they
    // go to the projects in the order they started, each to its need).
    setText(this.needV, num(e.tokens));
    setText(this.needLabel, t('launch.need'));
    setAttr(this.needRow, 'title', t('launch.need.tip', { v: num(e.tokens) }));
    const rate = serverRate(sim, satOf);
    let left = rate, before = 0;
    for (const p of sim.projects) { const n = tokensLeft(p); if (n > 0) { before++; left -= Math.min(n, left); } }
    const mine = Math.min(left, e.tokens);
    const hasServers = (sim.graph?.servers.length ?? 0) > 0;
    setText(this.srvV, t('hud.perMin', { v: num(rate) }));
    setText(this.srvLabel, t('launch.servers'));
    setText(this.srvMine, t('launch.servers.mine', { v: num(mine) }));
    setAttr(this.srvRow, 'data-none', hasServers ? null : '');
    setAttr(this.srvMine, 'data-short', mine < Math.min(rate, e.tokens) ? '' : null);
    setAttr(this.srvRow, 'title', t('launch.servers.tip', { v: num(rate), m: num(mine) }));
    const note = !hasServers ? t('launch.servers.none') : before > 0 && mine < rate ? tr('launch.servers.queue', { n: before }) : '';
    setText(this.srvNote, note);
    this.srvNote.hidden = !note;

    // The flow bought from CrierBelt, its price a minute and what it should come to in all.
    setText(this.buyLabel, t('launch.buy'));
    setAttr(this.buyHead, 'title', t('launch.buy.tip', { p: oc(sim.tokenPriceK(), false, 0) }));
    setText(this.flowV, buy > 0 ? t('hud.perMin', { v: num(buy) }) : t('launch.buy.none'));
    setAttr(this.minus, 'disabled', this.idx <= 0 ? '' : null);
    setAttr(this.plus, 'disabled', this.idx >= this.steps.length - 1 ? '' : null);
    setAttr(this.minus, 'title', t('tree.rs.flow.less'));
    setAttr(this.plus, 'title', t('tree.rs.flow.more'));
    const perMin = Math.ceil((buy * sim.tokenPriceK()) / 1000);
    const need = sim.projects.map((p) => tokensLeft(p)), flows = sim.projects.map((p) => (hold ? 0 : p.buy ?? 0));
    const bought = boughtEstimate(rate, need, flows, { tokens: e.tokens, buy: hold ? 0 : buy });
    const total = Math.ceil((bought * sim.tokenPriceK()) / 1000);
    setText(this.costV, buy > 0 ? t('hud.perMin', { v: oc(perMin, false, perMin < 10_000 ? 2 : 0) }) : t('launch.free'));
    setAttr(this.costV, 'data-free', buy > 0 ? null : '');
    setText(this.totalV, buy > 0 ? t('launch.total', { v: oc(total, false, total < 10_000 ? 2 : 0) }) : '');

    // When it would be done: its tokens (as the engine would deliver them, this node last) and its
    // data (what the first idle lab lacks over the base's production), the later of the two.
    const etas = tokenEtas(sim, satOf, { tokens: e.tokens, buy });
    const tokMin = etas[etas.length - 1] ?? Infinity;
    const lab = sim.idleLabs()[0] ?? 0;
    const store = lab ? sim.stores.get(lab) : undefined;
    const data = dataMinutes(e.cost, (item) => store?.[item] ?? 0, (item) => this.host.dataRate?.(item) ?? null);
    let end = tokMin;
    for (const d of data) if (d.min !== null) end = Math.max(end, d.min);
    // No end: the token flow reaches it never (« at this pace »: the slider can change that), or a kind
    // of its data is made nowhere in the base (no flow bought helps).
    setText(this.etaV, Number.isFinite(end) ? t('launch.eta', { d: minutes(end) }) : Number.isFinite(tokMin) ? t('launch.eta.noData') : t('launch.eta.never'));
    setAttr(this.etaV, 'data-never', Number.isFinite(end) ? null : '');
    setAttr(this.etaV, 'title', t('launch.eta.tip'));
    const val = (m: number | null, left = 0): { text: string; tone: string | null } => m === null ? { text: t('launch.data.unknown'), tone: 'unknown' }
      : m === Infinity ? { text: left > 0 ? t('launch.data.none') : t('launch.never'), tone: 'never' }
        : m === 0 ? { text: t('launch.data.here'), tone: 'here' } : { text: t('launch.approx', { d: minutes(m) }), tone: null };
    const sig = `${L}:${tokMin}:${data.map((d) => `${d.item}=${d.left}/${d.min}`).join(',')}`;
    if (sig !== this.partsSig) {
      this.partsSig = sig;
      const tv = Number.isFinite(tokMin) ? { text: t('launch.approx', { d: minutes(tokMin) }), tone: null } : { text: t('launch.never'), tone: 'never' };
      const chips: HTMLElement[] = [
        el('span.ld-part', { 'data-k': 'tokens', 'data-tone': tv.tone, title: t('launch.part.tokens', { d: tv.text }) }, [mark('token'), el('span', {}, tv.text)]),
      ];
      for (const d of data) {
        const name = itemDef(d.item).name[L];
        const v = val(d.min, d.left);
        const tip = d.min === null ? t('launch.data.unknown.tip', { item: name })
          : d.min === Infinity ? t('launch.data.none.tip', { item: name })
            : d.min === 0 ? t('launch.data.here.tip', { item: name })
              : t('launch.data.rate', { item: name, n: num(d.left), r: num(Math.round((this.host.dataRate?.(d.item) ?? 0) * 10) / 10), d: minutes(d.min) });
        chips.push(el('span.ld-part', { 'data-k': 'data', 'data-tone': v.tone, title: tip }, [itemIcon(this.atlas, d.item, 18), el('span', {}, v.text)]));
      }
      this.parts.replaceChildren(...chips);
    }

    // The actions; « Lancer » off if the node cannot start any more (a lab taken meanwhile…).
    setText(this.goBtn, t('research.start'));
    setText(this.cancelBtn, t('launch.cancel'));
    const block = sim.researchBlock(id);
    setAttr(this.goBtn, 'disabled', block ? '' : null);
    setAttr(this.goBtn, 'title', block ? tr(`research.block.${block}` as MsgKey) : null);
  }
}
