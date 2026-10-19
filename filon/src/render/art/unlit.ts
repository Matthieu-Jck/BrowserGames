// unlit.ts — a building's art switched off (D83): the same recipe, its lamps dark. A machine that
// does not work (no power, starved, backed up, no recipe…) is drawn from this picture instead of
// its lit one: no LED, no furnace mouth, no landing ring glowing, and the whole body greyed and a
// little darker, so it reads as switched off by day as well as by night.
//
// Two steps, both on a canvas the recipe has just drawn into:
// - `unlitCtx` wraps the real context while the recipe runs. A fill or stroke in one of the light
//   tokens (the very tokens the night lights' spy reads as lights, recipes/fx.ts) is drawn in dark
//   glass when opaque (the lamp's body stays, unlit), and skipped when translucent (its baked
//   halo: an unlit lamp has none). Every other call goes straight through.
// - `switchOff` then greys the pixels (towards their luminance) and darkens them a little, with a
//   touch of the night's lilac so a stopped machine stays in the palette rather than going dead grey.
// - What is not a lamp but goes out with the machine — a fire basket's flames, a cooling tower's
//   steam — the recipe leaves out itself when `isUnlit(ctx)` (the steam boiler's plume, the fumarole tap).
// No Pixi here: the buildings view bakes the result on demand into its own sheet.
import type { Ctx } from './ink';
import { C, mix } from './tokens';

/** The light tokens (lower-case hex), as the night lights' spy classes them. */
const LIGHTS: ReadonlySet<string> = new Set([C.led, C.glowCyan, C.glowTurq, C.ledWarm, C.glowPeach, C.ledRed, C.ledGreen].map((c) => c.toLowerCase()));

/** An unlit lamp or a cold furnace mouth: dark glass, blue-violet. */
export const UNLIT = mix(C.steelD, C.inkSoft, 0.4);

/** How far a stopped building is greyed (0 = as painted, 1 = grey) and how bright it stays. */
export const OFF_GREY = 0.6;
export const OFF_BRIGHT = 0.8;

/** The contexts `unlitCtx` made: a recipe asks `isUnlit` to leave out its fire and steam. */
const OFF = new WeakSet<object>();

/** Is a recipe drawing switched off? (Then no flames, no steam: they go out with the machine.) */
export function isUnlit(ctx: unknown): boolean {
  return typeof ctx === 'object' && ctx !== null && OFF.has(ctx);
}

/** Is this style one of the light tokens? (The canvas hands colours back as lower-case `#rrggbb`.) */
export function isLight(style: unknown): boolean {
  return typeof style === 'string' && LIGHTS.has(style.toLowerCase());
}

/**
 * The context a recipe draws through to come out unlit: fills and strokes in a light token are
 * dark glass (opaque) or nothing (translucent halos); everything else is the real context's.
 */
export function unlitCtx(ctx: CanvasRenderingContext2D): Ctx {
  const paint = (method: 'fill' | 'fillRect' | 'stroke' | 'strokeRect', style: 'fillStyle' | 'strokeStyle') =>
    (...args: unknown[]): void => {
      const s = ctx[style];
      const run = (): void => { (ctx[method] as (...a: unknown[]) => void).apply(ctx, args); };
      if (!isLight(s)) { run(); return; }
      if (ctx.globalAlpha < 0.95) return; // a lamp's halo: none when it is off
      ctx[style] = UNLIT;
      run();
      ctx[style] = s;
    };
  const own: Record<string, (...a: unknown[]) => void> = {
    fill: paint('fill', 'fillStyle'),
    fillRect: paint('fillRect', 'fillStyle'),
    stroke: paint('stroke', 'strokeStyle'),
    strokeRect: paint('strokeRect', 'strokeStyle'),
  };
  const off = new Proxy(ctx, {
    get(t, p) {
      if (typeof p === 'string' && own[p]) return own[p];
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
    set(t, p, v) { return Reflect.set(t, p, v, t); },
  });
  OFF.add(off);
  return off as unknown as Ctx;
}

/** The night's lilac a stopped building leans to (r, g, b). */
const LEAN = [0x8e, 0x88, 0xa8] as const;

/**
 * Grey and darken one RGBA pixel buffer in place (`OFF_GREY`, `OFF_BRIGHT`), leaning a little to
 * lilac; alpha is kept. Pure, so it is tested without a canvas.
 */
export function switchOffPixels(d: Uint8ClampedArray): void {
  const g = OFF_GREY, k = OFF_BRIGHT, lean = 0.12;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i]!, gr = d[i + 1]!, b = d[i + 2]!;
    const l = 0.3 * r + 0.59 * gr + 0.11 * b;
    for (let c = 0; c < 3; c++) {
      const v = c === 0 ? r : c === 1 ? gr : b;
      const grey = v + (l - v) * g;
      d[i + c] = (grey + (LEAN[c]! * (l / 255) - grey) * lean) * k;
    }
  }
}

/** Grey and darken what a recipe drew on a canvas (`switchOffPixels` over its whole area). */
export function switchOff(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  const img = ctx.getImageData(0, 0, w, h);
  switchOffPixels(img.data);
  ctx.putImageData(img, 0, 0);
}
