// keycap.test.ts — the hints name the pipette's key as the player's keyboard prints it (keycap.ts):
// the language's guess until the keyboard tells, then the letter at its position.
import { afterAll, beforeEach, describe, it, expect } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import { BINDINGS } from '@/input/bindings';
import { forgetKeys, keyCap, noteKey, pipetteCap, PIPETTE_CODE } from './keycap';

describe('the pipette’s key cap', () => {
  beforeEach(() => { forgetKeys(); setLocale('fr'); });
  afterAll(() => { forgetKeys(); setLocale('fr'); });

  it('sits where the pipette is bound', () => {
    expect(BINDINGS.pipette.codes).toEqual([PIPETTE_CODE]);
  });

  it('is the language’s guess while the keyboard has said nothing: A in French, Q in English', () => {
    expect(keyCap(PIPETTE_CODE)).toBe(null);
    expect(pipetteCap()).toBe('A');
    setLocale('en');
    expect(pipetteCap()).toBe('Q');
  });

  it('follows the keyboard, not the language: AZERTY’s A for an English player, QWERTY’s Q for a French one', () => {
    setLocale('en');
    noteKey('KeyW', 'z'); // panning up with Z on AZERTY
    expect(pipetteCap()).toBe('A');
    forgetKeys();
    setLocale('fr');
    noteKey('KeyW', 'w'); // panning up with W on QWERTY
    expect(pipetteCap()).toBe('Q');
    forgetKeys();
    noteKey('KeyA', 'q'); // AZERTY's Q, where QWERTY has A
    expect(pipetteCap()).toBe('A');
  });

  it('takes a key seen at the pipette’s own place over a layout’s signature', () => {
    noteKey(PIPETTE_CODE, 'q');
    noteKey('KeyA', 'q'); // an odd layout: its signature says nothing over a key seen
    expect(pipetteCap()).toBe('Q');
    noteKey(PIPETTE_CODE, 'Shift'); // not a letter: ignored
    expect(pipetteCap()).toBe('Q');
  });
});
