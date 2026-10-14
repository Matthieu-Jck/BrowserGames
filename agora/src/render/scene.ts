// scene.ts — the contract every chapter visualisation implements, plus a manager that
// owns them and routes update/render to the active one. Scenes draw on the 'scene'
// canvas; they read parameters set by the DOM sandbox controls and the journey, and
// they render "damage" when a blunt verdict fires.
import type { Severity, SceneId } from '@/core/kinds';

export interface Scene {
  readonly id: SceneId;
  /** Set one sandbox/journey parameter (e.g. 'price', 'tax', 'boats'). */
  setParam(key: string, value: number): void;
  /** Trigger the reveal animation (curves sweep in, point lands). */
  reveal(): void;
  /** Render the consequence of a verdict at this severity. */
  showVerdict(severity: Severity): void;
  resize(w: number, h: number): void;
  update(dt: number, t: number): void;
  render(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** Sims (auction, fishery) run to their end synchronously for the debug API. */
  runToCompletion?(): void;
  /** The latest engine result this scene computed, for the debug API. */
  result?(): unknown;
}

export class SceneManager {
  private scenes = new Map<SceneId, Scene>();
  private active: SceneId = 'ambient';
  private w = 0;
  private h = 0;

  register(scene: Scene): void {
    this.scenes.set(scene.id, scene);
  }

  setActive(id: SceneId): void {
    this.active = id;
  }

  current(): Scene | null {
    return this.scenes.get(this.active) ?? null;
  }

  get(id: SceneId): Scene | null {
    return this.scenes.get(id) ?? null;
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    for (const s of this.scenes.values()) s.resize(w, h);
  }

  update(dt: number, t: number): void {
    this.current()?.update(dt, t);
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.current()?.render(ctx, this.w, this.h);
  }
}
