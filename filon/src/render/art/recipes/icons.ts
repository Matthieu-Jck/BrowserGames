// icons.ts — status cartouches and small UI marks, inked like the rest: no power (crossed
// bolt), low power, starved (empty basket), blocked (full crate), no recipe (gear + ?),
// paused, plus the ocelle coin.
import { C } from '../tokens';
import { ellipsePts, flat, ink, roundRectPts, shape, type Ctx, type Pt } from '../ink';

export const ICON = 40;
export const ICON_IDS = ['noPower', 'lowPower', 'starved', 'blocked', 'noRecipe', 'paused', 'ocelle', 'building'] as const;
export type IconId = (typeof ICON_IDS)[number];

const c = ICON / 2;
const badge = (ctx: Ctx, fill: string, s: number): void => {
  const p = ellipsePts(c, c, 16, 16, s, 0.03, 32);
  flat(ctx, p.map(([x, y]) => [x + 2, y + 3] as Pt), C.ink, 0.9);
  shape(ctx, p, fill, { w: 2, seed: s });
};
const bolt: Pt[] = [[c + 2, c - 11], [c - 6, c + 2], [c, c + 2], [c - 3, c + 11], [c + 7, c - 3], [c + 1, c - 3]];

export function drawIcon(ctx: Ctx, id: IconId): void {
  switch (id) {
    case 'noPower':
      badge(ctx, C.coral, 1);
      shape(ctx, bolt, C.paper, { w: 1.4, seed: 2 });
      ink(ctx, [[c - 10, c + 10], [c + 10, c - 10]], { w: 3, color: C.ink, taper: 0, seed: 3 });
      break;
    case 'lowPower':
      badge(ctx, C.warn, 4);
      shape(ctx, bolt, C.paper, { w: 1.4, seed: 5 });
      break;
    case 'starved':
      badge(ctx, C.lilacL, 6);
      shape(ctx, [[c - 9, c - 3], [c + 9, c - 3], [c + 6, c + 9], [c - 6, c + 9]], C.peachL, { w: 1.6, seed: 7 });
      ink(ctx, ellipsePts(c, c - 5, 7, 6, 8).slice(16, 33), { w: 1.6, seed: 8 });
      break;
    case 'blocked':
      badge(ctx, C.peach, 9);
      shape(ctx, roundRectPts(c - 9, c - 8, 18, 16, 2), C.peachD, { w: 1.6, seed: 10 });
      ink(ctx, [[c - 9, c - 1], [c + 9, c - 1]], { w: 1.2, seed: 11 });
      for (const x of [c - 4, c + 4]) flat(ctx, ellipsePts(x, c - 10, 3.5, 3.5, 12), C.coral);
      break;
    case 'noRecipe':
      badge(ctx, C.lilacL, 13);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ink(ctx, [[c + Math.cos(a) * 8, c + Math.sin(a) * 8], [c + Math.cos(a) * 12, c + Math.sin(a) * 12]], { w: 3, taper: 0, seed: 14 + i });
      }
      shape(ctx, ellipsePts(c, c, 8, 8, 15), C.paper, { w: 1.5, seed: 15 });
      ink(ctx, [[c - 2.5, c - 3], [c, c - 4.5], [c + 2.5, c - 3], [c, c], [c, c + 1.5]], { w: 1.6, taper: 0, seed: 16 });
      break;
    case 'paused':
      badge(ctx, C.paperD, 17);
      for (const x of [c - 4.5, c + 4.5]) shape(ctx, roundRectPts(x - 2.5, c - 7, 5, 14, 1.5), C.inkSoft, { w: 1, seed: 18 });
      break;
    case 'ocelle':
      // The ocelle sign, as in the DOM (src/ui/coin.ts): a gold ring around a dot, with a
      // currency sign's two strokes above and below.
      for (const [y0, y1] of [[c - 18, c - 13], [c + 13, c + 18]] as const) {
        ink(ctx, [[c, y0], [c, y1]], { w: 5, color: '#6b3f0b', shade: false, taper: 0, jitter: 0, seed: 19 });
        ink(ctx, [[c, y0], [c, y1]], { w: 2.2, color: '#f2c14e', shade: false, taper: 0, jitter: 0, seed: 19 });
      }
      shape(ctx, ellipsePts(c, c, 12.7, 12.7, 20, 0.02, 32), '#e2a52a', { w: 2, seed: 20 });
      flat(ctx, ellipsePts(c, c, 8.2, 8.2, 21, 0, 28), '#fff3cf');
      shape(ctx, ellipsePts(c, c, 4.2, 4.2, 22, 0, 20), '#6b3f0b', { w: 1, seed: 22 });
      break;
    case 'building':
      badge(ctx, C.turqL, 22);
      for (let i = 0; i < 3; i++) ink(ctx, [[c - 9, c - 6 + i * 6], [c + 9, c - 8 + i * 6]], { w: 1.6, seed: 23 + i });
      break;
  }
}
