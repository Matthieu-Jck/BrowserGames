// kit.test.ts — the panels' kit (D89): numbers written one way everywhere, in both languages.
import { afterAll, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import { fmt, kw, perMin } from './kit';

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
