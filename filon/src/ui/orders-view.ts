// orders-view.ts — what the Crier's orders tab, the HUD's chip, the first order's notice and the
// shell's notices share about CrierBelt's delivery orders and the claims' standings (D153): a special
// reward as a chip (its icon and figure, its words on hover) or in words, the time an order has left,
// how much more it pays than a sale at the post, a rank as an ordinal, a claim's name. Reads the sim
// and the content; never writes.
import { BAL } from '@/content/balance';
import { buildingDef, buildingIdx } from '@/content/registry';
import { nodeName } from '@/content/research';
import { el } from '@/core/dom';
import { locale, t } from '@/i18n/i18n';
import type { ColonyView } from '@/market/types';
import type { Atlas } from '@/render/art/atlas';
import { EPOCH, TPS } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { orderSecondsLeft, type DeliveryOrder, type OrderReward } from '@/sim/systems/orders';
import { buildingIcon } from './build-bar';
import { mark } from './inspector/kit';
import { oc, ocNum } from './trade-view';

/** A rank as an ordinal: « 1re », « 23e » · "1st", "23rd". */
export function ordinal(n: number): string {
  if (locale() === 'fr') return n === 1 ? '1re' : `${n}e`;
  const r = new Intl.PluralRules('en', { type: 'ordinal' }).select(n);
  return `${n}${({ one: 'st', two: 'nd', few: 'rd' } as Record<string, string>)[r] ?? 'th'}`;
}

/** Another claim's name (a colony of the Crier), or the player's for −1. */
export const claimName = (colonies: readonly ColonyView[], colony: number, own: string): string =>
  colony < 0 ? own || t('rank.you') : colonies[colony]?.name[locale()] ?? '?';

const kitName = (def: string): string => buildingDef(buildingIdx(def)).name[locale()];

/** A reward in words (a notice's « En plus : … »). */
export function rewardText(r: OrderReward): string {
  switch (r.k) {
    case 'credits': return t('delivery.reward.credits', { v: oc(r.cents, false, 0) });
    case 'kit': return t('delivery.reward.kit', { n: r.n, name: kitName(r.def) });
    case 'node': return t('delivery.reward.node', { name: nodeName(r.id)[locale()] });
  }
}

/** A reward's sentence on hover. */
export function rewardTip(r: OrderReward): string {
  switch (r.k) {
    case 'credits': return t('delivery.reward.credits.tip', { v: oc(r.cents, false, 0) });
    case 'kit': return t('delivery.reward.kit.tip', { n: r.n, name: kitName(r.def) });
    case 'node': return t('delivery.reward.node.tip', { name: nodeName(r.id)[locale()] });
  }
}

/** A reward as a chip: the ocelle and « +150 », the kit's building and « ×2 », the tree's mark and the node's name. */
export function rewardChip(atlas: Atlas, r: OrderReward): HTMLElement {
  const icon = r.k === 'kit' ? buildingIcon(atlas, r.def, 22) ?? mark('build') : r.k === 'credits' ? el('span.cr-coin', {}, '◉') : mark('tree');
  const label = r.k === 'credits' ? `+${ocNum(r.cents, false, 0)}` : r.k === 'kit' ? `×${r.n}` : nodeName(r.id)[locale()];
  return el('span.dl-reward', { 'data-reward': r.k, title: rewardTip(r) }, [el('span.dl-reward-i', {}, icon), el('b', {}, label)]);
}

/** Game seconds an order has left: of its window once accepted, of its offer before. */
export const orderLeft = (sim: Sim, o: DeliveryOrder): number => orderSecondsLeft(sim, o, TPS, EPOCH);

/** How much more an order pays an item than a sale at the post now (a ratio: 0.45 = 45 % more), from today's bid less CrierBelt's fee. */
export function overSale(sim: Sim, o: DeliveryOrder): number {
  const bid = sim.prices.bid[o.item] ?? 0;
  const sale = (bid * (1000 - Math.max(sim.mods.tradeFee, 0))) / 1000;
  return sale > 0 ? o.cents / sale - 1 : 0;
}

/** The window an order is given, for its offer's words. */
export const windowSeconds = (o: DeliveryOrder): number => o.windowMin * (EPOCH / TPS);

/** Seconds of game time until the next order may be posted (the world's clock: every `BAL.orders.everyMin` minutes). */
export function nextPostIn(sim: Sim): number {
  const every = BAL.orders.everyMin, now = sim.absEpoch();
  const next = (Math.floor(now / every) + 1) * every;
  return (next - now) * (EPOCH / TPS) - (sim.tick % EPOCH) / TPS;
}

/** Seconds of game time until the next standings (every `BAL.ranking.everyMin` world minutes). */
export function nextStandingsIn(sim: Sim): number {
  const every = BAL.ranking.everyMin, now = sim.absEpoch();
  const next = (Math.floor(now / every) + 1) * every;
  return (next - now) * (EPOCH / TPS) - (sim.tick % EPOCH) / TPS;
}
