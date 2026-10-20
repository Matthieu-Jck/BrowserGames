// dyn-atlas.ts — an atlas that grows on demand: sprites are baked the first time they are
// needed (relief columns come in hundreds of combinations, only a few dozen per view), shelf-
// packed on 2048² pages (or smaller: `page`) and uploaded once per frame. Same padding rules as the
// static atlas. Sprites of very mixed sizes in no order waste a row's height under its short ones:
// with `fit`, each page keeps its skyline (art/skyline.ts) and a sprite goes on the first page with
// room, where its bottom ends highest up; a new page only when none has room.
// One whose sprites are all gone can be destroyed (`destroy`: its pages leave the GPU and their
// canvases are let go). Both for the neighbouring bases' sheets (D162).
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { Skyline } from './skyline';

const PAD = 6;

export interface DynFrame { tex: Texture; ox: number; oy: number; page: number; x: number; y: number; w: number; h: number }

export class DynAtlas {
  readonly pages: HTMLCanvasElement[] = [];
  private readonly sources: CanvasSource[] = [];
  private readonly frames = new Map<string, DynFrame>();
  private readonly dirty = new Set<number>();
  private x = PAD;
  private y = PAD;
  private rowH = 0;
  /** Bake time spent this frame (ms), for budgeting. */
  spent = 0;

  /** Each page's skyline (`fit`). */
  private readonly skylines: Skyline[] = [];

  /** `page`: its pages' side (px), 2048 by default; a sprite must fit one. `fit`: skyline packing. */
  constructor(private readonly page = 2048, private readonly fit = false) {}

  get(key: string): DynFrame | undefined {
    return this.frames.get(key);
  }

  get size(): number { return this.frames.size; }

  private newPage(): void {
    const c = document.createElement('canvas');
    c.width = c.height = this.page;
    this.pages.push(c);
    this.sources.push(new CanvasSource({ resource: c, autoGenerateMipmaps: true, scaleMode: 'linear' }));
    this.skylines.push(new Skyline(this.page, PAD));
    this.x = PAD; this.y = PAD; this.rowH = 0;
  }

  /** Bake a sprite of w×h px whose anchor is (ox, oy); `draw` paints into a fresh canvas. */
  add(key: string, w: number, h: number, ox: number, oy: number, draw: (ctx: CanvasRenderingContext2D) => void): DynFrame {
    const t0 = performance.now();
    w = Math.ceil(w); h = Math.ceil(h);
    if (!this.pages.length) this.newPage();
    let page: number, at: [number, number];
    if (this.fit) [page, at] = this.place(w, h);
    else {
      if (this.x + w + PAD > this.page) { this.x = PAD; this.y += this.rowH + PAD; this.rowH = 0; }
      if (this.y + h + PAD > this.page) this.newPage();
      page = this.pages.length - 1;
      at = [this.x, this.y];
      this.x += w + PAD;
      this.rowH = Math.max(this.rowH, h);
    }
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d')!;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    draw(ctx);
    const [x, y] = at;
    this.pages[page]!.getContext('2d')!.drawImage(tmp, x, y);
    const tex = new Texture({ source: this.sources[page]!, frame: new Rectangle(x, y, w, h) });
    const f: DynFrame = { tex, ox, oy, page, x, y, w, h };
    this.frames.set(key, f);
    this.dirty.add(page);
    this.spent += performance.now() - t0;
    return f;
  }

  /** Where a w × h sprite goes with `fit`: on the first page whose skyline has room for it (art/skyline.ts), else on a new page. */
  private place(w: number, h: number): [number, [number, number]] {
    for (let p = 0; p < this.skylines.length; p++) {
      const at = this.skylines[p]!.place(w, h);
      if (at) return [p, at];
    }
    this.newPage();
    const p = this.pages.length - 1;
    return [p, this.skylines[p]!.place(w, h) ?? [PAD, PAD]]; // larger than a page: it overflows, as without `fit`
  }

  /** Upload pages that changed (once per frame). */
  flush(): void {
    for (const p of this.dirty) this.sources[p]!.update();
    this.dirty.clear();
    this.spent = 0;
  }

  /** Every page's bytes on the GPU once drawn, mipmaps included (stats). */
  get bytes(): number { return this.pages.length * this.page * this.page * 4 * (4 / 3); }

  /**
   * Gone for good: its pages leave the GPU, their canvases are let go, its frames forgotten. Only
   * once no sprite shows one of its frames (they would draw nothing).
   */
  destroy(): void {
    for (const s of this.sources) s.destroy();
    for (const c of this.pages) c.width = c.height = 0;
    this.sources.length = 0;
    this.pages.length = 0;
    this.frames.clear();
    this.dirty.clear();
    this.skylines.length = 0;
    this.x = this.y = PAD;
    this.rowH = 0;
  }

  /** A copy of one frame (artboard). */
  canvasOf(key: string, scale = 1): HTMLCanvasElement | null {
    const f = this.frames.get(key);
    if (!f) return null;
    const c = document.createElement('canvas');
    c.width = Math.ceil(f.w * scale);
    c.height = Math.ceil(f.h * scale);
    c.getContext('2d')!.drawImage(this.pages[f.page]!, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
    return c;
  }
}
