// items.ts — item glyphs as precise vector icons. The inked tokens read as hand-drawn mush at
// HUD size, so the owner asked for "something precise, recognizable" (2026-10-12): every glyph
// is now plain Canvas2D geometry (paths, arcs, curves) in a 32 px space centred on (16, 16), in
// one grammar shared by all items:
//   · one constant ink outline (OUT) around every part, a thinner ink (LINE) for inner edges;
//   · flat fills — the item's content colour for the body, one lighter tone where the light
//     falls (top-left) and one darker tone on the far side — and at most one small glint;
//   · a bold, distinct silhouette per item, so it still reads at 16 px in the HUD and at ~22 px
//     on a teal ribbon (the atlas bakes it at 2× and, for ribbons, on a paper halo: atlas.ts).
// Families share a silhouette and differ by colour and mark: the cells (empty / charged), the
// drops (water, resin), the gems. (The data cartridges and the codex went with the data, D122.)
// Nothing is random: the same glyph bakes to the same pixels on every machine.
import { ITEMS, type ItemId } from '@/content/items';
import type { Glyph, ItemDef } from '@/content/types';
import { C, mix } from '../tokens';
import { ORE_LOOK } from '../ore';
import type { Ctx } from '../ink';

export const GLYPH = 32;

type G = (ctx: Ctx, col: string) => void;
/** A shape adds its closed sub-paths to the current path; the painter begins the path. */
type Shape = (ctx: Ctx) => void;
type P = readonly [number, number];

const c = GLYPH / 2;
const TAU = Math.PI * 2;
/** The outline of every part, and the thinner ink of inner edges (32 px space). */
const OUT = 1.6;
const LINE = 1;
const WHITE = '#ffffff';
/** Light machined steel (caps, pins, flecks) and its shade. */
const STEEL = '#c5cddb';
const STEEL_D = '#8b95ab';

/** The lit and the shaded tone of a fill (light from the top-left). */
const hi = (col: string, t = 0.42): string => mix(col, WHITE, t);
const lo = (col: string, t = 0.3): string => mix(col, C.ink, t);

// ── shapes ────────────────────────────────────────────────────────────────

const poly = (pts: readonly P[]): Shape => (ctx) => {
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
};
const circle = (x: number, y: number, r: number): Shape => (ctx) => {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
  ctx.closePath();
};
const oval = (x: number, y: number, rx: number, ry: number, rot = 0): Shape => (ctx) => {
  ctx.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.closePath();
};
const rrect = (x: number, y: number, w: number, h: number, r: number): Shape => (ctx) => {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};
/** A teardrop: a round belly of radius r centred on (x, y), its point `tip` above the centre. */
const tear = (x: number, y: number, r: number, tip: number): Shape => (ctx) => {
  ctx.moveTo(x, y - tip);
  ctx.bezierCurveTo(x + r * 0.2, y - tip + r * 0.6, x + r, y - r * 0.8, x + r, y);
  ctx.arc(x, y, r, 0, Math.PI);
  ctx.bezierCurveTo(x - r, y - r * 0.8, x - r * 0.2, y - tip + r * 0.6, x, y - tip);
  ctx.closePath();
};
/** A cog of n teeth from the root circle r to the tip circle R; tip / root: half-widths (rad). */
const cog = (x: number, y: number, n: number, R: number, r: number, tip: number, root: number, phase = 0): Shape => (ctx) => {
  let end = phase - root;
  ctx.moveTo(x + Math.cos(end) * r, y + Math.sin(end) * r);
  for (let k = 0; k < n; k++) {
    const a = phase + (k * TAU) / n;
    ctx.arc(x, y, r, end, a - root);
    ctx.lineTo(x + Math.cos(a - tip) * R, y + Math.sin(a - tip) * R);
    ctx.arc(x, y, R, a - tip, a + tip);
    ctx.lineTo(x + Math.cos(a + root) * r, y + Math.sin(a + root) * r);
    end = a + root;
  }
  ctx.arc(x, y, r, end, phase - root + TAU);
  ctx.closePath();
};
/** A four-point star (a glint, a compass). */
const star = (x: number, y: number, r: number, waist = 0.28): Shape => poly([
  [x, y - r], [x + r * waist, y - r * waist], [x + r, y], [x + r * waist, y + r * waist],
  [x, y + r], [x - r * waist, y + r * waist], [x - r, y], [x - r * waist, y - r * waist],
]);

// ── painters ──────────────────────────────────────────────────────────────

function fill(ctx: Ctx, s: Shape, color: string, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  s(ctx);
  ctx.fill();
  ctx.restore();
}

/** Ink a shape's outline (or a coloured stroke when `color` is given). */
function stroke(ctx: Ctx, s: Shape, w = OUT, color: string = C.ink): void {
  ctx.save();
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  s(ctx);
  ctx.stroke();
  ctx.restore();
}

/** An open polyline: inner edges, veins, traces, wire. */
function line(ctx: Ctx, pts: readonly P[], w = LINE, color: string = C.ink): void {
  stroke(ctx, (k) => pts.forEach(([x, y], i) => (i === 0 ? k.moveTo(x, y) : k.lineTo(x, y))), w, color);
}

/** Paint clipped to a shape. */
function inside(ctx: Ctx, s: Shape, paint: () => void): void {
  ctx.save();
  ctx.beginPath();
  s(ctx);
  ctx.clip();
  paint();
  ctx.restore();
}

/**
 * The band of a shape that the same shape shifted by (dx, dy) leaves uncovered — a crisp
 * crescent on the side opposite the shift: shift up-left for the shade, down-right for the
 * light. Works for any single-contour shape, so every part is lit the same way.
 */
function rim(ctx: Ctx, s: Shape, dx: number, dy: number, color: string): void {
  inside(ctx, s, () => {
    ctx.beginPath();
    ctx.rect(-GLYPH, -GLYPH, GLYPH * 3, GLYPH * 3);
    ctx.translate(dx, dy);
    s(ctx);
    ctx.fillStyle = color;
    ctx.fill('evenodd');
  });
}

/** One part in the house style: flat body, shaded rim, lit rim, outline. */
function part(ctx: Ctx, s: Shape, col: string, o: { lit?: number; dark?: number; l?: number; d?: number } = {}): void {
  const d = o.d ?? 2.2, l = o.l ?? 1.3;
  fill(ctx, s, col);
  rim(ctx, s, -d * 0.75, -d, lo(col, o.dark ?? 0.28));
  rim(ctx, s, l * 0.85, l, hi(col, o.lit ?? 0.42));
  stroke(ctx, s);
}

/** The one small white specular glint a glyph may carry. */
function glint(ctx: Ctx, x: number, y: number, r = 1.5): void {
  fill(ctx, oval(x, y, r, r * 0.62, -Math.PI / 4), WHITE, 0.95);
}

// ── shared bodies ─────────────────────────────────────────────────────────

/** An iso cube: (x, y) its top vertex, e its edge — lit top, body-coloured left, shaded right. */
function cube(ctx: Ctx, x: number, y: number, e: number, col: string): void {
  const w = e * 0.87, v = e * 0.5;
  const N: P = [x, y], E: P = [x + w, y + v], S: P = [x, y + 2 * v], W: P = [x - w, y + v];
  const Ed: P = [E[0], E[1] + e], Sd: P = [S[0], S[1] + e], Wd: P = [W[0], W[1] + e];
  fill(ctx, poly([N, E, S, W]), hi(col, 0.55));
  fill(ctx, poly([W, S, Sd, Wd]), col);
  fill(ctx, poly([S, E, Ed, Sd]), lo(col, 0.2));
  line(ctx, [W, S, E]);
  line(ctx, [S, Sd]);
  stroke(ctx, poly([N, E, Ed, Sd, Wd, W]));
}

/** A cylindrical cell standing up: a steel + cap, lit down its left side, shaded down its right. */
function cell(ctx: Ctx, col: string, charged: boolean): void {
  const cap = rrect(12.5, 3, 7, 5, 1.2);
  fill(ctx, cap, STEEL);
  rim(ctx, cap, -1, -1.2, STEEL_D);
  stroke(ctx, cap);
  const body = rrect(8.5, 6.5, 15, 22, 3);
  fill(ctx, body, col);
  inside(ctx, body, () => {
    fill(ctx, rrect(10.4, 0, 2.6, 40, 0), hi(col, charged ? 0.6 : 0.42));
    fill(ctx, rrect(19.6, 0, 5, 40, 0), lo(col, charged ? 0.18 : 0.26));
  });
  line(ctx, [[8.5, 11.2], [23.5, 11.2]]);
  stroke(ctx, body);
  // The + of the positive pole, on the top band.
  line(ctx, [[14.2, 8.85], [17.8, 8.85]], 1.2);
  line(ctx, [[16, 7.2], [16, 10.5]], 1.2);
  if (charged) {
    const bolt = poly([[18, 12.5], [11.6, 20.6], [15.4, 20.6], [13.9, 27], [20.4, 18.4], [16.6, 18.4]]);
    fill(ctx, bolt, '#fff4b8');
    stroke(ctx, bolt, 1.1);
  } else {
    // An empty gauge: a dark window, one red bar left at the bottom.
    const win = rrect(12, 13.5, 8, 12, 1.4);
    fill(ctx, win, lo(col, 0.5));
    stroke(ctx, win, LINE);
    fill(ctx, rrect(13.4, 22.2, 5.2, 2, 0.6), C.coral);
  }
}

/** A cut gem: table and crown above the girdle, the pavilion converging to the culet. */
function gem(ctx: Ctx, col: string, table = hi(col, 0.55)): void {
  const T0: P = [10.5, 6], T1: P = [21.5, 6], G0: P = [3.5, 12.5], G1: P = [28.5, 12.5], K: P = [16, 28.5];
  const t0: P = [13, 12.5], t1: P = [19, 12.5];
  const S = poly([T0, T1, G1, K, G0]);
  fill(ctx, S, col);
  fill(ctx, poly([G0, T0, t0]), hi(col, 0.3));
  fill(ctx, poly([T0, T1, t1, t0]), table);
  fill(ctx, poly([t1, T1, G1]), col);
  fill(ctx, poly([t0, t1, K]), hi(col, 0.12));
  fill(ctx, poly([t1, G1, K]), lo(col, 0.3));
  line(ctx, [G0, t0, t1, G1], LINE, lo(col, 0.55));
  line(ctx, [T0, t0, K, t1, T1], LINE, lo(col, 0.55));
  stroke(ctx, S);
}

/** Copper (wire, leads): warm, a touch darker than brass. */
const COPPER = '#d9844a';
/** Dark iron (a bobbin's flanges and core, D129): bluer and deeper than the machined steel. */
const IRON = '#4f566c';

/**
 * A rock-crystal point: a hexagonal prism standing at (x, base) with its foot hidden, `h` tall and
 * `w` wide, leaning `lean` rad, terminated in three facets — the face to the light white, the far
 * one ice-blue, its root clouded milky.
 */
function quartzPoint(ctx: Ctx, x: number, base: number, h: number, w: number, lean: number, col: string): void {
  ctx.save();
  ctx.translate(x, base);
  ctx.rotate(lean);
  const hw = w / 2, sh = -h + w * 0.95, m = hw * 0.2, n = hw * 0.4;
  const S = poly([[-hw, 0], [-hw, sh], [0, -h], [hw, sh], [hw, 0]]);
  const ice = mix(col, '#7f9fb6', 0.42);
  fill(ctx, S, col);
  fill(ctx, poly([[-hw, 0], [-hw, sh], [0, -h], [-m, sh + 1], [-m, 0]]), WHITE);
  fill(ctx, poly([[n, 0], [n, sh + 1], [0, -h], [hw, sh], [hw, 0]]), ice);
  fill(ctx, poly([[-hw, 0], [-hw, -h * 0.28], [hw, -h * 0.28], [hw, 0]]), WHITE, 0.45);
  line(ctx, [[-m, 0], [-m, sh + 1], [0, -h]], 0.8, lo(col, 0.45));
  line(ctx, [[n, 0], [n, sh + 1], [0, -h]], 0.8, lo(col, 0.45));
  line(ctx, [[-hw, sh], [-m, sh + 1], [n, sh + 1], [hw, sh]], 0.8, lo(col, 0.45));
  stroke(ctx, S);
  ctx.restore();
}

// ── the glyphs ────────────────────────────────────────────────────────────

const GLYPHS: Record<Glyph, G> = {
  pebble: (ctx, col) => {
    // Iron ore: a chunky faceted rock, rust-red, its lit top cut as a facet and its far flank
    // grey-black magnetite — the nodules on the ground (art/ore.ts `ORE_LOOK`, D99) — grey metal
    // flecks catching the light.
    const nw: P = [6.5, 11.5], n: P = [12, 6.5], ne: P = [21, 5.5], e: P = [27, 10.5];
    const se: P = [28.5, 19], s: P = [23, 26], sw: P = [10.5, 27], w: P = [4, 20.5];
    const k1: P = [11, 13.5], k2: P = [20, 13], k3: P = [19.5, 21]; // where the facets meet
    const rock = poly([nw, n, ne, e, se, s, sw, w]);
    fill(ctx, rock, col);
    fill(ctx, poly([nw, n, ne, e, k2, k1]), ORE_LOOK.iron_ore.lit);
    fill(ctx, poly([e, se, s, k3, k2]), ORE_LOOK.iron_ore.accent);
    line(ctx, [k1, k2, e], 0.8, lo(col, 0.55));
    line(ctx, [k2, k3, s], 0.8, lo(col, 0.55));
    for (const [x, y, k] of [[10.5, 18.5, 1], [15, 23, 0.8], [24, 17.5, 0.85], [15.5, 9.5, 0.75]] as const) {
      fill(ctx, poly([[x - 2.2 * k, y + 0.3], [x - 0.4 * k, y - 1.5 * k], [x + 2.2 * k, y - 0.3], [x + 0.4 * k, y + 1.5 * k]]), STEEL);
    }
    stroke(ctx, rock);
  },
  grain: (ctx, col) => {
    // Sand: a small heap — a smooth mound lit on its left flank, a few grains on its slope.
    const heap: Shape = (k) => {
      k.moveTo(3, 25.5);
      k.bezierCurveTo(6, 18, 11, 8, 16, 8);
      k.bezierCurveTo(21, 8, 26, 18, 29, 25.5);
      k.quadraticCurveTo(29.5, 27.5, 27, 27.5);
      k.lineTo(5, 27.5);
      k.quadraticCurveTo(2.5, 27.5, 3, 25.5);
      k.closePath();
    };
    fill(ctx, heap, col);
    rim(ctx, heap, -2.4, -1.4, lo(col, 0.25));
    rim(ctx, heap, 1.6, 1.4, hi(col, 0.5));
    for (const [x, y] of [[12, 15.5], [18.5, 13], [21.5, 20.5], [9, 22], [15.5, 21.5]] as const) fill(ctx, circle(x, y, 1.1), lo(col, 0.38));
    stroke(ctx, heap);
  },
  crystal: (ctx, col) => {
    // Quartz (D87): rock crystal as it is cut from the cliff — two clear, milky-rooted points
    // breaking out of a lump of grey stone, cool pale tints and a glint. Two white points on grey,
    // where the singing quartz is three lilac prisms on a dark matrix.
    const stone = '#a7a3b4';
    quartzPoint(ctx, 21.5, 25, 16, 7, 0.48, col);
    quartzPoint(ctx, 13.2, 26, 24, 9, -0.2, col);
    const lump = poly([[3.5, 26.5], [5.5, 22.5], [10.5, 21], [17, 22], [23.5, 20.5], [28, 23.5], [28.5, 27], [24, 29.5], [8.5, 29.5]]);
    fill(ctx, lump, stone);
    rim(ctx, lump, -1.4, -1.6, lo(stone, 0.32));
    rim(ctx, lump, 1, 1.2, hi(stone, 0.35));
    line(ctx, [[9, 26.5], [13, 27.8], [17.5, 27]], 0.8, lo(stone, 0.45));
    stroke(ctx, lump);
    fill(ctx, star(10, 5.6, 2.8), WHITE);
  },
  oscillator: (ctx, col) => {
    // Quartz oscillator (D87): the HC-49 can — a rounded metal case on its darker flange, a quartz
    // blade's wave stamped on it, its two copper leads below.
    for (const x of [12.2, 19.8]) {
      line(ctx, [[x, 24], [x, 30]], 3.4);
      line(ctx, [[x, 24], [x, 30]], 1.6, COPPER);
    }
    const flange = rrect(5.5, 21, 21, 4.5, 1.6);
    part(ctx, flange, lo(col, 0.18), { d: 1.1, l: 0.9 });
    const can = rrect(6.5, 5, 19, 17, 4.2);
    fill(ctx, can, col);
    inside(ctx, can, () => {
      fill(ctx, rrect(9.4, 0, 2.6, 40, 0), hi(col, 0.55));
      fill(ctx, rrect(20.2, 0, 6, 40, 0), lo(col, 0.24));
    });
    stroke(ctx, can);
    // The stamp: one period of a wave in a little frame (the crystal's ring).
    const frame = rrect(10.5, 9.8, 11, 7.4, 1.2);
    stroke(ctx, frame, 0.8, lo(col, 0.5));
    stroke(ctx, (k) => { k.moveTo(11.8, 13.5); k.bezierCurveTo(13.8, 9.3, 14.5, 9.3, 16, 13.5); k.bezierCurveTo(17.5, 17.7, 18.2, 17.7, 20.2, 13.5); }, 1.2, C.ink);
    glint(ctx, 10, 7.6, 1.4);
  },
  coal: (ctx, col) => {
    // Coal: three black faceted lumps with cool grey top facets, one cold glint.
    const topTone = mix(col, C.steelL, 0.45);
    const lump = (pts: readonly P[], top: readonly P[]): void => {
      fill(ctx, poly(pts), col);
      fill(ctx, poly(top), topTone);
      stroke(ctx, poly(pts));
    };
    lump([[10, 11], [13, 5], [19.5, 4.5], [23.5, 9.5], [21.5, 15.5], [12, 16]], [[10, 11], [13, 5], [19.5, 4.5], [23.5, 9.5], [17, 11]]);
    lump([[15, 19.5], [19, 13], [25.5, 13], [29, 18.5], [26, 26], [17.5, 26.5]], [[15, 19.5], [19, 13], [25.5, 13], [29, 18.5], [22, 19.5]]);
    lump([[3, 20.5], [6.5, 14], [12.5, 12.5], [17, 17.5], [15.5, 26], [7.5, 27]], [[3, 20.5], [6.5, 14], [12.5, 12.5], [17, 17.5], [10, 19]]);
    fill(ctx, star(16.5, 7.5, 2.6), '#e6f9ff');
  },
  copper: (ctx, col) => {
    // Copper ore: a broken chunk of copper-orange rock (a peaked silhouette where iron ore is a
    // squat boulder), faceted the same way, crusted with malachite green — the crusts on the
    // ground (art/ore.ts `ORE_LOOK`, D99).
    const w: P = [3.5, 18.5], nw: P = [8, 9], n: P = [15.5, 5.5], ne: P = [25.5, 4.5];
    const e: P = [29, 13], se: P = [27, 24.5], s: P = [18.5, 28.5], sw: P = [7, 26.5];
    const k1: P = [11.5, 14], k2: P = [21, 13.5], k3: P = [21, 22]; // where the facets meet
    const rock = poly([w, nw, n, ne, e, se, s, sw]);
    fill(ctx, rock, col);
    fill(ctx, poly([nw, n, ne, e, k2, k1]), hi(col, 0.3));
    fill(ctx, poly([e, se, s, k3, k2]), lo(col, 0.3));
    const green = ORE_LOOK.copper_ore.accent;
    fill(ctx, poly([[5.5, 21], [9.5, 18], [14, 19.5], [12.5, 24.5], [7.5, 25]]), green);
    fill(ctx, poly([[16.5, 8.5], [21.5, 7], [22.5, 10.5], [18, 11.5]]), mix(green, WHITE, 0.3));
    fill(ctx, poly([[22.5, 18.5], [26.5, 16.5], [26, 21.5], [22.5, 23]]), mix(green, C.ink, 0.3));
    line(ctx, [nw, k1, k2, e], 0.8, lo(col, 0.55));
    line(ctx, [k2, k3, s], 0.8, lo(col, 0.55));
    stroke(ctx, rock);
  },
  rubble: (ctx, col) => {
    // Stone: a quarried block seen from the front — lit top, body-coloured face, shaded flank —
    // two corners broken off and a crack down its face, so it reads as stone, not a crate.
    const F0: P = [4, 12.5], F1: P = [21.5, 12.5], F2: P = [21.5, 26], F3: P = [4, 26];
    const T0: P = [10, 6.5], T1: P = [27.5, 6.5], R2: P = [27.5, 20];
    const a: P = [4, 16.5], b: P = [7, 9.5], m: P = [8.8, 12.5]; // chip at the front-top-left corner
    const p: P = [27.5, 15.5], q: P = [24.5, 23], n: P = [25.2, 18.4]; // chip at the back-bottom corner
    const S = poly([F3, a, b, T0, T1, p, q, F2]);
    inside(ctx, S, () => {
      fill(ctx, poly([F0, T0, T1, F1]), hi(col, 0.45));
      fill(ctx, poly([F0, F1, F2, F3]), col);
      fill(ctx, poly([F1, T1, R2, F2]), lo(col, 0.3));
    });
    fill(ctx, poly([a, b, m]), hi(col, 0.22));
    fill(ctx, poly([p, q, n]), lo(col, 0.45));
    line(ctx, [m, F1, T1]);
    line(ctx, [F1, F2]);
    line(ctx, [a, m, b]);
    line(ctx, [p, n, q]);
    line(ctx, [[13, 12.5], [14.5, 16.5], [13, 19.5], [14, 23]], 1, lo(col, 0.55));
    stroke(ctx, S);
  },
  drop: (ctx, col) => {
    // Water: a drop — lit along its left, shaded round its belly, one glint.
    const s = tear(16, 19.5, 8.5, 16);
    part(ctx, s, col, { d: 2.6, l: 1.4, lit: 0.5 });
    glint(ctx, 12.6, 18, 1.7);
  },
  salt: (ctx, col) => {
    // Salt: three white cubic crystals.
    cube(ctx, 18.5, 3.5, 9, col);
    cube(ctx, 10, 11, 8.5, col);
    cube(ctx, 22.5, 14.5, 7, col);
  },
  plate: (ctx, col) => {
    // Iron plate: a bevelled steel plate, slightly turned, its thickness showing, two bolt holes.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-0.14);
    ctx.translate(-c, -c);
    const edge = rrect(4.5, 10, 24, 14.5, 2.2);
    const face = rrect(3.5, 7.5, 24, 14.5, 2.2);
    fill(ctx, edge, lo(col, 0.38));
    stroke(ctx, edge);
    fill(ctx, face, col);
    rim(ctx, face, 1.2, 1.4, hi(col, 0.5));
    stroke(ctx, face);
    for (const x of [8, 23]) fill(ctx, circle(x, 14.75, 1.9), C.ink);
    ctx.restore();
  },
  pane: (ctx, col) => {
    // Glass: a clear pane, its green-tinted thickness showing, two diagonal reflections.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(0.12);
    ctx.translate(-c, -c);
    const edge = rrect(7.5, 7, 19, 21, 1.5);
    const face = rrect(5.5, 5, 19, 21, 1.5);
    fill(ctx, edge, mix(col, C.turqD, 0.55));
    stroke(ctx, edge);
    fill(ctx, face, col);
    inside(ctx, face, () => {
      fill(ctx, poly([[4, 19], [18, 5], [22, 5], [4, 23]]), WHITE, 0.85);
      fill(ctx, poly([[9, 26], [26, 9], [26, 10.6], [10.6, 26]]), WHITE, 0.85);
    });
    stroke(ctx, face);
    ctx.restore();
  },
  coil: (ctx, col) => {
    // Copper wire: a spool — steel flanges, copper turns between them, a loose end.
    const flange = mix(C.steel, C.steelL, 0.5);
    line(ctx, [[22, 16], [26.5, 14.5], [29, 11]], 3.4);
    line(ctx, [[22, 16], [26.5, 14.5], [29, 11]], 1.4, col);
    const body = rrect(8.5, 8, 15, 16, 1);
    fill(ctx, body, col);
    inside(ctx, body, () => {
      fill(ctx, rrect(10.2, 0, 2.4, 40, 0), hi(col, 0.42));
      fill(ctx, rrect(19.5, 0, 5, 40, 0), lo(col, 0.3));
      for (let y = 11; y < 23; y += 2.7) line(ctx, [[8, y], [24, y]], 0.8, lo(col, 0.5));
    });
    stroke(ctx, body);
    for (const y of [4.5, 23]) {
      const f = rrect(5, y, 22, 4.5, 1.6);
      fill(ctx, f, flange);
      rim(ctx, f, 0.8, 1, hi(flange, 0.35));
      stroke(ctx, f);
    }
  },
  gear: (ctx, col) => {
    // Gear: a clean cog, eight teeth, a raised hub and its axle hole.
    const s = cog(c, c, 8, 13.5, 10, 0.135, 0.24, 0);
    part(ctx, s, col, { d: 2, l: 1.3 });
    const hub = circle(c, c, 5);
    fill(ctx, hub, hi(col, 0.2));
    stroke(ctx, hub, LINE);
    fill(ctx, circle(c, c, 2.2), C.ink);
  },
  servo: (ctx, col) => {
    // Servomotor (D81): a ribbed motor can on its side, a steel flange and the output shaft with
    // its key, the cable out of its back end.
    line(ctx, [[6.5, 21.5], [4.5, 25.5], [8.5, 27.5]], 1.6, C.ink);
    const plug = rrect(8, 26, 4, 3, 0.8);
    fill(ctx, plug, STEEL);
    stroke(ctx, plug, 0.8);
    const can = rrect(4.5, 9.5, 17.5, 13, 3);
    part(ctx, can, col, { d: 1.8, l: 1.2 });
    for (const x of [8.5, 11.5, 14.5, 17.5]) line(ctx, [[x, 10.5], [x, 21.5]], 1.2, lo(col, 0.45));
    const flange = rrect(21.5, 7, 4.5, 18, 1.2);
    part(ctx, flange, STEEL, { d: 1.2, l: 1 });
    const shaft = rrect(25.5, 14, 4.5, 4, 0.8);
    fill(ctx, shaft, hi(STEEL, 0.25));
    stroke(ctx, shaft, LINE);
    line(ctx, [[27, 14.6], [29, 14.6]], 1, C.ink);
  },
  arm: (ctx, col) => {
    // Robot arm (D81): a steel base plate, a pedestal, two jointed segments and a two-finger gripper.
    const base = rrect(3.5, 24.5, 13, 4, 1.2);
    part(ctx, base, STEEL, { d: 1.2, l: 1 });
    part(ctx, rrect(7, 19, 6, 6.5, 1.5), col, { d: 1.4, l: 1 });
    part(ctx, poly([[11.6, 20.5], [20.6, 10.5], [17.4, 7.5], [8.4, 17.5]]), col, { d: 1.4, l: 1 });
    part(ctx, poly([[20.5, 7.9], [26.5, 15.9], [23.5, 18.1], [17.5, 10.1]]), col, { d: 1.4, l: 1 });
    for (const [x, y, r] of [[10, 19, 3], [19, 9, 2.6], [25, 17, 1.9]] as const) {
      const j = circle(x, y, r);
      fill(ctx, j, STEEL);
      stroke(ctx, j, LINE);
      fill(ctx, circle(x, y, r * 0.38), C.ink);
    }
    line(ctx, [[24.2, 18.5], [22.6, 23], [24, 24.5]], 1.7, C.ink);
    line(ctx, [[26.3, 18.3], [28.2, 22.4], [27, 24.2]], 1.7, C.ink);
  },
  chip: (ctx, col) => {
    // Circuit board: a board, a black chip, gold traces running to pads.
    const board = rrect(4, 5.5, 24, 21, 2.5);
    fill(ctx, board, col);
    rim(ctx, board, -1.5, -2, lo(col, 0.3));
    rim(ctx, board, 1.1, 1.3, hi(col, 0.38));
    const gold = C.brassL;
    for (const pts of [
      [[14, 11], [14, 8.8], [8.5, 8.8]],
      [[18, 11], [18, 8.8], [23.5, 8.8]],
      [[14, 21], [14, 23.2], [8.5, 23.2]],
      [[18, 21], [18, 23.2], [23.5, 23.2]],
    ] as const) line(ctx, pts, 1.1, gold);
    for (const [x, y] of [[8, 8.8], [24, 8.8], [8, 23.2], [24, 23.2]] as const) {
      fill(ctx, circle(x, y, 1.4), gold);
      stroke(ctx, circle(x, y, 1.4), 0.7);
    }
    stroke(ctx, board);
    for (const y of [13.5, 16, 18.5]) {
      line(ctx, [[9.6, y], [11.5, y]], 1.1, STEEL);
      line(ctx, [[20.5, y], [22.4, y]], 1.1, STEEL);
    }
    const ic = rrect(11.5, 11, 9, 10, 1);
    fill(ctx, ic, '#2e2a44');
    stroke(ctx, ic, LINE);
    fill(ctx, circle(13.6, 13.1, 0.9), '#6c6886');
  },
  tile: (ctx, col) => {
    // Ceramic: a glazed tile — cream glaze on top with a glaze motif, terracotta body below.
    const t = 4.5;
    const N: P = [16, 5], E: P = [29, 12], S: P = [16, 19], W: P = [3, 12];
    const Ed: P = [29, 12 + t], Sd: P = [16, 19 + t], Wd: P = [3, 12 + t];
    const clay = C.mesa;
    fill(ctx, poly([W, S, Sd, Wd]), clay);
    fill(ctx, poly([S, E, Ed, Sd]), lo(clay, 0.3));
    const top = poly([N, E, S, W]);
    fill(ctx, top, col);
    inside(ctx, top, () => fill(ctx, poly([[3, 12], [16, 5], [17.5, 6.5], [4.5, 13.5]]), WHITE, 0.8));
    const motif = poly([[16, 8.5], [22.5, 12], [16, 15.5], [9.5, 12]]);
    fill(ctx, motif, C.turq);
    stroke(ctx, motif, LINE);
    line(ctx, [W, S, E]);
    line(ctx, [S, Sd]);
    stroke(ctx, poly([N, E, Ed, Sd, Wd, W]));
  },
  cell: (ctx, col) => cell(ctx, col, false),
  cellCharged: (ctx, col) => cell(ctx, col, true),
  shard: (ctx, col) => {
    // Sporeglass: a long glass shard, a ridge down its length, spores caught inside.
    const T: P = [20, 3.5], R1: P = [25, 11], R2: P = [21.5, 26], B: P = [13.5, 29], L2: P = [7.5, 21], L1: P = [11.5, 8];
    const M: P = [17, 16];
    const S = poly([T, R1, R2, B, L2, L1]);
    fill(ctx, S, col);
    fill(ctx, poly([T, M, B, L2, L1]), hi(col, 0.4));
    fill(ctx, poly([T, R1, R2, B, M]), lo(col, 0.18));
    line(ctx, [T, M, B], LINE, lo(col, 0.5));
    for (const [x, y, r] of [[13, 13, 1.2], [20.5, 19, 1.3], [16, 23.5, 1]] as const) fill(ctx, circle(x, y, r), C.turqD);
    stroke(ctx, S);
  },
  resin: (ctx, col) => {
    // Sky resin: a big amber drop and a little one beside it.
    part(ctx, tear(24, 24, 3.8, 7), col, { d: 1.4, l: 0.8 });
    part(ctx, tear(13.5, 18.5, 8, 15), col, { d: 2.4, l: 1.4, lit: 0.48 });
    glint(ctx, 10.4, 17, 1.6);
  },
  ember: (ctx, col) => {
    // Embersalt: a red gem with a glowing heart.
    gem(ctx, col, C.glowPeach);
    fill(ctx, star(13.5, 8.8, 2.2), WHITE);
  },
  lens: (ctx, col) => {
    // Lens: a ground glass disc in a brass ring, one curved reflection.
    part(ctx, circle(c, c, 12.5), C.brass, { d: 1.6, l: 1.1 });
    const glass = circle(c, c, 8.8);
    fill(ctx, glass, col);
    rim(ctx, glass, -1.6, -2, lo(col, 0.25));
    stroke(ctx, glass, LINE * 1.2);
    stroke(ctx, (k) => k.arc(c, c, 5.8, Math.PI * 1.05, Math.PI * 1.45), 1.8, WHITE);
  },
  canvas: (ctx, col) => {
    // Resin canvas: a roll of stiffened cloth, a sheet unrolled towards us.
    const sheet = poly([[6, 15.5], [23.5, 15.5], [26.5, 27], [4, 27]]);
    fill(ctx, sheet, col);
    rim(ctx, sheet, -1.5, -1.5, lo(col, 0.2));
    inside(ctx, sheet, () => fill(ctx, poly([[4, 22], [27, 22], [27, 23.6], [4, 23.6]]), hi(col, 0.5)));
    stroke(ctx, sheet);
    const roll = rrect(4, 6, 22, 11, 5.5);
    fill(ctx, roll, col);
    inside(ctx, roll, () => {
      fill(ctx, rrect(0, 7.6, 32, 2.4, 0), hi(col, 0.45));
      fill(ctx, rrect(0, 13.4, 32, 6, 0), lo(col, 0.22));
    });
    stroke(ctx, roll);
    const end = oval(23.5, 11.5, 2.6, 5.5);
    fill(ctx, end, hi(col, 0.2));
    stroke(ctx, end, LINE);
    stroke(ctx, oval(23.5, 11.5, 1, 2.2), 0.8);
  },
  core: (ctx, col) => {
    // Thermal core: a hot orb inside a brass ring (the ring passes behind, then in front).
    const ring = (a0: number, a1: number): void => {
      const s: Shape = (k) => k.ellipse(c, c + 0.5, 14, 4.8, -0.35, a0, a1);
      stroke(ctx, s, 5);
      stroke(ctx, s, 2.2, C.warn);
    };
    ring(Math.PI, TAU);
    part(ctx, circle(c, c, 9), col, { d: 2.2, l: 1.3, lit: 0.38 });
    fill(ctx, circle(c - 3, c - 3, 2.8), C.glowPeach);
    ring(0, Math.PI);
  },
  moss: (ctx, col) => {
    // Lumen moss: a clump of round tufts, back to front, with three specks of light.
    for (const [x, y, r] of [[11, 13.5, 5.5], [19.5, 10.5, 6.5], [25, 16.5, 4.8], [8, 20.5, 5.5], [16.5, 20, 7], [24.5, 23, 4.8]] as const) {
      part(ctx, circle(x, y, r), col, { d: 1.6, l: 1, dark: 0.3, lit: 0.5 });
    }
    for (const [x, y] of [[21.5, 8], [14.5, 18.5], [6.5, 21]] as const) fill(ctx, circle(x, y, 1), WHITE);
  },
  nacre: (ctx, col) => {
    // Fossil nacre: an ammonite. Its outline is the last turn of an Archimedean spiral closed
    // by the aperture; the inner turns are one lilac line; ribs cross the outer whorl.
    const turns = 2.5, r0 = 1, rMax = 13.2, end = 0.35;
    const ox = c - 1.1, oy = c - 0.4; // the coil's eye, set off so the shell sits centred
    const at = (t: number, dr = 0): P => {
      const a = end - (1 - t) * turns * TAU, r = r0 + (rMax - r0) * t + dr;
      return [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
    };
    const t0 = 1 - 1 / turns;
    const rim0: P[] = [];
    for (let i = 0; i <= 72; i++) rim0.push(at(t0 + ((1 - t0) * i) / 72));
    const shell = poly(rim0);
    fill(ctx, shell, col);
    rim(ctx, shell, -1.6, -2, mix(col, C.lilacD, 0.35));
    rim(ctx, shell, 1.1, 1.3, WHITE);
    for (let k = 0; k < 13; k++) {
      const t = t0 + ((1 - t0) * (k + 0.6)) / 13.4;
      line(ctx, [at(t - 1 / turns, 1), at(t, -1)], 0.8, mix(col, C.lilacD, 0.55));
    }
    const coil: P[] = [];
    for (let i = 0; i <= 96; i++) coil.push(at((t0 * i) / 96));
    line(ctx, coil, 1.2, C.lilacD);
    stroke(ctx, shell);
  },
  quartz: (ctx, col) => {
    // Singing quartz: three hexagonal prisms on a dark matrix, lit faces left, shaded right.
    const prism = (x: number, base: number, h: number, w: number, rot: number): void => {
      ctx.save();
      ctx.translate(x, base);
      ctx.rotate(rot);
      const hw = w / 2, sh = -h + w * 0.8;
      const S = poly([[-hw, 0], [-hw, sh], [0, -h], [hw, sh], [hw, 0]]);
      fill(ctx, S, col);
      fill(ctx, poly([[-hw, 0], [-hw, sh], [0, -h], [-hw * 0.15, sh], [-hw * 0.15, 0]]), hi(col, 0.45));
      fill(ctx, poly([[hw * 0.45, 0], [hw * 0.45, sh], [0, -h], [hw, sh], [hw, 0]]), lo(col, 0.25));
      line(ctx, [[-hw * 0.15, 0], [-hw * 0.15, sh], [0, -h]], 0.8, lo(col, 0.5));
      line(ctx, [[-hw, sh], [-hw * 0.15, sh], [hw * 0.45, sh], [hw, sh]], 0.8, lo(col, 0.5));
      stroke(ctx, S);
      ctx.restore();
    };
    prism(9.5, 26, 15, 6.5, -0.4);
    prism(22.5, 26, 13, 6, 0.42);
    prism(16, 26.5, 23, 7.5, 0);
    part(ctx, poly([[5.5, 24.5], [26.5, 24.5], [24.5, 29], [7.5, 29]]), lo(col, 0.55), { d: 1, l: 0.8 });
  },
  resonator: (ctx, col) => {
    // Resonator: a tuning fork — two prongs on a U, a stem below.
    part(ctx, rrect(14, 19, 4, 10.5, 1.6), col, { d: 1.2, l: 0.8 });
    const fork: Shape = (k) => {
      k.moveTo(8, 5);
      k.lineTo(8, 13.5);
      k.arc(16, 13.5, 8, Math.PI, 0, true);
      k.lineTo(24, 5);
      k.arc(22, 5, 2, 0, Math.PI, true);
      k.lineTo(20, 13.5);
      k.arc(16, 13.5, 4, 0, Math.PI, false);
      k.lineTo(12, 5);
      k.arc(10, 5, 2, 0, Math.PI, true);
      k.closePath();
    };
    part(ctx, fork, col, { d: 1.8, l: 1.1, lit: 0.45 });
  },
  lattice: (ctx, col) => {
    // Nacre lattice: a hexagonal truss — a pearly frame, six triangular openings.
    const R = 13, vs: P[] = [];
    for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + (k * TAU) / 6; vs.push([c + Math.cos(a) * R, c + Math.sin(a) * R]); }
    const hex = poly(vs);
    fill(ctx, hex, col);
    rim(ctx, hex, -1.6, -2, mix(col, C.lilacD, 0.4));
    for (let k = 0; k < 6; k++) {
      const a = vs[k]!, b = vs[(k + 1) % 6]!;
      // The opening: the triangle (centre, a, b) shrunk towards its own centre.
      const gx = (c + a[0] + b[0]) / 3, gy = (c + a[1] + b[1]) / 3, f = 0.52;
      const tri = poly([[gx + (c - gx) * f, gy + (c - gy) * f], [gx + (a[0] - gx) * f, gy + (a[1] - gy) * f], [gx + (b[0] - gx) * f, gy + (b[1] - gy) * f]]);
      fill(ctx, tri, k < 3 ? mix(col, C.lilacD, 0.55) : mix(col, C.lilacD, 0.4)); // right half: the shaded side
      stroke(ctx, tri, LINE);
    }
    stroke(ctx, hex);
  },
  // ── D123: what the basic resources make one step further ────────────────
  ingot: (ctx, col) => {
    // Steel: a cast bar seen from above its front corner — its battered sides, its lit top with the
    // mill's stamp, a glint on the near edge. Heavier and bluer than the iron plate.
    const fl: P = [4, 25], fr: P = [22, 25], br: P = [28, 21], tbr: P = [25, 12], tbl: P = [13, 12], tfl: P = [7, 16], tfr: P = [19, 16];
    const S = poly([fl, fr, br, tbr, tbl, tfl]);
    fill(ctx, S, col);
    fill(ctx, poly([tfl, tfr, tbr, tbl]), hi(col, 0.5));
    fill(ctx, poly([fr, br, tbr, tfr]), lo(col, 0.32));
    fill(ctx, poly([[6.5, 24], [9, 24], [9.8, 17.5], [8.2, 17.5]]), hi(col, 0.2));
    line(ctx, [tfl, tfr, fr]);
    line(ctx, [tfr, tbr]);
    const stamp = poly([[13.2, 13.4], [19.6, 13.4], [21.2, 14.6], [14.8, 14.6]]);
    fill(ctx, stamp, lo(col, 0.35));
    stroke(ctx, S);
    glint(ctx, 10, 17.2, 1.3);
  },
  brick: (ctx, col) => {
    // Brick: two bricks in a running bond, the upper one set half a brick along on a pale bed of
    // mortar — lit tops, shaded ends, a few dark grains of fired sand on their faces.
    const mortar = mix(C.paper, col, 0.25);
    const one = (dx: number, dy: number): void => {
      const f0: P = [2 + dx, 28 + dy], f1: P = [20 + dx, 28 + dy], t0: P = [2 + dx, 22 + dy], t1: P = [20 + dx, 22 + dy];
      const b1: P = [26 + dx, 18 + dy], b0: P = [8 + dx, 18 + dy], e1: P = [26 + dx, 24 + dy];
      const S = poly([f0, f1, e1, b1, b0, t0]);
      fill(ctx, S, col);
      fill(ctx, poly([t0, t1, b1, b0]), hi(col, 0.38));
      fill(ctx, poly([f1, e1, b1, t1]), lo(col, 0.3));
      for (const [x, y] of [[6, 25], [11.5, 26.2], [16, 24.6]] as const) fill(ctx, circle(x + dx, y + dy, 0.6), lo(col, 0.55));
      line(ctx, [t0, t1, f1]);
      line(ctx, [t1, b1]);
      stroke(ctx, S);
    };
    one(0, 0);
    // The mortar bed on the lower brick's top, under where the upper one sits.
    fill(ctx, poly([[6, 22], [20, 22], [26, 18], [12, 18]]), mortar);
    one(4, -6);
  },
  pipe: (ctx, col) => {
    // Pipe: a length of steel tube lying aslant, lit along its top, a flange at its near end and
    // the dark bore open towards the light.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-0.5);
    ctx.translate(-c, -c);
    const body: Shape = (k) => {
      k.moveTo(24, 10.5);
      k.lineTo(5.5, 10.5);
      k.ellipse(5.5, 16, 2.6, 5.5, 0, -Math.PI / 2, Math.PI / 2, true);
      k.lineTo(24, 21.5);
      k.closePath();
    };
    fill(ctx, body, col);
    inside(ctx, body, () => {
      fill(ctx, rrect(0, 12, 32, 2.2, 0), hi(col, 0.5));
      fill(ctx, rrect(0, 18.6, 32, 4, 0), lo(col, 0.3));
    });
    line(ctx, [[9.5, 10.8], [9.5, 21.2]], LINE, lo(col, 0.45));
    stroke(ctx, body);
    const flange = oval(24.5, 16, 3.6, 7.2);
    fill(ctx, flange, hi(col, 0.22));
    rim(ctx, flange, -0.8, -1, lo(col, 0.25));
    stroke(ctx, flange);
    for (const a of [0.9, 2.2, 4.1, 5.4]) fill(ctx, circle(24.5 + Math.cos(a) * 2.6, 16 + Math.sin(a) * 5.6, 0.55), C.ink);
    const bore = oval(24.5, 16, 2, 4.3);
    fill(ctx, bore, lo(col, 0.72));
    stroke(ctx, bore, LINE);
    ctx.restore();
  },
  cable: (ctx, col) => {
    // Cable: a hank of thick sheathed cable, two turns and a tail, its cut end showing the copper
    // strands inside — not the bare wire's spool.
    const rope = (draw: (k: Ctx) => void): void => {
      stroke(ctx, draw, 6.6, C.ink);
      stroke(ctx, draw, 4.2, col);
      stroke(ctx, draw, 1.1, hi(col, 0.45));
    };
    rope((k) => { k.moveTo(22.6, 13); k.ellipse(13.5, 13, 9.1, 8.2, 0, 0, Math.PI * 1.85); });
    rope((k) => { k.moveTo(19, 14.5); k.ellipse(13.5, 14.5, 5.5, 4.8, 0, 0, Math.PI * 1.7); });
    rope((k) => { k.moveTo(22.6, 13); k.bezierCurveTo(23.4, 19, 24, 22, 26.6, 25.4); });
    const end = circle(26.8, 25.6, 3.3);
    fill(ctx, end, col);
    stroke(ctx, end);
    fill(ctx, circle(26.8, 25.6, 2.1), COPPER);
    for (const a of [0.3, 2.4, 4.5]) fill(ctx, circle(26.8 + Math.cos(a) * 1.05, 25.6 + Math.sin(a) * 1.05, 0.55), lo(COPPER, 0.4));
  },
  // ── D129: the assembly bench's parts ────────────────────────────────────
  bobbin: (ctx, col) => {
    // Copper coil: a bobbin lying aslant — fat copper windings between two dark iron flanges, the
    // near one seen face on with the square iron core through it, two leads out of its top. Not
    // the wire's upright spool (`coil`: steel bars top and bottom): a reel on its side, iron-ended.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-0.38);
    ctx.translate(-c, -c);
    const far = oval(7, 16, 2.6, 10.2);
    part(ctx, far, IRON, { d: 1, l: 0.8 });
    const body: Shape = (k) => {
      k.moveTo(7, 9);
      k.lineTo(22, 9);
      k.lineTo(22, 23);
      k.lineTo(7, 23);
      k.closePath();
    };
    fill(ctx, body, col);
    inside(ctx, body, () => {
      fill(ctx, rrect(0, 10.2, 40, 2.4, 0), hi(col, 0.45));
      fill(ctx, rrect(0, 18.6, 40, 5, 0), lo(col, 0.3));
      // The turns: close slanted strokes across the winding, darker than the copper.
      for (let x = 7.6; x < 23; x += 2.2) line(ctx, [[x, 8.5], [x + 1.4, 23.5]], 0.85, lo(col, 0.5));
    });
    stroke(ctx, body);
    // The near flange, face on: dark iron, lit on its upper rim, the square core in the middle.
    const near = oval(22.5, 16, 4.4, 10.8);
    part(ctx, near, IRON, { d: 1.3, l: 1.1 });
    // The core's end: a square of laminated iron through the flange, its plates' seams, a dark bore.
    const core = poly([[20.6, 12.6], [24.4, 13.2], [24.4, 19.4], [20.6, 18.8]]);
    fill(ctx, core, hi(IRON, 0.3));
    line(ctx, [[20.6, 14.7], [24.4, 15.3]], 0.6, lo(IRON, 0.3));
    line(ctx, [[20.6, 16.8], [24.4, 17.4]], 0.6, lo(IRON, 0.3));
    stroke(ctx, core, LINE);
    fill(ctx, oval(22.5, 16, 0.9, 1.4), C.ink);
    // The two leads, out of the winding at the near flange's top.
    for (const [a, b] of [[[19.5, 9], [21, 4.8]], [[17, 9], [17.6, 3.6]]] as const) {
      line(ctx, [a, b], 3.2);
      line(ctx, [a, b], 1.4, hi(col, 0.2));
    }
    ctx.restore();
    glint(ctx, 11, 9.4, 1.2);
  },
  motor: (ctx, col) => {
    // Electric motor: a finned cast housing lying on its feet, seen three-quarters — the fins along
    // its length, the fan cowl's rounded end bell at the back, the near end bell face on with the
    // steel shaft stub and its key, the terminal box on top with its cable gland. Not the
    // servomotor (a ringed can on a flange): fins along, a box on top, feet below.
    const feet = rrect(6, 24.5, 15, 4, 1);
    part(ctx, feet, lo(col, 0.3), { d: 0.9, l: 0.7 });
    const bell = (k: Ctx): void => {
      k.moveTo(6.5, 10.5);
      k.bezierCurveTo(1.8, 10.5, 1.8, 24.5, 6.5, 24.5);
      k.closePath();
    };
    part(ctx, bell, hi(col, 0.12), { d: 1, l: 0.9 });
    for (const y of [14, 17.5, 21]) line(ctx, [[3.4, y], [6.2, y]], 0.8, lo(col, 0.45));
    const body = rrect(6, 10, 16, 15, 0.8);
    fill(ctx, body, col);
    inside(ctx, body, () => {
      fill(ctx, rrect(0, 11.2, 40, 2.4, 0), hi(col, 0.45));
      fill(ctx, rrect(0, 20.5, 40, 5, 0), lo(col, 0.3));
      // The fins: ridges along the housing, each a dark groove under a lit edge.
      for (const y of [13.6, 16.4, 19.2, 22]) {
        line(ctx, [[6, y], [22, y]], 1.2, lo(col, 0.5));
        line(ctx, [[6, y - 1.1], [22, y - 1.1]], 0.7, hi(col, 0.5));
      }
    });
    stroke(ctx, body);
    // The near end bell, face on, and the shaft.
    const end = oval(22.5, 17.5, 3.6, 7.6);
    part(ctx, end, hi(col, 0.2), { d: 1, l: 0.9 });
    const shaft = rrect(23.5, 15.6, 6.5, 3.8, 0.8);
    fill(ctx, shaft, STEEL);
    rim(ctx, shaft, -0.6, -1, STEEL_D);
    stroke(ctx, shaft, LINE);
    line(ctx, [[25.6, 16.2], [28.6, 16.2]], 1, C.ink);
    // The terminal box on top, its gland out of its side.
    const box = rrect(10, 5, 8, 6.2, 1.2);
    part(ctx, box, hi(col, 0.25), { d: 1, l: 0.8 });
    line(ctx, [[12, 7.6], [16, 7.6]], 0.8, lo(col, 0.45));
    const gland = rrect(17.6, 6.6, 2.6, 2.8, 0.6);
    fill(ctx, gland, STEEL);
    stroke(ctx, gland, LINE);
    glint(ctx, 11.6, 6.6, 1);
  },
  // ── D125: the machines' waste ───────────────────────────────────────────
  slag: (ctx, col) => {
    // Slag: a lump of clinker — rounded bulges run together (where coal is angular facets and stone
    // a squared block), a frozen drip under it, frothy with gas bubbles of every size, its skin
    // vitreous: lit in a cool glassy grey rather than a warm tone, a dull streak on its shoulder.
    // One silhouette made of lobes: its outline inked once round the union, lit top-left and
    // shaded bottom-right as one body (`lumpLit`).
    const lobes: ReadonlyArray<readonly [number, number, number]> = [
      [14, 14.5, 8.4], [22, 11.5, 5.6], [8.6, 20.5, 5.4], [19, 21, 6.8], [26.2, 18.8, 3.4], [11.2, 7.6, 3.8], [24.2, 26.6, 2.3], [5.2, 13.5, 2.6],
    ];
    lumpLit(ctx, lobes, col, mix(col, '#a7c0c2', 0.5));
    // The bubbles: dark pits, each lit on its far wall (the light falls in from the top-left).
    for (const [x, y, r] of [[11, 12.5, 1.7], [16.5, 10, 1.15], [21.5, 9.5, 1.3], [8.2, 20, 1.6], [13.2, 18.4, 1.25], [11.5, 23.6, 0.95], [6, 15, 0.8], [17.4, 14.2, 0.8], [21.6, 18.2, 1.5], [25.6, 13, 0.9], [18.6, 25.2, 1.2], [24.4, 22.6, 1], [26.6, 19.4, 0.7], [15.2, 22.4, 0.7]] as const) {
      const b = oval(x, y, r, r * 0.86);
      fill(ctx, b, lo(col, 0.66));
      rim(ctx, b, -r * 0.5, -r * 0.6, hi(col, 0.32));
    }
    // The glassy skin: a cool, dull streak round the big bulge's lit shoulder, and the one glint on the break.
    stroke(ctx, (k) => { k.moveTo(14 + Math.cos(1.1 * Math.PI) * 6.2, 14.5 + Math.sin(1.1 * Math.PI) * 6.2); k.arc(14, 14.5, 6.2, 1.1 * Math.PI, 1.38 * Math.PI); }, 1.6, mix(hi(col, 0.3), '#9fc3c0', 0.45));
    glint(ctx, 23.4, 9.4, 1.15);
  },
  scrap: (ctx, col) => {
    // Scrap: the press's offcuts — behind, a corner of sheet sheared off with a jagged edge and bent
    // along one fold (a lit plane, a shaded one); in front, the skeleton of a punched strip (the row
    // of holes the blanks were cut from), kinked up halfway, its torn end ragged. Bent, torn, holed
    // sheet: not the plate's clean slab, the bar's block or the pipe's tube.
    const A: P = [3, 12], B: P = [14, 3.8], Cc: P = [28, 7.6], F0: P = [16, 4.4], F1: P = [16.6, 14.6]; // the corners, the fold
    const jag: P[] = [[26.6, 10.4], [24, 10], [22.5, 13], [20, 12], [18, 15.2], [F1[0] - 1.2, 14.1], [13, 16.6], [10.4, 15], [7.4, 16.4], [5, 14.4]];
    const sheet = poly([A, B, Cc, ...jag]);
    const under: P[] = jag.slice().reverse().map(([x, y]) => [x, y + 2] as P);
    const edge = poly([Cc, ...jag, A, [A[0], A[1] + 2], ...under, [Cc[0], Cc[1] + 2]]);
    fill(ctx, edge, lo(col, 0.45));
    stroke(ctx, edge);
    fill(ctx, sheet, col);
    inside(ctx, sheet, () => {
      fill(ctx, poly([A, B, F0, F1, [13, 16.6], [3, 17]]), hi(col, 0.42));
      fill(ctx, poly([F0, Cc, [28, 12], F1]), lo(col, 0.2));
    });
    line(ctx, [F0, F1], LINE, lo(col, 0.55));
    stroke(ctx, sheet);
    // The punched strip: two flat runs either side of a kink (the near one level, the far one bent
    // up to the light), its thickness under them, a row of holes, the near end torn.
    const P0: P = [3.6, 25.6], P1: P = [16, 22.8], P2: P = [28.2, 15.6], v: P = [0.8, -3.2];
    const add = (p: P, q: P, k = 1): P => [p[0] + q[0] * k, p[1] + q[1] * k];
    const torn: P[] = [[4.6, 24.2], [3.2, 23.4]]; // the ragged end, between P0−v and P0+v
    const run1 = poly([add(P0, v), add(P1, v), add(P1, v, -1), add(P0, v, -1), ...torn]);
    const run2 = poly([add(P1, v), add(P2, v), add(P2, v, -1), add(P1, v, -1)]);
    const T = 1; // its thickness
    const thick = poly([add(P0, v, -1), add(P1, v, -1), add(P2, v, -1), add(add(P2, v, -1), [0, T]), add(add(P1, v, -1), [0, T]), add(add(P0, v, -1), [0, T])]);
    fill(ctx, thick, lo(col, 0.45));
    stroke(ctx, thick);
    fill(ctx, run1, col);
    rim(ctx, run1, 0.9, 1, hi(col, 0.4));
    fill(ctx, run2, hi(col, 0.3));
    for (const [p, q, ts] of [[P0, P1, [0.36, 0.78]], [P1, P2, [0.3, 0.74]]] as const) {
      for (const t of ts) {
        const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
        const h = oval(x, y, 1.75, 1.45, Math.atan2(q[1] - p[1], q[0] - p[0]));
        fill(ctx, h, lo(col, 0.72));
        rim(ctx, h, -0.7, -0.8, lo(col, 0.2)); // the hole's lit far wall: the sheet's own thickness
      }
    }
    line(ctx, [add(P1, v), add(P1, v, -1)], LINE, lo(col, 0.5));
    stroke(ctx, run1);
    stroke(ctx, run2);
    glint(ctx, 8.2, 9.6, 1.2);
  },
};

/** Circles' union as one shape (nonzero: overlaps fill once). */
const union = (lobes: ReadonlyArray<readonly [number, number, number]>, dx = 0, dy = 0): Shape => (ctx) => {
  for (const [x, y, r] of lobes) circle(x + dx, y + dy, r)(ctx);
};

/**
 * A body made of round lobes, lit as one: its outline inked round the union (a double-width stroke
 * whose inner half the fill covers), the lit band where the union shifted down-right leaves it
 * (top-left; `lit`, its tone), the shaded band where it shifted up-left leaves it (bottom-right) —
 * `rim` for a shape of many overlapping contours, by nested clips.
 */
function lumpLit(ctx: Ctx, lobes: ReadonlyArray<readonly [number, number, number]>, col: string, lit = hi(col, 0.36)): void {
  const all: Shape = (k) => k.rect(-GLYPH, -GLYPH, GLYPH * 3, GLYPH * 3);
  stroke(ctx, union(lobes), OUT * 2);
  inside(ctx, union(lobes), () => {
    fill(ctx, all, lit);
    inside(ctx, union(lobes, 1.1, 1.3), () => {
      fill(ctx, all, lo(col, 0.34));
      inside(ctx, union(lobes, -1.7, -2.1), () => fill(ctx, all, col));
    });
  });
}

/** Draw one item glyph in the 32 px space (the caller scales). */
export function drawItem(ctx: Ctx, id: ItemId): void {
  const def = ITEMS[id] as ItemDef;
  GLYPHS[def.glyph](ctx, def.color);
}
