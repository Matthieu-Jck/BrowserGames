// skyline.ts — a bottom-left skyline packer for one square page (art/dyn-atlas.ts `fit`, D162): the
// page's filled height across it is kept as segments, left to right; a w × h rect goes where its
// bottom ends highest up, then leftmost, and the skyline under it rises to its bottom. Sprites of very
// mixed sizes coming in no order (the neighbouring bases' copies and dress) waste far less than on
// shelves, where a row is as tall as its tallest. Pure: positions only, padding taken with each rect.

export class Skyline {
  /** Segments [x, x + w) filled down to y, left to right, covering [pad, size). */
  private readonly sky: Array<{ x: number; y: number; w: number }>;

  constructor(private readonly size: number, private readonly pad: number) {
    this.sky = [{ x: pad, y: pad, w: size - pad }];
  }

  /** Where a w × h rect goes (its top-left), `pad` px clear of the others and of the page's edges; null: no room. */
  place(w: number, h: number): [number, number] | null {
    const sky = this.sky, W = w + this.pad, H = h + this.pad;
    let at = -1, top = 0, end = Infinity;
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i]!.x;
      if (x + W > this.size) break;
      let y = 0;
      for (let j = i, span = 0; span < W; span += sky[j]!.w, j++) y = Math.max(y, sky[j]!.y);
      if (y + H <= this.size && y + H < end) { at = i; top = y; end = y + H; }
    }
    if (at < 0) return null;
    const x = sky[at]!.x;
    // The segments under it replaced by its bottom; one it covers in part keeps its rest.
    let j = at;
    while (j < sky.length && sky[j]!.x + sky[j]!.w <= x + W) j++;
    const rest = j < sky.length && sky[j]!.x < x + W ? { x: x + W, y: sky[j]!.y, w: sky[j]!.x + sky[j]!.w - (x + W) } : null;
    sky.splice(at, j - at + (rest ? 1 : 0), { x, y: top + H, w: W }, ...(rest ? [rest] : []));
    // Neighbours at one height merge.
    for (let i = sky.length - 1; i > 0; i--) if (sky[i]!.y === sky[i - 1]!.y) { sky[i - 1]!.w += sky[i]!.w; sky.splice(i, 1); }
    return [x, top];
  }
}
