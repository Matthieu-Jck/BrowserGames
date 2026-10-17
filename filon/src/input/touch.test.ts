// touch.test.ts — the touch gestures (D96): a tap clicks or places, a drag pans or runs the tool's
// drag, a long press is the right button, two fingers pinch and drop what one had started.
import { describe, expect, it } from 'vitest';
import { LONG_MS, SLOP, TouchGestures, type TouchEffect } from './touch';

const kinds = (fx: TouchEffect[]): string[] => fx.map((e) => (e.k === 'down' || e.k === 'up' ? `${e.k}${e.button}` : e.k));

describe('one finger, nothing in hand', () => {
  it('a tap is a click where the finger came down', () => {
    const g = new TouchGestures();
    expect(kinds(g.down(1, 100, 100, 0))).toEqual(['hover']);
    expect(kinds(g.move(1, 103, 102, 'none'))).toEqual(['hover']); // within the slop
    const fx = g.up(1, 103, 102, 'none');
    expect(kinds(fx)).toEqual(['hover', 'up0']);
    expect(fx[1]).toMatchObject({ x: 100, y: 100 });
  });
  it('a drag pans by the finger\'s whole way, and never clicks', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 100 + SLOP + 5, 100, 'none')).toEqual([{ k: 'pan', dx: SLOP + 5, dy: 0 }]);
    expect(g.move(1, 130, 110, 'none')).toEqual([{ k: 'pan', dx: 130 - (100 + SLOP + 5), dy: 10 }]);
    expect(g.up(1, 130, 110, 'none')).toEqual([]);
  });
});

describe('one finger, a tool in hand', () => {
  it('a drag tool runs its drag from where the finger came down', () => {
    const g = new TouchGestures();
    g.down(1, 50, 50, 0);
    expect(kinds(g.move(1, 80, 50, 'drag'))).toEqual(['hover', 'down0', 'move']);
    expect(kinds(g.move(1, 90, 60, 'drag'))).toEqual(['move']);
    expect(g.up(1, 90, 60, 'drag')).toEqual([{ k: 'up', x: 90, y: 60, button: 0 }]);
  });
  it('a building is placed by a tap, and a drag pans instead', () => {
    const g = new TouchGestures();
    g.down(1, 50, 50, 0);
    expect(kinds(g.up(1, 51, 50, 'tap'))).toEqual(['hover', 'down0', 'up0']);
    g.down(2, 50, 50, 10);
    expect(kinds(g.move(2, 90, 50, 'tap'))).toEqual(['pan']);
    expect(g.up(2, 90, 50, 'tap')).toEqual([]);
  });
});

describe('long press', () => {
  it('a still finger becomes the right button once the time runs out; moving on drags a right box', () => {
    const g = new TouchGestures();
    g.down(1, 40, 40, 1000);
    expect(g.longAt()).toBe(1000 + LONG_MS);
    expect(g.timer(1000 + LONG_MS - 1)).toEqual([]);
    expect(kinds(g.timer(1000 + LONG_MS))).toEqual(['long', 'down2']);
    expect(g.longAt()).toBeNull();
    expect(kinds(g.move(1, 80, 40, 'none'))).toEqual(['move']);
    expect(g.up(1, 80, 40, 'none')).toEqual([{ k: 'up', x: 80, y: 40, button: 2 }]);
  });
  it('a finger that moved first is no long press', () => {
    const g = new TouchGestures();
    g.down(1, 40, 40, 0);
    g.move(1, 80, 40, 'none');
    expect(g.longAt()).toBeNull();
    expect(g.timer(LONG_MS * 2)).toEqual([]);
  });
});

describe('two fingers', () => {
  it('pinch zooms about their middle and pans with it', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 5);
    expect(g.count).toBe(2);
    // Spread: the distance doubles about the same middle.
    expect(g.move(2, 300, 100, 'none')).toEqual([{ k: 'pan', dx: 50, dy: 0 }, { k: 'zoom', f: 2, x: 200, y: 100 }]);
    g.move(1, 0, 100, 'none');
    // One finger lifts: the other pans from where it is, and never clicks.
    expect(g.up(2, 300, 100, 'none')).toEqual([]);
    expect(g.move(1, 10, 100, 'none')).toEqual([{ k: 'pan', dx: 10, dy: 0 }]);
    expect(g.up(1, 10, 100, 'none')).toEqual([]);
  });
  it('a second finger drops the tool\'s drag under way (cancel), and nothing is laid', () => {
    const g = new TouchGestures();
    g.down(1, 50, 50, 0);
    g.move(1, 90, 50, 'drag');
    expect(kinds(g.down(2, 200, 200, 30))).toEqual(['cancel']);
    expect(g.up(1, 90, 50, 'drag')).toEqual([]);
  });
  it('a cancelled finger (the browser took it) drops a drag and never taps', () => {
    const g = new TouchGestures();
    g.down(1, 50, 50, 0);
    expect(g.up(1, 50, 50, 'none', true)).toEqual([]);
    g.down(1, 50, 50, 0);
    g.move(1, 90, 50, 'drag');
    expect(g.up(1, 90, 50, 'drag', true)).toEqual([{ k: 'cancel' }]);
  });
});
