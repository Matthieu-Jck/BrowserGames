import { describe, it, expect } from 'vitest';
import { resolveKey, type KeyEventLike } from './bindings';

const k = (code: string, key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike =>
  ({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('key bindings', () => {
  it('movement and the pipette follow the key position (AZERTY plays ZQSD, pipette on A)', () => {
    // AZERTY: z q s d sit on the KeyW KeyA KeyS KeyD positions, a on KeyQ.
    expect(resolveKey(k('KeyW', 'z'))).toEqual({ action: 'panUp' });
    expect(resolveKey(k('KeyA', 'q'))).toEqual({ action: 'panLeft' });
    expect(resolveKey(k('KeyQ', 'a'))).toEqual({ action: 'pipette' });
    // QWERTY: the same positions.
    expect(resolveKey(k('KeyW', 'w'))).toEqual({ action: 'panUp' });
    expect(resolveKey(k('KeyQ', 'q'))).toEqual({ action: 'pipette' });
  });

  it('the digit row picks build slots by position, with or without the AZERTY shift', () => {
    expect(resolveKey(k('Digit1', '&'))).toEqual({ slot: 0, shift: false });
    expect(resolveKey(k('Digit6', '-'))).toEqual({ slot: 5, shift: false }); // AZERTY's minus is the 6
    expect(resolveKey(k('Digit0', 'à'))).toEqual({ slot: 9, shift: false });
    expect(resolveKey(k('Digit2', '2', { shiftKey: true }))).toEqual({ slot: 1, shift: true });
  });

  it('zoom keys sit right of the digit row on both layouts, and on the numpad', () => {
    expect(resolveKey(k('Minus', '-'))).toEqual({ action: 'zoomOut' }); // QWERTY -
    expect(resolveKey(k('Minus', ')'))).toEqual({ action: 'zoomOut' }); // AZERTY )
    expect(resolveKey(k('Equal', '='))).toEqual({ action: 'zoomIn' });
    expect(resolveKey(k('NumpadSubtract', '-'))).toEqual({ action: 'zoomOut' });
    expect(resolveKey(k('NumpadAdd', '+'))).toEqual({ action: 'zoomIn' });
  });

  it('mnemonic actions follow the layout letter', () => {
    expect(resolveKey(k('Semicolon', 'm'))).toEqual({ action: 'scrMarket' }); // AZERTY M
    expect(resolveKey(k('KeyM', 'm'))).toEqual({ action: 'scrMarket' });
    expect(resolveKey(k('KeyB', 'b'))).toEqual({ action: 'build' });
    expect(resolveKey(k('KeyT', 't'))).toEqual({ action: 'scrResearch' });
    expect(resolveKey(k('KeyI', 'i'))).toEqual({ action: 'land' }); // the land mode (D60), both layouts
    // The specialised views (D88): P, F, O on both layouts (I is the Terrain view: the land mode).
    expect(resolveKey(k('KeyP', 'p'))).toEqual({ action: 'viewPower' });
    expect(resolveKey(k('KeyF', 'f'))).toEqual({ action: 'viewLogistics' });
    expect(resolveKey(k('KeyO', 'o'))).toEqual({ action: 'viewProduction' });
  });

  it('with Ctrl / Cmd only the chords exist: undo, copy, paste (by letter: AZERTY Ctrl+Z is not a pan); Z, C, V alone are not them', () => {
    expect(resolveKey(k('KeyW', 'z', { ctrlKey: true }))).toEqual({ action: 'undo' });
    expect(resolveKey(k('KeyZ', 'z', { metaKey: true }))).toEqual({ action: 'undo' });
    expect(resolveKey(k('KeyC', 'c', { ctrlKey: true }))).toEqual({ action: 'copy' }); // the copy tool (D154), not the brush
    expect(resolveKey(k('KeyV', 'v', { metaKey: true }))).toEqual({ action: 'paste' });
    expect(resolveKey(k('KeyX', 'x', { metaKey: true }))).toBeNull(); // cut, not demolish
    expect(resolveKey(k('Digit1', '1', { ctrlKey: true }))).toBeNull();
    expect(resolveKey(k('KeyC', 'c', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveKey(k('KeyZ', 'z'))).not.toEqual({ action: 'undo' });
    expect(resolveKey(k('KeyC', 'c'))).toEqual({ action: 'mark' }); // the brush
    expect(resolveKey(k('KeyV', 'v'))).toEqual({ action: 'viewWind' });
  });

  it('the blueprints\' keys (D154): K the library, N the upgrade tool, on both layouts', () => {
    expect(resolveKey(k('KeyK', 'k'))).toEqual({ action: 'library' });
    expect(resolveKey(k('KeyN', 'n'))).toEqual({ action: 'upgrade' });
    // Each letter bound once: no other action answers to K or N.
    expect(resolveKey(k('KeyK', 'k', { shiftKey: true }))).toEqual({ action: 'library' });
  });
});
