// unlit.test.ts — a building's art switched off (D83): through `unlitCtx` an opaque fill or
// stroke in a light token is dark glass and its translucent halo is not drawn, every other call
// goes through unchanged and the style is put back; `isUnlit` knows the context; `switchOffPixels`
// greys and darkens, keeps alpha and leaves transparent pixels alone.
import { describe, it, expect } from 'vitest';
import { C } from './tokens';
import { UNLIT, isLight, isUnlit, switchOffPixels, unlitCtx } from './unlit';

/** A stand-in 2D context: records what each fill and stroke was drawn in. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; drawn: Array<[string, string]> } {
  const drawn: Array<[string, string]> = [];
  const ctx = {
    fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1,
    fill() { drawn.push(['fill', this.fillStyle]); },
    fillRect() { drawn.push(['fillRect', this.fillStyle]); },
    stroke() { drawn.push(['stroke', this.strokeStyle]); },
    strokeRect() { drawn.push(['strokeRect', this.strokeStyle]); },
    beginPath() { drawn.push(['beginPath', '']); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

describe('unlit art', () => {
  it('an opaque lamp is dark glass, its halo is not drawn, the rest goes through, the style is put back', () => {
    const { ctx, drawn } = fakeCtx();
    const off = unlitCtx(ctx);
    expect(isUnlit(off)).toBe(true);
    expect(isUnlit(ctx)).toBe(false);
    off.fillStyle = C.led;
    off.fill();
    expect(drawn.pop()).toEqual(['fill', UNLIT]);
    expect(off.fillStyle).toBe(C.led);
    off.globalAlpha = 0.35; // a baked halo
    off.fill();
    off.fillRect(0, 0, 2, 2);
    expect(drawn).toEqual([]);
    off.globalAlpha = 1;
    off.strokeStyle = C.glowPeach.toUpperCase(); // a furnace mouth's rim, whatever its case
    off.stroke();
    expect(drawn.pop()).toEqual(['stroke', UNLIT]);
    off.fillStyle = C.coral; // paint, not light
    off.fill();
    off.beginPath();
    expect(drawn).toEqual([['fill', C.coral], ['beginPath', '']]);
    for (const c of [C.led, C.ledWarm, C.ledRed, C.ledGreen, C.glowCyan, C.glowTurq, C.glowPeach]) expect(isLight(c), c).toBe(true);
    for (const c of [C.coral, C.steel, C.ink, '#ffffff']) expect(isLight(c), c).toBe(false);
  });

  it('switching pixels off greys and darkens them, keeps alpha, leaves the transparent ones', () => {
    const d = new Uint8ClampedArray([
      236, 95, 67, 255, // coral
      31, 178, 168, 128, // turquoise, half transparent
      10, 20, 30, 0, // transparent
    ]);
    const before = [...d];
    switchOffPixels(d);
    const spread = (i: number, a: ArrayLike<number>): number => Math.max(a[i]!, a[i + 1]!, a[i + 2]!) - Math.min(a[i]!, a[i + 1]!, a[i + 2]!);
    const sum = (i: number, a: ArrayLike<number>): number => a[i]! + a[i + 1]! + a[i + 2]!;
    for (const i of [0, 4]) {
      expect(spread(i, d)).toBeLessThan(spread(i, before) * 0.5); // greyer
      expect(sum(i, d)).toBeLessThan(sum(i, before)); // darker
      expect(d[i + 3]).toBe(before[i + 3]);
    }
    expect([...d.slice(8)]).toEqual(before.slice(8));
  });
});
