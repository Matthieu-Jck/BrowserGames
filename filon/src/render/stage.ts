// stage.ts — PixiJS v8 renderer creation. We use autoDetectRenderer (no Application, no
// ticker): main.ts owns the loop, like the sibling games. Texture GC is off — the atlas is
// permanent and terrain chunks are evicted explicitly by their LRU.
import { autoDetectRenderer, Container, type Renderer, type TextureSource } from 'pixi.js';

export interface Stage {
  renderer: Renderer;
  root: Container;
  /** CSS-pixel size of the view. */
  width: number;
  height: number;
  resolution: number;
  resize(): void;
}

/**
 * `perf`: lighter rendering (1× resolution, no antialiasing). `lowPower` (« Basse consommation »,
 * D100): ask for the economical GPU — on a computer with two, the integrated one, which leaves the
 * discrete one (and its fans) asleep.
 */
export async function createStage(host: HTMLElement, opts: { perf?: boolean; lowPower?: boolean } = {}): Promise<Stage> {
  const resolution = opts.perf ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const renderer = await autoDetectRenderer({
    preference: 'webgl',
    width: window.innerWidth,
    height: window.innerHeight,
    resolution,
    autoDensity: true,
    antialias: !opts.perf,
    backgroundColor: 0xeed7b8,
    powerPreference: opts.lowPower ? 'low-power' : 'high-performance',
    textureGCActive: false,
  });
  host.appendChild(renderer.canvas);
  const root = new Container();
  // Tile hit-testing goes through the occupancy grid, never through Pixi's event traversal.
  root.eventMode = 'none';
  root.interactiveChildren = false;

  const stage: Stage = {
    renderer,
    root,
    width: window.innerWidth,
    height: window.innerHeight,
    resolution,
    resize() {
      stage.width = window.innerWidth;
      stage.height = window.innerHeight;
      renderer.resize(stage.width, stage.height, stage.resolution);
    },
  };
  window.addEventListener('resize', () => stage.resize());
  return stage;
}

/**
 * A test of the texture sources on the GPU now (D162: the neighbouring bases share a page of the
 * claim's atlas only where it is up already, render/world/neighbour-art.ts). Read once from the GL
 * texture system's list (Pixi 8's `managedTextures`); none known: none up (they copy, never share).
 */
export function gpuSources(r: Renderer): (s: TextureSource) => boolean {
  const list = (r.texture as unknown as { managedTextures?: ReadonlyArray<TextureSource | null> }).managedTextures ?? [];
  const up = new Set<TextureSource>();
  for (const s of list) if (s) up.add(s);
  return (s) => up.has(s);
}

/** Renderer label for diagnostics ('webgl' | 'webgpu' | 'canvas'). */
export function rendererName(r: Renderer): string {
  return r.name;
}
