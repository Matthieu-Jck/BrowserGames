// dyn-atlas.ts — an atlas that grows on demand: sprites are baked the first time they are
// needed (relief columns come in hundreds of combinations, only a few dozen per view), shelf-
// packed on 2048² pages and uploaded once per frame. Same padding rules as the static atlas.
import { CanvasSource, Rectangle, Texture } from 'pixi.js';

const PAGE = 2048;
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

  get(key: string): DynFrame | undefined {
    return this.frames.get(key);
  }

  get size(): number { return this.frames.size; }

  private newPage(): void {
    const c = document.createElement('canvas');
    c.width = c.height = PAGE;
    this.pages.push(c);
    this.sources.push(new CanvasSource({ resource: c, autoGenerateMipmaps: true, scaleMode: 'linear' }));
    this.x = PAD; this.y = PAD; this.rowH = 0;
  }

  /** Bake a sprite of w×h px whose anchor is (ox, oy); `draw` paints into a fresh canvas. */
  add(key: string, w: number, h: number, ox: number, oy: number, draw: (ctx: CanvasRenderingContext2D) => void): DynFrame {
    const t0 = performance.now();
    w = Math.ceil(w); h = Math.ceil(h);
    if (!this.pages.length) this.newPage();
    if (this.x + w + PAD > PAGE) { this.x = PAD; this.y += this.rowH + PAD; this.rowH = 0; }
    if (this.y + h + PAD > PAGE) this.newPage();
    const page = this.pages.length - 1;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d')!;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    draw(ctx);
    this.pages[page]!.getContext('2d')!.drawImage(tmp, this.x, this.y);
    const tex = new Texture({ source: this.sources[page]!, frame: new Rectangle(this.x, this.y, w, h) });
    const f: DynFrame = { tex, ox, oy, page, x: this.x, y: this.y, w, h };
    this.frames.set(key, f);
    this.dirty.add(page);
    this.x += w + PAD;
    this.rowH = Math.max(this.rowH, h);
    this.spent += performance.now() - t0;
    return f;
  }

  /** Upload pages that changed (once per frame). */
  flush(): void {
    for (const p of this.dirty) this.sources[p]!.update();
    this.dirty.clear();
    this.spent = 0;
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
