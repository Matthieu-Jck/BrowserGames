// neighbour-art.ts — the textures the neighbouring bases are drawn with (D162; world/neighbour-lod.ts
// says which look a base wears). Two sheets of their own, 1024² pages, never the claim's atlas pulled
// onto the GPU for them:
// - far: every texture a base shows — its buildings' frames (the static atlas), its flag's, its
//   pits', its ribbons', the goods on them — copied at half size the first time it is needed
//   (`art('far')`), its dress drawn at half size (`bake`); its name bands and the smoke's puff at
//   their own size (`label`: constant on screen). A copy keeps its frame's exact size in texture units
//   (a fractional frame), so a sprite drawn with it at twice the scale covers exactly what it did.
// - detail: a frame whose page is on the GPU already (the claim draws from it) is shared as it is;
//   any other is copied at full size; the dress at full size.
// A sheet is renewed when it grows past `SHEET_CAP` pages (its bases laid again on a fresh one) and
// the detail one dropped when no base wears detail for a while (`renew`); an old sheet is destroyed
// once no base is drawn from it (`sweep`): its pages leave the GPU, their canvases are let go.
import { Rectangle, Texture, type TextureSource } from 'pixi.js';
import { DynAtlas, type DynFrame } from '../art/dyn-atlas';
import { FAR_K, type Look } from './neighbour-lod';

/** The sheets' page side (px): the largest frame copied (a 6 × 6 building's, ~670 px) fits, and the GPU takes them a few MB at a time. */
const PAGE = 1024;

/** One look's sheet: its atlas, its generation (a base remembers which it was drawn from), what was copied or baked on it. */
interface Sheet { atlas: DynAtlas; gen: number; copies: Map<Texture, Texture>; baked: Map<string, DynFrame> }

/** A texture's source as Canvas2D can draw it (a canvas, a bitmap, an image), else null: such a texture is shared, never copied. */
function drawable(r: unknown): CanvasImageSource | null {
  if (typeof HTMLCanvasElement !== 'undefined' && r instanceof HTMLCanvasElement) return r;
  if (typeof OffscreenCanvas !== 'undefined' && r instanceof OffscreenCanvas) return r;
  if (typeof ImageBitmap !== 'undefined' && r instanceof ImageBitmap) return r;
  if (typeof HTMLImageElement !== 'undefined' && r instanceof HTMLImageElement) return r;
  return null;
}

/** How the buildings view draws a base's sprites (`layForeign`): each texture through `map` (null: kept), its scale × `k`. */
export interface ForeignArt { map(t: Texture): Texture | null; readonly k: number }

export class NeighbourArt {
  private gens = 0;
  private readonly sheets: Record<Look, Sheet>;
  private retired: Sheet[] = [];

  /** `onGpu`: a test of the texture sources on the GPU now (made at most once per base laid or texture first asked). */
  constructor(private readonly onGpu: () => (s: TextureSource) => boolean) {
    this.sheets = { far: this.sheet(), detail: this.sheet() };
  }

  private sheet(): Sheet {
    return { atlas: new DynAtlas(PAGE, true), gen: ++this.gens, copies: new Map(), baked: new Map() };
  }

  /** The current sheet's generation of a look. */
  gen(look: Look): number { return this.sheets[look].gen; }

  /** Pages of a look's current sheet (stats, renewal), and every sheet's (current or retired) bytes once on the GPU. */
  pages(look: Look): number { return this.sheets[look].atlas.pages.length; }
  get bytes(): number { return [this.sheets.far, this.sheets.detail, ...this.retired].reduce((n, s) => n + s.atlas.bytes, 0); }

  /** The art a base is laid with in a look: far, every texture's half-size copy; detail, the claim's own where its page is up, else a copy. */
  art(look: Look): ForeignArt {
    if (look === 'far') return { map: (t) => this.copy(this.sheets.far, t, FAR_K), k: FAR_K };
    let up: ((s: TextureSource) => boolean) | null = null;
    const gpu = (): ((s: TextureSource) => boolean) => (up ??= this.onGpu());
    return { map: (t) => { const c = this.copy(this.sheets.detail, t, 1, gpu); return c === t ? null : c; }, k: 1 };
  }

  /** One texture in a look (the goods, per frame): its copy, or itself where shared; the scale it is drawn at × `k`. */
  tex(look: Look, t: Texture): Texture {
    return look === 'far' ? this.copy(this.sheets.far, t, FAR_K) : this.copy(this.sheets.detail, t, 1, this.onGpu);
  }

  /**
   * A texture copied onto a sheet at 1/f of its size, once per sheet (`gpu`: shared as it is when its
   * source is on the GPU). The copy's frame is the original's / f exactly (fractional), so anchors and
   * scales map exactly.
   */
  private copy(s: Sheet, t: Texture, f: number, gpu?: () => (s: TextureSource) => boolean): Texture {
    let c = s.copies.get(t);
    if (c) return c;
    const src = drawable(t.source.resource);
    if (!src || (gpu && gpu()(t.source))) c = t;
    else {
      const fr = t.frame, w = fr.width / f, h = fr.height / f;
      const d = s.atlas.add(`c${t.uid}`, w, h, 0, 0, (ctx) => {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, fr.x, fr.y, fr.width, fr.height, 0, 0, w, h);
      });
      c = f === 1 ? d.tex : new Texture({ source: d.tex.source, frame: new Rectangle(d.x, d.y, w, h) });
    }
    s.copies.set(t, c);
    return c;
  }

  /**
   * A piece of dress baked once per key on a look's sheet: w × h px anchored at (ox, oy) as drawn at
   * full size; on the far sheet at 1/FAR_K (its frame's anchor scaled: draw it at FAR_K × the scale).
   */
  bake(look: Look, key: string, w: number, h: number, ox: number, oy: number, draw: (ctx: CanvasRenderingContext2D) => void): DynFrame {
    const s = this.sheets[look];
    let fr = s.baked.get(key);
    if (fr) return fr;
    const f = look === 'far' ? FAR_K : 1;
    fr = s.atlas.add(key, w / f, h / f, ox / f, oy / f, f === 1 ? draw : (ctx) => { ctx.scale(1 / f, 1 / f); draw(ctx); });
    s.baked.set(key, fr);
    return fr;
  }

  /** A sprite of its own size (a name band, the smoke's puff: constant on screen), baked once per key on the far sheet. */
  label(key: string, w: number, h: number, ox: number, oy: number, draw: (ctx: CanvasRenderingContext2D) => void): DynFrame {
    const s = this.sheets.far;
    let fr = s.baked.get(`=${key}`);
    if (!fr) { fr = s.atlas.add(`=${key}`, w, h, ox, oy, draw); s.baked.set(`=${key}`, fr); }
    return fr;
  }

  /** Upload what was baked (once per frame laid). */
  flush(): void { this.sheets.far.atlas.flush(); this.sheets.detail.atlas.flush(); }

  /** A fresh sheet for a look: the bases drawn from the old one are laid again, the old destroyed once none is (`sweep`). */
  renew(look: Look): void {
    const old = this.sheets[look];
    if (!old.atlas.pages.length) return;
    this.retired.push(old);
    this.sheets[look] = this.sheet();
  }

  /** Destroy the retired sheets no base is drawn from now (`inUse`: the generations still drawn). */
  sweep(inUse: ReadonlySet<number>): void {
    if (!this.retired.length) return;
    const keep: Sheet[] = [];
    for (const s of this.retired) if (inUse.has(s.gen)) keep.push(s); else s.atlas.destroy();
    this.retired = keep;
  }

  /** Every sheet gone (another colony): nothing may be drawn from them any more. */
  destroy(): void {
    for (const s of [this.sheets.far, this.sheets.detail, ...this.retired]) s.atlas.destroy();
    this.retired = [];
    this.sheets.far = this.sheet();
    this.sheets.detail = this.sheet();
  }
}
