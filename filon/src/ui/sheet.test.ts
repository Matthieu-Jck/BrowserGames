// sheet.test.ts — the bottom sheet's states (D96): a tap folds or opens it, a release snaps to the
// nearest height, a flick goes on in its direction.
import { describe, expect, it } from 'vitest';
import { snapSheet, tapSheet } from './sheet';

const H = { peek: 84, half: 422, full: 700 };

describe('the bottom sheet', () => {
  it('a tap on the grip folds an open sheet and opens a folded one half-way', () => {
    expect(tapSheet('half')).toBe('peek');
    expect(tapSheet('full')).toBe('peek');
    expect(tapSheet('peek')).toBe('half');
  });
  it('a slow release snaps to the nearest height', () => {
    expect(snapSheet(120, H, 0)).toBe('peek');
    expect(snapSheet(380, H, 0.1)).toBe('half');
    expect(snapSheet(640, H, -0.1)).toBe('full');
  });
  it('a flick goes on to the next state in its direction', () => {
    expect(snapSheet(450, H, -1)).toBe('full'); // up, past half
    expect(snapSheet(300, H, -1)).toBe('half'); // up, from under half
    expect(snapSheet(400, H, 1)).toBe('peek'); // down, under half
    expect(snapSheet(600, H, 1)).toBe('half'); // down, from above half
  });
});
