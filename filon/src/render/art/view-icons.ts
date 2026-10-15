// view-icons.ts — the specialised views' marks (D88), in the Moebius ink of the rest of the art:
// a round paper badge with an inked rim and a little offset shadow (a cartouche's), the symbol in
// the palette's flat colours on it. One drawing serves the world (the views bake each into a Pixi
// texture: render/world/views-view.ts) and the DOM (legends and side panels draw the same mark on a
// small canvas: `viewIconCanvas`), so the map and its key never disagree. Shown rather than told
// (D53): a source by what it burns or catches, a stop by what is missing.
//
// Board: 64 units; `drawViewIcon` scales it to the size asked. Canvas2D only (no Pixi, no DOM but
// the canvas `viewIconCanvas` creates), so the UI may use it (it is part of the art kit).
import { C, mix } from './tokens';
import { ellipsePts, ink, roundRectPts, shape, type Ctx, type Pt } from './ink';
import type { Source } from '@/sim/readouts/power';

/** Every mark the views draw. */
export type ViewIcon =
  // power: the sources, a store, a consumer
  | 'solar' | 'wind' | 'fuel' | 'geo' | 'core' | 'acc' | 'plug'
  // why a building has no power / does not work
  | 'unwired' | 'asleep' | 'dark' | 'low' | 'site' | 'inputs' | 'output' | 'recipe' | 'idle' | 'gear'
  // logistics
  | 'jam' | 'dead' | 'dock'
  // the view selector: Normal (an eye), Électricité (the bolt), Logistique (a ribbon running)
  | 'eye' | 'bolt' | 'flow';

/** The badge's ground: paper for a fact, amber for a passing trouble, coral for a stop. */
const GROUND: Partial<Record<ViewIcon, string>> = {
  unwired: C.coral, dark: C.coral, output: C.coral, jam: C.ledRed, dead: C.coral,
  low: C.warn, inputs: C.warn, recipe: C.paperD, idle: C.paperD, asleep: C.lilacL, site: C.peachL,
};

const R = 26; // the badge's radius on the 64 board

/** Draw a mark centred in a square of `size` px at (x, y) (its top-left). `badge`: on its paper disc. */
export function drawViewIcon(g: Ctx, id: ViewIcon, x: number, y: number, size: number, badge = true): void {
  g.save();
  g.translate(x, y);
  g.scale(size / 64, size / 64);
  if (badge) {
    // The cartouche's shadow, offset down-right, then the disc and its inked rim.
    g.fillStyle = C.ink;
    g.globalAlpha = 0.85;
    g.beginPath(); g.arc(34.5, 35.5, R, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    shape(g, ellipsePts(32, 32, R, R, 7, 0.02, 40), GROUND[id] ?? C.paper, { w: 3.2, seed: 11 });
  }
  SYMBOL[id](g);
  g.restore();
}

/** A mark on its own small canvas (CSS px `px`, drawn at twice that for a sharp edge): the DOM's legends and panels. */
export function viewIconCanvas(id: ViewIcon, px = 22, badge = true): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px * 2;
  cv.style.width = cv.style.height = `${px}px`;
  cv.className = 'vicon';
  cv.dataset.icon = id;
  const g = cv.getContext('2d');
  if (g) drawViewIcon(g, id, 0, 0, px * 2, badge);
  return cv;
}

const line = (g: Ctx, pts: readonly Pt[], w = 3, color: string = C.ink): void => ink(g, pts, { w, color, taper: 0.1, shade: false });
const disc = (g: Ctx, cx: number, cy: number, r: number, fill: string, w = 2.6): void => shape(g, ellipsePts(cx, cy, r, r, 3, 0.02, 28), fill, { w });

/** The bolt, the house glyph's (ui/glyphs.ts `power`) on the 64 board. */
const BOLT: Pt[] = [[38, 6], [13, 37], [30, 37], [24, 58], [51, 25], [34, 25]];

const SYMBOL: Record<ViewIcon, (g: Ctx) => void> = {
  solar: (g) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      line(g, [[32 + Math.cos(a) * 15, 32 + Math.sin(a) * 15], [32 + Math.cos(a) * 21, 32 + Math.sin(a) * 21]], 3.4, C.peachD);
    }
    disc(g, 32, 32, 10.5, C.warn);
  },
  wind: (g) => {
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i / 3) * Math.PI * 2, b = a + 0.5;
      shape(g, [[32, 32], [32 + Math.cos(a) * 20, 32 + Math.sin(a) * 20], [32 + Math.cos(b) * 13, 32 + Math.sin(b) * 13]], C.paper, { w: 2.4 });
    }
    disc(g, 32, 32, 4.2, C.steelL, 2);
  },
  fuel: (g) => {
    shape(g, [[32, 9], [44, 26], [46, 40], [40, 51], [32, 54], [24, 51], [18, 40], [21, 28], [27, 34], [28, 21]], C.coral, { w: 2.6 });
    shape(g, [[32, 30], [38, 40], [36, 48], [32, 50], [28, 48], [26, 41]], C.warn, { w: 1.8 });
  },
  geo: (g) => {
    shape(g, [[14, 50], [22, 41], [42, 41], [50, 50]], C.vent, { w: 2.6 });
    line(g, [[26, 36], [22, 28], [27, 20], [24, 12]], 3.2, C.coral);
    line(g, [[37, 36], [34, 27], [39, 19], [36, 11]], 3.2, C.coral);
  },
  core: (g) => {
    const hex: Pt[] = [];
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i / 6) * Math.PI * 2; hex.push([32 + Math.cos(a) * 18, 32 + Math.sin(a) * 18]); }
    shape(g, hex, C.turq, { w: 2.8 });
    disc(g, 32, 32, 6.5, C.glowTurq, 2.2);
  },
  acc: (g) => {
    shape(g, roundRectPts(19, 16, 26, 38, 4), C.paperD, { w: 2.8 });
    shape(g, roundRectPts(27, 10, 10, 6, 1.5), C.ink, { w: 1.4 });
    for (const y of [42, 33, 24]) shape(g, roundRectPts(23, y, 18, 7, 1.5), C.turq, { w: 1.4 });
  },
  plug: (g) => {
    line(g, [[26, 10], [26, 20]], 3.6); line(g, [[38, 10], [38, 20]], 3.6);
    shape(g, roundRectPts(18, 20, 28, 17, 5), C.steelL, { w: 2.6 });
    line(g, [[32, 37], [32, 46], [26, 54]], 3.4);
  },
  unwired: (g) => {
    line(g, [[26, 9], [26, 18]], 3.4, C.paper); line(g, [[38, 9], [38, 18]], 3.4, C.paper);
    shape(g, roundRectPts(18, 18, 28, 15, 5), C.paperD, { w: 2.4 });
    line(g, [[32, 33], [32, 39]], 3.4, C.paper);
    line(g, [[32, 46], [32, 55]], 3.4, C.paper);
    line(g, [[23, 41], [41, 44]], 3, C.ink);
  },
  asleep: (g) => {
    shape(g, [[38, 13], [28, 17], [22, 28], [24, 41], [33, 49], [45, 49], [36, 42], [32, 31], [35, 20]], C.lilac, { w: 2.4 });
    line(g, [[41, 18], [49, 18], [41, 27], [49, 27]], 2.6);
  },
  dark: (g) => {
    shape(g, BOLT, C.paperD, { w: 2.4 });
    line(g, [[14, 14], [50, 50]], 4.2, C.ink);
  },
  low: (g) => {
    shape(g, BOLT, C.paper, { w: 2.4 });
    shape(g, BOLT.map(([x, y]) => [x, Math.max(y, 34)] as Pt), C.warn, { w: 0.01 });
    ink(g, BOLT, { w: 2.4, closed: true });
  },
  site: (g) => {
    line(g, [[18, 54], [18, 14], [48, 14]], 3.4);
    line(g, [[18, 22], [26, 14]], 2.4); line(g, [[44, 14], [44, 30]], 2);
    shape(g, roundRectPts(38, 30, 12, 9, 1.5), C.warn, { w: 2 });
    line(g, [[10, 54], [30, 54]], 3.4);
  },
  inputs: (g) => {
    shape(g, [[14, 30], [50, 30], [46, 52], [18, 52]], C.paper, { w: 2.6 });
    line(g, [[32, 8], [32, 25]], 3.6);
    line(g, [[25, 18], [32, 25], [39, 18]], 3.4);
    for (const x of [21, 27, 33, 39, 45]) if (x < 44) line(g, [[x, 41], [x + 3, 41]], 2, C.inkSoft);
  },
  output: (g) => {
    shape(g, roundRectPts(14, 22, 30, 28, 3), C.peach, { w: 2.6 });
    for (const [x, y] of [[21, 30], [31, 30], [21, 40], [31, 40]] as const) shape(g, roundRectPts(x, y, 8, 7, 1), C.paper, { w: 1.2 });
    line(g, [[50, 14], [50, 52]], 4.4, C.paper);
  },
  recipe: (g) => {
    shape(g, roundRectPts(17, 11, 30, 42, 4), C.paper, { w: 2.6 });
    line(g, [[26, 25], [28, 20], [34, 19], [38, 23], [36, 29], [32, 31], [32, 36]], 3.4);
    disc(g, 32, 44, 2.4, C.ink, 0.8);
  },
  idle: (g) => {
    shape(g, roundRectPts(20, 17, 9, 30, 2), C.inkSoft, { w: 1.6 });
    shape(g, roundRectPts(35, 17, 9, 30, 2), C.inkSoft, { w: 1.6 });
  },
  gear: (g) => {
    const pts: Pt[] = [];
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 14 : 19; pts.push([32 + Math.cos(a) * r, 32 + Math.sin(a) * r]); }
    shape(g, pts, C.turq, { w: 2.4 });
    disc(g, 32, 32, 5, C.paper, 2);
  },
  jam: (g) => {
    const oct: Pt[] = [];
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i / 8) * Math.PI * 2; oct.push([32 + Math.cos(a) * 18, 32 + Math.sin(a) * 18]); }
    shape(g, oct, C.coralD, { w: 2.4 });
    shape(g, roundRectPts(21, 28, 22, 8, 2), C.paper, { w: 1.4 });
  },
  dead: (g) => {
    shape(g, roundRectPts(13, 26, 27, 12, 2), C.steelL, { w: 2.4 });
    line(g, [[20, 32], [33, 32]], 2.2, C.paper);
    line(g, [[46, 16], [46, 48]], 5, C.ink);
  },
  eye: (g) => {
    shape(g, [[8, 32], [18, 21], [32, 17], [46, 21], [56, 32], [46, 43], [32, 47], [18, 43]], C.paper, { w: 2.8 });
    disc(g, 32, 32, 9, C.turq, 2.4);
    disc(g, 32, 32, 3.6, C.ink, 0.8);
  },
  bolt: (g) => {
    shape(g, BOLT, C.warn, { w: 2.8 });
  },
  flow: (g) => {
    shape(g, roundRectPts(6, 21, 52, 22, 5), C.steelL, { w: 2.6 });
    for (const x of [16, 30, 44]) line(g, [[x - 3, 26], [x + 4, 32], [x - 3, 38]], 3.2, C.paper);
  },
  dock: (g) => {
    shape(g, ellipsePts(32, 26, 15, 13, 5, 0.02, 28), C.violetL, { w: 2.6 });
    line(g, [[22, 36], [28, 46]], 2); line(g, [[42, 36], [36, 46]], 2);
    shape(g, roundRectPts(26, 45, 12, 8, 1.5), C.peachD, { w: 2 });
  },
};

/** Each power source's colour (the 24 h chart, the supply bars) and mark, shared by the world and the panels. */
export const SOURCE_COLOR: Readonly<Record<Source, string>> = { core: C.turq, geo: C.violet, wind: C.steelL, solar: C.warn, fuel: C.peachD, acc: C.lilacL };
export const SOURCE_ICON: Readonly<Record<Source, ViewIcon>> = { core: 'core', geo: 'geo', wind: 'wind', solar: 'solar', fuel: 'fuel', acc: 'acc' };

/**
 * Each grid's colour in the Électricité view (D88), in grid order (`net % n`): the wires, the
 * pillars' rings and the footprints of its buildings take it, the panel's grid cards too. Coral,
 * red and amber are left out: they are the view's troubles (no wire, no power, short of it).
 */
export const GRID_COLORS: readonly string[] = [C.cyan, C.violetL, C.ledGreen, C.lilac, C.tealL, C.steelL, C.brass, C.turqL, C.peachD, C.glowPeach];

/**
 * The Logistique view's heat (D88): a line's throughput against what it can carry, cool to hot —
 * pale turquoise barely used, turquoise, amber, coral at its limit. The world's lines and the
 * panel's key read the same stops.
 */
export const HEAT: ReadonlyArray<readonly [number, string]> = [[0, C.turqL], [350, C.turq], [650, C.warn], [900, C.coral]];

/** The heat of a utilisation ‰ (0–1000), as '#rrggbb'. */
export function heatColor(util: number): string {
  const u = Math.max(0, Math.min(1000, util));
  for (let i = 1; i < HEAT.length; i++) {
    const [a, ca] = HEAT[i - 1]!, [b, cb] = HEAT[i]!;
    if (u <= b) return mix(ca, cb, (u - a) / (b - a));
  }
  return HEAT[HEAT.length - 1]![1];
}

