// atlas.ts — bakes every sprite with Canvas2D (deterministic, antialiased, clip-able), packs
// them on 2048² pages with a shelf packer (8 px padding survives mipmaps) and wraps each page
// in one Pixi texture source, so hot layers batch. Pages are also exposed as canvases for the
// DOM (artboard, icons) — pixel-identical to the game. Buildings with a moving part
// (recipes/moving.ts) also get their body alone and the part's phases, cropped to one cell
// size and packed together as one sheet — the same page, so stepping through them never
// breaks a batch.
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { BUILDING_IDS, ITEM_IDS, isBeltDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import type { ItemId } from '@/content/items';
import type { Rot } from '@/sim/types';
import type { Ctx } from './ink';
import { drawBuilding, drawBuildingMoving, needsRotations } from './recipes/buildings';
import { drawBuildingTop, drawBuildingTopMoving, needsRotationsTop, TOP_MARGIN, TOP_PX } from './recipes/buildings-top';
import { MOVING } from './recipes/moving';
import { drawItem, GLYPH } from './recipes/items';
import { BELT_PX, BELT_TIERS, drawCorner, drawDeck, drawInlet, drawStraight, type BeltTier } from './recipes/belts';
import { C } from './tokens';
import { drawIcon, ICON, ICON_IDS } from './recipes/icons';

export const PAGE = 2048;
const PAD = 8;

export interface FrameInfo {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Anchor inside the frame (atlas px): buildings — the footprint's ground corner (tile 0,0). */
  ox: number;
  oy: number;
  /** Scale to the sprite's space: world px per atlas px (iso), tiles per atlas px (plan). */
  k: number;
}

/** A building sprite with a moving part (by its `bKey` / `btKey`): its phases, and whether the part goes over the body. */
export interface MovingFrames { n: number; over: boolean }

export interface Atlas {
  pages: HTMLCanvasElement[];
  frames: Map<string, FrameInfo>;
  textures: Map<string, Texture>;
  /** Sprites whose building has a moving part: `bodyKey(key)` and `partKey(key, k)` exist for them. */
  moving: Map<string, MovingFrames>;
  bakeMs: number;
}

/** A piece to pack; `cells`: a sheet of equal cells (a moving part's phases), each its own frame. */
interface Piece { key: string; canvas: HTMLCanvasElement; ox: number; oy: number; k: number; cells?: { n: number; w: number; h: number; cols: number } }

function canvasOf(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { canvas, ctx };
}

export const bKey = (id: string, rot: Rot): string => `b:${id}:${rot}`;
/** Plan-view (build mode) building frame. */
export const btKey = (id: string, rot: Rot): string => `bt:${id}:${rot}`;
export const iKey = (id: string): string => `i:${id}`;
export const beltKey = (tier: string, corner: boolean): string => `belt:${tier}:${corner ? 'c' : 's'}`;
export const iconKey = (id: string): string => `ic:${id}`;
/** An item as it rides a ribbon: the glyph at 2×, on a paper halo, with a contact shadow. */
export const ibKey = (id: string): string => `ib:${id}`;
/** Side inlet of a straight ribbon piece (a line merging in from its left). */
export const inletKey = (tier: string): string => `belt:${tier}:inlet`;
export const DECK_KEY = 'belt:deck';
/** The body alone of a building sprite (`bKey` / `btKey`) whose moving part is drawn apart. */
export const bodyKey = (key: string): string => `${key}/body`;
/** Phase k of the moving part of a building sprite (`bKey` / `btKey`), anchored like the sprite. */
export const partKey = (key: string, k: number): string => `${key}/${k}`;
/** Belt-item frames: px square (the glyph is drawn at ×2 inside). */
export const IB_PX = 64;

/**
 * The belt variant of an item glyph. A ribbon is teal, steel and slats: a sticker-like paper
 * halo keeps every item readable on it (glass and circuits are teal themselves), and a soft
 * contact shadow sets it down on the belt.
 */
function drawBeltItem(id: ItemId): HTMLCanvasElement {
  const k = 2;
  const g = canvasOf(GLYPH * k, GLYPH * k);
  g.ctx.scale(k, k);
  drawItem(g.ctx, id);
  const sil = canvasOf(IB_PX, IB_PX);
  sil.ctx.drawImage(g.canvas, 0, 0);
  sil.ctx.globalCompositeOperation = 'source-in';
  sil.ctx.fillStyle = C.paper;
  sil.ctx.fillRect(0, 0, IB_PX, IB_PX);
  const out = canvasOf(IB_PX, IB_PX);
  const ctx = out.ctx;
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.ellipse(IB_PX / 2 + 2, IB_PX * 0.74, IB_PX * 0.3, IB_PX * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const R = 2.6;
  for (let a = 0; a < 16; a++) ctx.drawImage(sil.canvas, Math.cos((a * Math.PI) / 8) * R, Math.sin((a * Math.PI) / 8) * R);
  ctx.drawImage(g.canvas, 0, 0);
  return out.canvas;
}

/**
 * The phases of a moving part (canvases the size of the whole sprite, anchor (ox, oy)), cropped
 * to the bounds all of them paint and laid out as a sheet of equal cells, PAD apart.
 */
function partSheet(key: string, parts: HTMLCanvasElement[], ox: number, oy: number, k: number): Piece {
  const W = parts[0]!.width, H = parts[0]!.height;
  // Every phase stacked on one canvas: one read-back finds the bounds they all paint.
  const all = canvasOf(W, H);
  for (const c of parts) all.ctx.drawImage(c, 0, 0);
  const d = all.ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3]! > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
  const cw = x1 - x0 + 3, ch = y1 - y0 + 3, n = parts.length;
  const cols = Math.max(1, Math.min(n, Math.floor((PAGE - PAD) / (cw + PAD))));
  const rows = Math.ceil(n / cols);
  const sheet = canvasOf(cols * cw + (cols - 1) * PAD, rows * ch + (rows - 1) * PAD);
  parts.forEach((c, i) => sheet.ctx.drawImage(c, x0 - 1, y0 - 1, cw, ch, (i % cols) * (cw + PAD), Math.floor(i / cols) * (ch + PAD), cw, ch));
  return { key, canvas: sheet.canvas, ox: ox - x0 + 1, oy: oy - y0 + 1, k, cells: { n, w: cw, h: ch, cols } };
}

export function bakeAtlas(): Atlas {
  const t0 = performance.now();
  const pieces: Piece[] = [];
  const moving = new Map<string, MovingFrames>();
  const make = (w: number, h: number): { ctx: Ctx; canvas: unknown } => canvasOf(w, h) as unknown as { ctx: Ctx; canvas: unknown };
  for (const id of BUILDING_IDS) {
    if (isBeltDef(id)) continue; // ribbons and conduits are drawn as belt pieces
    const rots: Rot[] = needsRotations(id as BuildingId) ? [0, 1, 2, 3] : [0];
    const spec = MOVING[id as BuildingId];
    for (const rot of rots) {
      const { canvas, frame } = drawBuilding(id as BuildingId, rot, make);
      pieces.push({ key: bKey(id, rot), canvas: canvas as HTMLCanvasElement, ox: frame.ox, oy: frame.oy, k: 0.5 });
      const mv = spec ? drawBuildingMoving(id as BuildingId, rot, spec.frames, make) : null;
      if (mv) {
        pieces.push({ key: bodyKey(bKey(id, rot)), canvas: mv.body as HTMLCanvasElement, ox: frame.ox, oy: frame.oy, k: 0.5 });
        pieces.push(partSheet(bKey(id, rot), mv.parts as HTMLCanvasElement[], frame.ox, frame.oy, 0.5));
        moving.set(bKey(id, rot), { n: spec!.frames, over: mv.over });
      }
    }
  }
  for (const id of BUILDING_IDS) {
    if (isBeltDef(id)) continue; // ribbons and conduits are drawn as belt pieces
    const rots: Rot[] = needsRotationsTop(id as BuildingId) ? [0, 1, 2, 3] : [0];
    const spec = MOVING[id as BuildingId];
    for (const rot of rots) {
      const { canvas } = drawBuildingTop(id as BuildingId, rot, make);
      pieces.push({ key: btKey(id, rot), canvas: canvas as HTMLCanvasElement, ox: TOP_MARGIN, oy: TOP_MARGIN, k: 1 / TOP_PX });
      const mv = spec ? drawBuildingTopMoving(id as BuildingId, rot, spec.frames, make) : null;
      if (mv) {
        pieces.push({ key: bodyKey(btKey(id, rot)), canvas: mv.body as HTMLCanvasElement, ox: TOP_MARGIN, oy: TOP_MARGIN, k: 1 / TOP_PX });
        pieces.push(partSheet(btKey(id, rot), mv.parts as HTMLCanvasElement[], TOP_MARGIN, TOP_MARGIN, 1 / TOP_PX));
        moving.set(btKey(id, rot), { n: spec!.frames, over: true });
      }
    }
  }
  for (const id of ITEM_IDS) {
    // Drawn at 2× (the glyphs live in a 32 px space): crisp UI icons on high-density screens.
    const { canvas, ctx } = canvasOf(GLYPH * 2, GLYPH * 2);
    ctx.scale(2, 2);
    drawItem(ctx, id as ItemId);
    pieces.push({ key: iKey(id), canvas, ox: GLYPH, oy: GLYPH, k: 0.5 });
  }
  for (const id of ITEM_IDS) pieces.push({ key: ibKey(id), canvas: drawBeltItem(id as ItemId), ox: IB_PX / 2, oy: IB_PX / 2, k: 1 });
  for (const tier of Object.keys(BELT_TIERS) as BeltTier[]) {
    for (const corner of [false, true]) {
      const { canvas, ctx } = canvasOf(BELT_PX, BELT_PX);
      if (corner) drawCorner(ctx, tier, 5); else drawStraight(ctx, tier, 5);
      pieces.push({ key: beltKey(tier, corner), canvas, ox: BELT_PX / 2, oy: BELT_PX / 2, k: 1 / BELT_PX });
    }
    const { canvas, ctx } = canvasOf(BELT_PX, BELT_PX);
    drawInlet(ctx, tier, 7);
    pieces.push({ key: inletKey(tier), canvas, ox: BELT_PX / 2, oy: BELT_PX / 2, k: 1 / BELT_PX });
  }
  {
    const { canvas, ctx } = canvasOf(BELT_PX, BELT_PX);
    drawDeck(ctx, 11);
    pieces.push({ key: DECK_KEY, canvas, ox: BELT_PX / 2, oy: BELT_PX / 2, k: 1 / BELT_PX });
  }
  for (const id of ICON_IDS) {
    const { canvas, ctx } = canvasOf(ICON, ICON);
    drawIcon(ctx, id);
    pieces.push({ key: iconKey(id), canvas, ox: ICON / 2, oy: ICON / 2, k: 1 });
  }

  // Shelf packing, tallest first (stable by key for determinism).
  pieces.sort((a, b) => b.canvas.height - a.canvas.height || a.key.localeCompare(b.key));
  const pages: HTMLCanvasElement[] = [];
  const frames = new Map<string, FrameInfo>();
  let page = -1, x = PAD, y = PAD, rowH = 0;
  let pctx: CanvasRenderingContext2D | null = null;
  const newPage = (): void => {
    const c = document.createElement('canvas');
    c.width = PAGE; c.height = PAGE;
    pages.push(c);
    pctx = c.getContext('2d')!;
    page = pages.length - 1;
    x = PAD; y = PAD; rowH = 0;
  };
  newPage();
  for (const p of pieces) {
    const w = p.canvas.width, h = p.canvas.height;
    if (x + w + PAD > PAGE) { x = PAD; y += rowH + PAD; rowH = 0; }
    if (y + h + PAD > PAGE) newPage();
    pctx!.drawImage(p.canvas, x, y);
    if (p.cells) {
      const c = p.cells;
      for (let i = 0; i < c.n; i++) {
        frames.set(partKey(p.key, i), { page, x: x + (i % c.cols) * (c.w + PAD), y: y + Math.floor(i / c.cols) * (c.h + PAD), w: c.w, h: c.h, ox: p.ox, oy: p.oy, k: p.k });
      }
    } else frames.set(p.key, { page, x, y, w, h, ox: p.ox, oy: p.oy, k: p.k });
    x += w + PAD;
    rowH = Math.max(rowH, h);
  }

  const sources = pages.map((c) => new CanvasSource({ resource: c, autoGenerateMipmaps: true, scaleMode: 'linear' }));
  const textures = new Map<string, Texture>();
  for (const [k, f] of frames) {
    textures.set(k, new Texture({ source: sources[f.page]!, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
  }
  return { pages, frames, textures, moving, bakeMs: performance.now() - t0 };
}

/** Copy one frame into a standalone canvas (DOM icons, artboard). */
export function frameCanvas(atlas: Atlas, key: string, scale = 1): HTMLCanvasElement | null {
  const f = atlas.frames.get(key);
  if (!f) return null;
  // Backed at the screen's pixel density and shown at CSS size: a 1× canvas on a 2× screen is
  // stretched by the browser, and the icon blurs.
  const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
  const w = Math.ceil(f.w * scale), h = Math.ceil(f.h * scale);
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(atlas.pages[f.page]!, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
  return c;
}
