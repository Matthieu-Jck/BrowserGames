// contract-notice.ts — CrierBelt's starter contract fulfilled (D101; owner, 2026-10-16: on their
// base the tutorial's copper order bought on for hours, about −2 200 ◉/h, unseen). Once the contract
// has bought its allowance it stops (systems/trade.ts `orderHold` 'fulfilled'); this card says so
// while it stands so, shown more than told — the ore's icon and how many came at the fixed price,
// what it would cost a minute at today's market price — and asks the one question: « Continuer au
// prix du marché » (the logged `starterGo` command) or « Arrêter » (cancelling it: the default, the
// primary button). It waits under a full screen or a side panel, like the night notice beside it;
// nothing is decided while it waits — the order buys nothing in the meantime. Reads the sim, acts
// only through its commands.
import { BAL } from '@/content/balance';
import { el, setAttr, setText } from '@/core/dom';
import { t } from '@/i18n/i18n';
import type { Sim } from '@/sim/state';
import { orderHold } from '@/sim/systems/trade';
import type { ImportOrder } from '@/sim/trade';
import { oc, unitBuyCents } from './trade-view';
import { itemMention, itemRef } from './mention';

export interface ContractNoticeHost {
  sim(): Sim;
  /** A full screen or the naming modal is up: the card waits. */
  covered(): boolean;
  /** A notice in words (the toasts), for what was decided. */
  notify(kind: 'good' | 'info' | 'bad', text: string): void;
}

/** A side panel on show at the right (the inspector, a view's card, the land panel): the card waits. */
const sidePanel = (): boolean => !!document.querySelector('[data-screen="inspector"]:not([hidden]), [data-screen="view"]:not([hidden]), [data-screen="land"]:not([hidden])');

/** The fulfilled starter contract standing, if any. */
const fulfilled = (sim: Sim): ImportOrder | undefined => sim.trade.orders.find((o) => o.starter !== undefined && orderHold(sim, o) === 'fulfilled');

export class ContractNotice {
  readonly root: HTMLElement;
  private readonly title = el('h3.nn-title.lettering');
  private readonly text = el('p.nn-text');
  private readonly price = el('b');
  private readonly icon = el('span.cn-icon');
  private readonly goBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  /** The order on show (0: none). */
  private shownId = 0;

  constructor(private readonly host: ContractNoticeHost) {
    this.goBtn = el<'button'>('button.btn', { type: 'button', 'data-contract-go': '', onclick: () => this.go() });
    this.stopBtn = el<'button'>('button.btn.primary', { type: 'button', 'data-contract-stop': '', onclick: () => this.stop() });
    this.root = el('aside.nnotice.cnotice.cartouche', { 'data-screen': 'contract', hidden: true }, [
      el('div.nn-art.cn-art', {}, [this.icon]),
      el('div.nn-body', {}, [
        this.title, this.text,
        el('div.nn-figs', {}, [el('span.nn-fig', {}, [this.price])]),
        el('div.nn-actions', {}, [this.goBtn, this.stopBtn]),
      ]),
    ]);
  }

  /** Is it on show (FL / the smoke)? */
  get shown(): boolean { return !this.root.hasAttribute('hidden'); }

  /** 4 Hz. */
  refresh(): void {
    const sim = this.host.sim();
    const o = fulfilled(sim);
    if (!o) { this.shownId = 0; setAttr(this.root, 'hidden', ''); return; }
    if (o.id !== this.shownId) {
      this.shownId = o.id;
      this.icon.replaceChildren(itemMention(o.item, { name: false, big: true }));
    }
    const unit = unitBuyCents(sim, o.item), perMin = o.perMin * unit;
    setText(this.title, t('crier.starter.done'));
    setText(this.text, t('crier.starter.done.text', { n: BAL.starter.n, item: itemRef(o.item), cost: oc(perMin) }));
    setText(this.price, t('crier.starter.done.price', { price: oc(unit) }));
    setText(this.goBtn, t('crier.starter.continue'));
    setAttr(this.goBtn, 'title', t('crier.starter.continue.tip', { price: oc(unit), cost: oc(perMin) }));
    setText(this.stopBtn, t('crier.starter.stop'));
    setAttr(this.root, 'hidden', this.host.covered() || sidePanel() ? '' : null);
  }

  /** « Continuer au prix du marché »: an ordinary standing order from now on (one logged command). */
  private go(): void {
    const sim = this.host.sim(), o = fulfilled(sim);
    if (!o) return;
    const cost = o.perMin * unitBuyCents(sim, o.item);
    if (sim.continueStarter(o.id)) this.host.notify('info', t('crier.starter.continued', { item: itemRef(o.item), cost: oc(cost) }));
    this.refresh();
  }

  /** « Arrêter » (the default): the order cancelled; nothing more is bought. */
  private stop(): void {
    const sim = this.host.sim(), o = fulfilled(sim);
    if (!o) return;
    if (sim.cancelImport(o.id)) this.host.notify('info', t('crier.order.cancelled', { item: itemRef(o.item) }));
    this.refresh();
  }
}
