// order-notice.ts — CrierBelt's first delivery order (D153), the tutorial's next step: right after
// « Les pièces de la Synthèse » the Core holds hundreds of quartz it has no use for (D146's problem 7),
// and CrierBelt asks for some. A card in the notices' column (top right, with the night notice and
// the starter contract's) says it in CrierBelt's voice — the quartz's icon, how many, in how long, what
// it pays —, and that the trade post sells what its entrance takes; « Accepter » (the logged
// `acceptDelivery` command) or « Voir les commandes » (the Crier's Commandes tab). It stands while
// that order is an offer, waits under a full screen or a side panel like the others, and a ✕ puts it
// away for the session (the order stays in the Crier and on the HUD's chip). The quest table is
// untouched: the hook is the order itself. Reads the sim, acts only through its commands.
import { el, setAttr, setText } from '@/core/dom';
import { t } from '@/i18n/i18n';
import type { Sim } from '@/sim/state';
import { orderPay, type DeliveryOrder } from '@/sim/systems/orders';
import { itemMention, itemRef, richNodes } from './mention';
import { minutes, oc } from './trade-view';

export interface OrderNoticeHost {
  sim(): Sim;
  /** A full screen or the naming modal is up: the card waits. */
  covered(): boolean;
  /** A notice in words (the toasts), for what was decided. */
  notify(kind: 'good' | 'info' | 'bad', text: string): void;
  /** The Crier on its Commandes tab. */
  openOrders(): void;
}

/** A side panel on show at the right (the inspector, a view's card, the land panel): the card waits. */
const sidePanel = (): boolean => !!document.querySelector('[data-screen="inspector"]:not([hidden]), [data-screen="view"]:not([hidden]), [data-screen="land"]:not([hidden])');

/** CrierBelt's first order, while it is an offer. */
const firstOffer = (sim: Sim): DeliveryOrder | undefined => sim.deliveries.open.find((o) => o.first && o.due < 0);

export class OrderNotice {
  readonly root: HTMLElement;
  private readonly title = el('h3.nn-title.lettering');
  private readonly text = el('p.nn-text');
  private readonly icon = el('span.on-icon');
  private readonly n = el('b');
  private readonly pay = el('b');
  private readonly window = el('b');
  private readonly acceptBtn: HTMLButtonElement;
  private readonly seeBtn: HTMLButtonElement;
  /** The order on show (0: none), and the one put away for this session. */
  private shownId = 0;
  private dismissed = 0;
  private textKey = '';

  constructor(private readonly host: OrderNoticeHost) {
    this.acceptBtn = el<'button'>('button.btn.primary', { type: 'button', 'data-order-accept': '', onclick: () => this.accept() });
    this.seeBtn = el<'button'>('button.btn', { type: 'button', 'data-order-see': '', onclick: () => host.openOrders() });
    this.root = el('aside.nnotice.onotice.cartouche', { 'data-screen': 'order-notice', hidden: true }, [
      el('div.nn-art.on-art', {}, [this.icon]),
      el('div.nn-body', {}, [
        el('div.on-top', {}, [this.title, el('button.on-x', { type: 'button', 'aria-label': '✕', onclick: () => { this.dismissed = this.shownId; this.refresh(); } }, '✕')]),
        this.text,
        el('div.nn-figs', {}, [el('span.nn-fig', {}, [this.n]), el('span.nn-fig', { 'data-k': 'night' }, [this.window]), el('span.nn-fig', {}, [this.pay])]),
        el('div.nn-actions', {}, [this.seeBtn, this.acceptBtn]),
      ]),
    ]);
  }

  /** Is it on show (FL / the smoke)? */
  get shown(): boolean { return !this.root.hasAttribute('hidden'); }

  /** 4 Hz. */
  refresh(): void {
    const sim = this.host.sim();
    const o = firstOffer(sim);
    if (!o || o.id === this.dismissed) { this.shownId = 0; setAttr(this.root, 'hidden', ''); return; }
    if (o.id !== this.shownId) {
      this.shownId = o.id;
      this.icon.replaceChildren(itemMention(o.item, { name: false, big: true }));
    }
    const text = t('delivery.first.text', { n: o.n, item: itemRef(o.item), d: minutes(o.windowMin), pay: oc(orderPay(o), false, 0) });
    if (text !== this.textKey) { this.textKey = text; this.text.replaceChildren(...richNodes(text)); }
    setText(this.title, t('delivery.first.title'));
    setText(this.n, `${o.n} ×`);
    setText(this.window, minutes(o.windowMin));
    setText(this.pay, oc(orderPay(o), false, 0));
    setText(this.acceptBtn, t('delivery.accept'));
    setAttr(this.acceptBtn, 'title', t('delivery.accept.tip', { d: minutes(o.windowMin) }));
    setText(this.seeBtn, t('delivery.first.see'));
    setAttr(this.root, 'hidden', this.host.covered() || sidePanel() ? '' : null);
  }

  /** « Accepter »: the order's window starts (one logged command). */
  private accept(): void {
    const sim = this.host.sim(), o = firstOffer(sim);
    if (!o) return;
    if (sim.acceptDelivery(o.id)) this.host.notify('good', t('delivery.accepted', { n: o.n, item: itemRef(o.item), d: minutes(o.windowMin) }));
    this.refresh();
  }
}
