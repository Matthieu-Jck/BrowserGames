// silhouette.ts — a Canvas2D context that paints a drawing's silhouette: every fill and stroke
// that the drawing makes at least half opaque lands in one colour (white, to be tinted), and the
// translucent touches — baked cast shadows, light halos, stipple, washes — are dropped. Run a
// building's recipe through it with a ShadowFrame (iso-shapes.ts) and it paints the building's
// cast shadow (BuildingsView). Colours, alpha and compositing the recipe sets are ignored;
// paths, transforms and clips go through to the real context.
import type { Ctx } from './ink';

/** Below this alpha a fill is a wash (a shadow, a halo), not a solid part. */
const SOLID = 0.5;

export function silhouette(real: CanvasRenderingContext2D, color = '#ffffff'): Ctx {
  real.fillStyle = color;
  real.strokeStyle = color;
  real.globalAlpha = 1;
  let alpha = 1;
  const stack: number[] = [];
  const paint = (name: 'fill' | 'stroke' | 'fillRect' | 'strokeRect') => (...args: unknown[]): void => {
    if (alpha >= SOLID) (real[name] as (...a: unknown[]) => void).apply(real, args);
  };
  const own: Record<string, unknown> = {
    fill: paint('fill'),
    stroke: paint('stroke'),
    fillRect: paint('fillRect'),
    strokeRect: paint('strokeRect'),
    save: (): void => { stack.push(alpha); real.save(); },
    restore: (): void => { alpha = stack.pop() ?? 1; real.restore(); },
    drawImage: (): void => {},
    fillText: (): void => {},
    strokeText: (): void => {},
  };
  return new Proxy(real, {
    get(t, k): unknown {
      if (k === 'globalAlpha') return alpha;
      if (typeof k === 'string' && k in own) return own[k];
      const v = Reflect.get(t, k, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
    set(t, k, v): boolean {
      if (k === 'globalAlpha') { alpha = Number(v); return true; }
      if (k === 'fillStyle' || k === 'strokeStyle' || k === 'globalCompositeOperation' || k === 'filter') return true;
      return Reflect.set(t, k, v, t);
    },
  }) as unknown as Ctx;
}
