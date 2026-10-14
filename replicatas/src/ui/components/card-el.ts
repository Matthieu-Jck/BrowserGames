// card-el.ts — renders one card (def or instance) to a DOM node, with archetype
// art, rarity frame and keyword tooltips.
import { el } from '../dom';
import { keywordize } from './tooltip';
import type { CardInstance } from '@/combat/combat-types';
import { getCard, effectiveCard } from '@/content/registry';
import { cardArt } from '@/vfx/textures';

const RARITY_LABEL: Record<string, string> = {
  starter: 'Starter', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', special: 'Paradox',
};

export function cardEl(inst: CardInstance, opts: { price?: number } = {}): HTMLElement {
  const def = effectiveCard(inst);
  const node = el('div.card', { 'data-arch': def.archetype, 'data-rarity': def.rarity, 'data-uid': inst.uid });
  if (inst.refitted) node.classList.add('refitted');
  const cost = def.cost === 'X' ? 'X' : String(def.cost);
  const rarity = def.archetype === 'status' ? (def.kind === 'curse' ? 'Curse' : 'Status') : (RARITY_LABEL[def.rarity] ?? def.rarity);
  node.append(
    el('div.c-cost', {}, cost),
    el('div.c-name', {}, def.name),
    el('img.c-art', { src: cardArt(inst.cardId, def.archetype), draggable: 'false' }),
    el('div.c-kind', {}, [
      el('span.c-rarity', {}, rarity),
      el('span', {}, ' · '),
      el('span', {}, def.kind === 'statusCard' ? 'status' : def.kind),
    ]),
    el('div.c-text', { html: keywordize(def.text) }),
  );
  if (opts.price != null) node.append(el('div.price', {}, `${opts.price} M`));
  return node;
}

export function cardElById(cardId: string, opts: { price?: number; refitted?: boolean } = {}): HTMLElement {
  getCard(cardId);
  return cardEl({ uid: `view_${cardId}_${Math.random().toString(36).slice(2, 7)}`, cardId, refitted: opts.refitted ?? false }, opts);
}
