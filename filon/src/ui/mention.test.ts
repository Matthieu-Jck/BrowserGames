// mention.test.ts — the item mention's text side (the DOM side runs in the browser, under the
// smoke test): a reference names an item by id, survives `t()` filling and lists, reads as the
// item's name in each language (`plain`), splits into text and items in order, marks the item a
// plain-worded label names (`markItems`), and an unknown item fails loudly instead of leaving a
// stray token on screen.
import { afterEach, describe, expect, it } from 'vitest';
import { itemIdx } from '@/content/registry';
import { setLocale, t } from '@/i18n/i18n';
import { hasRef, itemList, itemRef, markItems, nameOf, plain, splitRefs } from './mention';

describe('item mentions', () => {
  afterEach(() => setLocale('fr'));

  it('a reference is a short token, by index or by id', () => {
    expect(itemRef('iron_ore')).toBe('⟪i:iron_ore⟫');
    expect(itemRef(itemIdx('iron_ore'))).toBe('⟪i:iron_ore⟫');
    expect(hasRef(itemRef('glass'))).toBe(true);
    expect(hasRef('Verre')).toBe(false);
    expect(() => itemRef('no_such_item')).toThrow();
  });

  it('goes through a translated sentence and reads as the name, in each language', () => {
    setLocale('fr');
    const fr = t('toast.vein', { n: 12, item: itemRef('copper_ore') });
    expect(fr).toContain('⟪i:copper_ore⟫');
    expect(plain(fr)).toContain('Minerai de cuivre');
    expect(plain(fr)).not.toContain('⟪');
    setLocale('en');
    expect(plain(fr)).toContain('Copper Ore'); // resolved when read: a language switch renames it
    expect(nameOf('glass')).toBe('Glass');
  });

  it('lists several items in the language’s own way', () => {
    setLocale('fr');
    expect(plain(itemList(['iron_ore', 'coal', 'glass']))).toBe('Minerai de fer, Charbon et Verre');
    setLocale('en');
    expect(plain(itemList(['iron_ore', 'coal']))).toBe('Iron Ore and Coal');
    expect(plain(itemList(['iron_ore', 'coal'], 'disjunction'))).toBe('Iron Ore or Coal');
  });

  it('marks the item a plain-worded text names (whole words, any case), keeping its own words', () => {
    setLocale('fr');
    expect(markItems('Charbon jusqu’à la fonderie', ['coal'])).toBe('⟪i:coal⟫ jusqu’à la fonderie');
    expect(markItems('Du charbon pour elle : un routeur sur le ruban du charbon', ['coal']))
      .toBe('Du ⟪i:coal|charbon⟫ pour elle : un routeur sur le ruban du charbon'); // the first time only
    expect(plain(markItems('Le verre coule', ['glass']))).toBe('Le verre coule');
    expect(markItems('Minerai au Cœur', ['iron_ore', 'coal'])).toBe('Minerai au Cœur');
    expect(markItems('Sables du nord', ['sand'])).toBe('Sables du nord');
    setLocale('en');
    expect(markItems('Iron ore to the smelter', ['iron_ore'])).toBe('⟪i:iron_ore|Iron ore⟫ to the smelter');
    expect(splitRefs('Iron ore to the smelter'.replace('Iron ore', itemRef('iron_ore', 'Iron ore'))))
      .toEqual([{ item: 'iron_ore', words: 'Iron ore' }, ' to the smelter']);
  });

  it('splits a text into words and items, in order', () => {
    expect(splitRefs(`Livraison : 3 × ${itemRef('iron_plate')} et ${itemRef('glass')}.`)).toEqual([
      'Livraison : 3 × ', { item: 'iron_plate' }, ' et ', { item: 'glass' }, '.',
    ]);
    expect(splitRefs(itemRef('sand'))).toEqual([{ item: 'sand' }]);
    expect(splitRefs('rien')).toEqual(['rien']);
  });
});
