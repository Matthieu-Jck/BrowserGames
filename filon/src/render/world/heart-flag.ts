// heart-flag.ts — the claim's flag on the Heart (owner, 2026-10-13: "the heart will have a flag
// with the logo on it"): a steel pole on the depot roof's back corner, a paper cloth bordered in
// the field's colour bearing the emblem (art/emblem.ts), waving. Baked on demand per emblem
// (`flagFrames`): `FLAG.phases` frames of the wave for iso (the pole and the cloth, anchored at the
// pole's foot) and the emblem as a badge for plan, on a DynAtlas of their own. The buildings view
// lays them over the Heart and steps the wave's frames with the game's time.
import type { Emblem } from '@/content/emblem';
import { emblemKey } from '@/content/emblem';
import { DynAtlas, type DynFrame } from '../art/dyn-atlas';
import { drawEmblem, emblemColor } from '../art/emblem';
import { flat, ink } from '../art/ink';
import { light } from '../art/shapes';
import { C, mix } from '../art/tokens';
import { LH } from '../iso';

/**
 * Where it stands on the Heart (local tiles: the depot roof's back corner, clear of the dish and
 * the beacons), the roof's height and the pole's (levels), the cloth (world px), the wave.
 */
export const FLAG = { x: 1.3, y: 1.3, roof: 1.45, pole: 3.2, w: 46, h: 30, phases: 8, wavesPerSec: 0.9 } as const;
/** Baked at 2× (sprites drawn at half scale), like the buildings. */
export const FLAG_K = 0.5;

export interface FlagFrames { iso: DynFrame[]; badge: DynFrame }

const sheet = new DynAtlas();
const baked = new Map<string, FlagFrames>();

/** A canvas (the cloth flat, before the wave). */
function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  const ctx = c.getContext('2d')!;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  return ctx;
}

/** The flag's frames for an emblem, baked the first time. */
export function flagFrames(e: Emblem): FlagFrames {
  const key = emblemKey(e);
  const got = baked.get(key);
  if (got) return got;
  const S = 2, W = FLAG.w * S, H = FLAG.h * S, A = 3 * S; // the wave's amplitude at the cloth's free end
  // The cloth, flat: paper, bordered in the field's colour, the emblem in the middle.
  const cloth = canvas(W, H);
  flat(cloth, [[0, 0], [W, 0], [W, H], [0, H]], C.paper);
  const band = emblemColor(e.field);
  for (const [y0, y1] of [[0, 3 * S], [H - 3 * S, H]] as const) flat(cloth, [[0, y0], [W, y0], [W, y1], [0, y1]], band);
  drawEmblem(cloth, e, W * 0.55, H / 2, H * 0.36, 1.6 * S);
  ink(cloth, [[0, 0], [W, 0], [W, H], [0, H]], { closed: true, w: 1.4 * S, shade: false, taper: 0, jitter: 0 });
  const poleH = FLAG.pole * LH * S, M = 4 * S;
  const fw = M + 3 * S + W + A + M, fh = M + A + poleH + M;
  // Anchor: the pole's foot (bottom-left inside the margin).
  const ox = M + 1.5 * S, oy = fh - M;
  const iso: DynFrame[] = [];
  for (let k = 0; k < FLAG.phases; k++) {
    const ph = (k / FLAG.phases) * Math.PI * 2;
    iso.push(sheet.add(`f:${key}:${k}`, fw, fh, ox, oy, (ctx) => {
      // The pole, its cap and a lamp.
      flat(ctx, [[ox - 1.5 * S, oy], [ox + 1.5 * S, oy], [ox + 1.5 * S, oy - poleH], [ox - 1.5 * S, oy - poleH]], C.steelL);
      ink(ctx, [[ox - 1.5 * S, oy], [ox - 1.5 * S, oy - poleH]], { w: 1.2 * S, shade: false, taper: 0, jitter: 0 });
      ink(ctx, [[ox + 1.5 * S, oy], [ox + 1.5 * S, oy - poleH]], { w: 1.2 * S, color: mix(C.steel, C.ink, 0.4), shade: false, taper: 0, jitter: 0 });
      light(ctx, ox, oy - poleH - 2 * S, 2.2 * S, C.ledWarm);
      // The cloth from the pole's top, waving: strips shifted along a travelling wave that grows
      // from the pole, shaded where they turn away from the light.
      const x0 = ox + 1.5 * S, y0 = oy - poleH + A;
      const step = 2;
      for (let x = 0; x < W; x += step) {
        const t = x / W, wave = Math.sin(t * Math.PI * 2.2 - ph);
        const dy = A * t * wave;
        ctx.drawImage(cloth.canvas, x, 0, step, H, x0 + x, y0 + dy, step + 0.6, H);
        const slope = Math.cos(t * Math.PI * 2.2 - ph) * t;
        if (slope < 0) flat(ctx, [[x0 + x, y0 + dy], [x0 + x + step + 0.6, y0 + dy], [x0 + x + step + 0.6, y0 + dy + H], [x0 + x, y0 + dy + H]], C.ink, -slope * 0.22);
      }
    }));
  }
  const R = 18 * S;
  const badge = sheet.add(`b:${key}`, R * 2 + 6, R * 2 + 6, R + 3, R + 3, (ctx) => drawEmblem(ctx, e, R + 3, R + 3, R, 1.6 * S));
  sheet.flush();
  const frames: FlagFrames = { iso, badge };
  baked.set(key, frames);
  return frames;
}
