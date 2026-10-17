// kit.test.ts — the panels' kit (D89): numbers written one way everywhere, in both languages; a
// label given as a function follows a language switch by itself (`lang`), for every panel at once.
import { afterAll, describe, expect, it } from 'vitest';
import { setLocale, t } from '@/i18n/i18n';
import { fmt, kw, lang, perMin } from './kit';

/** French groups thousands with U+202F and puts U+00A0 before a unit: compare with plain spaces. */
const plain = (s: string): string => s.replace(/[  ]/g, ' ');

describe('the kit’s number formats', () => {
  afterAll(() => setLocale('fr'));

  it('writes whole items rounded down, small values with up to two decimals, big ones whole', () => {
    setLocale('fr');
    expect(fmt(2.9999, 0)).toBe('2');
    expect(fmt(3, 0)).toBe('3'); // a float a hair under an integer still counts as it
    expect(fmt(13.456)).toBe('13,5');
    expect(fmt(1.234)).toBe('1,23');
    expect(plain(fmt(6482.4))).toBe('6 482');
    expect(fmt(13.46, 1)).toBe('13,5');
  });

  it('writes kilowatts and rates the same way, in French and in English', () => {
    setLocale('fr');
    expect(plain(kw(6482.4))).toBe('6 482 kW');
    expect(plain(perMin(13.4))).toBe('13,4/min');
    setLocale('en');
    expect(kw(6482.4)).toBe('6,482 kW');
    expect(perMin(13.4)).toBe('13.4/min');
  });
});

describe('the kit’s live labels', () => {
  afterAll(() => setLocale('fr'));

  /** Just enough of an element for `lang` (node has no DOM): its text and its attributes. */
  const fake = () => {
    const attrs = new Map<string, string>();
    return { textContent: '', attrs, setAttribute: (k: string, v: string) => { attrs.set(k, v); }, removeAttribute: (k: string) => { attrs.delete(k); } };
  };

  it('says a function label again at each language switch, its text or its tooltip; a plain string stays as given', () => {
    setLocale('fr');
    const title = fake(), tip = fake(), fixed = fake();
    const doc = globalThis as { document?: unknown };
    // The document the kit re-reads on a switch: every node marked `data-lang`.
    doc.document = { querySelectorAll: () => [title, tip, fixed].filter((n) => n.attrs.has('data-lang')) };
    try {
      lang(title as unknown as Element, () => t('kit.state.on'));
      lang(tip as unknown as Element, () => t('kit.state.off'), 'title');
      lang(fixed as unknown as Element, 'Essai');
      expect(title.textContent).toBe('En marche');
      expect(tip.attrs.get('title')).toBe('À l’arrêt');
      expect(fixed.attrs.has('data-lang')).toBe(false);
      setLocale('en');
      expect(title.textContent).toBe('Working');
      expect(tip.attrs.get('title')).toBe('Stopped');
      expect(fixed.textContent).toBe('Essai');
      setLocale('fr');
      expect(title.textContent).toBe('En marche');
    } finally {
      delete doc.document;
    }
  });
});
