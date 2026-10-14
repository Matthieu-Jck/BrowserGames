// layers.ts — the stacked, full-viewport canvas system. Three fixed layers compose the
// generative depth: a slow ambient field at the back, the active scene in the middle,
// and fast foreground effects (verdict "damage") on top. The DOM #ui sits above all.
export type LayerName = 'bg' | 'scene' | 'fx';

export class LayeredCanvas {
  width = 0;
  height = 0;
  dpr = 1;
  /** Pixels scrolled — fed by the ScrollDriver, read by renderers for parallax. */
  scroll = 0;

  private canvases: Record<LayerName, HTMLCanvasElement>;
  private ctxs: Record<LayerName, CanvasRenderingContext2D>;

  constructor() {
    const get = (id: string): HTMLCanvasElement => {
      const c = document.getElementById(id);
      if (!(c instanceof HTMLCanvasElement)) throw new Error(`missing canvas #${id}`);
      return c;
    };
    this.canvases = { bg: get('bg'), scene: get('scene'), fx: get('fx') };
    this.ctxs = {
      bg: this.canvases.bg.getContext('2d')!,
      scene: this.canvases.scene.getContext('2d')!,
      fx: this.canvases.fx.getContext('2d')!,
    };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  ctx(layer: LayerName): CanvasRenderingContext2D {
    return this.ctxs[layer];
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    for (const name of Object.keys(this.canvases) as LayerName[]) {
      const c = this.canvases[name];
      c.width = Math.floor(this.width * this.dpr);
      c.height = Math.floor(this.height * this.dpr);
      c.style.width = `${this.width}px`;
      c.style.height = `${this.height}px`;
      const ctx = this.ctxs[name];
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  clear(layer: LayerName): void {
    this.ctxs[layer].clearRect(0, 0, this.width, this.height);
  }

  clearAll(): void {
    this.clear('bg');
    this.clear('scene');
    this.clear('fx');
  }
}
